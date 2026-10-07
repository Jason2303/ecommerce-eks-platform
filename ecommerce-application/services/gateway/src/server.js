'use strict';

// API gateway: the single entry point for /api.
//   /api/products...  -> product-service
//   /api/orders...    -> order-service
//   /api/health       -> answered here (used for load tests and smoke checks)
// It also adds a request id to every call and applies a per-client rate limit
// stored in Redis, so the limit is shared across all gateway replicas.

const http = require('http');
const crypto = require('crypto');
const express = require('express');
const Redis = require('ioredis');

const SERVICE = 'gateway';
const VERSION = process.env.APP_VERSION || 'dev';
const PORT = Number(process.env.PORT || 3000);
const PRODUCT_SERVICE_URL = process.env.PRODUCT_SERVICE_URL || 'http://product-service:3001';
const ORDER_SERVICE_URL = process.env.ORDER_SERVICE_URL || 'http://order-service:3002';
const RATE_LIMIT_PER_MIN = Number(process.env.RATE_LIMIT_PER_MIN ?? 600); // 0 disables
const UPSTREAM_TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS || 10000);
const SHUTDOWN_DELAY_MS = Number(process.env.SHUTDOWN_DELAY_MS || 5000);

const log = (level, msg, extra = {}) =>
  console.log(JSON.stringify({ time: new Date().toISOString(), level, service: SERVICE, msg, ...extra }));

const redis = new Redis({
  host: process.env.REDIS_HOST || 'redis',
  port: Number(process.env.REDIS_PORT || 6379),
  password: process.env.REDIS_PASSWORD || undefined,
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
  retryStrategy: (times) => Math.min(times * 200, 2000),
});
let redisWasReady = false;
redis.on('ready', () => { redisWasReady = true; log('info', 'redis connected'); });
redis.on('error', (err) => {
  if (redisWasReady) log('warn', 'redis unavailable, rate limiting disabled', { error: err.message });
  redisWasReady = false;
});

// No keep-alive to upstreams. A pooled connection to a Pod that is shutting down
// during a rolling update can be reset mid-request; a fresh connection per request avoids that.
const upstreamAgent = new http.Agent({ keepAlive: false });

const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);

function proxyTo(baseUrl) {
  const target = new URL(baseUrl);
  return (req, res) => {
    const path = req.originalUrl.replace(/^\/api/, '') || '/';
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) if (!HOP_BY_HOP.has(k)) headers[k] = v;
    headers.host = target.host;
    headers['x-request-id'] = req.id;
    headers['x-forwarded-for'] = req.ip;

    const upstream = http.request({
      protocol: target.protocol, hostname: target.hostname, port: target.port || 80,
      method: req.method, path, headers, agent: upstreamAgent, timeout: UPSTREAM_TIMEOUT_MS,
    }, (upRes) => {
      const outHeaders = {};
      for (const [k, v] of Object.entries(upRes.headers)) if (!HOP_BY_HOP.has(k)) outHeaders[k] = v;
      res.writeHead(upRes.statusCode, outHeaders);
      upRes.pipe(res);
    });

    upstream.on('timeout', () => upstream.destroy(Object.assign(new Error('upstream timeout'), { code: 'ETIMEDOUT' })));
    upstream.on('error', (err) => {
      log('error', 'upstream error', { target: target.host, path, error: err.message, requestId: req.id });
      if (res.headersSent) return res.destroy();
      const timedOut = err.code === 'ETIMEDOUT';
      res.status(timedOut ? 504 : 502).json({ error: timedOut ? 'upstream_timeout' : 'upstream_unavailable', requestId: req.id });
    });
    req.pipe(upstream);
  };
}

// Fixed-window rate limit: one Redis counter per client IP per minute.
// Fails open: if Redis is down, requests are allowed rather than rejected.
async function rateLimit(req, res, next) {
  if (RATE_LIMIT_PER_MIN <= 0 || redis.status !== 'ready') return next();
  const windowKey = `rl:${req.ip}:${Math.floor(Date.now() / 60000)}`;
  try {
    const count = await redis.incr(windowKey);
    if (count === 1) await redis.expire(windowKey, 60);
    res.set('X-RateLimit-Limit', String(RATE_LIMIT_PER_MIN));
    res.set('X-RateLimit-Remaining', String(Math.max(RATE_LIMIT_PER_MIN - count, 0)));
    if (count > RATE_LIMIT_PER_MIN) {
      res.set('Retry-After', String(60 - (Math.floor(Date.now() / 1000) % 60)));
      return res.status(429).json({ error: 'rate_limited' });
    }
  } catch { /* fail open */ }
  next();
}

const app = express();
app.disable('x-powered-by');
// Behind ingress-nginx, the client address arrives in X-Forwarded-For.
app.set('trust proxy', true);

let shuttingDown = false;

app.use((req, res, next) => {
  req.id = req.get('x-request-id') || crypto.randomUUID();
  res.set('X-Request-Id', req.id);
  const start = Date.now();
  res.on('finish', () => {
    if (req.path === '/healthz' || req.path === '/readyz') return;
    log('info', 'request', { method: req.method, path: req.originalUrl, status: res.statusCode, ms: Date.now() - start, requestId: req.id });
  });
  next();
});

app.get('/healthz', (req, res) => res.json({ status: 'ok', service: SERVICE, version: VERSION }));
app.get('/readyz', (req, res) => {
  if (shuttingDown) return res.status(503).json({ status: 'shutting_down' });
  res.json({ status: 'ready', rateLimiter: redis.status === 'ready' ? 'ok' : 'down' });
});

app.get('/api/health', (req, res) => res.json({ status: 'ok', service: SERVICE, version: VERSION, hostname: process.env.HOSTNAME || '' }));

app.use('/api/products', rateLimit, proxyTo(PRODUCT_SERVICE_URL));
app.use('/api/orders', rateLimit, proxyTo(ORDER_SERVICE_URL));

app.use((req, res) => res.status(404).json({ error: 'not_found' }));

const server = app.listen(PORT, () =>
  log('info', 'listening', { port: PORT, version: VERSION, products: PRODUCT_SERVICE_URL, orders: ORDER_SERVICE_URL, rateLimitPerMin: RATE_LIMIT_PER_MIN }));

const shutdown = (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  log('info', 'shutdown started', { signal, delayMs: SHUTDOWN_DELAY_MS });
  setTimeout(() => {
    server.close(() => {
      redis.disconnect();
      log('info', 'shutdown complete');
      process.exit(0);
    });
    server.closeIdleConnections();
    setTimeout(() => process.exit(1), 10000).unref();
  }, SHUTDOWN_DELAY_MS);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

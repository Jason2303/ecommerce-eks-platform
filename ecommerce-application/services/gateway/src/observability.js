'use strict';

// Shared observability helpers (an identical copy lives in each Node service,
// because every service is built from its own Docker context).
//
//   * Prometheus metrics: RED metrics for every HTTP route + Node.js runtime metrics.
//   * Trace context: W3C `traceparent` is read from the caller or started here,
//     forwarded to downstream services, and returned as X-Trace-Id.
//   * Logging: JSON lines; trace_id / span_id are added automatically to every
//     line written while a request is being handled (AsyncLocalStorage).

const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');
const client = require('prom-client');

const register = new client.Registry();
client.collectDefaultMetrics({ register });

const httpRequests = new client.Counter({
  name: 'http_requests_total',
  help: 'HTTP requests handled, by route template and status code',
  labelNames: ['method', 'route', 'status'],
  registers: [register],
});

const httpDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request latency by route template',
  labelNames: ['method', 'route'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

// Probe and scrape traffic is not user traffic: keep it out of RED metrics and logs.
const NOT_USER_TRAFFIC = new Set(['/healthz', '/readyz', '/metrics']);

const als = new AsyncLocalStorage();
const TRACEPARENT_RE = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;
const ZERO_TRACE = '0'.repeat(32);
const randomHex = (bytes) => crypto.randomBytes(bytes).toString('hex');

function makeLogger(service) {
  return (level, msg, extra = {}) => {
    const ctx = als.getStore() || {};
    console.log(JSON.stringify({
      time: new Date().toISOString(),
      level,
      service,
      msg,
      ...(ctx.traceId ? { trace_id: ctx.traceId, span_id: ctx.spanId } : {}),
      ...extra,
    }));
  };
}

// Express middleware: continue the caller's trace or start a new one.
function traceContext(req, res, next) {
  const match = TRACEPARENT_RE.exec(req.get('traceparent') || '');
  const traceId = match && match[1] !== ZERO_TRACE ? match[1] : randomHex(16);
  const ctx = { traceId, spanId: randomHex(8), parentSpanId: match ? match[2] : undefined };
  req.trace = ctx;
  res.set('X-Trace-Id', traceId);
  als.run(ctx, next);
}

// Header value to send to the next service: same trace, this service's span as parent.
function traceparentFor(req) {
  return `00-${req.trace.traceId}-${req.trace.spanId}-01`;
}

function routeLabel(req) {
  if (req.route && req.route.path) return `${req.baseUrl || ''}${req.route.path}`;
  return req.baseUrl || 'unmatched'; // proxied prefixes (gateway) or 404s
}

// Express middleware: count and time every user request by route template
// (`/products/:id`, never the raw URL, to keep label cardinality low).
function httpMetrics(req, res, next) {
  if (NOT_USER_TRAFFIC.has(req.path)) return next();
  const stopTimer = httpDuration.startTimer();
  res.on('finish', () => {
    const route = routeLabel(req);
    stopTimer({ method: req.method, route });
    httpRequests.inc({ method: req.method, route, status: String(res.statusCode) });
  });
  next();
}

async function metricsHandler(req, res) {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
}

module.exports = {
  client,
  register,
  makeLogger,
  traceContext,
  traceparentFor,
  httpMetrics,
  metricsHandler,
  NOT_USER_TRAFFIC,
};

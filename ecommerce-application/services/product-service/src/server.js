'use strict';

// Product service: owns the product catalogue and stock levels.
// Reads are cached in Redis (cache-aside). Stock changes go straight to Postgres.

const express = require('express');
const { Pool } = require('pg');
const Redis = require('ioredis');
const { migrateAndSeed } = require('./db');

const SERVICE = 'product-service';
const VERSION = process.env.APP_VERSION || 'dev';
const PORT = Number(process.env.PORT || 3001);
const CACHE_TTL_SECONDS = Number(process.env.CACHE_TTL_SECONDS || 30);
const SHUTDOWN_DELAY_MS = Number(process.env.SHUTDOWN_DELAY_MS || 5000);
const CACHE_KEY = 'products:all';

const log = (level, msg, extra = {}) =>
  console.log(JSON.stringify({ time: new Date().toISOString(), level, service: SERVICE, msg, ...extra }));

// Postgres connection comes from the standard PG* variables:
// PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE
const pool = new Pool({ max: 10, connectionTimeoutMillis: 5000 });
pool.on('error', (err) => log('error', 'postgres pool error', { error: err.message }));

// Redis is optional. If it is down, the service keeps working without the cache.
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
  if (redisWasReady) log('warn', 'redis unavailable, serving without cache', { error: err.message });
  redisWasReady = false;
});

async function cacheGet(key) {
  if (redis.status !== 'ready') return null;
  try { return await redis.get(key); } catch { return null; }
}
async function cacheSet(key, value) {
  if (redis.status !== 'ready') return;
  try { await redis.set(key, value, 'EX', CACHE_TTL_SECONDS); } catch { /* cache is best effort */ }
}
async function cacheDel(key) {
  if (redis.status !== 'ready') return;
  try { await redis.del(key); } catch { /* cache is best effort */ }
}

const PRODUCT_COLUMNS = 'id, sku, name, description, category, price_cents, stock, emoji, hue';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));

let shuttingDown = false;

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    if (req.path === '/healthz' || req.path === '/readyz') return;
    log('info', 'request', { method: req.method, path: req.originalUrl, status: res.statusCode, ms: Date.now() - start, requestId: req.get('x-request-id') });
  });
  next();
});

app.get('/healthz', (req, res) => res.json({ status: 'ok', service: SERVICE, version: VERSION }));

app.get('/readyz', async (req, res) => {
  if (shuttingDown) return res.status(503).json({ status: 'shutting_down' });
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ready', db: 'ok', cache: redis.status === 'ready' ? 'ok' : 'down' });
  } catch (err) {
    res.status(503).json({ status: 'not_ready', db: 'down', error: err.message });
  }
});

app.get('/products', async (req, res, next) => {
  try {
    let products;
    const cached = await cacheGet(CACHE_KEY);
    if (cached) {
      products = JSON.parse(cached);
      res.set('X-Cache', 'HIT');
    } else {
      const { rows } = await pool.query(`SELECT ${PRODUCT_COLUMNS} FROM products ORDER BY category, name`);
      products = rows;
      await cacheSet(CACHE_KEY, JSON.stringify(rows));
      res.set('X-Cache', 'MISS');
    }
    const { category } = req.query;
    if (category) products = products.filter((p) => p.category === category);
    res.json(products);
  } catch (err) { next(err); }
});

app.get('/products/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'invalid_id' });
  try {
    const { rows } = await pool.query(`SELECT ${PRODUCT_COLUMNS} FROM products WHERE id = $1`, [id]);
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// Validates [{product_id, quantity}] and merges duplicate product ids.
function normaliseItems(items) {
  if (!Array.isArray(items) || items.length === 0 || items.length > 20) return null;
  const merged = new Map();
  for (const item of items) {
    const id = Number(item && item.product_id);
    const qty = Number(item && item.quantity);
    if (!Number.isInteger(id) || id < 1 || !Number.isInteger(qty) || qty < 1 || qty > 20) return null;
    merged.set(id, (merged.get(id) || 0) + qty);
  }
  // Sorted by id so concurrent orders lock rows in the same order (no deadlocks).
  return [...merged.entries()].sort((a, b) => a[0] - b[0]).map(([product_id, quantity]) => ({ product_id, quantity }));
}

// Internal: called by order-service only. Not routed by the gateway.
// Reserves stock for every item or none of them.
app.post('/internal/reserve', async (req, res, next) => {
  const items = normaliseItems(req.body && req.body.items);
  if (!items) return res.status(400).json({ error: 'invalid_items' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const reserved = [];
    for (const { product_id, quantity } of items) {
      const { rows } = await client.query(
        'UPDATE products SET stock = stock - $2 WHERE id = $1 AND stock >= $2 RETURNING id, name, price_cents',
        [product_id, quantity],
      );
      if (!rows.length) {
        await client.query('ROLLBACK');
        const exists = await pool.query('SELECT stock FROM products WHERE id = $1', [product_id]);
        if (!exists.rows.length) return res.status(404).json({ error: 'product_not_found', product_id });
        await cacheDel(CACHE_KEY); // the shopper saw a stale stock figure, refresh it
        return res.status(409).json({ error: 'insufficient_stock', product_id, available: exists.rows[0].stock });
      }
      reserved.push({ product_id, quantity, name: rows[0].name, unit_price_cents: rows[0].price_cents });
    }
    await client.query('COMMIT');
    await cacheDel(CACHE_KEY);
    res.json({ items: reserved });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

// Internal: puts stock back if order-service could not save the order.
app.post('/internal/release', async (req, res, next) => {
  const items = normaliseItems(req.body && req.body.items);
  if (!items) return res.status(400).json({ error: 'invalid_items' });
  try {
    for (const { product_id, quantity } of items) {
      await pool.query('UPDATE products SET stock = stock + $2 WHERE id = $1', [product_id, quantity]);
    }
    await cacheDel(CACHE_KEY);
    res.json({ released: items.length });
  } catch (err) { next(err); }
});

app.use((req, res) => res.status(404).json({ error: 'not_found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  // Malformed JSON and oversized bodies come from express.json() with a 4xx status.
  if (err.status >= 400 && err.status < 500) return res.status(err.status).json({ error: 'invalid_request_body' });
  log('error', 'unhandled error', { error: err.message, path: req.originalUrl });
  res.status(500).json({ error: 'internal_error' });
});

async function waitForDatabase() {
  for (let attempt = 1; attempt <= 30; attempt++) {
    try { await pool.query('SELECT 1'); return; } catch (err) {
      log('warn', 'waiting for postgres', { attempt, error: err.message });
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error('postgres not reachable after 30 attempts');
}

async function main() {
  await waitForDatabase();
  await migrateAndSeed(pool, log);
  const server = app.listen(PORT, () => log('info', 'listening', { port: PORT, version: VERSION }));

  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log('info', 'shutdown started', { signal, delayMs: SHUTDOWN_DELAY_MS });
    // Keep serving briefly so Kubernetes can remove this Pod from Service endpoints first.
    setTimeout(() => {
      server.close(async () => {
        await pool.end().catch(() => {});
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
}

main().catch((err) => {
  log('error', 'startup failed', { error: err.message });
  process.exit(1);
});

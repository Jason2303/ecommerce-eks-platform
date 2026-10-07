'use strict';

// Order service: places and lists orders.
// Stock is reserved through product-service first, then the order is saved.
// If saving fails, the reservation is released (a simple compensating action).

const express = require('express');
const { Pool } = require('pg');
const { migrate } = require('./db');

const SERVICE = 'order-service';
const VERSION = process.env.APP_VERSION || 'dev';
const PORT = Number(process.env.PORT || 3002);
const PRODUCT_SERVICE_URL = (process.env.PRODUCT_SERVICE_URL || 'http://product-service:3001').replace(/\/$/, '');
const SHUTDOWN_DELAY_MS = Number(process.env.SHUTDOWN_DELAY_MS || 5000);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const log = (level, msg, extra = {}) =>
  console.log(JSON.stringify({ time: new Date().toISOString(), level, service: SERVICE, msg, ...extra }));

const pool = new Pool({ max: 10, connectionTimeoutMillis: 5000 });
pool.on('error', (err) => log('error', 'postgres pool error', { error: err.message }));

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

// Readiness checks only this service's own database.
// It deliberately does not check product-service, so one service failing
// does not mark every other service unready.
app.get('/readyz', async (req, res) => {
  if (shuttingDown) return res.status(503).json({ status: 'shutting_down' });
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ready', db: 'ok' });
  } catch (err) {
    res.status(503).json({ status: 'not_ready', db: 'down', error: err.message });
  }
});

const ORDER_QUERY = `
  SELECT o.id, o.customer_name, o.customer_email, o.status, o.total_cents, o.created_at,
         COALESCE(json_agg(json_build_object(
           'product_id', i.product_id, 'name', i.product_name,
           'unit_price_cents', i.unit_price_cents, 'quantity', i.quantity
         ) ORDER BY i.id) FILTER (WHERE i.id IS NOT NULL), '[]') AS items
  FROM orders o
  LEFT JOIN order_items i ON i.order_id = o.id
`;

app.get('/orders', async (req, res, next) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
  try {
    const { rows } = await pool.query(`${ORDER_QUERY} GROUP BY o.id ORDER BY o.id DESC LIMIT $1`, [limit]);
    res.json(rows);
  } catch (err) { next(err); }
});

app.get('/orders/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'invalid_id' });
  try {
    const { rows } = await pool.query(`${ORDER_QUERY} WHERE o.id = $1 GROUP BY o.id`, [id]);
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

async function callProductService(path, body, requestId) {
  return fetch(`${PRODUCT_SERVICE_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-request-id': requestId || '' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
}

app.post('/orders', async (req, res, next) => {
  const { customer_name, customer_email, items } = req.body || {};
  const name = typeof customer_name === 'string' ? customer_name.trim() : '';
  const email = typeof customer_email === 'string' ? customer_email.trim() : '';
  if (!name || name.length > 100) return res.status(400).json({ error: 'invalid_customer_name' });
  if (!EMAIL_RE.test(email) || email.length > 200) return res.status(400).json({ error: 'invalid_customer_email' });
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'invalid_items' });

  const requestId = req.get('x-request-id');

  // 1. Reserve stock (all or nothing) and get authoritative prices.
  let reserved;
  try {
    const resp = await callProductService('/internal/reserve', { items }, requestId);
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      // Pass 400 / 404 / 409 straight back so the shopper sees why.
      const status = [400, 404, 409].includes(resp.status) ? resp.status : 502;
      return res.status(status).json(body.error ? body : { error: 'reservation_failed' });
    }
    reserved = body.items;
  } catch (err) {
    log('error', 'product-service unreachable', { error: err.message });
    return res.status(503).json({ error: 'product_service_unavailable' });
  }

  // 2. Save the order. Prices come from product-service, never from the client.
  const total = reserved.reduce((sum, i) => sum + i.unit_price_cents * i.quantity, 0);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO orders (customer_name, customer_email, status, total_cents)
       VALUES ($1, $2, 'confirmed', $3) RETURNING id, created_at`,
      [name, email, total],
    );
    const orderId = rows[0].id;
    for (const i of reserved) {
      await client.query(
        `INSERT INTO order_items (order_id, product_id, product_name, unit_price_cents, quantity)
         VALUES ($1, $2, $3, $4, $5)`,
        [orderId, i.product_id, i.name, i.unit_price_cents, i.quantity],
      );
    }
    await client.query('COMMIT');
    log('info', 'order placed', { orderId, totalCents: total, requestId });
    res.status(201).json({
      id: orderId, customer_name: name, customer_email: email, status: 'confirmed',
      total_cents: total, created_at: rows[0].created_at,
      items: reserved.map((i) => ({ product_id: i.product_id, name: i.name, unit_price_cents: i.unit_price_cents, quantity: i.quantity })),
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    // 3. Compensate: give the stock back.
    try {
      await callProductService('/internal/release', { items: reserved.map(({ product_id, quantity }) => ({ product_id, quantity })) }, requestId);
    } catch (releaseErr) {
      log('error', 'stock release failed', { error: releaseErr.message, items: reserved });
    }
    next(err);
  } finally {
    client.release();
  }
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
  await migrate(pool, log);
  const server = app.listen(PORT, () => log('info', 'listening', { port: PORT, version: VERSION, productService: PRODUCT_SERVICE_URL }));

  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log('info', 'shutdown started', { signal, delayMs: SHUTDOWN_DELAY_MS });
    setTimeout(() => {
      server.close(async () => {
        await pool.end().catch(() => {});
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

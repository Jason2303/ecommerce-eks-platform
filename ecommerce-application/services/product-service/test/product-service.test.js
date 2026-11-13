'use strict';

// product-service unit tests. No Postgres or Redis: only code paths that
// run before the database is touched are exercised over HTTP.
process.env.NODE_ENV = 'test';
process.env.PGHOST = '127.0.0.1';
process.env.PGPORT = '1'; // nothing listens: any DB call fails fast

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');

const { app, normaliseItems, pool } = require('../src/server');

let server;
let base;

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.close();
  await pool.end().catch(() => {});
});

test('normaliseItems merges duplicates and sorts by product id', () => {
  const items = normaliseItems([
    { product_id: 3, quantity: 1 },
    { product_id: 1, quantity: 2 },
    { product_id: 3, quantity: 4 },
  ]);
  assert.deepEqual(items, [
    { product_id: 1, quantity: 2 },
    { product_id: 3, quantity: 5 },
  ]);
});

test('normaliseItems rejects bad input', () => {
  assert.equal(normaliseItems([]), null);
  assert.equal(normaliseItems('nope'), null);
  assert.equal(normaliseItems([{ product_id: 1, quantity: 0 }]), null);
  assert.equal(normaliseItems([{ product_id: 1, quantity: 21 }]), null);
  assert.equal(normaliseItems([{ product_id: -1, quantity: 1 }]), null);
  assert.equal(normaliseItems([{ product_id: 1.5, quantity: 1 }]), null);
  assert.equal(normaliseItems(Array.from({ length: 21 }, (_, i) => ({ product_id: i + 1, quantity: 1 }))), null);
});

test('GET /healthz reports the service', async () => {
  const res = await fetch(`${base}/healthz`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).service, 'product-service');
});

test('GET /readyz is 503 when the database is unreachable', async () => {
  const res = await fetch(`${base}/readyz`);
  assert.equal(res.status, 503);
  assert.equal((await res.json()).db, 'down');
});

test('POST /internal/reserve validates the body and keeps the trace id', async () => {
  const trace = 'd'.repeat(32);
  const res = await fetch(`${base}/internal/reserve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', traceparent: `00-${trace}-${'e'.repeat(16)}-01` },
    body: JSON.stringify({ items: [{ product_id: 1, quantity: 0 }] }),
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'invalid_items');
  assert.equal(res.headers.get('x-trace-id'), trace);
});

test('GET /products/:id rejects a non-numeric id', async () => {
  const res = await fetch(`${base}/products/abc`);
  assert.equal(res.status, 400);
});

test('/metrics exposes RED, business and runtime metrics', async () => {
  const text = await (await fetch(`${base}/metrics`)).text();
  assert.match(text, /http_requests_total\{method="POST",route="\/internal\/reserve",status="400"\} 1/);
  assert.match(text, /http_requests_total\{method="GET",route="\/products\/:id",status="400"\} 1/);
  assert.match(text, /# HELP product_cache_requests_total/);
  assert.match(text, /# HELP product_stock_reservations_total/);
  assert.match(text, /# HELP product_stock_units/);
  assert.match(text, /nodejs_heap_size_used_bytes/);
});

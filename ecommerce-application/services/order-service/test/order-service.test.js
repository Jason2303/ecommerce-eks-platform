'use strict';

// order-service unit tests. A stub plays product-service; no Postgres needed
// because every case here is decided before an order is written.
process.env.NODE_ENV = 'test';
process.env.PGHOST = '127.0.0.1';
process.env.PGPORT = '1';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');

const received = [];
let stub;
let server;
let base;
let pool;

const TRACE = 'f'.repeat(32);
const order = (body, headers = {}) => fetch(`${base}/orders`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});
const validOrder = {
  customer_name: 'Ada Lovelace',
  customer_email: 'ada@example.com',
  items: [{ product_id: 4, quantity: 1 }],
};

before(async () => {
  // product-service stub: every reservation is out of stock
  stub = http.createServer((req, res) => {
    received.push({ url: req.url, headers: req.headers });
    res.statusCode = 409;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'insufficient_stock', product_id: 4, available: 0 }));
  });
  stub.listen(0, '127.0.0.1');
  await once(stub, 'listening');
  process.env.PRODUCT_SERVICE_URL = `http://127.0.0.1:${stub.address().port}`;

  ({ pool } = require('../src/server'));
  const { app } = require('../src/server');
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.close();
  stub.close();
  await pool.end().catch(() => {});
});

test('GET /healthz reports the service', async () => {
  const res = await fetch(`${base}/healthz`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).service, 'order-service');
});

test('rejects an invalid email', async () => {
  const res = await order({ ...validOrder, customer_email: 'not-an-email' });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'invalid_customer_email');
});

test('rejects an empty basket', async () => {
  const res = await order({ ...validOrder, items: [] });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'invalid_items');
});

test('passes out-of-stock back as 409 and forwards the trace to product-service', async () => {
  const res = await order(validOrder, { traceparent: `00-${TRACE}-${'1'.repeat(16)}-01`, 'x-request-id': 'req-9' });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).error, 'insufficient_stock');

  const hop = received.at(-1);
  assert.equal(hop.url, '/internal/reserve');
  assert.equal(hop.headers['x-request-id'], 'req-9');
  assert.match(hop.headers.traceparent, new RegExp(`^00-${TRACE}-[0-9a-f]{16}-01$`));
});

test('returns 503 when product-service is unreachable', async () => {
  stub.close();
  await once(stub, 'close');
  const res = await order(validOrder);
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'product_service_unavailable');
});

test('/metrics counts orders by outcome', async () => {
  const text = await (await fetch(`${base}/metrics`)).text();
  assert.match(text, /shop_orders_total\{result="invalid"\} 2/);
  assert.match(text, /shop_orders_total\{result="rejected"\} 1/);
  assert.match(text, /shop_orders_total\{result="failed"\} 1/);
  assert.match(text, /http_requests_total\{method="POST",route="\/orders",status="503"\} 1/);
  assert.match(text, /# HELP shop_revenue_cents_total/);
});

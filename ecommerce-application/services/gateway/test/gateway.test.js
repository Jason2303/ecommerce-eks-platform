'use strict';

// Gateway unit tests: no Redis, no backends. A stub HTTP server plays product-service;
// order-service points at a closed port to simulate an outage.
process.env.NODE_ENV = 'test';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');

const received = [];
let upstream;
let server;
let base;

const TRACE = 'a'.repeat(32);
const PARENT_SPAN = 'b'.repeat(16);

before(async () => {
  upstream = http.createServer((req, res) => {
    received.push({ url: req.url, headers: req.headers });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify([{ id: 1, name: 'Stoneware Mug' }]));
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');

  process.env.PRODUCT_SERVICE_URL = `http://127.0.0.1:${upstream.address().port}`;
  process.env.ORDER_SERVICE_URL = 'http://127.0.0.1:1'; // nothing listens here
  process.env.RATE_LIMIT_PER_MIN = '0';

  const { app } = require('../src/server');
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  upstream.close();
});

test('GET /healthz reports the service', async () => {
  const res = await fetch(`${base}/healthz`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.service, 'gateway');
  assert.equal(body.status, 'ok');
});

test('proxies /api/products and continues the caller\'s trace', async () => {
  const res = await fetch(`${base}/api/products?category=desk`, {
    headers: { traceparent: `00-${TRACE}-${PARENT_SPAN}-01`, 'x-request-id': 'req-123' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-trace-id'), TRACE);

  const hop = received.at(-1);
  assert.equal(hop.url, '/products?category=desk');
  assert.equal(hop.headers['x-request-id'], 'req-123');
  // same trace id, a new span id for the gateway hop
  const m = /^00-([0-9a-f]{32})-([0-9a-f]{16})-01$/.exec(hop.headers.traceparent);
  assert.ok(m, `bad traceparent: ${hop.headers.traceparent}`);
  assert.equal(m[1], TRACE);
  assert.notEqual(m[2], PARENT_SPAN);
});

test('starts a new trace when the caller sends none', async () => {
  const res = await fetch(`${base}/api/products`);
  const traceId = res.headers.get('x-trace-id');
  assert.match(traceId, /^[0-9a-f]{32}$/);
  assert.ok(received.at(-1).headers.traceparent.includes(traceId));
});

test('returns 502 when a backend is down', async () => {
  const res = await fetch(`${base}/api/orders`);
  assert.equal(res.status, 502);
  assert.equal((await res.json()).error, 'upstream_unavailable');
});

test('unknown routes return 404', async () => {
  const res = await fetch(`${base}/nope`);
  assert.equal(res.status, 404);
});

test('request logs are JSON and carry the trace_id', async () => {
  const lines = [];
  const original = console.log;
  console.log = (line) => lines.push(line);
  try {
    const res = await fetch(`${base}/api/products`, { headers: { traceparent: `00-${'c'.repeat(32)}-${PARENT_SPAN}-01` } });
    await res.text();
    await new Promise((r) => setTimeout(r, 20)); // log is written on 'finish'
  } finally {
    console.log = original;
  }
  const entry = lines.map((l) => JSON.parse(l)).find((e) => e.msg === 'request' && e.path === '/api/products');
  assert.ok(entry, 'no request log line');
  assert.equal(entry.trace_id, 'c'.repeat(32));
  assert.match(entry.span_id, /^[0-9a-f]{16}$/);
  assert.equal(entry.service, 'gateway');
  assert.equal(entry.level, 'info');
});

test('/metrics exposes RED and gateway metrics by route template', async () => {
  const res = await fetch(`${base}/metrics`);
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.match(text, /http_requests_total\{method="GET",route="\/api\/products",status="200"\} \d+/);
  assert.match(text, /http_requests_total\{method="GET",route="\/api\/orders",status="502"\} 1/);
  assert.match(text, /http_request_duration_seconds_bucket\{le="0.005",method="GET",route="\/api\/products"\}/);
  assert.match(text, /gateway_upstream_errors_total\{target="127.0.0.1",kind="unavailable"\} 1/);
  assert.match(text, /process_cpu_user_seconds_total/);
  // probes and scrapes are not counted as user traffic
  assert.doesNotMatch(text, /route="\/healthz"/);
  assert.doesNotMatch(text, /route="\/metrics"/);
});

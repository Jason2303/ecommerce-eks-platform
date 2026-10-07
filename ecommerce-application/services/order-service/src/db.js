'use strict';

// Creates the orders tables on first start. No foreign key to products:
// that table belongs to product-service, so this service only stores a copy
// of the name and price at the time of purchase.

const MIGRATION_LOCK_ID = 7102;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS orders (
  id              SERIAL PRIMARY KEY,
  customer_name   TEXT NOT NULL,
  customer_email  TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'confirmed',
  total_cents     INTEGER NOT NULL CHECK (total_cents >= 0),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_items (
  id                SERIAL PRIMARY KEY,
  order_id          INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id        INTEGER NOT NULL,
  product_name      TEXT NOT NULL,
  unit_price_cents  INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  quantity          INTEGER NOT NULL CHECK (quantity > 0)
);

CREATE INDEX IF NOT EXISTS order_items_order_id_idx ON order_items (order_id);
`;

async function migrate(pool, log) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    await client.query(SCHEMA);
    log('info', 'migration complete');
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => {});
    client.release();
  }
}

module.exports = { migrate };

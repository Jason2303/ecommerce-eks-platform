'use strict';

// Creates the products table and seeds the catalogue on first start.
// An advisory lock stops two replicas from migrating at the same time.

const MIGRATION_LOCK_ID = 7101;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS products (
  id           SERIAL PRIMARY KEY,
  sku          TEXT UNIQUE NOT NULL,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  category     TEXT NOT NULL,
  price_cents  INTEGER NOT NULL CHECK (price_cents >= 0),
  stock        INTEGER NOT NULL CHECK (stock >= 0),
  emoji        TEXT NOT NULL DEFAULT '',
  hue          INTEGER NOT NULL DEFAULT 30,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

// sku, name, description, category, price_cents, stock, emoji, hue
const SEED = [
  ['KIT-001', 'Stoneware Mug', 'Hand-glazed 350 ml mug. Dishwasher safe.', 'kitchen', 1800, 40, '☕', 24],
  ['KIT-002', 'Pour-Over Kettle', 'Gooseneck kettle for slow, precise pours.', 'kitchen', 5400, 15, '🫖', 190],
  ['KIT-003', 'Olive Wood Board', 'Single-piece cutting and serving board.', 'kitchen', 3900, 20, '🪵', 32],
  ['KIT-004', 'Cast Iron Skillet', 'Pre-seasoned 26 cm skillet. Lasts forever.', 'kitchen', 4500, 12, '🍳', 0],
  ['DSK-001', 'Linen Notebook', 'A5, 192 dotted pages, lay-flat binding.', 'desk', 1600, 60, '📓', 140],
  ['DSK-002', 'Brass Pen', 'Solid brass ballpoint that ages with you.', 'desk', 3200, 25, '🖋️', 45],
  ['DSK-003', 'Desk Lamp', 'Warm dimmable LED with a weighted base.', 'desk', 7900, 10, '💡', 50],
  ['DSK-004', 'Cork Desk Mat', 'Natural cork, 80 x 40 cm.', 'desk', 2700, 30, '🟫', 28],
  ['OUT-001', 'Canvas Tote', 'Heavy waxed canvas with leather straps.', 'outdoor', 4200, 35, '👜', 95],
  ['OUT-002', 'Insulated Bottle', 'Keeps drinks cold for 24 hours.', 'outdoor', 2900, 50, '🧴', 205],
  ['OUT-003', 'Wool Beanie', 'Merino rib knit. One size.', 'outdoor', 2400, 45, '🧶', 340],
  ['OUT-004', 'Trail Lantern', 'Rechargeable, 300 lumens, 40 hour battery.', 'outdoor', 5900, 8, '🏮', 15],
];

async function migrateAndSeed(pool, log) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    await client.query(SCHEMA);
    let inserted = 0;
    for (const row of SEED) {
      const result = await client.query(
        `INSERT INTO products (sku, name, description, category, price_cents, stock, emoji, hue)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (sku) DO NOTHING`,
        row,
      );
      inserted += result.rowCount;
    }
    log('info', 'migration complete', { seededProducts: inserted });
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => {});
    client.release();
  }
}

module.exports = { migrateAndSeed };

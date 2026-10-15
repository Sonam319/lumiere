'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'lumiere.db'));
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    category    TEXT NOT NULL,
    price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
    active      INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS orders (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    order_number   TEXT NOT NULL UNIQUE,
    customer_name  TEXT NOT NULL,
    phone          TEXT NOT NULL,
    email          TEXT,
    address        TEXT NOT NULL,
    notes          TEXT,
    payment_method TEXT NOT NULL,
    total_cents    INTEGER NOT NULL,
    status         TEXT NOT NULL DEFAULT 'pending',
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id         INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id       TEXT NOT NULL,
    name             TEXT NOT NULL,
    unit_price_cents INTEGER NOT NULL,
    qty              INTEGER NOT NULL CHECK (qty > 0)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    email      TEXT NOT NULL,
    topic      TEXT NOT NULL,
    message    TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS admin_sessions (
    token_hash TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL
  );
`);

/* ---------- Products ----------
   The id must match the data-id of the product card in the HTML.
   Prices are in cents: 16500 = $165.00.
   Change a price here and restart the server to update it. */
const PRODUCTS = [
  ['noir-hobo',         'Noir Hobo',         'shoulder',  16500],
  ['lagune-top-handle', 'Lagune Top-Handle', 'handbags',  18500],
  ['capri-crossbody',   'Capri Crossbody',   'crossbody',  9500],
  ['weekender-duffel',  'Weekender Duffel',  'travel',    21500],
  ['cognac-satchel',    'Cognac Satchel',    'handbags',  15500],
  ['checker-tote',      'Checker Tote',      'handbags',  14500]
];

db.exec('UPDATE products SET active = 0');
const upsertProduct = db.prepare(`
  INSERT INTO products (id, name, category, price_cents, active) VALUES (?, ?, ?, ?, 1)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    category = excluded.category,
    price_cents = excluded.price_cents,
    active = 1
`);
PRODUCTS.forEach((p) => upsertProduct.run(p[0], p[1], p[2], p[3]));

/* ---------- Helpers ---------- */
function transaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function newOrderNumber() {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return 'LUM-' + day + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();
}

/* ---------- Queries ---------- */
const selectProducts = db.prepare('SELECT id, name, category, price_cents FROM products WHERE active = 1 ORDER BY name');
const selectProduct = db.prepare('SELECT id, name, price_cents FROM products WHERE id = ? AND active = 1');
const insertOrder = db.prepare(`
  INSERT INTO orders (order_number, customer_name, phone, email, address, notes, payment_method, total_cents)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
const insertItem = db.prepare(`
  INSERT INTO order_items (order_id, product_id, name, unit_price_cents, qty) VALUES (?, ?, ?, ?, ?)
`);
const selectOrders = db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT ?');
const selectOrderItems = db.prepare(
  'SELECT product_id, name, unit_price_cents, qty FROM order_items WHERE order_id = ? ORDER BY id'
);
const updateStatus = db.prepare('UPDATE orders SET status = ? WHERE id = ?');
const insertMessage = db.prepare('INSERT INTO messages (name, email, topic, message) VALUES (?, ?, ?, ?)');
const selectMessages = db.prepare('SELECT * FROM messages ORDER BY id DESC LIMIT ?');
const selectStats = db.prepare(`
  SELECT
    COUNT(*) AS orders,
    COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) AS pending,
    COALESCE(SUM(CASE WHEN status != 'cancelled' THEN total_cents ELSE 0 END), 0) AS sales_cents
  FROM orders
`);
const insertSession = db.prepare('INSERT INTO admin_sessions (token_hash, expires_at) VALUES (?, ?)');
const selectSession = db.prepare('SELECT token_hash, expires_at FROM admin_sessions WHERE token_hash = ?');
const removeSession = db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?');
const removeExpiredSessions = db.prepare('DELETE FROM admin_sessions WHERE expires_at < ?');

function listProducts() { return selectProducts.all(); }
function findProduct(id) { return selectProduct.get(id); }

function createOrder(order) {
  const customer = order.customer;
  const totalCents = order.lines.reduce((sum, l) => sum + l.unit_price_cents * l.qty, 0);

  for (let attempt = 0; attempt < 5; attempt++) {
    const orderNumber = newOrderNumber();
    try {
      transaction(() => {
        const result = insertOrder.run(
          orderNumber,
          customer.name,
          customer.phone,
          customer.email || null,
          customer.address,
          customer.notes || null,
          order.paymentMethod,
          totalCents
        );
        order.lines.forEach((l) => {
          insertItem.run(result.lastInsertRowid, l.product_id, l.name, l.unit_price_cents, l.qty);
        });
      });
      return { orderNumber, totalCents };
    } catch (err) {
      if (!/UNIQUE/i.test(String(err.message))) throw err;
    }
  }
  throw new Error('Could not create a unique order number.');
}

function listOrders(limit) {
  return selectOrders.all(limit || 200).map((o) => ({ ...o, items: selectOrderItems.all(o.id) }));
}

function setOrderStatus(id, status) { return updateStatus.run(status, id).changes; }
function addMessage(m) { insertMessage.run(m.name, m.email, m.topic, m.message); }
function listMessages(limit) { return selectMessages.all(limit || 200); }

function getStats() {
  const row = selectStats.get();
  return { orders: row.orders, pending: row.pending, salesCents: row.sales_cents };
}

function createSession(tokenHash, expiresAt) { insertSession.run(tokenHash, expiresAt); }
function findSession(tokenHash) { return selectSession.get(tokenHash); }
function deleteSession(tokenHash) { removeSession.run(tokenHash); }
function purgeSessions(now) { removeExpiredSessions.run(now); }

module.exports = {
  listProducts,
  findProduct,
  createOrder,
  listOrders,
  setOrderStatus,
  addMessage,
  listMessages,
  getStats,
  createSession,
  findSession,
  deleteSession,
  purgeSessions
};
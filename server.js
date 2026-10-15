'use strict';

try { process.loadEnvFile(); } catch (err) { /* no .env file, use defaults */ }

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const db = require('./db');

const PORT = Number(process.env.PORT) || 3000;
const ADMIN_USERNAME = (process.env.ADMIN_USERNAME || '').trim();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const ADMIN_ENABLED = ADMIN_USERNAME.length >= 3 && ADMIN_PASSWORD.length >= 10;
const COOKIE_SECURE = process.env.COOKIE_SECURE === '1';
const COOKIE_NAME = 'lumiere_admin';
const SESSION_MS = 8 * 60 * 60 * 1000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const app = express();
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);

/* ---------- Security headers ---------- */
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", 'https://fonts.googleapis.com'],
      fontSrc: ['https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"]
    }
  }
}));

app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

/* Block form posts coming from other websites */
app.use('/api', (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const origin = req.get('origin');
  if (origin) {
    let host = '';
    try { host = new URL(origin).host; } catch (err) { host = ''; }
    if (host !== req.get('host')) return res.status(403).json({ error: 'Request blocked.' });
  }
  next();
});

app.use(express.json({ limit: '20kb' }));

/* ---------- Rate limits ---------- */
const limiterOptions = { standardHeaders: true, legacyHeaders: false };
const apiLimiter = rateLimit({ ...limiterOptions, windowMs: 15 * 60 * 1000, limit: 300, message: { error: 'Too many requests. Please try again later.' } });
const orderLimiter = rateLimit({ ...limiterOptions, windowMs: 60 * 60 * 1000, limit: 20, message: { error: 'Too many orders from this connection. Please try again later.' } });
const contactLimiter = rateLimit({ ...limiterOptions, windowMs: 60 * 60 * 1000, limit: 5, message: { error: 'Too many messages. Please try again later.' } });
const loginLimiter = rateLimit({ ...limiterOptions, windowMs: 15 * 60 * 1000, limit: 10, skipSuccessfulRequests: true, message: { error: 'Too many sign-in attempts. Please wait 15 minutes and try again.' } });

app.use('/api', apiLimiter);

/* ---------- Helpers ---------- */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[0-9+()\s-]{7,20}$/;
const PAYMENT_METHODS = ['cod', 'bank'];
const TOPICS = ['Order question', 'Product question', 'Returns and exchanges', 'Other'];
const STATUSES = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'];

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const bad = (res, message) => res.status(400).json({ error: message });
const sha256 = (value) => crypto.createHash('sha256').update(value).digest();
const sha256Hex = (value) => sha256(value).toString('hex');
const safeEqual = (a, b) => crypto.timingSafeEqual(sha256(a), sha256(b));

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch (err) { return ''; }
    }
  }
  return '';
}

/* ---------- Public API ---------- */
app.get('/api/products', (req, res) => {
  res.json({
    products: db.listProducts().map((p) => ({
      id: p.id, name: p.name, category: p.category, priceCents: p.price_cents
    }))
  });
});

/* Place an order. Prices always come from the database, never from the browser. */
app.post('/api/orders', orderLimiter, (req, res) => {
  const body = req.body || {};
  const c = body.customer || {};
  const customer = {
    name: str(c.name),
    phone: str(c.phone),
    email: str(c.email),
    address: str(c.address),
    notes: str(c.notes)
  };
  const paymentMethod = str(body.paymentMethod);

  if (customer.name.length < 2 || customer.name.length > 100) return bad(res, 'Please enter your name.');
  if (!PHONE_RE.test(customer.phone)) return bad(res, 'Please enter a valid phone number.');
  if (customer.email && (customer.email.length > 254 || !EMAIL_RE.test(customer.email))) return bad(res, 'Please enter a valid email address.');
  if (customer.address.length < 8 || customer.address.length > 300) return bad(res, 'Please enter your full delivery address.');
  if (customer.notes.length > 500) return bad(res, 'Notes are too long (500 characters maximum).');
  if (!PAYMENT_METHODS.includes(paymentMethod)) return bad(res, 'Please choose a payment method.');

  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 50) {
    return bad(res, 'Your cart is empty.');
  }

  const wanted = new Map();
  for (const item of body.items) {
    const id = item && typeof item.id === 'string' ? item.id : '';
    const qty = item ? item.qty : 0;
    if (!id || id.length > 64 || !Number.isInteger(qty) || qty < 1 || qty > 99) {
      return bad(res, 'Your cart contains an invalid item.');
    }
    wanted.set(id, (wanted.get(id) || 0) + qty);
  }

  const lines = [];
  for (const [id, qty] of wanted) {
    const product = db.findProduct(id);
    if (!product) return bad(res, 'Sorry, one of the items in your cart is no longer available. Please clear your cart and add it again.');
    if (qty > 99) return bad(res, 'You can order at most 99 of one item.');
    lines.push({ product_id: product.id, name: product.name, unit_price_cents: product.price_cents, qty });
  }

  const result = db.createOrder({ customer, paymentMethod, lines });

  res.status(201).json({
    orderNumber: result.orderNumber,
    totalCents: result.totalCents,
    paymentMethod,
    items: lines.map((l) => ({ name: l.name, qty: l.qty, lineTotalCents: l.unit_price_cents * l.qty }))
  });
});

/* Contact form */
app.post('/api/contact', contactLimiter, (req, res) => {
  const body = req.body || {};
  const message = {
    name: str(body.name),
    email: str(body.email),
    topic: str(body.topic),
    message: str(body.message)
  };

  if (message.name.length < 2 || message.name.length > 100) return bad(res, 'Please enter your name.');
  if (message.email.length > 254 || !EMAIL_RE.test(message.email)) return bad(res, 'Please enter a valid email address.');
  if (!TOPICS.includes(message.topic)) return bad(res, 'Please choose a topic.');
  if (message.message.length < 10 || message.message.length > 2000) return bad(res, 'Your message must be between 10 and 2000 characters.');

  db.addMessage(message);
  res.status(201).json({ ok: true });
});

/* ---------- Admin login ---------- */
function adminDisabled(res) {
  return res.status(503).json({ error: 'Admin login is not set up. Add ADMIN_USERNAME (3+ characters) and ADMIN_PASSWORD (10+ characters) to your .env file, then restart the server.' });
}

app.post('/api/admin/login', loginLimiter, (req, res) => {
  if (!ADMIN_ENABLED) return adminDisabled(res);

  const body = req.body || {};
  const username = str(body.username);
  const password = typeof body.password === 'string' ? body.password : '';

  const userOk = safeEqual(username, ADMIN_USERNAME);
  const passOk = safeEqual(password, ADMIN_PASSWORD);
  if (!(userOk && passOk)) return res.status(401).json({ error: 'Incorrect username or password.' });

  const token = crypto.randomBytes(32).toString('hex');
  db.createSession(sha256Hex(token), Date.now() + SESSION_MS);

  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: COOKIE_SECURE,
    maxAge: SESSION_MS,
    path: '/'
  });
  res.json({ ok: true });
});

function requireAdmin(req, res, next) {
  if (!ADMIN_ENABLED) return adminDisabled(res);
  const token = readCookie(req, COOKIE_NAME);
  if (!token) return res.status(401).json({ error: 'Please sign in.' });
  const session = db.findSession(sha256Hex(token));
  if (!session || session.expires_at < Date.now()) return res.status(401).json({ error: 'Your session has ended. Please sign in again.' });
  next();
}

app.post('/api/admin/logout', (req, res) => {
  const token = readCookie(req, COOKIE_NAME);
  if (token) db.deleteSession(sha256Hex(token));
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
});

/* ---------- Admin API (sign-in required) ---------- */
app.get('/api/admin/me', requireAdmin, (req, res) => res.json({ ok: true, username: ADMIN_USERNAME }));

app.get('/api/admin/stats', requireAdmin, (req, res) => res.json(db.getStats()));

app.get('/api/admin/orders', requireAdmin, (req, res) => res.json({ orders: db.listOrders(200) }));

app.patch('/api/admin/orders/:id/status', requireAdmin, (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const status = str((req.body || {}).status);
  if (!Number.isInteger(id) || id < 1) return bad(res, 'Invalid order id.');
  if (!STATUSES.includes(status)) return bad(res, 'Invalid status.');
  if (db.setOrderStatus(id, status) === 0) return res.status(404).json({ error: 'Order not found.' });
  res.json({ ok: true });
});

app.get('/api/admin/messages', requireAdmin, (req, res) => res.json({ messages: db.listMessages(200) }));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

/* ---------- Website files ---------- */
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

/* ---------- Errors ---------- */
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid request.' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large.' });
  console.error(err);
  res.status(500).json({ error: 'Server error. Please try again.' });
});

/* Remove expired sign-ins now and every hour */
db.purgeSessions(Date.now());
setInterval(() => db.purgeSessions(Date.now()), 60 * 60 * 1000).unref();

app.listen(PORT, () => {
  console.log('LUMIERE is running at http://localhost:' + PORT);
  if (!ADMIN_ENABLED) console.log('Admin login is off: set ADMIN_USERNAME and ADMIN_PASSWORD in .env');
});
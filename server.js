require('dotenv').config();

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');

const { computeQuote, genres, continents } = require('./lib/pricing');
const { generateWithLyria, LyriaNotConfiguredError } = require('./lib/lyria');
const { sendAssistantRequestEmail, sendReviewEmail, sendJoinEmail } = require('./lib/email');

const app = express();
const PORT = process.env.PORT || 3000;

// Razorpay is optional until keys are set, so we don't crash on boot without them.
const razorpay = (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET)
  ? new (require('razorpay'))({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET
    })
  : null;

app.set('trust proxy', 1);
app.use(cors());
app.use(express.json());

// ---- Seasonal unavailability (e.g. exam months) ----
// CLOSED_PERIODS defines the site's closed windows, each as a whole month
// OR an exact date range. Two entry shapes are supported:
//   { month: 2 }                          -> closed for all of February, every year
//   { from: '11-10', to: '12-20' }        -> closed from Nov 10 through Dec 20, every year
// This can optionally be overridden via the CLOSED_PERIODS_JSON env var
// (a JSON string in the same shape) without touching code.
const DEFAULT_CLOSED_PERIODS = [
  { month: 2 },                      // February (whole month)
  { from: '03-01', to: '03-20' },    // Mar 1 – Mar 20
  { from: '05-01', to: '05-20' },    // May 1 – May 20
  { from: '07-01', to: '07-20' },    // Jul 1 – Jul 20
  { month: 9 },                      // September (whole month)
  { from: '11-10', to: '12-20' }     // Nov 10 – Dec 20
];

let CLOSED_PERIODS = DEFAULT_CLOSED_PERIODS;
if (process.env.CLOSED_PERIODS_JSON) {
  try {
    CLOSED_PERIODS = JSON.parse(process.env.CLOSED_PERIODS_JSON);
  } catch (e) {
    console.error('CLOSED_PERIODS_JSON is not valid JSON — falling back to defaults.', e);
  }
}

// Builds a real Date for a period boundary in a given year, from 'MM-DD'.
function dateInYear(monthDay, year) {
  const [mm, dd] = monthDay.split('-').map((n) => parseInt(n, 10));
  return new Date(year, mm - 1, dd);
}

// Returns the closed [start, end) range (as real Dates) that CONTAINS the
// given date, if any — checking this year, last year, and next year so
// ranges that cross Dec 31 (or are checked near a boundary) resolve correctly.
function findContainingClosedRange(date) {
  for (const period of CLOSED_PERIODS) {
    const yearsToCheck = [date.getFullYear() - 1, date.getFullYear(), date.getFullYear() + 1];
    for (const year of yearsToCheck) {
      let start, end;
      if (period.month) {
        start = new Date(year, period.month - 1, 1);
        end = new Date(year, period.month, 1); // first of next month
      } else if (period.from && period.to) {
        start = dateInYear(period.from, year);
        end = dateInYear(period.to, year);
        end.setDate(end.getDate() + 1); // 'to' is inclusive, so end is exclusive
        if (end <= start) end.setFullYear(end.getFullYear() + 1); // range crosses new year
      } else {
        continue;
      }
      if (date >= start && date < end) return { start, end };
    }
  }
  return null;
}

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// Human-readable names of every month touched by any closed period, in
// calendar order, deduplicated — used for the "may cause delays" notice.
function closedMonthNames() {
  const monthsTouched = new Set();
  for (const period of CLOSED_PERIODS) {
    if (period.month) {
      monthsTouched.add(period.month);
    } else if (period.from && period.to) {
      const fromMonth = parseInt(period.from.split('-')[0], 10);
      const toMonth = parseInt(period.to.split('-')[0], 10);
      monthsTouched.add(fromMonth);
      monthsTouched.add(toMonth);
    }
  }
  return [...monthsTouched].sort((a, b) => a - b).map((m) => MONTH_NAMES[m - 1]);
}

app.get('/api/availability', (req, res) => {
  const now = new Date();
  const range = overrideActive() ? null : findContainingClosedRange(now);
  if (!range) return res.json({ closed: false });

  const daysLeft = Math.ceil((range.end - now) / (1000 * 60 * 60 * 24));
  res.json({
    closed: true,
    reopenDate: range.end.toISOString(),
    daysLeft,
    closedMonths: closedMonthNames()
  });
});

app.post('/api/scheduled-order', async (req, res) => {
  try {
    const { prompt, genre, durationSeconds, engine, continent, customerEmail } = req.body;
    const err = validateGenerationInput(req.body);
    if (err) return res.status(400).json({ error: err });
    if (!EMAIL_RE.test(customerEmail || '')) {
      return res.status(400).json({ error: 'A valid email address is required.' });
    }

    const quote = computeQuote({ genre, durationSeconds, engine: engine || 'assistant', continent });
    await sendAssistantRequestEmail({
      prompt: `[SCHEDULED ORDER — placed while the site was closed, start once back] ${(prompt || '')}`.trim(),
      genre,
      durationSeconds,
      customerEmail,
      priceLabel: `$${quote.usd.toFixed(2)} / ₹${quote.inr}`
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('Scheduled order error:', err);
    res.status(500).json({ error: err.message || 'Could not save your scheduled order.' });
  }
});

// ---- Owner unlock: open the site during a closed period ----
// Set ADMIN_KEY on Render (a long random string). Then visit
//   https://<your-site>/admin?key=<ADMIN_KEY>
// to open the site for a few hours or close it again. The override is kept in
// memory only, so it also ends if Render restarts the service.
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const MAX_UNLOCK_HOURS = 168;
let openUntil = 0; // epoch ms; 0 = no override

function overrideActive() { return Date.now() < openUntil; }
function isClosedNow() { return !overrideActive() && !!findContainingClosedRange(new Date()); }

const adminFails = new Map(); // ip -> [timestamps of wrong keys]
function adminAuth(req) {
  if (!ADMIN_KEY) return false;
  const now = Date.now();
  const fails = (adminFails.get(req.ip) || []).filter((t) => now - t < 60 * 60 * 1000);
  adminFails.set(req.ip, fails);
  if (fails.length >= 10) return false;
  const given = String((req.query && req.query.key) || (req.body && req.body.key) || '');
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(ADMIN_KEY).digest();
  if (crypto.timingSafeEqual(a, b)) return true;
  fails.push(now);
  return false;
}

function adminStatus() {
  const scheduled = !!findContainingClosedRange(new Date());
  if (overrideActive()) {
    return { open: true, text: `Open by your override until ${new Date(openUntil).toUTCString()}.` };
  }
  return scheduled
    ? { open: false, text: 'Closed (scheduled closed period).' }
    : { open: true, text: 'Open (no closed period right now).' };
}

function adminHeaders(res) {
  res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer' });
}

app.get('/admin', (req, res) => {
  adminHeaders(res);
  if (!adminAuth(req)) return res.status(404).send('Not found');
  const st = adminStatus();
  res.send(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>MusiFun admin</title>
<style>
  body{font-family:system-ui,sans-serif;background:#05070f;color:#e8ecf5;max-width:420px;margin:0 auto;padding:40px 20px}
  h1{font-size:22px;margin:0 0 6px} .st{padding:14px;border:1px solid #2a3350;border-radius:8px;margin:18px 0}
  select,button{font-size:16px;padding:12px;border-radius:8px;border:1px solid #2a3350;background:#0d1226;color:#e8ecf5;width:100%;margin-top:10px}
  button{cursor:pointer} .go{background:#2b4bdc;border-color:#2b4bdc}
</style></head><body>
<h1>MusiFun admin</h1>
<div class="st" id="st">${st.text}</div>
<label for="h">Keep the site open for</label>
<select id="h"><option value="3">3 hours</option><option value="6">6 hours</option><option value="12">12 hours</option><option value="24" selected>24 hours</option><option value="72">3 days</option><option value="168">7 days</option></select>
<button class="go" onclick="act('unlock')">Open the site</button>
<button onclick="act('lock')">Back to the normal schedule</button>
<script>
const key = new URLSearchParams(location.search).get('key');
async function act(what) {
  const r = await fetch('/admin/' + what, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, hours: Number(document.getElementById('h').value) }) });
  const d = await r.json();
  document.getElementById('st').textContent = r.ok ? d.status : (d.error || 'Failed');
}
</script></body></html>`);
});

app.post('/admin/unlock', (req, res) => {
  adminHeaders(res);
  if (!adminAuth(req)) return res.status(404).json({ error: 'Not found' });
  const hours = Math.min(Math.max(parseFloat(req.body.hours) || 24, 0.5), MAX_UNLOCK_HOURS);
  openUntil = Date.now() + hours * 60 * 60 * 1000;
  res.json({ ok: true, status: adminStatus().text });
});

app.post('/admin/lock', (req, res) => {
  adminHeaders(res);
  if (!adminAuth(req)) return res.status(404).json({ error: 'Not found' });
  openUntil = 0;
  res.json({ ok: true, status: adminStatus().text });
});

app.use((req, res, next) => {
  if (isClosedNow()) {
    if (req.path.startsWith('/api/availability') || req.path.startsWith('/api/scheduled-order') || req.path.startsWith('/api/reviews') || req.path.startsWith('/api/join')) {
      return next();
    }
    if (req.path.startsWith('/api/')) {
      return res.status(503).json({ error: 'MusiFun is temporarily unavailable.', code: 'SITE_CLOSED' });
    }
    return res.status(503).sendFile(path.join(__dirname, 'public', 'unavailable.html'));
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ENGINES = ['lyria', 'assistant'];

function validateGenerationInput(body) {
  const { genre, durationSeconds, continent } = body;
  if (!genres.includes(genre)) return `Unknown genre: ${genre}`;
  if (continent && !continents.includes(continent)) return `Unknown continent: ${continent}`;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 184) {
    return 'Duration must be between 1 and 184 seconds.';
  }
  return null;
}

// ---- Public config the frontend needs (no secrets) ----
app.get('/api/config', (req, res) => {
  res.json({
    genres,
    continents,
    engines: ENGINES,
    joinRoles: JOIN_ROLES,
    razorpayKeyId: process.env.RAZORPAY_KEY_ID || null,
    upiId: process.env.PAYMENT_UPI_ID || null,
    lyriaConfigured: Boolean(process.env.GOOGLE_CLOUD_PROJECT),
    emailConfigured: Boolean(process.env.ASSISTANT_EMAIL && process.env.RESEND_API_KEY)
  });
});

// ---- Price quote (server is always the source of truth) ----
app.post('/api/quote', (req, res) => {
  try {
    const { genre, durationSeconds, engine, continent } = req.body;
    const err = validateGenerationInput(req.body);
    if (err) return res.status(400).json({ error: err });
    if (!ENGINES.includes(engine)) return res.status(400).json({ error: `Unknown engine: ${engine}` });

    const quote = computeQuote({ genre, durationSeconds, engine, continent });
    res.json(quote);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---- Lyria 3 generation ----
app.post('/api/generate/lyria', async (req, res) => {
  try {
    const { prompt, genre, durationSeconds } = req.body;
    const err = validateGenerationInput(req.body);
    if (err) return res.status(400).json({ error: err });

    const fullPrompt = [prompt && prompt.trim(), `Genre: ${genre}.`]
      .filter(Boolean)
      .join(' ');

    const result = await generateWithLyria({ prompt: fullPrompt, durationSeconds });
    res.json(result);
  } catch (err) {
    if (err instanceof LyriaNotConfiguredError) {
      return res.status(503).json({ error: err.message, code: 'LYRIA_NOT_CONFIGURED' });
    }
    console.error('Lyria generation error:', err);
    res.status(500).json({ error: 'Lyria generation failed. Check server logs for details.' });
  }
});

// ---- Your Assistant: email handoff ----
app.post('/api/assistant/request', async (req, res) => {
  try {
    const { prompt, genre, durationSeconds, customerEmail, continent } = req.body;
    const err = validateGenerationInput(req.body);
    if (err) return res.status(400).json({ error: err });
    if (!EMAIL_RE.test(customerEmail || '')) {
      return res.status(400).json({ error: 'A valid email address is required.' });
    }

    const quote = computeQuote({ genre, durationSeconds, engine: 'assistant', continent });
    await sendAssistantRequestEmail({
      prompt,
      genre,
      durationSeconds,
      customerEmail,
      priceLabel: `$${quote.usd.toFixed(2)} / ₹${quote.inr}`
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('Assistant request error:', err);
    res.status(500).json({ error: err.message || 'Could not send the request.' });
  }
});

// ---- Manual UPI payment claim (works without any payment gateway) ----
app.post('/api/payments/upi-claim', async (req, res) => {
  try {
    const { prompt, genre, durationSeconds, engine, continent, customerEmail } = req.body;
    const err = validateGenerationInput(req.body);
    if (err) return res.status(400).json({ error: err });
    if (!ENGINES.includes(engine)) return res.status(400).json({ error: `Unknown engine: ${engine}` });
    if (customerEmail && !EMAIL_RE.test(customerEmail)) {
      return res.status(400).json({ error: 'Invalid email address.' });
    }

    const quote = computeQuote({ genre, durationSeconds, engine, continent });
    await sendAssistantRequestEmail({
      prompt: `[UPI payment claim — verify in your UPI app before delivering] ${(prompt || '')}`.trim(),
      genre,
      durationSeconds,
      customerEmail: customerEmail || '(not provided)',
      priceLabel: `$${quote.usd.toFixed(2)} / ₹${quote.inr}`
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('UPI claim error:', err);
    res.status(500).json({ error: 'Could not record your payment claim.' });
  }
});

// ---- Track reviews, emailed straight to the owner ----
app.post('/api/reviews', async (req, res) => {
  try {
    const { rating, comment, genre, durationSeconds, engine } = req.body;
    const ratingNum = parseInt(rating, 10);
    if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      return res.status(400).json({ error: 'Rating must be a whole number from 1 to 5.' });
    }

    await sendReviewEmail({ rating: ratingNum, comment, genre, durationSeconds, engine });
    res.json({ ok: true });
  } catch (err) {
    console.error('Review submission error:', err);
    res.status(500).json({ error: err.message || 'Could not send your review.' });
  }
});

// ---- Join us: musicians who want help with their music ----
const JOIN_ROLES = ['Musician', 'Vocalist', 'Producer', 'Songwriter', 'Other'];
const JOIN_LIMIT = 5;                        // requests allowed per IP...
const JOIN_WINDOW_MS = 60 * 60 * 1000;       // ...per hour
const joinHits = new Map();                  // ip -> [timestamps] (in memory; resets on restart)

function joinRateLimited(ip) {
  const now = Date.now();
  const recent = (joinHits.get(ip) || []).filter((t) => now - t < JOIN_WINDOW_MS);
  if (recent.length >= JOIN_LIMIT) {
    joinHits.set(ip, recent);
    return true;
  }
  recent.push(now);
  joinHits.set(ip, recent);
  return false;
}

app.post('/api/join', async (req, res) => {
  try {
    const body = req.body || {};

    // Honeypot: real visitors never see this field, bots often fill it in.
    if (typeof body.website === 'string' && body.website.trim() !== '') {
      return res.json({ ok: true });
    }

    const clean = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
    const name = clean(body.name, 80);
    const phone = clean(body.phone, 20);
    const email = clean(body.email, 120);
    const role = typeof body.role === 'string' ? body.role : '';
    const help = clean(body.help, 600);
    const link = clean(body.link, 200);

    if (!name) return res.status(400).json({ error: 'Please tell us your name.' });
    const phoneDigits = phone.replace(/\D/g, '');
    if (!/^\+?[\d\s\-().]{7,20}$/.test(phone) || phoneDigits.length < 7 || phoneDigits.length > 15) {
      return res.status(400).json({ error: 'Please enter a valid contact number.' });
    }
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'A valid email address is required.' });
    if (!JOIN_ROLES.includes(role)) return res.status(400).json({ error: 'Please choose what you do.' });
    if (!help) return res.status(400).json({ error: 'Please tell us what you need help with.' });
    if (link && !/^https?:\/\/\S+$/i.test(link)) {
      return res.status(400).json({ error: 'The link should start with http:// or https://' });
    }

    if (joinRateLimited(req.ip)) {
      return res.status(429).json({ error: 'Too many requests — please try again in a little while.' });
    }

    await sendJoinEmail({ name, phone, email, role, help, link });
    res.json({ ok: true });
  } catch (err) {
    console.error('Join request error:', err);
    res.status(500).json({ error: err.message || 'Could not send your request.' });
  }
});

// ---- Razorpay: create a real order ----
app.post('/api/payments/create-order', async (req, res) => {
  try {
    if (!razorpay) {
      return res.status(503).json({ error: 'Payments are not configured yet.', code: 'RAZORPAY_NOT_CONFIGURED' });
    }
    const { genre, durationSeconds, engine, continent } = req.body;
    const err = validateGenerationInput(req.body);
    if (err) return res.status(400).json({ error: err });
    if (!ENGINES.includes(engine)) return res.status(400).json({ error: `Unknown engine: ${engine}` });

    const quote = computeQuote({ genre, durationSeconds, engine, continent });
    const amountInPaise = Math.round(quote.inr * 100);

    const order = await razorpay.orders.create({
      amount: amountInPaise,
      currency: 'INR',
      receipt: `musifun_${Date.now()}`,
      notes: { genre, durationSeconds: String(durationSeconds), engine, continent: continent || '' }
    });

    res.json({ orderId: order.id, amount: order.amount, quote });
  } catch (err) {
    console.error('Order creation error:', err);
    res.status(500).json({ error: 'Could not start payment.' });
  }
});

// ---- Razorpay: verify payment signature after checkout completes ----
app.post('/api/payments/verify', (req, res) => {
  if (!razorpay) {
    return res.status(503).json({ error: 'Payments are not configured yet.', code: 'RAZORPAY_NOT_CONFIGURED' });
  }
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ error: 'Missing payment verification fields.' });
  }

  const body = `${razorpay_order_id}|${razorpay_payment_id}`;
  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(body)
    .digest('hex');

  if (expectedSignature !== razorpay_signature) {
    return res.status(400).json({ error: 'Payment verification failed.' });
  }

  res.json({ verified: true });
});

app.listen(PORT, () => {
  console.log(`MusiFun server running on http://localhost:${PORT}`);
});

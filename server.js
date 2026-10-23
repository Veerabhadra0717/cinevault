// Movie Seat Booking System: backend
// Express (REST API) + Socket.IO (live updates) + SQLite (sql.js)

const express = require('express');
const compression = require('compression');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');
const db = require('./db');
const catalog = require('./catalog');
const seo = require('./seo');

const PORT = process.env.PORT || 3000;
const HOLD_MS = 5 * 60 * 1000;   // a held seat stays yours for 5 minutes
const MAX_SEATS = 6;             // max seats per person per show
const CANCEL_CUTOFF_MS = 30 * 60 * 1000; // cancelling closes 30 minutes before the show
const MAX_SNACK_QTY = 10;
const FEE_PER_SEAT = 30;         // convenience fee, rupees
const GST_RATE = 18;             // percent, charged on the convenience fee

const app = express();
const server = http.createServer(app);
const io = new Server(server);

/* ---------- SEO step 1: work correctly behind a host's proxy ---------- */
// Hosts like Render and Railway put a proxy in front of the app. Without this,
// req.protocol says "http" even on https, so canonical links would be wrong.
app.set('trust proxy', 1);
app.disable('x-powered-by');

/* ---------- SEO step 2: one address for every page ---------- */
// In production, send everything to SITE_URL (https, www or not, as you set it),
// and drop trailing slashes: /movie/x/ -> /movie/x. Both use a permanent 301.
const IS_PROD = process.env.NODE_ENV === 'production';
const SITE = process.env.SITE_URL ? new URL(process.env.SITE_URL) : null;
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const q = req.originalUrl.indexOf('?');
  let pathname = q === -1 ? req.originalUrl : req.originalUrl.slice(0, q);
  const query = q === -1 ? '' : req.originalUrl.slice(q);
  let origin = '';
  let changed = false;
  if (pathname.length > 1 && pathname.endsWith('/') && !pathname.startsWith('/api/')) {
    pathname = pathname.replace(/\/+$/, '') || '/';
    changed = true;
  }
  if (pathname.startsWith('/movie/') && pathname !== pathname.toLowerCase()) {
    pathname = pathname.toLowerCase();
    changed = true;
  }
  if (SITE && IS_PROD && (req.protocol + ':' !== SITE.protocol || req.hostname !== SITE.hostname)) {
    origin = SITE.origin;
    changed = true;
  }
  if (!changed) return next();
  res.redirect(301, origin + pathname + query);
});

/* ---------- SEO step 3: speed ---------- */
// Gzip every text response (HTML, CSS, JS, JSON, sitemap): usually 70-80% smaller
app.use(compression());

app.use(express.json({ limit: '20kb' }));
// index: false, so page URLs go through the SEO renderer below instead of the bare index.html.
// Images and fonts rarely change: browsers keep them 30 days. CSS, JS and the manifest
// change when you edit the app, so they are kept 1 hour and then checked again.
app.use(express.static(path.join(__dirname, 'public'), {
  index: false,
  setHeaders(res, file) {
    const longLived = /\.(png|jpe?g|webp|avif|gif|svg|ico|woff2?)$/i.test(file);
    res.set('Cache-Control', longLived ? 'public, max-age=2592000' : 'public, max-age=3600');
  }
}));

/* ---------- Helpers ---------- */
class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const TIERS = [
  { name: 'Classic', rows: 'A–C', letters: 'ABC', price: 150 },
  { name: 'Prime', rows: 'D–G', letters: 'DEFG', price: 200 },
  { name: 'Recliner', rows: 'H–J', letters: 'HIJ', price: 350 }
];

// Row price plus the format's extra (3D, IMAX, 4DX)
function priceFor(row, format) {
  const tier = TIERS.find(t => t.letters.includes(row));
  return tier.price + (catalog.FORMATS[format] || 0);
}

function pricesFor(format) {
  return TIERS.map(t => ({ name: t.name, rows: t.rows, price: t.price + (catalog.FORMATS[format] || 0) }));
}

// Same rules as chargesFor() in public/app.js
function chargesFor(seatCount) {
  const fee = seatCount * FEE_PER_SEAT;
  return { fee, tax: Math.round(fee * GST_RATE / 100) };
}

const SNACKS = [
  { id: 'popcorn', name: 'Salted popcorn, large', price: 220, emoji: '🍿' },
  { id: 'caramel', name: 'Caramel popcorn, medium', price: 190, emoji: '🍯' },
  { id: 'nachos', name: 'Nachos with cheese', price: 210, emoji: '🧀' },
  { id: 'samosa', name: 'Samosa (2 pcs)', price: 90, emoji: '🥟' },
  { id: 'cola', name: 'Cold drink, 500 ml', price: 120, emoji: '🥤' },
  { id: 'coffee', name: 'Filter coffee', price: 80, emoji: '☕' }
];
const SNACK_BY_ID = new Map(SNACKS.map(s => [s.id, s]));

// on: which part of the order the discount applies to (seats | snacks | all)
const PROMOS = {
  FLAT20: { description: '20% off seats, up to ₹200', type: 'percent', value: 20, max: 200, minTotal: 0, on: 'seats' },
  CINE50: { description: '₹50 off orders of ₹400 or more', type: 'flat', value: 50, minTotal: 400, on: 'all' },
  SNACKY: { description: '30% off snacks', type: 'percent', value: 30, minTotal: 0, on: 'snacks' }
};

// Same rules as discountFor() in public/app.js. The server's answer is the one that counts.
function discountFor(p, seatTotal, snackTotal) {
  const subtotal = seatTotal + snackTotal;
  if (subtotal < p.minTotal) return { discount: 0, error: `Add ₹${p.minTotal - subtotal} more to use ${p.code}` };
  const base = p.on === 'seats' ? seatTotal : p.on === 'snacks' ? snackTotal : subtotal;
  if (!base) return { discount: 0, error: `${p.code} only works when your order has ${p.on}` };
  const d = p.type === 'percent' ? Math.floor(base * p.value / 100) : p.value;
  return { discount: Math.min(d, p.max || Infinity, base) };
}

function findPromo(code) {
  const key = String(code || '').trim().toUpperCase();
  return PROMOS[key] ? { code: key, ...PROMOS[key] } : null;
}

// Wheelchair spaces and their companion seats, at the ends of the front row
const SEAT_TYPES = { A1: 'wheelchair', A12: 'wheelchair', A2: 'companion', A11: 'companion' };

// Cinevault Rewards: 1 point per ₹10 spent on seats (confirmed bookings only)
const REWARD_TIERS = [
  { name: 'Bronze', min: 0 },
  { name: 'Silver', min: 200 },
  { name: 'Gold', min: 600 },
  { name: 'Platinum', min: 1500 }
];
const pointsFor = r => (r.status === 'confirmed' ? Math.floor((r.seat_total || 0) / 10) : 0);

function rewardsFor(rows) {
  const points = rows.reduce((sum, r) => sum + pointsFor(r), 0);
  const i = REWARD_TIERS.findLastIndex(t => points >= t.min);
  const next = REWARD_TIERS[i + 1] || null;
  return { points, tier: REWARD_TIERS[i].name, tierMin: REWARD_TIERS[i].min, next };
}

const SEAT_ID = /^[A-J](1[0-2]|[1-9])$/;
const USER_ID = /^[a-zA-Z0-9-]{8,64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TOTAL_SEATS = db.ROWS.length * db.SEATS_PER_ROW;

function getShow(id) {
  const show = db.get('SELECT * FROM shows WHERE id = ?', [Number(id)]);
  if (!show) throw new HttpError(404, 'Show not found');
  db.ensureSeats([show.id]);
  return show;
}

function theatreToJson(id) {
  const t = catalog.THEATRE_BY_ID.get(id);
  if (!t) return null;
  return { id: t.id, name: t.name, area: t.area, city: catalog.CITY_BY_ID.get(t.city).name };
}

function showToJson(s) {
  return {
    id: s.id, title: s.title, genre: s.genre, language: s.language,
    duration: s.duration, certificate: s.certificate, tagline: s.tagline,
    colors: [s.color_a, s.color_b], startTime: s.start_time,
    movieSlug: s.movie_slug || null, format: s.format || '2D', screen: s.screen || null,
    theatre: theatreToJson(s.theatre_id)
  };
}

// Current seat map. An expired hold counts as free.
function seatsFor(showId) {
  const now = Date.now();
  const { format } = db.get('SELECT format FROM shows WHERE id = ?', [showId]) || {};
  return db.all(
    'SELECT seat_id, row_label, seat_num, status, held_by, held_until FROM seats WHERE show_id = ? ORDER BY row_label, seat_num',
    [showId]
  ).map(s => {
    const expired = s.status === 'held' && s.held_until < now;
    return {
      id: s.seat_id,
      row: s.row_label,
      num: s.seat_num,
      price: priceFor(s.row_label, format),
      type: SEAT_TYPES[s.seat_id] || null,
      status: expired ? 'free' : s.status,
      heldBy: expired || s.status !== 'held' ? null : s.held_by,
      heldUntil: expired || s.status !== 'held' ? null : s.held_until
    };
  });
}

// Free seats per show, for a list of show ids
function seatsLeftFor(ids) {
  if (!ids.length) return new Map();
  db.ensureSeats(ids);
  const rows = db.all(
    `SELECT show_id, COUNT(*) AS left FROM seats
     WHERE show_id IN (${ids.map(() => '?').join(',')})
       AND (status = 'free' OR (status = 'held' AND held_until < ?))
     GROUP BY show_id`,
    [...ids, Date.now()]
  );
  return new Map(rows.map(r => [r.show_id, r.left]));
}

function broadcast(showId) {
  io.to('show:' + showId).emit('seats', { showId: Number(showId), seats: seatsFor(showId) });
}

function checkUser(userId) {
  if (typeof userId !== 'string' || !USER_ID.test(userId)) throw new HttpError(400, 'Invalid user id');
}

function checkSeatList(seats, { required = true } = {}) {
  if (seats === undefined && !required) return null;
  if (!Array.isArray(seats) || seats.length === 0) throw new HttpError(400, 'Choose at least one seat');
  if (seats.length > MAX_SEATS) throw new HttpError(400, `You can choose up to ${MAX_SEATS} seats`);
  const unique = [...new Set(seats)];
  if (unique.some(s => typeof s !== 'string' || !SEAT_ID.test(s))) throw new HttpError(400, 'Invalid seat number');
  return unique;
}

// { popcorn: 2 } -> [{ id, name, price, qty }], with today's prices saved into the booking
function checkSnacks(snacks) {
  if (snacks === undefined || snacks === null) return [];
  if (typeof snacks !== 'object' || Array.isArray(snacks)) throw new HttpError(400, 'Invalid snacks');
  const out = [];
  for (const [id, qty] of Object.entries(snacks)) {
    const snack = SNACK_BY_ID.get(id);
    if (!snack) throw new HttpError(400, 'Unknown snack');
    if (!Number.isInteger(qty) || qty < 0 || qty > MAX_SNACK_QTY) {
      throw new HttpError(400, `Snack quantity must be 0 to ${MAX_SNACK_QTY}`);
    }
    if (qty) out.push({ id, name: snack.name, price: snack.price, qty });
  }
  return out;
}

function checkCity(id) {
  const city = catalog.CITY_BY_ID.get(String(id || 'bengaluru'));
  if (!city) throw new HttpError(400, 'Unknown city');
  return city;
}

function getMovie(slug) {
  const movie = catalog.MOVIE_BY_SLUG.get(String(slug));
  if (!movie) throw new HttpError(404, 'Movie not found');
  return movie;
}

function bookingToJson(r, show) {
  const canCancel = r.status === 'confirmed' && show.start_time - Date.now() >= CANCEL_CUTOFF_MS;
  return {
    code: r.code, seats: JSON.parse(r.seats), name: r.user_name, createdAt: r.created_at,
    seatTotal: r.seat_total, snacks: JSON.parse(r.snacks || '[]'), snackTotal: r.snack_total,
    promo: r.promo, discount: r.discount, fee: r.fee || 0, tax: r.tax || 0, total: r.total,
    status: r.status, cancelledAt: r.cancelled_at, canCancel, points: pointsFor(r),
    show: showToJson(show)
  };
}

function makeCode() {
  // e.g. "CX7K2P" (no confusing letters like O/0 or I/1)
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[crypto.randomInt(chars.length)];
  return code;
}

function seatSort(a, b) {
  return a[0] === b[0] ? Number(a.slice(1)) - Number(b.slice(1)) : a.localeCompare(b);
}

/* ---------- Movies ---------- */
function interestCounts() {
  return new Map(db.all('SELECT movie_slug, COUNT(*) AS n FROM interests GROUP BY movie_slug').map(r => [r.movie_slug, r.n]));
}

const isComingSoon = m => m.releaseDate > db.dayKey(Date.now());

// Average star rating per movie: slug -> { avg, count }
function ratingsMap(slug) {
  const rows = slug
    ? db.all('SELECT movie_slug, AVG(rating) AS avg, COUNT(*) AS n FROM reviews WHERE movie_slug = ? GROUP BY movie_slug', [slug])
    : db.all('SELECT movie_slug, AVG(rating) AS avg, COUNT(*) AS n FROM reviews GROUP BY movie_slug');
  return new Map(rows.map(r => [r.movie_slug, { avg: Math.round(r.avg * 10) / 10, count: r.n }]));
}
const NO_RATING = { avg: 0, count: 0 };

// Optional catalogue fields come back as null so the page can leave them out
function movieSummary(m, extra = {}) {
  const [y, mo, d] = m.releaseDate.split('-').map(Number);
  return {
    slug: m.slug, title: m.title, languages: m.languages, genres: m.genres || [], formats: m.formats, colors: m.colors,
    certificate: m.certificate || null, duration: m.duration || null, tagline: m.tagline || null,
    synopsis: m.synopsis || null,
    releaseDate: new Date(y, mo - 1, d).getTime(), comingSoon: isComingSoon(m), ...extra
  };
}

function interestFor(slug) {
  return (db.get('SELECT COUNT(*) AS n FROM interests WHERE movie_slug = ?', [slug]) || {}).n || 0;
}

// Things the filters need: cities, languages, genres, formats
app.get('/api/meta', (req, res) => {
  res.json({
    cities: catalog.CITIES.map(c => ({ id: c.id, name: c.name })),
    languages: catalog.LANGUAGES,
    genres: [...new Set(catalog.MOVIES.flatMap(m => m.genres || []))].sort(),
    formats: Object.keys(catalog.FORMATS)
  });
});

// Movies showing in a city, and coming soon
app.get('/api/movies', (req, res) => {
  const city = checkCity(req.query.city);
  const userId = USER_ID.test(String(req.query.userId || '')) ? req.query.userId : null;
  const theatreIds = catalog.THEATRES.filter(t => t.city === city.id).map(t => t.id);
  const counts = new Map(db.all(
    `SELECT movie_slug, COUNT(*) AS n FROM shows
     WHERE start_time > ? AND theatre_id IN (${theatreIds.map(() => '?').join(',')})
     GROUP BY movie_slug`,
    [Date.now(), ...theatreIds]
  ).map(r => [r.movie_slug, r.n]));
  const interest = interestCounts();
  const mine = new Set(userId ? db.all('SELECT movie_slug FROM interests WHERE user_id = ?', [userId]).map(r => r.movie_slug) : []);
  const ratings = ratingsMap();
  // Real bookings in this city over the last 7 days, for "Trending"
  const booked = new Map(db.all(
    `SELECT s.movie_slug, COUNT(*) AS n FROM bookings b JOIN shows s ON s.id = b.show_id
     WHERE b.status = 'confirmed' AND b.created_at > ? AND s.theatre_id IN (${theatreIds.map(() => '?').join(',')})
     GROUP BY s.movie_slug`,
    [Date.now() - 7 * db.DAY, ...theatreIds]
  ).map(r => [r.movie_slug, r.n]));

  res.json({
    city: { id: city.id, name: city.name },
    nowShowing: catalog.MOVIES.filter(m => !isComingSoon(m) && counts.get(m.slug))
      .map(m => movieSummary(m, {
        showCount: counts.get(m.slug), bookings: booked.get(m.slug) || 0, rating: ratings.get(m.slug) || NO_RATING
      })),
    // Unreleased films whose first shows fall in the 7-day window can already be booked
    comingSoon: catalog.MOVIES.filter(isComingSoon).map(m => movieSummary(m, {
      interested: interest.get(m.slug) || 0, interestedByMe: mine.has(m.slug), advanceBooking: !!counts.get(m.slug)
    }))
  });
});

// One movie with synopsis and cast
app.get('/api/movies/:slug', (req, res) => {
  const m = getMovie(req.params.slug);
  const userId = USER_ID.test(String(req.query.userId || '')) ? req.query.userId : null;
  res.json({
    movie: movieSummary(m, {
      director: m.director || null, cast: m.cast || [],
      rating: ratingsMap(m.slug).get(m.slug) || NO_RATING,
      interested: interestFor(m.slug),
      interestedByMe: !!(userId && db.get('SELECT 1 FROM interests WHERE movie_slug = ? AND user_id = ?', [m.slug, userId]))
    })
  });
});

// Showtimes for a movie in a city on one day, grouped by cinema
app.get('/api/movies/:slug/shows', (req, res) => {
  const m = getMovie(req.params.slug);
  const city = checkCity(req.query.city);
  const theatres = catalog.THEATRES.filter(t => t.city === city.id);
  const theatreIds = theatres.map(t => t.id);
  const now = Date.now();
  const today = db.startOfDay(now);
  const inCity = `movie_slug = ? AND theatre_id IN (${theatreIds.map(() => '?').join(',')})`;

  // The 7-day date strip, with how many shows are left on each day
  const dates = [];
  for (let i = 0; i < db.SCHEDULE_DAYS; i++) {
    const from = today + i * db.DAY;
    const { n } = db.get(
      `SELECT COUNT(*) AS n FROM shows WHERE ${inCity} AND start_time >= ? AND start_time < ?`,
      [m.slug, ...theatreIds, Math.max(from, now), from + db.DAY]
    );
    dates.push({ date: db.dayKey(from), start: from, shows: n });
  }

  let date = String(req.query.date || '');
  if (!DATE.test(date) || !dates.some(d => d.date === date)) {
    date = (dates.find(d => d.shows) || dates[0]).date;
  }
  const day = dates.find(d => d.date === date);

  const shows = db.all(
    `SELECT * FROM shows WHERE ${inCity} AND start_time >= ? AND start_time < ? ORDER BY start_time`,
    [m.slug, ...theatreIds, Math.max(day.start, now), day.start + db.DAY]
  );
  const left = seatsLeftFor(shows.map(s => s.id));

  res.json({
    dates: dates.map(({ date, shows }) => ({ date, shows })),
    date,
    theatres: theatres
      .map(t => ({
        ...theatreToJson(t.id),
        shows: shows.filter(s => s.theatre_id === t.id).map(s => ({
          id: s.id, startTime: s.start_time, language: s.language, format: s.format, screen: s.screen,
          seatsLeft: left.get(s.id) || 0, totalSeats: TOTAL_SEATS,
          fromPrice: priceFor('A', s.format)
        }))
      }))
      .filter(t => t.shows.length)
  });
});

// "I'm interested" in a coming-soon movie (tap again to undo)
app.post('/api/movies/:slug/interest', (req, res) => {
  const m = getMovie(req.params.slug);
  const { userId } = req.body || {};
  checkUser(userId);
  const interestedByMe = db.transaction(() => {
    if (db.run('DELETE FROM interests WHERE movie_slug = ? AND user_id = ?', [m.slug, userId])) return false;
    db.run('INSERT INTO interests (movie_slug, user_id) VALUES (?, ?)', [m.slug, userId]);
    return true;
  });
  res.json({ interestedByMe, interested: interestFor(m.slug) });
});

/* ---------- Ratings and reviews ---------- */
const REVIEW_MAX = 500;

function reviewsFor(slug, userId) {
  const rows = db.all('SELECT * FROM reviews WHERE movie_slug = ? ORDER BY created_at DESC', [slug]);
  // Reviewers who booked this movie on Cinevault get a badge
  const bookers = new Set(db.all(
    `SELECT DISTINCT b.user_id FROM bookings b JOIN shows s ON s.id = b.show_id
     WHERE s.movie_slug = ? AND b.status = 'confirmed'`, [slug]
  ).map(r => r.user_id));
  const distribution = [0, 0, 0, 0, 0];
  rows.forEach(r => distribution[r.rating - 1]++);
  // Never send user ids: other people's ids would let anyone act as them
  const toJson = r => ({
    name: r.user_name, rating: r.rating, text: r.text, createdAt: r.created_at,
    verified: bookers.has(r.user_id), mine: r.user_id === userId
  });
  const mine = rows.find(r => r.user_id === userId);
  return {
    average: rows.length ? Math.round(rows.reduce((s, r) => s + r.rating, 0) / rows.length * 10) / 10 : 0,
    count: rows.length,
    distribution,
    reviews: rows.slice(0, 30).map(toJson),
    mine: mine ? toJson(mine) : null
  };
}

app.get('/api/movies/:slug/reviews', (req, res) => {
  const m = getMovie(req.params.slug);
  const userId = USER_ID.test(String(req.query.userId || '')) ? req.query.userId : null;
  res.json(reviewsFor(m.slug, userId));
});

// Rate a movie (posting again replaces your earlier review)
app.post('/api/movies/:slug/reviews', (req, res) => {
  const m = getMovie(req.params.slug);
  const { userId, rating } = req.body || {};
  checkUser(userId);
  if (isComingSoon(m)) throw new HttpError(400, 'You can rate this movie once it’s released');
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new HttpError(400, 'Choose 1 to 5 stars');
  const name = String(req.body.name || '').trim();
  if (name.length < 2 || name.length > 40) throw new HttpError(400, 'Enter your name (2 to 40 letters)');
  const text = String(req.body.text || '').trim().replace(/\s+\n/g, '\n');
  if (text.length > REVIEW_MAX) throw new HttpError(400, `Keep your review under ${REVIEW_MAX} characters`);
  db.transaction(() => db.run(
    `INSERT OR REPLACE INTO reviews (movie_slug, user_id, user_name, rating, text, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [m.slug, userId, name, rating, text, Date.now()]
  ));
  res.status(201).json(reviewsFor(m.slug, userId));
});

app.delete('/api/movies/:slug/reviews', (req, res) => {
  const m = getMovie(req.params.slug);
  const { userId } = req.body || {};
  checkUser(userId);
  db.transaction(() => db.run('DELETE FROM reviews WHERE movie_slug = ? AND user_id = ?', [m.slug, userId]));
  res.json(reviewsFor(m.slug, userId));
});

/* ---------- Shows and seats ---------- */

// The next 20 shows anywhere (used by the race test)
app.get('/api/shows', (req, res) => {
  const shows = db.all(
    'SELECT * FROM shows WHERE start_time > ? AND movie_slug IS NOT NULL ORDER BY start_time LIMIT 20', [Date.now()]
  );
  const left = seatsLeftFor(shows.map(s => s.id));
  res.json({ shows: shows.map(s => ({ ...showToJson(s), seatsLeft: left.get(s.id) || 0, totalSeats: TOTAL_SEATS })) });
});

// One show with its full seat map
app.get('/api/shows/:id', (req, res) => {
  const show = getShow(req.params.id);
  res.json({
    show: showToJson(show), seats: seatsFor(show.id), prices: pricesFor(show.format), snacks: SNACKS,
    maxSeats: MAX_SEATS, maxSnackQty: MAX_SNACK_QTY, holdMs: HOLD_MS,
    fees: { perSeat: FEE_PER_SEAT, gstRate: GST_RATE }
  });
});

// Look up a promo code. The discount itself is worked out again when you book.
app.get('/api/promos/:code', (req, res) => {
  const promo = findPromo(req.params.code);
  if (!promo) throw new HttpError(404, 'That promo code isn’t valid');
  res.json({ promo });
});

// Hold seats for 5 minutes
app.post('/api/shows/:id/hold', (req, res) => {
  const show = getShow(req.params.id);
  const { userId } = req.body || {};
  checkUser(userId);
  const seats = checkSeatList(req.body.seats);
  if (show.start_time < Date.now()) throw new HttpError(400, 'This show has already started');

  const result = db.transaction(() => {
    const now = Date.now();
    const mine = db.all(
      `SELECT seat_id, held_until FROM seats
       WHERE show_id = ? AND held_by = ? AND status = 'held' AND held_until >= ?`,
      [show.id, userId, now]
    );
    if (mine.length + seats.length > MAX_SEATS) {
      throw new HttpError(400, `You can hold up to ${MAX_SEATS} seats at a time`);
    }
    // All your seats in one show share one timer
    const heldUntil = mine.length ? mine[0].held_until : now + HOLD_MS;

    // THE KEY PART: update only if the seat is still free (or its hold expired).
    // This check-and-update happens in ONE statement, so two people can never
    // both succeed. If 0 rows changed, someone else got there first.
    const taken = [];
    for (const seatId of seats) {
      const changed = db.run(
        `UPDATE seats SET status = 'held', held_by = ?, held_until = ?
         WHERE show_id = ? AND seat_id = ?
           AND (status = 'free' OR (status = 'held' AND held_until < ?))`,
        [userId, heldUntil, show.id, seatId, now]
      );
      if (changed === 0) taken.push(seatId);
    }
    if (taken.length) {
      throw new HttpError(409, `Seat ${taken.join(', ')} was just taken by someone else`, { taken });
    }
    return { heldUntil, seats };
  });

  broadcast(show.id);
  res.json(result);
});

// Release held seats (all of yours, or only the ones listed)
function releaseHandler(req, res) {
  const show = getShow(req.params.id);
  const { userId } = req.body || {};
  checkUser(userId);
  const seats = checkSeatList(req.body.seats, { required: false });

  let sql = `UPDATE seats SET status = 'free', held_by = NULL, held_until = NULL
             WHERE show_id = ? AND held_by = ? AND status = 'held'`;
  const params = [show.id, userId];
  if (seats) {
    sql += ` AND seat_id IN (${seats.map(() => '?').join(',')})`;
    params.push(...seats);
  }
  const released = db.transaction(() => db.run(sql, params));
  if (released) broadcast(show.id);
  res.json({ released });
}
app.delete('/api/shows/:id/hold', releaseHandler);
app.post('/api/shows/:id/release', releaseHandler); // used by navigator.sendBeacon when a tab closes

// Confirm booking for seats you are holding
app.post('/api/shows/:id/book', (req, res) => {
  const show = getShow(req.params.id);
  const { userId } = req.body || {};
  checkUser(userId);
  const seats = checkSeatList(req.body.seats);
  const name = String(req.body.name || '').trim();
  if (name.length < 2 || name.length > 40) throw new HttpError(400, 'Enter your name (2 to 40 letters)');
  const snacks = checkSnacks(req.body.snacks);
  let promo = null;
  if (req.body.promo) {
    promo = findPromo(req.body.promo);
    if (!promo) throw new HttpError(400, 'That promo code isn’t valid');
  }

  const row = db.transaction(() => {
    const now = Date.now();
    for (const seatId of seats) {
      // Only works if YOU still hold it and the hold hasn't run out
      const changed = db.run(
        `UPDATE seats SET status = 'booked', booked_by = ?, held_by = NULL, held_until = NULL
         WHERE show_id = ? AND seat_id = ? AND status = 'held' AND held_by = ? AND held_until >= ?`,
        [userId, show.id, seatId, userId, now]
      );
      if (changed === 0) throw new HttpError(409, `Seat ${seatId} is no longer held for you (the 5 minutes may have run out). Please choose again.`);
    }

    const seatTotal = seats.reduce((sum, s) => sum + priceFor(s[0], show.format), 0);
    const snackTotal = snacks.reduce((sum, s) => sum + s.price * s.qty, 0);
    let discount = 0;
    if (promo) {
      const result = discountFor(promo, seatTotal, snackTotal);
      if (result.error) throw new HttpError(400, result.error);
      discount = result.discount;
    }
    const { fee, tax } = chargesFor(seats.length);
    const total = seatTotal + snackTotal - discount + fee + tax;

    let code = makeCode();
    while (db.get('SELECT 1 FROM bookings WHERE code = ?', [code])) code = makeCode();
    db.run(
      `INSERT INTO bookings (code, show_id, user_id, user_name, seats, total, created_at,
                             seat_total, snacks, snack_total, promo, discount, fee, tax)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [code, show.id, userId, name, JSON.stringify(seats.sort(seatSort)), total, now,
       seatTotal, JSON.stringify(snacks), snackTotal, promo ? promo.code : null, discount, fee, tax]
    );
    return db.get('SELECT * FROM bookings WHERE code = ?', [code]);
  });

  broadcast(show.id);
  res.status(201).json({ booking: bookingToJson(row, show) });
});

// Cancel a booking: its seats become free again for everyone, live
app.post('/api/bookings/:code/cancel', (req, res) => {
  const { userId } = req.body || {};
  checkUser(userId);
  const code = String(req.params.code).toUpperCase();

  const { row, show } = db.transaction(() => {
    const b = db.get('SELECT * FROM bookings WHERE code = ?', [code]);
    // Same answer for "doesn't exist" and "not yours", so codes can't be probed
    if (!b || b.user_id !== userId) throw new HttpError(404, 'Booking not found');
    if (b.status === 'cancelled') throw new HttpError(409, 'This booking is already cancelled');
    const show = getShow(b.show_id);
    if (show.start_time - Date.now() < CANCEL_CUTOFF_MS) {
      throw new HttpError(400, 'Bookings can only be cancelled until 30 minutes before the show');
    }
    const seats = JSON.parse(b.seats);
    db.run(
      `UPDATE seats SET status = 'free', booked_by = NULL
       WHERE show_id = ? AND booked_by = ? AND status = 'booked'
         AND seat_id IN (${seats.map(() => '?').join(',')})`,
      [show.id, userId, ...seats]
    );
    db.run(`UPDATE bookings SET status = 'cancelled', cancelled_at = ? WHERE id = ?`, [Date.now(), b.id]);
    return { row: db.get('SELECT * FROM bookings WHERE id = ?', [b.id]), show };
  });

  broadcast(show.id);
  res.json({ booking: bookingToJson(row, show) });
});

// A user's bookings
app.get('/api/users/:userId/bookings', (req, res) => {
  checkUser(req.params.userId);
  const rows = db.all(
    `SELECT b.*, s.title, s.genre, s.language, s.duration, s.certificate, s.tagline, s.color_a, s.color_b, s.start_time,
            s.movie_slug, s.theatre_id, s.screen, s.format, s.id AS sid
     FROM bookings b JOIN shows s ON s.id = b.show_id
     WHERE b.user_id = ? ORDER BY b.created_at DESC`,
    [req.params.userId]
  );
  res.json({ bookings: rows.map(r => bookingToJson(r, { ...r, id: r.sid })), rewards: rewardsFor(rows) });
});

// Unknown API route
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

/* ---------- Pages and SEO ---------- */
const seoContext = {
  isComingSoon,
  rating: slug => ratingsMap(slug).get(slug) || NO_RATING,
  // For the sitemap's lastmod: when each movie last got a review (ms)
  lastReviews: () => new Map(
    db.all('SELECT movie_slug, MAX(created_at) AS t FROM reviews GROUP BY movie_slug').map(r => [r.movie_slug, r.t])
  )
};

app.get('/robots.txt', (req, res) => res.type('text/plain').send(seo.robotsTxt(req)));
app.get('/sitemap.xml', (req, res) => res.type('application/xml').send(seo.sitemapXml(req, seoContext)));

// Old links used #/movie/... ; browsers never send the # part, so the app redirects those itself.
// Every other GET is a page of the app, rendered with its own title, description and structured data.
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const { status, html } = seo.renderPage(req, seoContext);
  res.status(status).set('Cache-Control', 'no-cache').type('html').send(html);
});

// Error handler: turns thrown errors into JSON
app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...err.extra });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server' });
});

/* ---------- Live updates ---------- */
// Tell everyone on a show page how many people are looking at it
function broadcastViewers(showId) {
  const room = io.sockets.adapter.rooms.get('show:' + showId);
  io.to('show:' + showId).emit('viewers', { showId: Number(showId), count: room ? room.size : 0 });
}

// Leaves every show room and returns the show ids it left
function leaveShows(socket) {
  const left = [];
  for (const room of socket.rooms) {
    if (room.startsWith('show:')) { socket.leave(room); left.push(room.slice(5)); }
  }
  return left;
}

io.on('connection', socket => {
  socket.on('join', showId => {
    const id = Number(showId);
    if (!Number.isInteger(id)) return;
    leaveShows(socket).forEach(broadcastViewers);
    socket.join('show:' + id);
    if (db.get('SELECT 1 FROM shows WHERE id = ?', [id])) {
      db.ensureSeats([id]);
      socket.emit('seats', { showId: id, seats: seatsFor(id) });
    }
    broadcastViewers(id);
  });
  socket.on('leave', () => leaveShows(socket).forEach(broadcastViewers));
  // Rooms are still known in 'disconnecting' but already emptied by 'disconnect'
  socket.on('disconnecting', () => {
    socket.data.shows = [...socket.rooms].filter(r => r.startsWith('show:')).map(r => r.slice(5));
  });
  socket.on('disconnect', () => (socket.data.shows || []).forEach(broadcastViewers));
});

// Every 5 seconds: free expired holds and tell everyone
setInterval(() => {
  const now = Date.now();
  const expired = db.all(
    `SELECT DISTINCT show_id FROM seats WHERE status = 'held' AND held_until < ?`, [now]
  );
  if (!expired.length) return;
  db.transaction(() => db.run(
    `UPDATE seats SET status = 'free', held_by = NULL, held_until = NULL
     WHERE status = 'held' AND held_until < ?`, [now]
  ));
  expired.forEach(r => broadcast(r.show_id));
}, 5000);

// Every 10 minutes: add the next day's showtimes after midnight, clear old ones
setInterval(() => db.ensureSchedule(), 10 * 60 * 1000);

/* ---------- Start ---------- */
db.init().then(() => {
  server.listen(PORT, () => {
    console.log(`\n  🎬  Movie booking running at http://localhost:${PORT}\n`);
  });
});

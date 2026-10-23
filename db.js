// Database layer: SQLite running in pure JavaScript (sql.js).
// No native compilation needed, so it works the same on Windows, Mac and Linux.
// The database is saved to data/cinema.db after every change.

const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');
const catalog = require('./catalog');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'cinema.db');
const DAY = 24 * 60 * 60 * 1000;

const ROWS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
const SEATS_PER_ROW = 12;

let db;

/* ---------- Small helpers ---------- */
function all(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function get(sql, params = []) {
  return all(sql, params)[0];
}

// Runs a write query and returns how many rows changed
function run(sql, params = []) {
  db.run(sql, params);
  return db.getRowsModified();
}

function persist() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, Buffer.from(db.export()));
  fs.renameSync(tmp, DB_FILE);
}

// All-or-nothing: if fn throws, every change inside it is undone
function transaction(fn) {
  db.run('BEGIN');
  try {
    const result = fn();
    db.run('COMMIT');
    persist();
    return result;
  } catch (err) {
    db.run('ROLLBACK');
    throw err;
  }
}

/* ---------- Schema ---------- */
// The original tables. Everything added later lives in migrate(), so a fresh
// database and an older data/cinema.db end up with exactly the same shape.
function createSchema() {
  db.run(`
    CREATE TABLE shows (
      id          INTEGER PRIMARY KEY,
      title       TEXT NOT NULL,
      genre       TEXT NOT NULL,
      language    TEXT NOT NULL,
      duration    INTEGER NOT NULL,      -- minutes
      certificate TEXT NOT NULL,
      tagline     TEXT NOT NULL,
      color_a     TEXT NOT NULL,         -- poster colours
      color_b     TEXT NOT NULL,
      start_time  INTEGER NOT NULL       -- ms since epoch
    );

    CREATE TABLE seats (
      show_id    INTEGER NOT NULL,
      seat_id    TEXT NOT NULL,          -- e.g. 'A5'
      row_label  TEXT NOT NULL,
      seat_num   INTEGER NOT NULL,
      status     TEXT NOT NULL DEFAULT 'free',   -- free | held | booked
      held_by    TEXT,
      held_until INTEGER,
      booked_by  TEXT,
      PRIMARY KEY (show_id, seat_id)
    );

    CREATE TABLE bookings (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      code        TEXT NOT NULL UNIQUE,
      show_id     INTEGER NOT NULL,
      user_id     TEXT NOT NULL,
      user_name   TEXT NOT NULL,
      seats       TEXT NOT NULL,         -- JSON array
      total       INTEGER NOT NULL,      -- rupees
      created_at  INTEGER NOT NULL
    );

    CREATE INDEX idx_bookings_user ON bookings(user_id);
  `);
}

// Adds any missing columns; returns the column names that existed before
function addColumns(table, defs) {
  const cols = all(`PRAGMA table_info(${table})`).map(c => c.name);
  for (const [name, def] of defs) {
    if (!cols.includes(name)) db.run(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`);
  }
  return cols;
}

function migrate() {
  const before = addColumns('bookings', [
    ['seat_total', 'INTEGER NOT NULL DEFAULT 0'],      // rupees, before snacks and discount
    ['snacks', "TEXT NOT NULL DEFAULT '[]'"],          // JSON: [{ id, name, price, qty }]
    ['snack_total', 'INTEGER NOT NULL DEFAULT 0'],
    ['promo', 'TEXT'],
    ['discount', 'INTEGER NOT NULL DEFAULT 0'],
    ['fee', 'INTEGER NOT NULL DEFAULT 0'],             // convenience fee
    ['tax', 'INTEGER NOT NULL DEFAULT 0'],             // GST on the convenience fee
    ['status', "TEXT NOT NULL DEFAULT 'confirmed'"],   // confirmed | cancelled
    ['cancelled_at', 'INTEGER']
  ]);
  // Old bookings only had seats, so their total was the seat total
  if (!before.includes('seat_total')) run('UPDATE bookings SET seat_total = total');

  // Shows now belong to a movie and a cinema (see catalog.js).
  // Shows from the first version have NULL here and are no longer listed.
  addColumns('shows', [
    ['movie_slug', 'TEXT'],
    ['theatre_id', 'TEXT'],
    ['screen', 'TEXT'],
    ['format', "TEXT NOT NULL DEFAULT '2D'"]
  ]);
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_shows_movie ON shows(movie_slug, start_time);
    CREATE INDEX IF NOT EXISTS idx_shows_theatre ON shows(theatre_id, start_time);
    CREATE TABLE IF NOT EXISTS schedule_days (day TEXT PRIMARY KEY);   -- days whose showtimes exist
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS interests (
      movie_slug TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      PRIMARY KEY (movie_slug, user_id)
    );
    CREATE TABLE IF NOT EXISTS reviews (
      movie_slug TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      user_name  TEXT NOT NULL,
      rating     INTEGER NOT NULL,       -- 1 to 5 stars
      text       TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      PRIMARY KEY (movie_slug, user_id)
    );
  `);
}

/* ---------- Showtimes ---------- */
const SCHEDULE_DAYS = 7;
const SLOTS = [[9, 30], [10, 45], [12, 15], [13, 30], [15, 0], [16, 20], [18, 0], [19, 30], [21, 15], [22, 30]];

// Simple repeatable random numbers, so the same movie gets the same cinemas every time
function seededRandom(seed) {
  let s = seed % 2147483648;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619) >>> 0;
  return h;
}

// 'YYYY-MM-DD' in the server's local time
function dayKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function startOfDay(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// Does this cinema play this movie? Fixed per pair, so it doesn't change day to day.
// Films play everywhere in their home city, Hindi/English films widely, other films in fewer places.
function plays(movie, theatre) {
  const city = catalog.CITY_BY_ID.get(theatre.city);
  if (movie.languages[0] === city.lang) return true;
  const chance = ['Hindi', 'English'].includes(movie.languages[0]) ? 0.8 : 0.45;
  return seededRandom(hash(movie.slug + theatre.id))() < chance;
}

function generateDay(dayStart) {
  const key = dayKey(dayStart);
  const daysFromToday = Math.round((dayStart - startOfDay(Date.now())) / DAY);
  const nowShowing = catalog.MOVIES.filter(m => m.releaseDate <= key);   // 'YYYY-MM-DD' compares as text
  // Skips a slot that already has a show (one kept because it has bookings)
  const insert = db.prepare(
    `INSERT INTO shows (title, genre, language, duration, certificate, tagline, color_a, color_b, start_time,
                        movie_slug, theatre_id, screen, format)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
     WHERE NOT EXISTS (SELECT 1 FROM shows WHERE start_time = ? AND theatre_id = ? AND movie_slug = ?)`
  );

  for (const movie of nowShowing) {
    for (const city of catalog.CITIES) {
      const theatres = catalog.THEATRES.filter(t => t.city === city.id);
      let chosen = theatres.filter(t => plays(movie, t));
      if (!chosen.length) chosen = [theatres[hash(movie.slug + city.id) % theatres.length]];

      for (const theatre of chosen) {
        const rand = seededRandom(hash(movie.slug + theatre.id + key));
        const home = movie.languages[0] === city.lang;
        const count = (home ? 3 : 2) + Math.floor(rand() * 2);
        const slots = SLOTS.map(s => [rand(), s]).sort((a, b) => a[0] - b[0]).slice(0, count)
          .map(x => x[1]).sort((a, b) => (a[0] * 60 + a[1]) - (b[0] * 60 + b[1]));
        const formats = movie.formats.filter(f => theatre.formats.includes(f));

        slots.forEach(([h, min], i) => {
          // Mostly the original language; some shows dubbed into the city's language or Hindi
          let language = movie.languages[0];
          if (i % 2 === 1 && movie.languages.includes(city.lang)) language = city.lang;
          else if (i % 3 === 2 && movie.languages.includes('Hindi')) language = 'Hindi';
          const format = formats[(i + daysFromToday) % formats.length];
          const start = dayStart + (h * 60 + min) * 60 * 1000;
          insert.run([
            // Runtime and certificate are often unknown before release; 0 and '' mean "not known"
            movie.title, (movie.genres || []).join(', '), language, movie.duration || 0, movie.certificate || '', movie.tagline || '',
            movie.colors[0], movie.colors[1], start,
            movie.slug, theatre.id, 'Audi ' + (1 + Math.floor(rand() * 5)), format,
            start, theatre.id, movie.slug
          ]);
        });
      }
    }
  }
  insert.free();
  db.run('INSERT INTO schedule_days (day) VALUES (?)', [key]);
}

// Makes sure the next 7 days have showtimes, and clears out old shows nobody booked.
// Cheap to call often: days that already exist are skipped.
function ensureSchedule() {
  const today = startOfDay(Date.now());
  const missing = [];
  for (let i = 0; i < SCHEDULE_DAYS; i++) {
    const day = today + i * DAY;
    if (!get('SELECT 1 FROM schedule_days WHERE day = ?', [dayKey(day)])) missing.push(day);
  }
  const cutoff = today - DAY;
  const unbookedOld = 'SELECT id FROM shows WHERE start_time < ? AND id NOT IN (SELECT show_id FROM bookings)';
  const stale = get(`SELECT COUNT(*) AS n FROM (${unbookedOld})`, [cutoff]).n;
  if (!missing.length && !stale) return;

  transaction(() => {
    missing.forEach(generateDay);
    db.run(`DELETE FROM seats WHERE show_id IN (${unbookedOld})`, [cutoff]);
    db.run(`DELETE FROM shows WHERE id IN (${unbookedOld})`, [cutoff]);
    db.run('DELETE FROM schedule_days WHERE day < ?', [dayKey(cutoff)]);
  });
}

// Seats are created the first time a show is looked at, so 7 days of showtimes
// don't need hundreds of thousands of seat rows. Some start booked so halls look real.
function ensureSeats(showIds) {
  const missing = showIds.filter(id => !get('SELECT 1 FROM seats WHERE show_id = ? LIMIT 1', [id]));
  if (!missing.length) return;
  transaction(() => {
    const insert = db.prepare(
      'INSERT INTO seats (show_id, seat_id, row_label, seat_num, status, booked_by) VALUES (?, ?, ?, ?, ?, ?)'
    );
    for (const showId of missing) {
      const rand = seededRandom(showId * 97 + 13);
      const fullness = 0.05 + rand() * 0.85;   // from nearly empty to nearly sold out
      for (const row of ROWS) {
        for (let n = 1; n <= SEATS_PER_ROW; n++) {
          const booked = rand() < fullness;
          insert.run([showId, row + n, row, n, booked ? 'booked' : 'free', booked ? 'seed' : null]);
        }
      }
    }
    insert.free();
  });
}

async function init() {
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_FILE)) {
    db = new SQL.Database(fs.readFileSync(DB_FILE));
  } else {
    db = new SQL.Database();
    createSchema();
  }
  migrate();
  refreshIfCatalogChanged();
  persist();
  ensureSchedule();
}

// If catalog.js was edited (a movie or cinema added, say), throw away future
// showtimes nobody has booked so ensureSchedule() rebuilds them from the new catalogue.
function refreshIfCatalogChanged() {
  const sig = String(hash(JSON.stringify([catalog.MOVIES, catalog.THEATRES, catalog.CITIES])));
  const row = get("SELECT value FROM meta WHERE key = 'catalog'");
  if (row && row.value === sig) return;
  const today = dayKey(Date.now());
  const unbooked = `SELECT id FROM shows WHERE start_time >= ? AND id NOT IN (SELECT show_id FROM bookings)
                    AND id NOT IN (SELECT show_id FROM seats WHERE status = 'held')`;
  const from = startOfDay(Date.now());
  db.run(`DELETE FROM seats WHERE show_id IN (${unbooked})`, [from]);
  db.run(`DELETE FROM shows WHERE id IN (${unbooked})`, [from]);
  db.run('DELETE FROM schedule_days WHERE day >= ?', [today]);
  db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('catalog', ?)", [sig]);
}

module.exports = {
  init, all, get, run, transaction, persist, ensureSchedule, ensureSeats, dayKey, startOfDay,
  ROWS, SEATS_PER_ROW, SCHEDULE_DAYS, DAY
};

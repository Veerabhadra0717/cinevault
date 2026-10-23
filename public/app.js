// Cinevault frontend: plain JavaScript, no framework.
// Views: movies (/), one movie with showtimes (/movie/:slug), seat selection (/show/:id),
// ticket (/ticket), my tickets (/bookings). Real URLs (History API), so search engines can index them.

(() => {
  const app = document.getElementById('app');
  const toastEl = document.getElementById('toast');
  const seatTip = document.getElementById('seatTip');
  window.addEventListener('scroll', () => { seatTip.hidden = true; }, { passive: true });

  /* ---------- Small helpers ---------- */
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };

  function makeId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'u-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  // Each browser gets its own id, so you can test with two different browsers
  let userId = store.get('cv-user');
  if (!userId || !/^[a-zA-Z0-9-]{8,64}$/.test(userId)) {
    userId = makeId();
    store.set('cv-user', userId);
  }
  let userName = store.get('cv-name') || '';

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rupees = n => '₹' + n.toLocaleString('en-IN');

  // 1,26,000 -> "1.3L", 41,200 -> "41.2K" (lakh, as Indian apps show it)
  function compact(n) {
    if (n >= 100000) return (n / 100000).toFixed(1).replace(/\.0$/, '') + 'L';
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    return String(n);
  }

  function fmtTime(ms) {
    return new Date(ms).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
  }
  function fmtDay(ms) {
    const d = new Date(ms); d.setHours(0, 0, 0, 0);
    const t = new Date(); t.setHours(0, 0, 0, 0);
    const diff = Math.round((d - t) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    return new Date(ms).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  }
  function fmtFull(ms) {
    return new Date(ms).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }) + ', ' + fmtTime(ms);
  }
  function fmtDate(ms) {
    return new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function fmtShort(ms) {
    return new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  }
  function fmtDuration(min) { return Math.floor(min / 60) + 'h ' + (min % 60) + 'm'; }
  // "2d 4h", "3h 20m", "12m"
  function fmtLeft(ms) {
    const min = Math.max(1, Math.round(ms / 60000));
    const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = min % 60;
    if (d) return `${d}d ${h}h`;
    if (h) return `${h}h ${m}m`;
    return `${m}m`;
  }
  function timeAgo(ms) {
    const min = Math.round((Date.now() - ms) / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return `${min}m ago`;
    if (min < 1440) return `${Math.floor(min / 60)}h ago`;
    if (min < 10080) return `${Math.floor(min / 1440)}d ago`;
    return fmtDate(ms);
  }
  // Five stars, filled to the rating (a CSS gradient does the partial fill)
  function stars(avg, label = true) {
    return `<span class="stars" style="--r:${(avg / 5) * 100}%" ${label ? `role="img" aria-label="${avg} out of 5 stars"` : 'aria-hidden="true"'}>★★★★★</span>`;
  }

  /* ---------- Watchlist and recently viewed (this browser only) ---------- */
  function loadList(key) {
    try { const v = JSON.parse(store.get(key) || '[]'); return Array.isArray(v) ? v.filter(x => typeof x === 'string') : []; }
    catch (e) { return []; }
  }
  const watchlist = new Set(loadList('cv-watch'));
  let recent = loadList('cv-recent');
  function toggleWatch(slug) {
    if (watchlist.has(slug)) watchlist.delete(slug); else watchlist.add(slug);
    store.set('cv-watch', JSON.stringify([...watchlist]));
    return watchlist.has(slug);
  }
  function addRecent(slug) {
    recent = [slug, ...recent.filter(s => s !== slug)].slice(0, 10);
    store.set('cv-recent', JSON.stringify(recent));
  }
  function heartButton(m, extraClass = '') {
    const on = watchlist.has(m.slug);
    return `<button type="button" class="heart ${extraClass}" data-watch="${esc(m.slug)}" aria-pressed="${on}"
      aria-label="${on ? 'Remove from' : 'Add to'} watchlist: ${esc(m.title)}"><span aria-hidden="true">${on ? '♥' : '♡'}</span></button>`;
  }
  // 'YYYY-MM-DD' -> local midnight
  function parseDay(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d).getTime();
  }
  function seatSort(a, b) {
    return a[0] === b[0] ? Number(a.slice(1)) - Number(b.slice(1)) : a.localeCompare(b);
  }

  let toastTimer;
  function toast(msg, type = '') {
    toastEl.textContent = msg;
    toastEl.className = 'toast show ' + type;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.className = 'toast ' + type; }, 3200);
  }

  /* ---------- Theme ---------- */
  const themeBtn = document.getElementById('themeBtn');
  const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const isDark = () => (document.documentElement.dataset.theme || (darkQuery.matches ? 'dark' : 'light')) === 'dark';
  function syncThemeBtn() {
    themeBtn.textContent = isDark() ? '☀' : '☾';
    themeBtn.setAttribute('aria-label', isDark() ? 'Switch to light theme' : 'Switch to dark theme');
  }
  themeBtn.addEventListener('click', () => {
    const next = isDark() ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    store.set('cv-theme', next);
    syncThemeBtn();
  });
  darkQuery.addEventListener('change', syncThemeBtn);
  syncThemeBtn();

  /* ---------- State ---------- */
  const state = {
    meta: null,        // cities, languages, genres, formats
    city: store.get('cv-city') || 'bengaluru',
    movie: null,       // movie page: { slug, data, date, lang, format }
    show: null,        // current show on the seat page
    seats: [],
    prices: [],
    snackMenu: [],
    fees: { perSeat: 0, gstRate: 0 },
    maxSeats: 6,
    maxSnackQty: 10,
    cart: {},          // snack id -> quantity
    promo: null,       // applied promo rule from the server
    pickCount: 2,      // "best seats" picker
    busy: new Set(),   // seats waiting for a server reply
    tick: null,        // countdown interval
    hadHold: false,
    lastBooking: null,
    tickets: new Map(),// booking code -> booking, for the ticket buttons
    online: true
  };

  const filters = { q: '', lang: 'All', genre: 'All', format: 'All', sort: 'popular', saved: false };
  let spotTimer = null;
  let movieLists = { nowShowing: [], comingSoon: [] };

  const mySeats = () => state.seats.filter(s => s.status === 'held' && s.heldBy === userId).sort((a, b) => seatSort(a.id, b.id));
  const cityName = () => (state.meta.cities.find(c => c.id === state.city) || state.meta.cities[0]).name;

  /* ---------- City picker ---------- */
  const citySel = document.getElementById('citySel');
  citySel.addEventListener('change', () => {
    state.city = citySel.value;
    store.set('cv-city', state.city);
    // The seat page belongs to one cinema; everything else is redrawn for the new city
    if (!/^\/show\//.test(location.pathname)) route();
  });

  /* ---------- Router ---------- */
  window.addEventListener('popstate', route);

  function navigate(path, { replace = false } = {}) {
    if (path !== location.pathname) history[replace ? 'replaceState' : 'pushState'](null, '', path);
    route();
  }

  // Links inside the app change the view without reloading the page
  document.addEventListener('click', e => {
    const a = e.target.closest('a[href^="/"]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey ||
        a.target || a.hasAttribute('download') || /^\/(api|socket\.io)\//.test(a.getAttribute('href'))) return;
    e.preventDefault();
    navigate(a.getAttribute('href'));
  });

  // Old #/movie/... links keep working
  if (/^#\//.test(location.hash)) history.replaceState(null, '', location.hash.slice(1));
  window.addEventListener('beforeunload', () => {
    if (state.show && mySeats().length) API.releaseOnExit(state.show.id, userId);
  });

  function setNav(active) {
    document.querySelectorAll('[data-nav]').forEach(a => {
      if (a.dataset.nav === active) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }

  function leaveShow() {
    if (!state.show) return;
    const id = state.show.id;
    if (mySeats().length) API.request('DELETE', `/shows/${id}/hold`, { userId }).catch(() => {});
    Realtime.disconnect();
    clearInterval(state.tick);
    state.show = null;
    state.seats = [];
    state.busy.clear();
  }

  function route() {
    const hash = location.pathname.replace(/\/+$/, '') || '/';
    const showMatch = hash.match(/^\/show\/(\d+)$/);
    const movieMatch = hash.match(/^\/movie\/([a-z0-9-]+)$/);
    if (!showMatch || (state.show && state.show.id !== Number(showMatch[1]))) leaveShow();
    clearInterval(spotTimer);
    seatTip.hidden = true;

    if (showMatch) { setNav(''); openShow(Number(showMatch[1])); }
    else if (movieMatch) { setNav('shows'); openMovie(movieMatch[1]); }
    else if (hash === '/bookings') { setNav('bookings'); openBookings(); }
    else if (hash === '/ticket' && state.lastBooking) { setNav(''); renderTicketPage(state.lastBooking); }
    else {
      // Unknown page (or /ticket after a reload): show the movies at the home URL
      if (hash !== '/') history.replaceState(null, '', '/');
      setNav('shows'); openMovies();
    }
    window.scrollTo(0, 0);
  }

  /* ---------- Page title and description ---------- */
  // The server sends these for the first page; this keeps them right as you move around
  function setMeta(title, description, { index = true } = {}) {
    const url = location.origin + location.pathname;
    const set = (attr, key, value) => {
      let m = document.head.querySelector(`meta[${attr}="${key}"]`);
      if (!m) { m = document.createElement('meta'); m.setAttribute(attr, key); document.head.appendChild(m); }
      m.setAttribute('content', value);
    };
    document.title = title;
    if (description) { set('name', 'description', description); set('property', 'og:description', description); }
    set('property', 'og:title', title);
    set('property', 'og:url', url);
    set('name', 'robots', index ? 'index, follow, max-image-preview:large' : 'noindex, nofollow');
    // Private pages (seats, tickets) are kept out of search, so they get no canonical link
    let canonical = document.head.querySelector('link[rel="canonical"]');
    if (!index) { if (canonical) canonical.remove(); return; }
    if (!canonical) { canonical = document.createElement('link'); canonical.rel = 'canonical'; document.head.appendChild(canonical); }
    canonical.href = url;
  }
  const clip = (t, max = 158) => (t.length <= max ? t : t.slice(0, t.lastIndexOf(' ', max - 1)).replace(/[,.;:]$/, '') + '…');

  /* ---------- Posters ---------- */
  function poster(m) {
    const [a, b] = m.colors;
    const imax = (m.formats || []).some(f => f.startsWith('IMAX'));
    return `
      <div class="poster" style="background:${a};color:${b}">
        <div class="orb" style="background:${b}"></div>
        ${m.certificate ? `<span class="cert" style="color:#fff">${esc(m.certificate)}</span>` : ''}
        ${imax ? '<span class="pbadge">IMAX</span>' : ''}
        <p class="ptitle${Math.max(...m.title.split(/\s+/).map(w => w.length)) > 8 ? ' long' : ''}">${esc(m.title)}</p>
        ${m.tagline ? `<p class="ptag" style="color:#fff">${esc(m.tagline)}</p>` : ''}
      </div>`;
  }

  /* ---------- Movies (home) ---------- */
  function skeletonGrid(n = 10) {
    return `<div class="skeleton-hero"></div>
      <div class="movie-grid" aria-busy="true" aria-label="Loading movies">
        ${'<div class="skel-card"><div class="skel poster-skel"></div><div class="skel line-skel"></div><div class="skel line-skel short"></div></div>'.repeat(n)}
      </div>`;
  }

  async function openMovies() {
    app.innerHTML = skeletonGrid();
    try {
      movieLists = await API.request('GET', `/movies?city=${state.city}&userId=${userId}`);
      renderMovies();
    } catch (e) {
      app.innerHTML = `<p class="loading">Couldn’t load movies. Is the server running?</p>`;
    }
  }

  function selectBox(id, label, value, options) {
    return `<label class="selectbox"><span>${label}</span>
      <select id="${id}">${options.map(([v, t]) => `<option value="${esc(v)}" ${v === value ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
    </label>`;
  }

  // The filter bar is drawn once; only the lists below it redraw, so the search box keeps focus
  function renderMovies() {
    setMeta(`Cinevault: Movie tickets in ${cityName()}, showtimes and seat booking`,
      `Book movie tickets in ${cityName()} for ${movieLists.nowShowing.length} films in ${state.meta.languages.length} languages. Pick your seats live, see showtimes for the next 7 days and add snacks.`);
    const all = [...movieLists.nowShowing, ...movieLists.comingSoon];
    const langCount = l => movieLists.nowShowing.filter(m => m.languages.includes(l)).length;
    const meta = state.meta;
    if (filters.lang !== 'All' && !meta.languages.includes(filters.lang)) filters.lang = 'All';

    const bySlug = new Map(all.map(m => [m.slug, m]));
    const recentMovies = recent.map(s => bySlug.get(s)).filter(Boolean);

    app.innerHTML = `
      <div id="spotlight"></div>
      <div class="home-head">
        <h1 class="marquee">Movies in <span class="accent">${esc(cityName())}</span></h1>
        <p class="lede">${movieLists.nowShowing.length} movies in ${meta.languages.length} languages. Pick one to see cinemas and showtimes for the next 7 days.</p>
      </div>
      ${recentMovies.length ? `
      <section class="recent" aria-labelledby="recentTitle">
        <h2 class="row-title" id="recentTitle">Recently viewed</h2>
        <div class="recent-row">${recentMovies.map(m => `
          <a class="recent-card" href="/movie/${esc(m.slug)}" style="--ma:${m.colors[0]};--mb:${m.colors[1]}">
            <span class="recent-dot" aria-hidden="true"></span>
            <span><b>${esc(m.title)}</b><small>${m.comingSoon ? 'Releasing ' + fmtShort(m.releaseDate) : esc(m.languages[0])}</small></span>
          </a>`).join('')}
        </div>
      </section>` : ''}
      <div class="filters" role="search">
        <div class="searchwrap">
          <span class="search-icon" aria-hidden="true"></span>
          <input type="search" id="q" class="search" placeholder="Search movies, genres, languages" aria-label="Search movies" value="${esc(filters.q)}">
        </div>
        <button type="button" class="fchip saved-chip" id="savedChip" aria-pressed="${filters.saved}">♥ Watchlist <small id="savedCount">${watchlist.size}</small></button>
        <div class="chips" role="group" aria-label="Language">
          ${['All', ...meta.languages].map(l => `<button type="button" class="fchip" data-lang="${esc(l)}" aria-pressed="${filters.lang === l}">${l === 'All' ? 'All languages' : esc(l)}${l === 'All' ? '' : ` <small>${langCount(l)}</small>`}</button>`).join('')}
        </div>
        <div class="selects">
          ${selectBox('fGenre', 'Genre', filters.genre, [['All', 'All genres'], ...meta.genres.map(g => [g, g])])}
          ${selectBox('fFormat', 'Format', filters.format, [['All', 'All formats'], ...meta.formats.map(f => [f, f])])}
          ${selectBox('fSort', 'Sort', filters.sort, [['popular', 'Popular'], ['rating', 'Top rated'], ['new', 'Newest first'], ['title', 'A to Z']])}
        </div>
      </div>
      <div id="movieList"></div>`;

    renderSpotlight();
    document.getElementById('savedChip').addEventListener('click', e => {
      filters.saved = !filters.saved;
      e.currentTarget.setAttribute('aria-pressed', String(filters.saved));
      renderMovieList();
    });
    document.getElementById('q').addEventListener('input', e => { filters.q = e.target.value; renderMovieList(); });
    app.querySelectorAll('.fchip[data-lang]').forEach(btn => btn.addEventListener('click', () => {
      filters.lang = btn.dataset.lang;
      app.querySelectorAll('.fchip[data-lang]').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
      renderMovieList();
    }));
    [['fGenre', 'genre'], ['fFormat', 'format'], ['fSort', 'sort']].forEach(([id, key]) =>
      document.getElementById(id).addEventListener('change', e => { filters[key] = e.target.value; renderMovieList(); }));
    renderMovieList();
    if (!all.length) document.getElementById('movieList').innerHTML = '<div class="emptystate"><p>No movies in this city right now.</p></div>';
  }

  function matches(m) {
    const q = filters.q.trim().toLowerCase();
    return (!q || [m.title, ...m.genres, ...m.languages].some(x => x.toLowerCase().includes(q))) &&
      (!filters.saved || watchlist.has(m.slug)) &&
      (filters.lang === 'All' || m.languages.includes(filters.lang)) &&
      (filters.genre === 'All' || m.genres.includes(filters.genre)) &&
      (filters.format === 'All' || m.formats.includes(filters.format));
  }

  // Popularity: real bookings this week first, then ratings, then how many shows the city has
  const popularity = m => m.bookings * 10 + m.rating.avg * Math.min(m.rating.count, 20) + m.showCount / 10;
  // Ratings with few votes are pulled towards 3 stars so one 5-star review doesn't top the chart
  const ratingScore = m => (m.rating.avg * m.rating.count + 3 * 3) / (m.rating.count + 3);
  const SORTS = {
    popular: (a, b) => popularity(b) - popularity(a) || b.releaseDate - a.releaseDate,
    rating: (a, b) => (b.rating.count ? ratingScore(b) : 0) - (a.rating.count ? ratingScore(a) : 0) || popularity(b) - popularity(a),
    new: (a, b) => b.releaseDate - a.releaseDate,
    title: (a, b) => a.title.localeCompare(b.title)
  };

  function ratingLine(m) {
    if (m.rating && m.rating.count) {
      return `<p class="rating">${stars(m.rating.avg)} <b>${m.rating.avg.toFixed(1)}</b> <small>${compact(m.rating.count)} rating${m.rating.count > 1 ? 's' : ''}</small></p>`;
    }
    return `<p class="rating">${Date.now() - m.releaseDate < 8 * 86400000 ? '<span class="newtag">New</span> ' : ''}<small>Released ${fmtShort(m.releaseDate)}</small></p>`;
  }

  function movieCard(m) {
    return `
      <article class="mcard">
        <a class="mcard-link" href="/movie/${esc(m.slug)}" tabindex="-1" aria-hidden="true">${poster(m)}</a>
        ${heartButton(m)}
        <div class="mcard-body">
          <h3><a href="/movie/${esc(m.slug)}">${esc(m.title)}</a></h3>
          ${ratingLine(m)}
          <p class="mmeta">${esc([m.genres.join(', '), m.languages.join(', ')].filter(Boolean).join(' · '))}</p>
        </div>
      </article>`;
  }

  // Big rotating banner: the most popular films in this city right now
  function renderSpotlight() {
    const el = document.getElementById('spotlight');
    if (!el) return;
    const picks = [...movieLists.nowShowing].sort(SORTS.popular).slice(0, 5);
    if (!picks.length) { el.innerHTML = ''; return; }
    let i = 0;
    el.innerHTML = `
      <section class="spotlight" aria-roledescription="carousel" aria-label="Trending in ${esc(cityName())}">
        ${picks.map((m, n) => `
          <article class="slide${n === 0 ? ' active' : ''}" style="--ma:${m.colors[0]};--mb:${m.colors[1]}"
            aria-roledescription="slide" aria-label="${n + 1} of ${picks.length}" ${n === 0 ? '' : 'aria-hidden="true"'}>
            <div class="slide-info">
              <p class="eyebrow"><span class="pulse-dot" aria-hidden="true"></span>Trending in ${esc(cityName())}</p>
              <h2>${esc(m.title)}</h2>
              <p class="slide-meta">${[
                m.rating.count ? `<span class="slide-rating">★ ${m.rating.avg.toFixed(1)}</span>` : '',
                esc(m.languages.slice(0, 3).join(', ') + (m.languages.length > 3 ? ' +' + (m.languages.length - 3) : '')),
                esc(m.genres.slice(0, 2).join(', ')), esc(m.formats.join(' · '))].filter(Boolean).join('<i aria-hidden="true">•</i>')}</p>
              ${m.synopsis ? `<p class="slide-syn">${esc(m.synopsis)}</p>` : ''}
              <div class="slide-actions">
                <a class="cta inline" href="/movie/${esc(m.slug)}" ${n === 0 ? '' : 'tabindex="-1"'}>Book tickets</a>
                ${heartButton(m, 'big')}
              </div>
            </div>
            <a class="slide-poster" href="/movie/${esc(m.slug)}" tabindex="-1" aria-hidden="true">${poster(m)}</a>
          </article>`).join('')}
        ${picks.length > 1 ? `
        <div class="spot-nav">
          <button type="button" class="spot-arrow" data-spot="-1" aria-label="Previous movie">‹</button>
          <div class="dots">${picks.map((m, n) => `<button type="button" class="dot" data-dot="${n}" aria-label="Show ${esc(m.title)}" aria-current="${n === 0}"></button>`).join('')}</div>
          <button type="button" class="spot-arrow" data-spot="1" aria-label="Next movie">›</button>
        </div>` : ''}
      </section>`;

    const slides = el.querySelectorAll('.slide');
    const go = n => {
      i = (n + picks.length) % picks.length;
      slides.forEach((s, k) => {
        s.classList.toggle('active', k === i);
        if (k === i) s.removeAttribute('aria-hidden'); else s.setAttribute('aria-hidden', 'true');
        s.querySelectorAll('a.cta, .heart').forEach(a => (k === i ? a.removeAttribute('tabindex') : a.setAttribute('tabindex', '-1')));
      });
      el.querySelectorAll('.dot').forEach((d, k) => d.setAttribute('aria-current', String(k === i)));
    };
    const start = () => {
      clearInterval(spotTimer);
      if (picks.length > 1 && !matchMedia('(prefers-reduced-motion: reduce)').matches) spotTimer = setInterval(() => go(i + 1), 6500);
    };
    el.querySelectorAll('[data-spot]').forEach(b => b.addEventListener('click', () => { go(i + Number(b.dataset.spot)); start(); }));
    el.querySelectorAll('[data-dot]').forEach(b => b.addEventListener('click', () => { go(Number(b.dataset.dot)); start(); }));
    const box = el.querySelector('.spotlight');
    box.addEventListener('mouseenter', () => clearInterval(spotTimer));
    box.addEventListener('mouseleave', start);
    box.addEventListener('focusin', () => clearInterval(spotTimer));
    start();
  }

  function soonCard(m) {
    return `
      <article class="mcard soon">
        <a href="/movie/${esc(m.slug)}" class="mcard-link" tabindex="-1" aria-hidden="true">${poster(m)}</a>
        ${heartButton(m)}
        <div class="mcard-body">
          <h3><a href="/movie/${esc(m.slug)}">${esc(m.title)}</a></h3>
          <p class="release">Releasing ${fmtDate(m.releaseDate)}</p>
          ${m.advanceBooking ? '<p class="advance">Advance booking open</p>' : ''}
          <p class="mmeta">${esc([m.genres.join(', '), m.languages.join(', ')].filter(Boolean).join(' · '))}</p>
          ${interestButton(m)}
        </div>
      </article>`;
  }

  function interestButton(m) {
    return `<button type="button" class="interest" data-interest="${esc(m.slug)}" aria-pressed="${!!m.interestedByMe}">
      <span aria-hidden="true">${m.interestedByMe ? '✓' : '👍'}</span> ${m.interestedByMe ? 'Interested' : 'I’m interested'}
      ${m.interested ? `<small>${compact(m.interested)}</small>` : ''}</button>`;
  }

  function renderMovieList() {
    const list = document.getElementById('movieList');
    if (!list) return;
    const now = movieLists.nowShowing.filter(matches).sort(SORTS[filters.sort]);
    const soon = movieLists.comingSoon.filter(matches).sort((a, b) => a.releaseDate - b.releaseDate);

    list.innerHTML = `
      <h2 class="section-title first">Now showing <small>${now.length}</small></h2>
      ${now.length
        ? `<div class="movie-grid">${now.map(movieCard).join('')}</div>`
        : `<div class="emptystate"><p>${filters.saved && !watchlist.size
            ? 'Your watchlist is empty. Tap ♡ on any movie to save it here.'
            : 'No movies match those filters.'}</p>
           <button type="button" class="btn primary" id="clearFilters">Clear filters</button></div>`}
      ${soon.length ? `<h2 class="section-title">Coming soon <small>${soon.length}</small></h2><div class="movie-grid">${soon.map(soonCard).join('')}</div>` : ''}`;

    const clear = document.getElementById('clearFilters');
    if (clear) clear.addEventListener('click', () => {
      Object.assign(filters, { q: '', lang: 'All', genre: 'All', format: 'All', saved: false });
      renderMovies();
    });
  }

  // Watchlist hearts work everywhere: cards, the spotlight and the movie page
  app.addEventListener('click', e => {
    const btn = e.target.closest('[data-watch]');
    if (!btn) return;
    e.preventDefault();
    const slug = btn.dataset.watch;
    const on = toggleWatch(slug);
    app.querySelectorAll(`[data-watch="${CSS.escape(slug)}"]`).forEach(b => {
      b.setAttribute('aria-pressed', String(on));
      b.firstElementChild.textContent = on ? '♥' : '♡';
      b.setAttribute('aria-label', b.getAttribute('aria-label').replace(/^(Add to|Remove from)/, on ? 'Remove from' : 'Add to'));
      b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
    });
    const count = document.getElementById('savedCount');
    if (count) count.textContent = watchlist.size;
    toast(on ? 'Added to your watchlist.' : 'Removed from your watchlist.');
    if (filters.saved && document.getElementById('movieList')) renderMovieList();
  });

  // "I'm interested" buttons on the home page and the movie page
  app.addEventListener('click', async e => {
    const btn = e.target.closest('[data-interest]');
    if (!btn) return;
    btn.disabled = true;
    try {
      const slug = btn.dataset.interest;
      const res = await API.request('POST', `/movies/${slug}/interest`, { userId });
      const m = movieLists.comingSoon.find(x => x.slug === slug) || (state.movie && state.movie.data);
      if (m) Object.assign(m, res);
      btn.outerHTML = interestButton({ ...m, ...res, slug });
      if (res.interestedByMe) toast('We’ll remind you when bookings open.');
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false;
    }
  });

  /* ---------- Movie page ---------- */
  async function openMovie(slug) {
    app.innerHTML = '<p class="loading">Loading…</p>';
    try {
      const { movie } = await API.request('GET', `/movies/${slug}?userId=${userId}`);
      if (!state.movie || state.movie.slug !== slug) state.movie = { slug, date: null, lang: 'All', format: 'All' };
      state.movie.data = movie;
      addRecent(slug);
      renderMoviePage();
      loadShowtimes();
      if (!movie.comingSoon) loadReviews();
    } catch (e) {
      app.innerHTML = `<p class="loading">${e.status === 404 ? 'That movie doesn’t exist.' : 'Couldn’t load this movie.'} <a href="/">Back to movies</a></p>`;
    }
  }

  const initials = name => name.replace(/^Voices of:\s*/, '').split(/\s+/).map(w => w[0]).slice(0, 2).join('');

  function renderMoviePage() {
    const m = state.movie.data;
    const year = new Date(m.releaseDate).getFullYear();
    setMeta(m.comingSoon
      ? `${m.title} (${year}): Release date, cast & advance booking | Cinevault`
      : `${m.title} (${year}): Book tickets, showtimes & reviews | Cinevault`,
    clip(`${m.comingSoon ? `${m.title} releases on ${fmtDate(m.releaseDate)} in ${m.languages.join(', ')}.` : `Book tickets for ${m.title} (${m.languages.join(', ')}) in ${cityName()}.`} ${m.synopsis || ''}`.trim()));
    app.innerHTML = `
      <a href="/" class="back">← All movies</a>
      <section class="mhero" style="--ma:${m.colors[0]};--mb:${m.colors[1]}">
        <div class="mhero-poster">${poster(m)}</div>
        <div class="mhero-info">
          <h1>${esc(m.title)}</h1>
          ${m.comingSoon
            ? `<p class="release big">Releasing ${fmtDate(m.releaseDate)}</p>${interestButton(m)}`
            : `<div class="rating-box" id="heroRating">${heroRating(m.rating)}</div>`}
          <div class="tags">${m.formats.map(f => `<span class="tag">${esc(f)}</span>`).join('')}</div>
          <div class="tags">${m.languages.map(l => `<span class="tag lang">${esc(l)}</span>`).join('')}</div>
          <p class="facts">${[m.duration ? fmtDuration(m.duration) : '', esc(m.genres.join(', ')), esc(m.certificate || ''),
            `${m.comingSoon ? 'Releases' : 'Released'} ${fmtDate(m.releaseDate)}`].filter(Boolean).join(' · ')}</p>
          <div class="hero-actions">
            <button type="button" class="cta inline" id="toBook">${m.comingSoon ? 'Advance booking' : 'Book tickets'}</button>
            ${heartButton(m, 'big')}
            <button type="button" class="iconbtn" id="shareMovie" aria-label="Share this movie"><span aria-hidden="true">↗</span></button>
          </div>
        </div>
      </section>

      <section class="about">
        <h2>About the movie</h2>
        <p>${m.synopsis ? esc(m.synopsis) : 'The story hasn’t been announced yet.'}</p>
      </section>

      ${m.cast.length || m.director ? `
      <section class="about">
        <h2>Cast and crew</h2>
        <div class="people">
          ${m.cast.map(c => `<div class="person"><span class="avatar" aria-hidden="true">${esc(initials(c))}</span><b>${esc(c)}</b><small>Cast</small></div>`).join('')}
          ${m.director ? `<div class="person"><span class="avatar crew" aria-hidden="true">${esc(initials(m.director))}</span><b>${esc(m.director)}</b><small>Director</small></div>` : ''}
        </div>
      </section>` : ''}

      ${`
      <section class="booksec" id="book">
        <h2>Showtimes in ${esc(cityName())}</h2>
        <div class="datestrip" id="dates" role="group" aria-label="Date"></div>
        <div class="show-filters" id="showFilters"></div>
        <div class="avail-legend" aria-hidden="true">
          <span><i class="avail"></i>Available</span><span><i class="filling"></i>Filling fast</span>
          <span><i class="almost"></i>Almost full</span><span><i class="sold"></i>Sold out</span>
        </div>
        <div id="theatreList"><p class="loading">Finding showtimes…</p></div>
      </section>`}

      ${m.comingSoon ? '' : `
      <section class="about reviews" id="reviews">
        <h2>Ratings and reviews</h2>
        <div id="reviewBox"><p class="loading">Loading reviews…</p></div>
      </section>`}`;

    const toBook = document.getElementById('toBook');
    if (toBook) toBook.addEventListener('click', () => document.getElementById('book').scrollIntoView({ behavior: 'smooth' }));
    document.getElementById('shareMovie').addEventListener('click', () => share(
      m.title, `${m.title}: ${m.comingSoon ? 'releasing ' + fmtDate(m.releaseDate) : 'now in cinemas'} on Cinevault`, location.href));
  }

  function heroRating(r) {
    return r && r.count
      ? `<span class="big-star" aria-hidden="true">★</span><b>${r.avg.toFixed(1)}/5</b> <small>${compact(r.count)} rating${r.count > 1 ? 's' : ''}</small>
         <a href="#reviews" class="rate-link" data-scroll="reviews">Rate now</a>`
      : `<b>In cinemas</b> <small>since ${fmtDate(state.movie.data.releaseDate)}</small>
         <a href="#reviews" class="rate-link" data-scroll="reviews">Be the first to rate</a>`;
  }

  // Native share sheet on phones; copies to the clipboard elsewhere
  async function share(title, text, url) {
    try {
      if (navigator.share) { await navigator.share({ title, text, url }); return; }
      await navigator.clipboard.writeText(url ? `${text}\n${url}` : text);
      toast('Copied to your clipboard.');
    } catch (e) {
      if (e && e.name !== 'AbortError') toast('Couldn’t share from this browser.', 'error');
    }
  }

  // In-page links like "Rate now" scroll smoothly instead of adding a # to the URL
  app.addEventListener('click', e => {
    const a = e.target.closest('[data-scroll]');
    if (!a) return;
    e.preventDefault();
    const target = document.getElementById(a.dataset.scroll);
    if (target) target.scrollIntoView({ behavior: 'smooth' });
  });

  /* ---------- Ratings and reviews ---------- */
  let myRating = 0;

  async function loadReviews() {
    const mv = state.movie;
    try {
      const data = await API.request('GET', `/movies/${mv.slug}/reviews?userId=${userId}`);
      if (state.movie !== mv) return;
      renderReviews(data);
    } catch (e) {
      const box = document.getElementById('reviewBox');
      if (box) box.innerHTML = '<p class="loading">Couldn’t load reviews.</p>';
    }
  }

  function renderReviews(data) {
    const box = document.getElementById('reviewBox');
    if (!box) return;
    const mine = data.mine;
    myRating = mine ? mine.rating : 0;
    state.movie.data.rating = { avg: data.average, count: data.count };
    const hero = document.getElementById('heroRating');
    if (hero) hero.innerHTML = heroRating(state.movie.data.rating);
    const max = Math.max(1, ...data.distribution);
    const words = ['', 'Skip it', 'Not great', 'Okay', 'Good', 'Loved it'];

    box.innerHTML = `
      <div class="review-top">
        <div class="review-score">
          <b>${data.count ? data.average.toFixed(1) : '–'}</b>
          ${stars(data.average)}
          <small>${data.count ? `${data.count} rating${data.count > 1 ? 's' : ''}` : 'No ratings yet'}</small>
        </div>
        <div class="dist" aria-label="Rating breakdown">
          ${[5, 4, 3, 2, 1].map(n => `
            <div class="dist-row"><span>${n}★</span>
              <span class="bar"><i style="width:${(data.distribution[n - 1] / max) * 100}%"></i></span>
              <small>${data.distribution[n - 1]}</small></div>`).join('')}
        </div>
      </div>

      <form class="review-form" id="reviewForm">
        <h3>${mine ? 'Your review' : 'Rate this movie'}</h3>
        <div class="star-pick" role="radiogroup" aria-label="Your rating">
          ${[1, 2, 3, 4, 5].map(n => `<button type="button" role="radio" class="star-btn" data-star="${n}" aria-checked="${n === myRating}" aria-label="${n} star${n > 1 ? 's' : ''}, ${words[n]}">★</button>`).join('')}
          <span class="star-word" id="starWord">${myRating ? words[myRating] : 'Tap to rate'}</span>
        </div>
        <label class="sr-only" for="reviewText">Your review</label>
        <textarea id="reviewText" maxlength="500" rows="3" placeholder="What did you think? (optional)">${mine ? esc(mine.text) : ''}</textarea>
        <div class="review-row">
          <label class="sr-only" for="reviewName">Your name</label>
          <input id="reviewName" maxlength="40" autocomplete="name" placeholder="Your name" value="${esc(mine ? mine.name : userName)}">
          <small class="charcount" id="charCount">${mine ? mine.text.length : 0}/500</small>
          ${mine ? '<button type="button" class="linkbtn danger" id="deleteReview">Delete</button>' : ''}
          <button type="submit" class="btn primary" id="postReview">${mine ? 'Update' : 'Post'}</button>
        </div>
      </form>

      <div class="review-list">
        ${data.reviews.length ? data.reviews.map(r => `
          <article class="review${r.mine ? ' mine' : ''}">
            <header>
              <span class="avatar small" aria-hidden="true">${esc(initials(r.name))}</span>
              <div><b>${esc(r.name)}${r.mine ? ' <small>(you)</small>' : ''}</b>
                <small>${timeAgo(r.createdAt)}${r.verified ? ' · <span class="verified">✓ Booked on Cinevault</span>' : ''}</small></div>
              ${stars(r.rating)}
            </header>
            ${r.text ? `<p>${esc(r.text)}</p>` : ''}
          </article>`).join('')
        : '<p class="empty">No reviews yet. Seen it? Tell everyone what you thought.</p>'}
      </div>`;

    const form = document.getElementById('reviewForm');
    const paint = n => {
      form.querySelectorAll('.star-btn').forEach(b => b.classList.toggle('lit', Number(b.dataset.star) <= n));
    };
    paint(myRating);
    form.querySelectorAll('.star-btn').forEach(b => {
      b.addEventListener('mouseenter', () => paint(Number(b.dataset.star)));
      b.addEventListener('mouseleave', () => paint(myRating));
      b.addEventListener('click', () => {
        myRating = Number(b.dataset.star);
        form.querySelectorAll('.star-btn').forEach(x => x.setAttribute('aria-checked', String(x === b)));
        document.getElementById('starWord').textContent = words[myRating];
        paint(myRating);
      });
    });
    const text = document.getElementById('reviewText');
    text.addEventListener('input', () => { document.getElementById('charCount').textContent = `${text.value.length}/500`; });
    form.addEventListener('submit', postReview);
    const del = document.getElementById('deleteReview');
    if (del) del.addEventListener('click', deleteReview);
  }

  async function postReview(e) {
    e.preventDefault();
    if (!myRating) return toast('Tap a star to rate first.', 'error');
    const name = document.getElementById('reviewName').value.trim();
    if (name.length < 2) return toast('Add your name (at least 2 letters).', 'error');
    const btn = document.getElementById('postReview');
    btn.disabled = true;
    const mv = state.movie;
    try {
      const data = await API.request('POST', `/movies/${mv.slug}/reviews`, {
        userId, name, rating: myRating, text: document.getElementById('reviewText').value
      });
      if (!userName) { userName = name; store.set('cv-name', name); }
      if (state.movie === mv) renderReviews(data);
      toast('Thanks! Your review is up.');
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false;
    }
  }

  async function deleteReview() {
    if (!window.confirm('Delete your review?')) return;
    const mv = state.movie;
    try {
      const data = await API.request('DELETE', `/movies/${mv.slug}/reviews`, { userId });
      if (state.movie === mv) renderReviews(data);
      toast('Review deleted.');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function loadShowtimes() {
    const mv = state.movie;
    const list = document.getElementById('theatreList');
    try {
      const data = await API.request('GET', `/movies/${mv.slug}/shows?city=${state.city}${mv.date ? '&date=' + mv.date : ''}`);
      if (state.movie !== mv) return;
      if (!data.dates.some(d => d.shows)) {
        // Nothing in the next 7 days: too early for advance booking, or not playing in this city
        const sec = document.getElementById('book');
        const btn = document.getElementById('toBook');
        if (btn) btn.hidden = true;
        if (sec) sec.innerHTML = `<h2>Showtimes in ${esc(cityName())}</h2>
          <div class="emptystate"><p>${mv.data.comingSoon
            ? `Bookings haven’t opened yet. Releasing ${fmtDate(mv.data.releaseDate)}. Tap “I’m interested” and check back closer to the date.`
            : 'No shows in this city for the next 7 days.'}</p></div>`;
        return;
      }
      mv.date = data.date;
      mv.showData = data;
      renderDates();
      renderShowFilters();
      renderTheatres();
    } catch (e) {
      if (list) list.innerHTML = '<p class="loading">Couldn’t load showtimes.</p>';
    }
  }

  function renderDates() {
    const mv = state.movie;
    const el = document.getElementById('dates');
    if (!el) return;
    el.innerHTML = mv.showData.dates.map(d => {
      const ms = parseDay(d.date);
      const day = new Date(ms);
      return `<button type="button" class="date" data-date="${d.date}" aria-pressed="${d.date === mv.date}" ${d.shows ? '' : 'disabled'}
                aria-label="${fmtDay(ms)}${d.shows ? '' : ', no shows'}">
        <small>${day.toLocaleDateString('en-IN', { weekday: 'short' }).toUpperCase()}</small>
        <b>${day.getDate()}</b>
        <small>${day.toLocaleDateString('en-IN', { month: 'short' }).toUpperCase()}</small>
      </button>`;
    }).join('');
    el.querySelectorAll('.date').forEach(b => b.addEventListener('click', () => {
      mv.date = b.dataset.date;
      el.querySelectorAll('.date').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      document.getElementById('theatreList').innerHTML = '<p class="loading">Finding showtimes…</p>';
      loadShowtimes();
    }));
  }

  function renderShowFilters() {
    const mv = state.movie;
    const el = document.getElementById('showFilters');
    if (!el) return;
    const shows = mv.showData.theatres.flatMap(t => t.shows);
    const langs = [...new Set(shows.map(s => s.language))];
    const formats = [...new Set(shows.map(s => s.format))];
    if (!langs.includes(mv.lang)) mv.lang = 'All';
    if (!formats.includes(mv.format)) mv.format = 'All';
    const group = (label, key, opts) => opts.length > 1 ? `
      <div class="chips" role="group" aria-label="${label}">
        ${['All', ...opts].map(o => `<button type="button" class="fchip small" data-${key}="${esc(o)}" aria-pressed="${mv[key] === o}">${o === 'All' ? `All ${label.toLowerCase()}s` : esc(o)}</button>`).join('')}
      </div>` : '';
    el.innerHTML = group('Language', 'lang', langs) + group('Format', 'format', formats);
    el.querySelectorAll('.fchip').forEach(b => b.addEventListener('click', () => {
      const key = b.dataset.lang !== undefined ? 'lang' : 'format';
      mv[key] = b.dataset[key];
      el.querySelectorAll(`[data-${key}]`).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      renderTheatres();
    }));
  }

  function availability(s) {
    const r = s.seatsLeft / s.totalSeats;
    if (s.seatsLeft === 0) return ['sold', 'Sold out'];
    if (r < 0.15) return ['almost', `Almost full, ${s.seatsLeft} left`];
    if (r < 0.45) return ['filling', `Filling fast, ${s.seatsLeft} left`];
    return ['avail', `${s.seatsLeft} seats available`];
  }

  function renderTheatres() {
    const mv = state.movie;
    const el = document.getElementById('theatreList');
    if (!el) return;
    const theatres = mv.showData.theatres
      .map(t => ({ ...t, shows: t.shows.filter(s => (mv.lang === 'All' || s.language === mv.lang) && (mv.format === 'All' || s.format === mv.format)) }))
      .filter(t => t.shows.length);

    if (!theatres.length) {
      el.innerHTML = `<div class="emptystate"><p>No shows left on this day${mv.lang !== 'All' || mv.format !== 'All' ? ' with these filters' : ''}. Try another date.</p></div>`;
      return;
    }
    el.innerHTML = theatres.map(t => `
      <article class="theatre">
        <div class="theatre-info">
          <h3>${esc(t.name)}: ${esc(t.area)}</h3>
          <p>${esc(t.city)} · M-Ticket · Food &amp; beverages · Cancellation available</p>
        </div>
        <div class="slots">
          ${t.shows.map(s => {
            const [cls, label] = availability(s);
            const text = `<b>${fmtTime(s.startTime)}</b><small>${esc(s.format)} · ${esc(s.language)}</small>`;
            return cls === 'sold'
              ? `<span class="slot sold" aria-label="${fmtTime(s.startTime)}, sold out">${text}</span>`
              : `<a class="slot ${cls}" href="/show/${s.id}" title="${label}. From ${rupees(s.fromPrice)}"
                   aria-label="${fmtTime(s.startTime)}, ${esc(s.format)}, ${esc(s.language)}, ${label}, from ${rupees(s.fromPrice)}">${text}</a>`;
          }).join('')}
        </div>
      </article>`).join('');
  }

  /* ---------- Seat page ---------- */
  async function openShow(id) {
    if (state.show && state.show.id === id) return;
    app.innerHTML = '<p class="loading">Opening the hall…</p>';
    try {
      const data = await API.request('GET', `/shows/${id}`);
      state.show = data.show;
      state.seats = data.seats;
      state.prices = data.prices;
      state.snackMenu = data.snacks;
      state.fees = data.fees;
      state.maxSeats = data.maxSeats;
      state.maxSnackQty = data.maxSnackQty;
      state.pickCount = Math.min(state.pickCount, state.maxSeats);
      state.cart = {};
      state.promo = null;
      state.hadHold = mySeats().length > 0;
      renderSeatPage();
      Realtime.connect(id, seats => { state.seats = seats; updateSeatPage(); }, setViewers);
      clearInterval(state.tick);
      state.tick = setInterval(updateTimer, 1000);
    } catch (e) {
      app.innerHTML = `<p class="loading">${e.status === 404 ? 'That show doesn’t exist.' : 'Couldn’t load this show.'} <a href="/">Back to movies</a></p>`;
    }
  }

  function tierFor(row) {
    if ('ABC'.includes(row)) return 0;
    if ('DEFG'.includes(row)) return 1;
    return 2;
  }

  // "Cinevault Orion, Rajajinagar · Audi 2 · IMAX 3D · Hindi"
  function venueLine(s) {
    return [s.theatre ? `${s.theatre.name}, ${s.theatre.area}` : '', s.screen, s.format, s.language].filter(Boolean).map(esc).join(' · ');
  }

  // 1 Showtime → 2 Seats and snacks → 3 Ticket
  function steps(current) {
    const names = ['Showtime', 'Seats and snacks', 'Ticket'];
    return `<ol class="steps" aria-label="Booking progress">${names.map((n, i) =>
      `<li class="${i < current ? 'done' : i === current ? 'now' : ''}" ${i === current ? 'aria-current="step"' : ''}><span>${i < current ? '✓' : i + 1}</span>${n}</li>`
    ).join('')}</ol>`;
  }

  const SEAT_TYPE_LABEL = { wheelchair: 'Wheelchair space', companion: 'Companion seat' };

  function renderSeatPage() {
    const s = state.show;
    setMeta(`Choose your seats: ${s.title} | Cinevault`, '', { index: false });
    const started = s.startTime < Date.now();
    const rows = 'ABCDEFGHIJ'.split('');

    let map = '';
    rows.forEach((row, i) => {
      const tier = tierFor(row);
      if (i === 0 || tierFor(rows[i - 1]) !== tier) {
        const p = state.prices[tier];
        map += `<div class="tier"><span><b>${esc(p.name)}</b>, ${rupees(p.price)}</span></div>`;
      }
      let cells = `<span class="lbl" aria-hidden="true">${row}</span>`;
      for (let n = 1; n <= 12; n++) {
        cells += `<button class="seat ${tier === 2 ? 'recliner' : ''}" data-id="${row}${n}">${n}</button>`;
        if (n === 6) cells += '<span aria-hidden="true"></span>';
      }
      cells += `<span class="lbl" aria-hidden="true">${row}</span>`;
      map += `<div class="seat-row" role="group" aria-label="Row ${row}">${cells}</div>`;
    });

    app.innerHTML = `
      <div class="pagehead">
        <a href="${s.movieSlug ? '/movie/' + esc(s.movieSlug) : '/'}" class="back">← ${s.movieSlug ? 'Other showtimes' : 'All movies'}</a>
        ${steps(1)}
      </div>
      <div class="booking">
        <section>
          <div class="show-head">
            <h1>${esc(s.title)}</h1>
            <p>${venueLine(s)}</p>
            <p>${[`${fmtDay(s.startTime)}, ${fmtTime(s.startTime)}`, esc(s.certificate), s.duration ? fmtDuration(s.duration) : ''].filter(Boolean).join(' &nbsp;|&nbsp; ')}</p>
            <div class="show-status">
              <span class="live" id="live">Live seat updates</span>
              <span class="viewers" id="viewers" aria-live="polite"></span>
            </div>
          </div>
          <div class="hall">
            <div class="quickpick" ${started ? 'hidden' : ''}>
              <span>Best seats together for</span>
              <div class="stepper" role="group" aria-label="Number of seats to pick">
                <button type="button" data-pick="-1" aria-label="Fewer seats">−</button>
                <output id="pickCount">${state.pickCount}</output>
                <button type="button" data-pick="1" aria-label="More seats">+</button>
              </div>
              <button type="button" class="btn primary" id="autoPick">Pick for me</button>
            </div>
            <div class="screen" aria-hidden="true">
              <svg viewBox="0 0 560 44" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="glow" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stop-color="var(--screen-glow)"/>
                    <stop offset="1" stop-color="transparent"/>
                  </linearGradient>
                </defs>
                <path d="M10 14 Q280 -6 550 14 L520 44 Q280 26 40 44 Z" fill="url(#glow)"/>
                <path d="M10 14 Q280 -6 550 14" fill="none" stroke="var(--velvet)" stroke-width="4" stroke-linecap="round"/>
              </svg>
              <span>${s.format && s.format !== '2D' ? esc(s.format) + ' screen' : 'Screen'} this way</span>
            </div>
            <div class="seatmap-scroll">
              <div class="seatmap" id="seatmap">${map}</div>
            </div>
            <div class="legend">
              <span><i></i>Available</span>
              <span><i class="mine"></i>Your pick</span>
              <span><i class="held"></i>Someone is choosing</span>
              <span><i class="booked"></i>Booked</span>
              <span><i class="wc"></i>Wheelchair space</span>
              <span><i class="cp"></i>Companion seat</span>
            </div>
          </div>
        </section>

        <aside class="summary" aria-label="Your booking">
          <h2>Your seats</h2>
          <p class="when">${esc(s.title)}, ${fmtFull(s.startTime)}${s.theatre ? `<br>${esc(s.theatre.name)}, ${esc(s.theatre.area)}` : ''}</p>
          <div id="timerBox"></div>
          <div class="picked" id="picked"></div>

          <details class="snacks">
            <summary>Add snacks <span id="snackCount"></span></summary>
            <div class="snack-list" id="snackList">
              ${state.snackMenu.map(sn => `
                <div class="snack" data-id="${esc(sn.id)}">
                  <span class="snack-emoji" aria-hidden="true">${sn.emoji}</span>
                  <span class="snack-name">${esc(sn.name)}<small>${rupees(sn.price)}</small></span>
                  <div class="stepper" role="group" aria-label="${esc(sn.name)} quantity">
                    <button type="button" data-step="-1" aria-label="One less ${esc(sn.name)}">−</button>
                    <output data-qty="${esc(sn.id)}">0</output>
                    <button type="button" data-step="1" aria-label="One more ${esc(sn.name)}">+</button>
                  </div>
                </div>`).join('')}
            </div>
          </details>

          <div class="lines" id="lines"></div>

          <form class="promo" id="promoForm">
            <label for="promo" class="sr-only">Promo code</label>
            <input id="promo" placeholder="Promo code" autocomplete="off" autocapitalize="characters" maxlength="20">
            <button type="submit" class="btn">Apply</button>
          </form>
          <p class="promo-msg" id="promoMsg">Try FLAT20, CINE50 or SNACKY.</p>

          <div class="grand"><span>Total</span><b id="total">₹0</b></div>
          <p class="split" id="split" hidden></p>
          <div class="namefield">
            <label for="name">Name on the ticket</label>
            <input id="name" autocomplete="name" maxlength="40" placeholder="e.g. Veena Rao" value="${esc(userName)}">
          </div>
          <button class="cta" id="bookBtn" disabled>Select seats</button>
          <p class="fine">Up to ${state.maxSeats} seats. Seats are held for 5 minutes. Cancel free until 30 minutes before the show.</p>
          <div class="prices">
            ${state.prices.map(p => `<div><span>${esc(p.name)}, rows ${esc(p.rows)}</span><span>${rupees(p.price)}</span></div>`).join('')}
          </div>
        </aside>
      </div>`;

    if (started) {
      document.getElementById('bookBtn').textContent = 'This show has started';
    }
    const seatmap = document.getElementById('seatmap');
    seatmap.addEventListener('click', onSeatClick);
    seatmap.addEventListener('pointerover', e => { const b = e.target.closest('.seat'); if (b) showSeatTip(b); });
    seatmap.addEventListener('focusin', e => { const b = e.target.closest('.seat'); if (b) showSeatTip(b); });
    seatmap.addEventListener('pointerleave', () => { seatTip.hidden = true; });
    seatmap.addEventListener('focusout', () => { seatTip.hidden = true; });
    document.querySelector('.seatmap-scroll').addEventListener('scroll', () => { seatTip.hidden = true; }, { passive: true });
    document.getElementById('bookBtn').addEventListener('click', book);
    document.getElementById('name').addEventListener('input', e => {
      userName = e.target.value;
      store.set('cv-name', userName.trim());
      updateSummary();
    });
    document.getElementById('snackList').addEventListener('click', onSnackClick);
    document.getElementById('promoForm').addEventListener('submit', applyPromo);
    app.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () => {
      state.pickCount = Math.min(state.maxSeats, Math.max(1, state.pickCount + Number(b.dataset.pick)));
      document.getElementById('pickCount').textContent = state.pickCount;
    }));
    document.getElementById('autoPick').addEventListener('click', autoPick);
    setLive(state.online);
    updateSeatPage();
  }

  function updateSeatPage() {
    if (!state.show) return;
    const byId = new Map(state.seats.map(s => [s.id, s]));
    document.querySelectorAll('#seatmap .seat').forEach(btn => {
      const seat = byId.get(btn.dataset.id);
      if (!seat) return;
      const mine = seat.status === 'held' && seat.heldBy === userId;
      const kind = mine ? 'mine' : seat.status;     // free | mine | held | booked
      const recliner = seat.row >= 'H' ? ' recliner' : '';
      const type = seat.type === 'wheelchair' ? ' wc' : seat.type === 'companion' ? ' cp' : '';
      const busy = state.busy.has(seat.id) ? ' busy' : '';
      const flash = btn.classList.contains('flash') ? ' flash' : '';
      btn.className = 'seat ' + kind + recliner + type + busy + flash;
      btn.disabled = kind === 'held' || kind === 'booked';
      btn.setAttribute('aria-pressed', mine ? 'true' : 'false');
      const label = { free: 'available', mine: 'selected by you', held: 'being chosen by someone else', booked: 'booked' }[kind];
      btn.setAttribute('aria-label', `Seat ${seat.id}${seat.type ? ', ' + SEAT_TYPE_LABEL[seat.type].toLowerCase() : ''}, ${rupees(seat.price)}, ${label}`);
    });
    if (!seatTip.hidden && seatTip.dataset.id) {
      const btn = document.querySelector(`.seat[data-id="${seatTip.dataset.id}"]`);
      if (btn) showSeatTip(btn);
    }
    updateSummary();
    updateTimer();
  }

  // Small card above a seat: "F7 · Prime · ₹200 · Available"
  function showSeatTip(btn) {
    const seat = state.seats.find(s => s.id === btn.dataset.id);
    if (!seat) return;
    const mine = seat.status === 'held' && seat.heldBy === userId;
    const status = mine ? 'Your pick, tap to remove' : { free: 'Available', held: 'Someone is choosing', booked: 'Booked' }[seat.status];
    seatTip.dataset.id = seat.id;
    seatTip.innerHTML = `<b>${esc(seat.id)}</b> · ${esc(state.prices[tierFor(seat.row)].name)} · ${rupees(seat.price)}
      ${seat.type ? `<span class="tip-type">${SEAT_TYPE_LABEL[seat.type]}</span>` : ''}
      <small class="tip-${mine ? 'mine' : seat.status}">${status}</small>`;
    seatTip.hidden = false;
    const r = btn.getBoundingClientRect();
    const w = seatTip.offsetWidth, h = seatTip.offsetHeight;
    const left = Math.min(window.innerWidth - w - 8, Math.max(8, r.left + r.width / 2 - w / 2));
    const top = r.top - h - 10 < 8 ? r.bottom + 10 : r.top - h - 10;
    seatTip.style.left = left + 'px';
    seatTip.style.top = top + 'px';
  }

  // Same rules as discountFor() in server.js. The server re-checks when you book.
  function discountFor(p, seatTotal, snackTotal) {
    const subtotal = seatTotal + snackTotal;
    if (subtotal < p.minTotal) return { discount: 0, error: `Add ${rupees(p.minTotal - subtotal)} more to use ${p.code}` };
    const base = p.on === 'seats' ? seatTotal : p.on === 'snacks' ? snackTotal : subtotal;
    if (!base) return { discount: 0, error: `${p.code} only works when your order has ${p.on}` };
    const d = p.type === 'percent' ? Math.floor(base * p.value / 100) : p.value;
    return { discount: Math.min(d, p.max || Infinity, base) };
  }

  // Same rules as chargesFor() in server.js
  function chargesFor(seatCount) {
    const fee = seatCount * state.fees.perSeat;
    return { fee, tax: Math.round(fee * state.fees.gstRate / 100) };
  }

  function cartTotals() {
    const mine = mySeats();
    const seatTotal = mine.reduce((sum, s) => sum + s.price, 0);
    const snackTotal = state.snackMenu.reduce((sum, sn) => sum + (state.cart[sn.id] || 0) * sn.price, 0);
    const promo = state.promo ? discountFor(state.promo, seatTotal, snackTotal) : { discount: 0 };
    const { fee, tax } = chargesFor(mine.length);
    return {
      mine, seatTotal, snackTotal, discount: promo.discount, promoError: promo.error, fee, tax,
      total: seatTotal + snackTotal - promo.discount + fee + tax
    };
  }

  function updateSummary() {
    if (!state.show) return;
    const picked = document.getElementById('picked');
    if (!picked) return;
    const { mine, snackTotal, discount, promoError, fee, tax, total } = cartTotals();

    picked.innerHTML = mine.length
      ? mine.map(s => `<button class="chip" data-id="${s.id}" aria-label="Remove seat ${s.id}">${s.id}<span aria-hidden="true">×</span></button>`).join('')
      : '<p class="empty">Tap a seat on the map, or let us pick the best ones.</p>';
    picked.querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => release(c.dataset.id)));

    // Group by price tier
    const groups = {};
    mine.forEach(s => {
      const t = state.prices[tierFor(s.row)];
      groups[t.name] = groups[t.name] || { count: 0, price: t.price };
      groups[t.name].count++;
    });
    let lines = Object.entries(groups).map(([name, g]) =>
      `<div class="line"><span>${g.count} × ${esc(name)} (${rupees(g.price)})</span><b>${rupees(g.count * g.price)}</b></div>`
    ).join('') || '<div class="line"><span>No seats yet</span><b>₹0</b></div>';
    if (snackTotal) {
      const count = Object.values(state.cart).reduce((a, b) => a + b, 0);
      lines += `<div class="line"><span>Snacks (${count} item${count > 1 ? 's' : ''})</span><b>${rupees(snackTotal)}</b></div>`;
    }
    if (discount) lines += `<div class="line discount"><span>Promo ${esc(state.promo.code)}</span><b>−${rupees(discount)}</b></div>`;
    if (fee) {
      lines += `<div class="line"><span>Convenience fee (${rupees(state.fees.perSeat)} × ${mine.length})</span><b>${rupees(fee)}</b></div>`;
      lines += `<div class="line"><span>GST on fee (${state.fees.gstRate}%)</span><b>${rupees(tax)}</b></div>`;
    }
    document.getElementById('lines').innerHTML = lines;

    // Snack quantities
    let snackCount = 0;
    state.snackMenu.forEach(sn => {
      const qty = state.cart[sn.id] || 0;
      snackCount += qty;
      const out = app.querySelector(`output[data-qty="${sn.id}"]`);
      if (out) out.textContent = qty;
    });
    document.getElementById('snackCount').textContent = snackCount ? `(${snackCount})` : '';

    // Promo message
    const msg = document.getElementById('promoMsg');
    if (state.promo) {
      msg.className = 'promo-msg ' + (promoError ? 'warn' : 'ok');
      msg.innerHTML = `<span>${esc(promoError || state.promo.code + ': ' + state.promo.description)}</span> <button type="button" class="linkbtn" id="removePromo">Remove</button>`;
      document.getElementById('removePromo').addEventListener('click', () => {
        state.promo = null;
        msg.className = 'promo-msg';
        msg.textContent = 'Try FLAT20, CINE50 or SNACKY.';
        updateSummary();
      });
    }

    document.getElementById('total').textContent = rupees(total);
    const split = document.getElementById('split');
    split.hidden = mine.length < 2;
    if (mine.length > 1) split.textContent = `≈ ${rupees(Math.ceil(total / mine.length))} each, split ${mine.length} ways`;

    const btn = document.getElementById('bookBtn');
    const started = state.show.startTime < Date.now();
    if (started) { btn.disabled = true; return; }
    if (!mine.length) { btn.disabled = true; btn.textContent = 'Select seats'; }
    else if (userName.trim().length < 2) { btn.disabled = true; btn.textContent = 'Add your name to book'; }
    else { btn.disabled = false; btn.textContent = `Book ${mine.length} seat${mine.length > 1 ? 's' : ''} for ${rupees(total)}`; }
  }

  function onSnackClick(e) {
    const btn = e.target.closest('[data-step]');
    if (!btn) return;
    const id = btn.closest('.snack').dataset.id;
    const qty = Math.min(state.maxSnackQty, Math.max(0, (state.cart[id] || 0) + Number(btn.dataset.step)));
    if (qty) state.cart[id] = qty; else delete state.cart[id];
    updateSummary();
  }

  async function applyPromo(e) {
    e.preventDefault();
    const input = document.getElementById('promo');
    const code = input.value.trim();
    if (!code) return;
    try {
      const { promo } = await API.request('GET', `/promos/${encodeURIComponent(code)}`);
      state.promo = promo;
      input.value = '';
      updateSummary();
      if (!cartTotals().promoError) toast(`${promo.code} applied.`);
    } catch (err) {
      const msg = document.getElementById('promoMsg');
      msg.className = 'promo-msg warn';
      msg.textContent = err.status === 404 ? `“${code}” isn’t a valid code.` : err.message;
    }
  }

  function updateTimer() {
    const box = document.getElementById('timerBox');
    if (!box || !state.show) return;
    const mine = mySeats();
    if (!mine.length) {
      box.innerHTML = '';
      state.hadHold = false;
      return;
    }
    state.hadHold = true;
    const until = Math.min(...mine.map(s => s.heldUntil));
    const left = Math.max(0, until - Date.now());
    const m = Math.floor(left / 60000);
    const sec = Math.floor((left % 60000) / 1000);
    box.innerHTML = `<div class="timer ${left < 60000 ? 'urgent' : ''}"><span>Held for you</span><b>${m}:${String(sec).padStart(2, '0')}</b></div>`;

    if (left === 0) {
      // Hold ran out: free them locally; the server's sweeper confirms within seconds
      state.seats = state.seats.map(s => (s.heldBy === userId ? { ...s, status: 'free', heldBy: null, heldUntil: null } : s));
      toast('Your 5 minutes ran out, so the seats were released.', 'error');
      updateSeatPage();
    }
  }

  function setLive(on) {
    state.online = on;
    const el = document.getElementById('live');
    if (!el) return;
    el.classList.toggle('off', !on);
    el.textContent = on ? 'Live seat updates' : 'Reconnecting…';
  }
  window.addEventListener('realtime-offline', () => setLive(false));
  window.addEventListener('realtime-online', () => setLive(true));

  function setViewers(count) {
    const el = document.getElementById('viewers');
    if (!el) return;
    const others = count - 1;
    el.textContent = others > 0 ? `You and ${others} other${others > 1 ? 's are' : ' is'} viewing this show` : '';
  }

  function onSeatClick(e) {
    const btn = e.target.closest('.seat');
    if (!btn || btn.disabled || !state.show) return;
    const id = btn.dataset.id;
    if (state.busy.has(id)) return;
    const seat = state.seats.find(s => s.id === id);
    if (!seat) return;

    if (seat.status === 'held' && seat.heldBy === userId) return release(id);
    if (seat.status !== 'free') return;
    if (state.show.startTime < Date.now()) return toast('This show has already started.', 'error');
    if (mySeats().length >= state.maxSeats) return toast(`You can pick up to ${state.maxSeats} seats.`, 'error');
    hold(id);
  }

  async function hold(id) {
    const showId = state.show.id;
    state.busy.add(id);
    updateSeatPage();
    try {
      const res = await API.request('POST', `/shows/${showId}/hold`, { userId, seats: [id] });
      if (!state.show || state.show.id !== showId) return;
      // Show it straight away; the live update will confirm
      state.seats = state.seats.map(s => (s.id === id ? { ...s, status: 'held', heldBy: userId, heldUntil: res.heldUntil } : s));
    } catch (err) {
      if (err.status === 409) {
        toast(`Too slow! Someone just grabbed ${id}.`, 'error');
        const btn = document.querySelector(`.seat[data-id="${id}"]`);
        if (btn) { btn.classList.add('flash'); setTimeout(() => btn.classList.remove('flash'), 900); }
      } else {
        toast(err.message, 'error');
      }
      await refreshSeats(showId);
    } finally {
      state.busy.delete(id);
      updateSeatPage();
    }
  }

  async function release(id) {
    const showId = state.show.id;
    state.busy.add(id);
    updateSeatPage();
    try {
      await API.request('DELETE', `/shows/${showId}/hold`, { userId, seats: [id] });
      if (state.show && state.show.id === showId) {
        state.seats = state.seats.map(s => (s.id === id ? { ...s, status: 'free', heldBy: null, heldUntil: null } : s));
      }
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      state.busy.delete(id);
      updateSeatPage();
    }
  }

  // Best block of n seats side by side: near the middle of the hall, a little
  // towards the back (row G), and not split by the aisle if it can be helped.
  // Seats you already hold count as available, so you can re-pick.
  function bestBlock(n) {
    const open = new Set(state.seats
      .filter(s => s.status === 'free' || (s.status === 'held' && s.heldBy === userId))
      .map(s => s.id));
    const rows = 'ABCDEFGHIJ';
    let best = null;
    for (let r = 0; r < rows.length; r++) {
      for (let start = 1; start + n - 1 <= 12; start++) {
        const ids = [];
        for (let k = 0; k < n; k++) ids.push(rows[r] + (start + k));
        if (!ids.every(id => open.has(id))) continue;
        const center = start + (n - 1) / 2;
        const splitByAisle = start <= 6 && start + n - 1 >= 7;
        const score = Math.abs(r - 6) * 1.2 + Math.abs(center - 6.5) * 0.8 + (splitByAisle ? 1 : 0);
        if (!best || score < best.score) best = { ids, score };
      }
    }
    return best && best.ids;
  }

  async function autoPick() {
    if (!state.show || state.show.startTime < Date.now()) return;
    const n = state.pickCount;
    const block = bestBlock(n);
    if (!block) return toast(`No ${n} seats together are free. Try fewer.`, 'error');

    const showId = state.show.id;
    const mineIds = mySeats().map(s => s.id);
    const toRelease = mineIds.filter(id => !block.includes(id));
    const toHold = block.filter(id => !mineIds.includes(id));
    if (!toRelease.length && !toHold.length) return toast('You already have the best seats.');

    block.concat(toRelease).forEach(id => state.busy.add(id));
    updateSeatPage();
    try {
      if (toRelease.length) await API.request('DELETE', `/shows/${showId}/hold`, { userId, seats: toRelease });
      // One request for the whole block: either all of them are held, or none
      if (toHold.length) await API.request('POST', `/shows/${showId}/hold`, { userId, seats: toHold });
      toast(`Picked ${block.join(', ')} for you.`);
    } catch (err) {
      toast(err.status === 409 ? 'Someone grabbed one of those seats. Tap “Pick for me” again.' : err.message, 'error');
    } finally {
      await refreshSeats(showId);
      block.concat(toRelease).forEach(id => state.busy.delete(id));
      updateSeatPage();
    }
  }

  async function refreshSeats(showId) {
    try {
      const data = await API.request('GET', `/shows/${showId}`);
      if (state.show && state.show.id === showId) state.seats = data.seats;
    } catch (e) {}
  }

  async function book() {
    const { mine, discount } = cartTotals();
    const name = userName.trim();
    if (!mine.length || name.length < 2) return;
    const btn = document.getElementById('bookBtn');
    btn.disabled = true;
    btn.textContent = 'Booking…';
    const showId = state.show.id;
    try {
      const { booking } = await API.request('POST', `/shows/${showId}/book`, {
        userId, name, seats: mine.map(s => s.id), snacks: state.cart,
        // Only send a promo that actually gives a discount right now
        promo: state.promo && discount > 0 ? state.promo.code : undefined
      });
      state.lastBooking = booking;
      state.justBooked = true;
      // Seats are now booked, nothing left to release
      state.seats = state.seats.map(s => (s.heldBy === userId ? { ...s, status: 'booked', heldBy: null } : s));
      navigate('/ticket');
    } catch (err) {
      toast(err.message, 'error');
      await refreshSeats(showId);
      updateSeatPage();
    }
  }

  /* ---------- Tickets ---------- */
  // A real QR code with the booking code when the QR library loaded; a decorative barcode otherwise
  function ticketCode(code) {
    if (window.qrcode) {
      try {
        const qr = window.qrcode(0, 'M');
        qr.addData('CINEVAULT:' + code);
        qr.make();
        return `<div class="qr" role="img" aria-label="QR code for booking ${esc(code)}">${qr.createSvgTag(3, 0)}</div>`;
      } catch (e) {}
    }
    let x = 0, bars = '';
    for (let i = 0; i < 34; i++) {
      const c = code.charCodeAt(i % code.length) * (i + 7);
      const w = 1 + (c % 3);
      if (i % 2 === 0) bars += `<rect x="${x}" y="0" width="${w}" height="42" fill="currentColor"/>`;
      x += w + 1;
    }
    return `<svg class="barcode" viewBox="0 0 ${x} 42" preserveAspectRatio="none" aria-hidden="true">${bars}</svg>`;
  }

  function ticketHTML(b) {
    state.tickets.set(b.code, b);
    const [a] = b.show.colors;
    const cancelled = b.status === 'cancelled';
    const past = b.show.startTime < Date.now();
    const snacks = (b.snacks || []).map(s => `${s.qty} × ${esc(s.name)}`).join(', ');
    const t = b.show.theatre;
    const [, c2] = b.show.colors;
    return `
      <article class="ticket ${cancelled ? 'cancelled' : ''}" data-code="${esc(b.code)}" aria-label="Ticket ${esc(b.code)}${cancelled ? ', cancelled' : ''}">
        <div class="top" style="--ta:${a};--tb:${c2}">
          ${cancelled ? '<span class="stamp">Cancelled</span>' : ''}
          ${!cancelled && !past ? `<span class="countdown" data-start="${b.show.startTime}">Starts in ${fmtLeft(b.show.startTime - Date.now())}</span>` : ''}
          <h2>${esc(b.show.title)}</h2>
          <p>${[esc(b.show.language), esc(b.show.format || '2D'), esc(b.show.certificate), b.show.duration ? fmtDuration(b.show.duration) : ''].filter(Boolean).join(', ')}</p>
        </div>
        <div class="body">
          ${t ? `<div class="wide"><small>Cinema</small><b>${esc(t.name)}, ${esc(t.area)}</b><small>${esc(t.city)}${b.show.screen ? ' · ' + esc(b.show.screen) : ''}</small></div>` : ''}
          <div><small>Date and time</small><b>${fmtFull(b.show.startTime)}</b></div>
          <div><small>Seats</small><b>${b.seats.map(esc).join(', ')}</b></div>
          <div><small>Name</small><b>${esc(b.name)}</b></div>
          <div><small>${cancelled ? 'Refunded' : 'Total paid'}</small><b>${rupees(b.total)}</b>${b.discount ? `<small class="saved">Saved ${rupees(b.discount)} with ${esc(b.promo)}</small>` : ''}${b.fee ? `<small>Incl. ${rupees(b.fee + b.tax)} fee and GST</small>` : ''}</div>
          ${snacks ? `<div class="wide"><small>Snacks</small><b class="snackline">${snacks}</b></div>` : ''}
        </div>
        <div class="stub">
          <div><small style="color:var(--muted);font-size:.8rem">Booking ID</small><div class="code">${esc(b.code)}</div>
            ${b.points ? `<span class="points">+${b.points} Cinevault points</span>` : ''}</div>
          ${ticketCode(b.code)}
        </div>
        ${cancelled ? '' : `
        <div class="tactions">
          <button type="button" class="linkbtn" data-act="print" data-code="${esc(b.code)}">Print</button>
          ${past ? '' : `<button type="button" class="linkbtn" data-act="share" data-code="${esc(b.code)}">Share</button>`}
          ${past ? '' : `<button type="button" class="linkbtn" data-act="ics" data-code="${esc(b.code)}">Add to calendar</button>`}
          ${b.canCancel ? `<button type="button" class="linkbtn danger" data-act="cancel" data-code="${esc(b.code)}">Cancel booking</button>` : ''}
        </div>`}
      </article>`;
  }

  // Ticket buttons work on both the ticket page and My tickets
  app.addEventListener('click', e => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const b = state.tickets.get(btn.dataset.code);
    if (!b) return;
    if (btn.dataset.act === 'print') printTicket(b.code);
    if (btn.dataset.act === 'share') {
      const t = b.show.theatre;
      share(`${b.show.title} tickets`, `🎬 ${b.show.title}\n${fmtFull(b.show.startTime)}${t ? `\n${t.name}, ${t.area}` : ''}\nSeats ${b.seats.join(', ')} · Booking ID ${b.code}`);
    }
    if (btn.dataset.act === 'ics') downloadIcs(b);
    if (btn.dataset.act === 'cancel') cancelBooking(b, btn);
  });

  function printTicket(code) {
    const el = app.querySelector(`.ticket[data-code="${code}"]`);
    if (!el) return;
    document.body.classList.add('print-one');
    el.classList.add('printing');
    window.print();
  }
  window.addEventListener('afterprint', () => {
    document.body.classList.remove('print-one');
    app.querySelectorAll('.ticket.printing').forEach(t => t.classList.remove('printing'));
  });

  function downloadIcs(b) {
    const stamp = ms => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const text = s => String(s).replace(/[\\;,]/g, m => '\\' + m).replace(/\n/g, '\\n');
    const t = b.show.theatre;
    const ics = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Cinevault//Tickets//EN', 'BEGIN:VEVENT',
      `UID:${b.code}@cinevault`,
      `DTSTAMP:${stamp(Date.now())}`,
      `DTSTART:${stamp(b.show.startTime)}`,
      // Runtime may not be known; assume 2.5 hours for the calendar entry
      `DTEND:${stamp(b.show.startTime + (b.show.duration || 150) * 60000)}`,
      `SUMMARY:${text(b.show.title + ' at Cinevault')}`,
      t ? `LOCATION:${text(`${t.name}, ${t.area}, ${t.city}`)}` : '',
      `DESCRIPTION:${text(`Seats ${b.seats.join(', ')}. Booking ID ${b.code}.`)}`,
      'END:VEVENT', 'END:VCALENDAR'
    ].filter(Boolean).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
    a.download = `cinevault-${b.code}.ics`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function cancelBooking(b, btn) {
    const ok = window.confirm(`Cancel booking ${b.code}?\n\nSeats ${b.seats.join(', ')} will be released and ${rupees(b.total)} refunded. This can’t be undone.`);
    if (!ok) return;
    btn.disabled = true;
    btn.textContent = 'Cancelling…';
    try {
      const { booking } = await API.request('POST', `/bookings/${b.code}/cancel`, { userId });
      toast(`Booking ${booking.code} cancelled. ${rupees(booking.total)} will be refunded.`);
      if (state.lastBooking && state.lastBooking.code === booking.code) state.lastBooking = booking;
      if (location.pathname === '/ticket') renderTicketPage(booking);
      else openBookings();
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Cancel booking';
    }
  }

  // Keep "Starts in 3h 20m" on tickets current
  setInterval(() => {
    app.querySelectorAll('.countdown[data-start]').forEach(el => {
      const left = Number(el.dataset.start) - Date.now();
      el.textContent = left > 0 ? `Starts in ${fmtLeft(left)}` : 'Showing now';
    });
  }, 30000);

  // A short burst of paper confetti when a booking goes through
  function confetti() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const box = document.createElement('div');
    box.className = 'confetti';
    box.setAttribute('aria-hidden', 'true');
    const colors = ['var(--gold)', 'var(--velvet)', '#f9a8d4', '#fde68a', '#a5b4fc'];
    for (let i = 0; i < 90; i++) {
      const p = document.createElement('i');
      p.style.left = Math.random() * 100 + '%';
      p.style.background = colors[i % colors.length];
      p.style.setProperty('--x', (Math.random() * 2 - 1) * 120 + 'px');
      p.style.setProperty('--r', Math.random() * 900 - 450 + 'deg');
      p.style.animationDelay = Math.random() * 0.4 + 's';
      p.style.animationDuration = 1.8 + Math.random() * 1.4 + 's';
      box.appendChild(p);
    }
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 3800);
  }

  function renderTicketPage(b) {
    setMeta(`Your ticket: ${b.show.title} | Cinevault`, '', { index: false });
    const cancelled = b.status === 'cancelled';
    if (state.justBooked && !cancelled) confetti();
    state.justBooked = false;
    app.innerHTML = `
      <div class="ticket-wrap">
        ${cancelled ? '' : steps(2)}
        <h1>${cancelled ? 'Booking cancelled.' : 'You’re in.'}</h1>
        <p>${cancelled ? 'Your seats have been released and the amount will be refunded.' : 'Show this QR code or booking ID at the cinema. Your seats are locked and no one else can book them.'}</p>
        ${ticketHTML(b)}
        <div class="ticket-actions">
          <a class="btn primary" href="/bookings">See all my tickets</a>
          <a class="btn" href="/">Book another movie</a>
        </div>
      </div>`;
  }

  async function openBookings() {
    setMeta('My tickets | Cinevault', '', { index: false });
    app.innerHTML = '<p class="loading">Finding your tickets…</p>';
    try {
      const { bookings, rewards } = await API.request('GET', `/users/${userId}/bookings`);
      const now = Date.now();
      const upcoming = bookings.filter(b => b.status === 'confirmed' && b.show.startTime >= now)
        .sort((a, b) => a.show.startTime - b.show.startTime);
      const other = bookings.filter(b => !upcoming.includes(b));
      const spent = bookings.filter(b => b.status === 'confirmed').reduce((s, b) => s + b.total, 0);
      const seen = new Set(bookings.filter(b => b.status === 'confirmed' && b.show.startTime < now).map(b => b.show.title)).size;
      app.innerHTML = `
        <h1 class="marquee">My tickets</h1>
        ${bookings.length
          ? `${rewardsCard(rewards, { spent, seen, upcoming: upcoming.length })}
             <p class="lede">${upcoming.length} upcoming booking${upcoming.length === 1 ? '' : 's'} from this browser.</p>
             ${upcoming.length ? `<div class="tickets">${upcoming.map(ticketHTML).join('')}</div>` : ''}
             ${other.length ? `<h2 class="section-title">Past and cancelled</h2><div class="tickets faded">${other.map(ticketHTML).join('')}</div>` : ''}`
          : `<div class="emptystate"><p>No tickets yet. Your bookings from this browser will show up here.</p>
             <a class="btn primary" href="/">Find a movie</a></div>`}`;
    } catch (e) {
      app.innerHTML = '<p class="loading">Couldn’t load your tickets.</p>';
    }
  }

  // Cinevault Rewards: tier, points and how far to the next tier
  function rewardsCard(r, stats) {
    const pct = r.next ? Math.min(100, ((r.points - r.tierMin) / (r.next.min - r.tierMin)) * 100) : 100;
    return `
      <section class="rewards tier-${r.tier.toLowerCase()}" aria-label="Cinevault Rewards">
        <div class="rewards-main">
          <p class="eyebrow">Cinevault Rewards</p>
          <h2><span class="tier-badge">${esc(r.tier)}</span> ${r.points.toLocaleString('en-IN')} <small>points</small></h2>
          <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}"
            aria-label="${r.next ? `Progress to ${r.next.name}` : 'Top tier'}"><i style="width:${pct}%"></i></div>
          <p class="rewards-next">${r.next ? `${(r.next.min - r.points).toLocaleString('en-IN')} points to <b>${esc(r.next.name)}</b>. You earn 1 point for every ₹10 spent on seats.` : 'You’re at the top tier. Enjoy the show!'}</p>
        </div>
        <dl class="rewards-stats">
          <div><dt>Upcoming</dt><dd>${stats.upcoming}</dd></div>
          <div><dt>Movies seen</dt><dd>${stats.seen}</dd></div>
          <div><dt>Spent</dt><dd>${rupees(stats.spent)}</dd></div>
        </dl>
      </section>`;
  }

  /* ---------- Start ---------- */
  (async function start() {
    app.innerHTML = '<p class="loading">Loading…</p>';
    try {
      state.meta = await API.request('GET', '/meta');
    } catch (e) {
      app.innerHTML = '<p class="loading">Couldn’t reach the server. Is it running?</p>';
      return;
    }
    if (!state.meta.cities.some(c => c.id === state.city)) state.city = state.meta.cities[0].id;
    citySel.innerHTML = state.meta.cities.map(c => `<option value="${c.id}" ${c.id === state.city ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
    route();
  })();
})();

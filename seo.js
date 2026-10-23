// SEO: every page URL gets its own title, description, canonical link, social
// cards and structured data (JSON-LD), plus plain HTML content for crawlers that
// don't run JavaScript. The app replaces that content as soon as it starts.

const fs = require('fs');
const path = require('path');
const catalog = require('./catalog');

const SITE_NAME = 'Cinevault';
const TEMPLATE_FILE = path.join(__dirname, 'public', 'index.html');
const CATALOG_MTIME = fs.statSync(path.join(__dirname, 'catalog.js')).mtime;

let template = null;
function getTemplate() {
  // Read once in production; re-read in development so edits show up without a restart
  if (!template || process.env.NODE_ENV !== 'production') template = fs.readFileSync(TEMPLATE_FILE, 'utf8');
  return template;
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// JSON inside <script> must not be able to close the tag
const jsonLd = data => `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;

function clip(text, max = 158) {
  const t = String(text).replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return t.slice(0, t.lastIndexOf(' ', max - 1)).replace(/[,.;:]$/, '') + '…';
}

// SITE_URL (e.g. https://cinevault.in) wins; otherwise the address the request came in on
function siteUrl(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/+$/, '');
  return `${req.protocol}://${req.get('host')}`;
}

function fmtDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
}

const cityList = () => catalog.CITIES.map(c => c.name);
const listText = items => items.length > 1 ? items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1] : items.join('');

/* ---------- Pages ---------- */
function homePage(ctx) {
  const { url, isComingSoon } = ctx;
  const now = catalog.MOVIES.filter(m => !isComingSoon(m));
  const soon = catalog.MOVIES.filter(isComingSoon);
  const link = m => `<li><a href="/movie/${esc(m.slug)}">${esc(m.title)}</a> <small>(${esc(m.languages.join(', '))})</small></li>`;
  return {
    title: `${SITE_NAME}: Book movie tickets online in ${cityList().slice(0, 4).join(", ")} & more`,
    description: clip(`Book movie tickets online for ${now.length} films in ${catalog.LANGUAGES.length} languages across ${catalog.CITIES.length} cities. Pick your seats live, see 7 days of showtimes and add snacks.`),
    path: '/',
    type: 'website',
    structured: [
      {
        '@context': 'https://schema.org', '@type': 'WebSite', name: SITE_NAME, url: url + '/',
        inLanguage: 'en-IN'
      },
      {
        '@context': 'https://schema.org', '@type': 'Organization', name: SITE_NAME, url: url + '/',
        logo: url + '/icon-512.png'
      },
      {
        '@context': 'https://schema.org', '@type': 'ItemList', name: 'Movies now showing',
        itemListElement: now.map((m, i) => ({ '@type': 'ListItem', position: i + 1, url: `${url}/movie/${m.slug}`, name: m.title }))
      }
    ],
    body: `
      <h1>Book movie tickets online</h1>
      <p>Choose from ${now.length} movies in ${esc(listText(catalog.LANGUAGES))}, playing in ${esc(listText(cityList()))}. Pick your seats on a live seat map, see showtimes for the next 7 days and add snacks before you go.</p>
      <h2>Now showing</h2><ul>${now.map(link).join('')}</ul>
      ${soon.length ? `<h2>Coming soon</h2><ul>${soon.map(link).join('')}</ul>` : ''}`
  };
}

function moviePage(ctx, m) {
  const { url, isComingSoon, rating } = ctx;
  const soon = isComingSoon(m);
  const year = m.releaseDate.slice(0, 4);
  const langs = listText(m.languages);
  const r = rating(m.slug);
  const pageUrl = `${url}/movie/${m.slug}`;

  const title = soon
    ? `${m.title} (${year}): Release date, cast & advance booking | ${SITE_NAME}`
    : `${m.title} (${year}): Book tickets, showtimes & reviews | ${SITE_NAME}`;
  const lead = soon
    ? `${m.title} releases on ${fmtDate(m.releaseDate)} in ${langs}.`
    : `Book tickets for ${m.title} (${langs}) in ${cityList().slice(0, 4).join(", ")} and more.`;
  const description = clip(`${lead} ${m.synopsis || (m.cast && m.cast.length ? 'Starring ' + listText(m.cast.slice(0, 3)) + '.' : '')}`);

  const movie = {
    '@context': 'https://schema.org', '@type': 'Movie',
    name: m.title, url: pageUrl, datePublished: m.releaseDate,
    inLanguage: m.languages[0],
    ...(m.synopsis && { description: m.synopsis }),
    ...(m.genres && m.genres.length && { genre: m.genres }),
    ...(m.duration && { duration: `PT${Math.floor(m.duration / 60)}H${m.duration % 60}M` }),
    ...(m.certificate && { contentRating: m.certificate }),
    ...(m.director && { director: { '@type': 'Person', name: m.director } }),
    ...(m.cast && m.cast.length && { actor: m.cast.map(name => ({ '@type': 'Person', name })) }),
    // Only real ratings from this site's users; left out until someone has rated it
    ...(r.count && {
      aggregateRating: { '@type': 'AggregateRating', ratingValue: r.avg, ratingCount: r.count, bestRating: 5, worstRating: 1 }
    })
  };
  const crumbs = {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Movies', item: url + '/' },
      { '@type': 'ListItem', position: 2, name: m.title, item: pageUrl }
    ]
  };

  return {
    title, description, path: `/movie/${m.slug}`, type: 'video.movie',
    extraMeta: `<meta property="video:release_date" content="${esc(m.releaseDate)}">`,
    structured: [movie, crumbs],
    body: `
      <nav><a href="/">Movies</a> › ${esc(m.title)}</nav>
      <h1>${esc(m.title)}</h1>
      <p>${soon ? 'Releasing' : 'Released'} ${esc(fmtDate(m.releaseDate))} · ${esc(langs)}${m.genres && m.genres.length ? ' · ' + esc(m.genres.join(', ')) : ''}</p>
      ${m.synopsis ? `<h2>About the movie</h2><p>${esc(m.synopsis)}</p>` : ''}
      ${(m.cast && m.cast.length) || m.director ? `<h2>Cast and crew</h2><ul>
        ${(m.cast || []).map(c => `<li>${esc(c)} (cast)</li>`).join('')}
        ${m.director ? `<li>${esc(m.director)} (director)</li>` : ''}</ul>` : ''}
      ${r.count ? `<p>Rated ${r.avg} out of 5 by ${r.count} ${r.count === 1 ? 'person' : 'people'}.</p>` : ''}
      <p><a href="/movie/${esc(m.slug)}">${soon ? 'Advance booking and release updates' : 'See showtimes and book tickets'}</a></p>`
  };
}

// Pages that are personal or short-lived: usable, but kept out of search results
const PRIVATE = {
  '/bookings': 'My tickets',
  '/ticket': 'Your ticket'
};

function pageFor(req, ctx) {
  const p = req.path.replace(/\/+$/, '') || '/';
  if (p === '/') return homePage(ctx);
  const movie = p.match(/^\/movie\/([a-z0-9-]+)$/);
  if (movie) {
    const m = catalog.MOVIE_BY_SLUG.get(movie[1]);
    if (m) return moviePage(ctx, m);
  }
  if (PRIVATE[p]) return { title: `${PRIVATE[p]} | ${SITE_NAME}`, description: '', path: p, noindex: true };
  if (/^\/show\/\d+$/.test(p)) return { title: `Choose your seats | ${SITE_NAME}`, description: '', path: p, noindex: true };
  return {
    status: 404, title: `Page not found | ${SITE_NAME}`, description: '', path: p, noindex: true,
    body: '<h1>Page not found</h1><p><a href="/">Browse movies</a></p>'
  };
}

function renderPage(req, ctx) {
  const url = siteUrl(req);
  const page = pageFor(req, { ...ctx, url });
  const canonical = url + page.path;
  const image = url + '/og-image.png';
  const head = [
    `<title>${esc(page.title)}</title>`,
    page.description ? `<meta name="description" content="${esc(page.description)}">` : '',
    `<meta name="robots" content="${page.noindex ? 'noindex, nofollow' : 'index, follow, max-image-preview:large'}">`,
    page.noindex ? '' : `<link rel="canonical" href="${esc(canonical)}">`,
    `<meta property="og:site_name" content="${SITE_NAME}">`,
    `<meta property="og:type" content="${page.type || 'website'}">`,
    `<meta property="og:title" content="${esc(page.title)}">`,
    page.description ? `<meta property="og:description" content="${esc(page.description)}">` : '',
    `<meta property="og:url" content="${esc(canonical)}">`,
    `<meta property="og:image" content="${esc(image)}">`,
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    `<meta property="og:image:alt" content="${SITE_NAME}: book movie tickets online">`,
    '<meta property="og:locale" content="en_IN">',
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${esc(page.title)}">`,
    page.description ? `<meta name="twitter:description" content="${esc(page.description)}">` : '',
    `<meta name="twitter:image" content="${esc(image)}">`,
    page.extraMeta || '',
    ...(page.structured || []).map(jsonLd)
  ].filter(Boolean).join('\n');

  const html = getTemplate()
    .replace(/<meta name="description"[^>]*>\s*/, '')   // the template's fallback; each page brings its own
    .replace(/<title>[\s\S]*?<\/title>/, '<!--SEO-->')
    .replace('<!--SEO-->', head)
    .replace('<main id="app" tabindex="-1"></main>',
      `<main id="app" tabindex="-1">${page.body ? `<div class="seo-content">${page.body}</div>` : ''}</main>`);
  return { status: page.status || 200, html };
}

/* ---------- robots.txt and sitemap.xml ---------- */
function robotsTxt(req) {
  return [
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    'Disallow: /show/',
    'Disallow: /ticket',
    'Disallow: /bookings',
    '',
    `Sitemap: ${siteUrl(req)}/sitemap.xml`,
    ''
  ].join('\n');
}

// lastmod tells Google which pages really changed. A movie page changes when the
// catalogue is edited, when the movie is released (Coming soon -> Book tickets)
// and when someone reviews it (the rating shown on the page).
// changefreq and priority are left out: Google ignores them.
function sitemapXml(req, { isComingSoon, lastReviews }) {
  const url = siteUrl(req);
  const reviews = lastReviews ? lastReviews() : new Map();
  const day = ms => new Date(ms).toISOString().slice(0, 10);
  const changed = m => {
    const released = isComingSoon(m) ? 0 : Date.parse(m.releaseDate);
    return Math.max(CATALOG_MTIME.getTime(), released, reviews.get(m.slug) || 0);
  };
  const dates = catalog.MOVIES.map(changed);
  const entry = (loc, ms) => `  <url><loc>${esc(loc)}</loc><lastmod>${day(ms)}</lastmod></url>`;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    entry(url + '/', Math.max(...dates)),
    ...catalog.MOVIES.map((m, i) => entry(`${url}/movie/${m.slug}`, dates[i])),
    '</urlset>',
    ''
  ].join('\n');
}

module.exports = { renderPage, robotsTxt, sitemapXml };

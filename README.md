# Cinevault: Movie Seat Booking System

A BookMyShow-style seat booking app with live seat updates.

- **Frontend:** plain HTML, CSS and JavaScript (`public/`)
- **Catalogue:** cities, cinemas and movies (`catalog.js`)
- **Backend:** Node.js + Express (`server.js`)
- **Database:** SQLite, using `sql.js` (pure JavaScript, nothing to compile) (`db.js`)
- **Live updates:** Socket.IO

## Run it

You need Node.js 18 or newer.

```bash
npm start
```

Open http://localhost:3000

`node_modules` is already included. If you ever delete it, run `npm install` first.

## Features

- **Real current movies in 10 languages** (Hindi, English, Kannada, Tamil, Telugu, Malayalam, Marathi, Bengali, Punjabi, Gujarati), as listed in cinemas in October 2026, plus **Coming soon** with "I'm interested" and **advance booking** in the week before release. Cinemas, showtimes and prices are simulated.
- **8 cities, 17 cinemas:** pick your city in the top bar
- **Movie page:** release date, synopsis, cast and crew, formats and languages (details not yet public are left out)
- **7-day date strip** and a cinema list with colour-coded showtimes (available, filling fast, almost full, sold out)
- **Formats:** 2D, 3D (+₹50), IMAX 2D (+₹150), IMAX 3D (+₹200), 4DX (+₹250) per seat
- **Price breakdown:** seats, snacks, discount, convenience fee (₹30 per seat) and 18% GST on the fee
- **QR code** on every ticket
- **Live seat map:** seats others are choosing show striped, and booked seats turn grey, without reloading
- **Live viewer count:** "You and 2 others are viewing this show"
- **Pick for me:** finds the best block of 1–6 seats side by side (middle of the hall, towards row G)
- **Search and filters:** search by movie, genre or language; filter by language, genre and format; sort by popularity, rating, release date or name
- **Snacks:** add popcorn, drinks and more at checkout
- **Promo codes:** `FLAT20` (20% off seats, up to ₹200), `CINE50` (₹50 off orders of ₹400+), `SNACKY` (30% off snacks)
- **Cancel a booking** until 30 minutes before the show; the seats free up live for everyone
- **Print a ticket** or **add it to your calendar** (.ics file)
- **Light and dark theme** toggle (follows your system until you pick one)
- **Ratings and reviews:** rate released movies 1–5 stars with an optional review; people who booked the movie get a "Booked on Cinevault" badge. Average ratings show on cards and power the **Top rated** sort
- **Trending spotlight:** a rotating banner of the most popular films in your city (real bookings this week, then ratings)
- **Watchlist (♥)** and **Recently viewed**, saved in your browser
- **Wheelchair spaces and companion seats** (A1, A12 and A2, A11), plus a hover card on every seat with its tier and price
- **Split the bill:** shows each person's share when you book more than one seat
- **Cinevault Rewards:** 1 point per ₹10 spent on seats; Bronze, Silver (200), Gold (600) and Platinum (1,500) tiers on My tickets
- **Tickets:** a live "Starts in 3h 20m" countdown, **Share** (native share sheet or clipboard) and confetti when a booking goes through

## SEO

Every page has a real URL (`/movie/drishyam-the-conclusion`, not `/#/movie/...`), so search engines can crawl each movie. Old `#/` links still work and are redirected.

- **Per-page tags** (`seo.js`): the server fills in a unique title, meta description, canonical link, Open Graph and Twitter card tags for each URL, plus plain HTML content (title, synopsis, cast) for crawlers that don't run JavaScript
- **Structured data (JSON-LD):** `Movie` (with cast, director, genre, release date and, once people have rated it, `aggregateRating`) and `BreadcrumbList` on movie pages; `WebSite`, `Organization` and an `ItemList` of movies on the home page
- **`/sitemap.xml`** lists the home page and every movie; **`/robots.txt`** points to it and keeps `/api/`, seat pages, tickets and My tickets out of search
- Seat, ticket and My tickets pages are marked `noindex`; unknown URLs return a real **404**
- Share image (`og-image.png`, 1200×630), SVG favicon, Apple touch icon and a web app manifest
- The title and description also update as you move around the app
- **One address per page:** `/movie/x/` and `/movie/X` redirect (301) to `/movie/x`; in production, `http://` and other hostnames redirect to `SITE_URL`
- **Works behind a proxy** (`trust proxy`), so links stay `https://` on Render, Railway and similar hosts
- **Speed:** gzip on every text response; images and fonts cached for 30 days, CSS and JS for 1 hour
- **Sitemap dates per movie:** `lastmod` changes when the catalogue is edited, the movie is released, or someone reviews it

**Before going live**, set your public address so canonical links, the sitemap and share cards use it:

```bash
SITE_URL=https://your-domain.com NODE_ENV=production npm start
```

Then submit `https://your-domain.com/sitemap.xml` in [Google Search Console](https://search.google.com/search-console) and Bing Webmaster Tools.

## Try the live updates

1. Open http://localhost:3000 in **Chrome**, and again in **Edge or Firefox** (or an incognito window). Each browser counts as a different person.
2. Open the same movie, city, date and showtime in both.
3. Pick a seat in one window. In the other window it turns striped ("Someone is choosing") within a second.
4. Book it, and it turns grey (booked) everywhere.

## Run the race test

With the server running, open a second terminal:

```bash
npm run test:race
```

It sends 50 "hold this seat" requests for the same seat at the same moment and checks that exactly one wins.

## How it works

| Rule | Where in the code |
|---|---|
| Hold a seat for 5 minutes | `POST /api/shows/:id/hold` in `server.js` |
| Never double book | The `UPDATE ... WHERE status = 'free'` query: if 0 rows changed, someone else got it first → **409 Conflict** |
| Expired holds become free | `seatsFor()` treats them as free, and a timer frees them every 5 seconds |
| Live updates | `broadcast()` sends the seat map to everyone viewing that show |
| Viewer count | `broadcastViewers()` counts the sockets in a show's room |
| Page titles, descriptions, structured data, sitemap | `seo.js` |
| Prices | Rows A–C ₹150, D–G ₹200, H–J (recliners) ₹350, plus the format extra |
| Showtimes | `ensureSchedule()` in `db.js` builds the next 7 days from `catalog.js`, adds a new day after midnight and removes old unbooked shows |
| Seats | `ensureSeats()` creates a show's 120 seats the first time someone opens it, so the database stays small |
| Snacks and promo codes | `SNACKS` and `PROMOS` in `server.js`. The server always works out the final total itself |
| Best seats | `bestBlock()` in `public/app.js`; the whole block is held in one request, so you get all of it or none |
| Older databases | `migrate()` in `db.js` adds new columns and tables to an existing `cinema.db` |

## API

| Method | Path | What it does |
|---|---|---|
| GET | `/api/meta` | Cities, languages, genres, formats |
| GET | `/api/movies?city=bengaluru` | Now showing and coming soon in a city |
| GET | `/api/movies/:slug` | One movie with synopsis and cast |
| GET | `/api/movies/:slug/shows?city=&date=YYYY-MM-DD` | Showtimes for one day, grouped by cinema |
| POST | `/api/movies/:slug/interest` | Toggle "interested" `{ userId }` |
| GET | `/api/movies/:slug/reviews?userId=` | Average, star breakdown, latest reviews and yours |
| POST | `/api/movies/:slug/reviews` | Rate a movie `{ userId, name, rating: 1-5, text? }` (replaces your earlier review) |
| DELETE | `/api/movies/:slug/reviews` | Delete your review `{ userId }` |
| GET | `/api/shows` | The next 20 shows with seats left |
| GET | `/api/shows/:id` | One show with its seat map |
| POST | `/api/shows/:id/hold` | Hold seats `{ userId, seats: ["A5"] }` |
| DELETE | `/api/shows/:id/hold` | Release seats `{ userId, seats? }` |
| POST | `/api/shows/:id/book` | Book held seats `{ userId, name, seats, snacks?: { popcorn: 2 }, promo? }` |
| GET | `/api/promos/:code` | Look up a promo code |
| POST | `/api/bookings/:code/cancel` | Cancel your booking `{ userId }` |
| GET | `/api/users/:userId/bookings` | A user's tickets and rewards |

## Reset the data

Stop the server and delete `data/cinema.db`. Fresh showtimes are created on the next start.

## Add a movie or cinema

Edit `catalog.js` and restart the server. Future showtimes that nobody has booked are rebuilt from the new catalogue automatically.

## Ideas to extend it

- Real login (each user currently gets an id saved in their browser)
- An admin dashboard to manage movies, cinemas, showtimes and reports
- A payment gateway such as Razorpay before confirming the booking (and real refunds on cancel)
- Email or SMS confirmations

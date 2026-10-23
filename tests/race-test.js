// Race test: 50 different users try to hold the SAME seat at the same moment.
// Exactly one must win. Run the server first (npm start), then: npm run test:race

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const USERS = 50;

async function main() {
  const { shows } = await (await fetch(BASE + '/api/shows')).json();
  const show = shows.find(s => s.startTime > Date.now() && s.seatsLeft > 0);
  if (!show) throw new Error('No upcoming show with free seats');

  const { seats } = await (await fetch(`${BASE}/api/shows/${show.id}`)).json();
  const seat = seats.find(s => s.status === 'free');
  console.log(`Show: ${show.title} (id ${show.id}), target seat: ${seat.id}`);
  console.log(`Firing ${USERS} hold requests at once…\n`);

  const requests = Array.from({ length: USERS }, (_, i) =>
    fetch(`${BASE}/api/shows/${show.id}/hold`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: `race-user-${String(i).padStart(4, '0')}`, seats: [seat.id] })
    }).then(r => r.status)
  );
  const statuses = await Promise.all(requests);

  const won = statuses.filter(s => s === 200).length;
  const lost = statuses.filter(s => s === 409).length;
  console.log(`200 OK (got the seat): ${won}`);
  console.log(`409 Conflict (too late): ${lost}`);

  // Clean up: release the winner's hold
  const winner = statuses.indexOf(200);
  if (winner >= 0) {
    await fetch(`${BASE}/api/shows/${show.id}/hold`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: `race-user-${String(winner).padStart(4, '0')}` })
    });
  }

  if (won === 1 && lost === USERS - 1) {
    console.log('\n✅ PASS: exactly one person got the seat.');
  } else {
    console.log('\n❌ FAIL: double booking is possible!');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Test could not run:', err.message);
  console.error('Is the server running? Start it with: npm start');
  process.exit(1);
});

// Runs /api/locate and /api/conditions for a set of coastal spots and prints a one-line summary each.
//   node scripts/smoke-test.js                      (against the local dev server)
//   node scripts/smoke-test.js https://plymouth-coastal.vercel.app
const base = process.argv[2] || 'http://localhost:3000';

const places = [
  'Plymouth, MA', 'Nauset Beach', 'Montauk, NY', 'Cape Hatteras', 'Miami Beach', 'Galveston, TX',
  'Huntington Beach', 'Ocean Beach, San Francisco', 'Cannon Beach, OR', 'Annapolis, MD',
  'Alki Beach, Seattle', 'Astoria, OR', 'Gulf Shores, AL', 'Myrtle Beach, SC',
];

let failures = 0;
for (const q of places) {
  const loc = await (await fetch(`${base}/api/locate?q=${encodeURIComponent(q)}`)).json();
  if (loc.error) { failures++; console.log(`FAIL ${q}: ${loc.error}`); continue; }
  const [zone, station] = [loc.zones[0], loc.stations[0]];
  const params = new URLSearchParams({ lat: loc.lat, lon: loc.lon, zone: zone?.id, station: station.id });
  const c = await (await fetch(`${base}/api/conditions?${params}`)).json();
  const errs = ['alerts', 'forecast', 'marine', 'tides'].filter(k => !c[k] || c[k].error);
  if (errs.length || c.error) failures++;
  console.log([
    errs.length || c.error ? 'FAIL' : 'ok  ',
    q.padEnd(27),
    `${zone?.id} ${station.id} ${station.name.slice(0, 22)} (${station.km} km)`.padEnd(48),
    `alerts:${c.alerts?.length ?? '-'} tides:${c.tides?.predictions?.length ?? '-'} headlines:${c.marine?.headlines?.length ?? '-'}`,
    errs.length ? 'errors: ' + errs.map(k => `${k}=${c[k]?.error}`).join('; ') : c.error || '',
  ].join(' | '));
}
process.exitCode = failures ? 1 : 0;

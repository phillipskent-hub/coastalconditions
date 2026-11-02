// Runs /api/locate and /api/conditions for a set of coastal spots and prints a one-line summary each.
//   node scripts/smoke-test.js                      (against the local dev server)
//   node scripts/smoke-test.js https://coastalconditions.app
//
// Spots are fixed on-land coordinates, so this doesn't call OpenStreetMap's search (their policy
// is max 1 request/second and no bulk use). One name search at the end checks search still works.
const base = process.argv[2] || 'http://localhost:3000';

const places = [
  ['Plymouth, MA', 41.958, -70.667], ['Nauset Beach, MA', 41.787, -69.936], ['Montauk, NY', 41.035, -71.954],
  ['Buxton (Cape Hatteras), NC', 35.267, -75.542], ['Miami Beach, FL', 25.790, -80.130], ['Galveston, TX', 29.306, -94.793],
  ['Huntington Beach, CA', 33.660, -117.999], ['Ocean Beach, San Francisco', 37.760, -122.505],
  ['Cannon Beach, OR', 45.892, -123.961], ['Annapolis, MD', 38.978, -76.492], ['Alki Beach, Seattle', 47.579, -122.410],
  ['Astoria, OR', 46.188, -123.831], ['Gulf Shores, AL', 30.246, -87.701], ['Myrtle Beach, SC', 33.689, -78.887],
];

const getJson = async url => (await fetch(url)).json();
let failures = 0;

for (const [label, lat, lon] of places) {
  const loc = await getJson(`${base}/api/locate?lat=${lat}&lon=${lon}`);
  if (loc.error) { failures++; console.log(`FAIL ${label}: ${loc.error}`); continue; }
  const [zone, station] = [loc.zones[0], loc.stations[0]];
  const params = new URLSearchParams({ lat: loc.lat, lon: loc.lon, zone: zone?.id, station: station.id });
  const c = await getJson(`${base}/api/conditions?${params}`);
  const errs = ['alerts', 'forecast', 'marine', 'tides', 'beach', 'hourly', 'astro'].filter(k => !c[k] || c[k].error);
  if (c.hourly?.length < 24) errs.push('hourly');
  if (!c.astro?.sunrise || !c.radar) errs.push('astro');
  const rip = c.beach?.periods?.[0]?.fields.find(f => f.label === 'Rip Current Risk');
  if (errs.length || c.error) failures++;
  console.log([
    errs.length || c.error ? 'FAIL' : 'ok  ',
    label.padEnd(27),
    `${zone?.id} ${station.id} ${station.name.slice(0, 22)} (${station.km} km)`.padEnd(48),
    `alerts:${c.alerts?.length ?? '-'} tides:${c.tides?.predictions?.length ?? '-'} headlines:${c.marine?.headlines?.length ?? '-'}`,
    `surf:${c.beach?.available ? c.beach.office + (rip ? ' rip ' + rip.parts.map(p => p.text).join('/') : ' no-rip') : '-'}`.padEnd(22),
    `water:${c.waterTemp ? c.waterTemp.fahrenheit + 'F@' + c.waterTemp.km + 'km' : '-'}`.padEnd(17),
    `hours:${c.hourly?.length ?? '-'} sun:${c.astro?.sunrise ?? '-'}-${c.astro?.sunset ?? '-'}`,
    errs.length ? 'errors: ' + errs.map(k => `${k}=${c[k]?.error}`).join('; ') : c.error || '',
  ].join(' | '));
}

const search = await getJson(`${base}/api/locate?q=${encodeURIComponent('Nauset Beach')}`);
if (search.error) failures++;
console.log(`${search.error ? 'FAIL' : 'ok  '} | name search "Nauset Beach" -> ${search.error || search.name}`);

process.exitCode = failures ? 1 : 0;

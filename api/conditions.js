// Serverless function: GET /api/conditions
// Fetches NWS forecast + alerts, the Cape Cod Bay marine forecast, and NOAA
// tide predictions, and returns them as one JSON payload for the page.

const LAT = 41.9584;
const LON = -70.6673;
const MARINE_ZONE = 'ANZ231';        // Cape Cod Bay
const TIDE_STATION = '8446493';      // NOAA CO-OPS "Plymouth, MA" (harmonic reference station)
const TZ = 'America/New_York';

// NWS requires a User-Agent identifying the app and a contact.
const UA = 'plymouth-coastal-app (https://github.com/phillipskent-hub/plymouth-coastal)';

async function getJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/geo+json, application/json' } });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} from ${url}`);
  return r.json();
}

async function getText(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} from ${url}`);
  return r.text();
}

async function forecast() {
  // /points resolves lat/lon to the forecast office grid; its response gives the forecast URL.
  const point = await getJson(`https://api.weather.gov/points/${LAT},${LON}`);
  const fc = await getJson(point.properties.forecast);
  // First two periods = "today" from the user's point of view (e.g. "This Afternoon" + "Tonight").
  return fc.properties.periods.slice(0, 2).map(p => ({
    name: p.name,
    temperature: p.temperature,
    unit: p.temperatureUnit,
    wind: `${p.windDirection} ${p.windSpeed}`,
    short: p.shortForecast,
    detailed: p.detailedForecast,
  }));
}

async function alerts() {
  // Land alerts for the Plymouth point plus marine alerts for the bay zone; dedupe by id.
  const [land, marine] = await Promise.all([
    getJson(`https://api.weather.gov/alerts/active?point=${LAT},${LON}`),
    getJson(`https://api.weather.gov/alerts/active/zone/${MARINE_ZONE}`),
  ]);
  const seen = new Map();
  for (const f of [...land.features, ...marine.features]) {
    const p = f.properties;
    seen.set(p.id, { event: p.event, severity: p.severity, headline: p.headline, description: p.description, ends: p.ends || p.expires });
  }
  return [...seen.values()];
}

async function marine() {
  // JSON periods carry wind/seas; the headline ("...SMALL CRAFT ADVISORY...") only appears in the text bulletin.
  const [json, text] = await Promise.all([
    getJson(`https://api.weather.gov/zones/forecast/${MARINE_ZONE}/forecast`),
    getText(`https://tgftp.nws.noaa.gov/data/forecasts/marine/coastal/an/${MARINE_ZONE.toLowerCase()}.txt`).catch(() => ''),
  ]);
  const headlines = [...text.matchAll(/^\.\.\.(.+?)\.\.\.\s*$/gm)].map(m => m[1].trim());
  return {
    updated: json.properties.updated,
    headlines,
    periods: json.properties.periods.slice(0, 2).map(p => ({ name: p.name, text: p.detailedForecast })),
  };
}

async function tides() {
  // date=today + time_zone=lst_ldt gives today's hi/lo in the station's local time (EST/EDT).
  const url = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter'
    + `?product=predictions&station=${TIDE_STATION}&date=today&datum=MLLW&time_zone=lst_ldt`
    + '&interval=hilo&units=english&format=json&application=plymouth-coastal-app';
  const data = await getJson(url);
  if (data.error) throw new Error(data.error.message);
  return data.predictions.map(p => ({ time: p.t, feet: Number(p.v), type: p.type === 'H' ? 'High' : 'Low' }));
}

export default async function handler(req, res) {
  // allSettled: one upstream being down shouldn't blank the whole page.
  const names = ['alerts', 'forecast', 'marine', 'tides'];
  const results = await Promise.allSettled([alerts(), forecast(), marine(), tides()]);

  const body = { generated: new Date().toLocaleString('en-US', { timeZone: TZ }), station: TIDE_STATION, zone: MARINE_ZONE };
  results.forEach((r, i) => {
    body[names[i]] = r.status === 'fulfilled' ? r.value : { error: String(r.reason?.message || r.reason) };
  });

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  // Let Vercel's CDN cache for 10 minutes so we don't hammer NWS/NOAA.
  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=300');
  res.end(JSON.stringify(body));
}

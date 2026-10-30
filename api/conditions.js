// Serverless function: GET /api/conditions?lat=..&lon=..&zone=ANZ231&station=8446493
// Fetches NWS forecast + alerts, the surf zone forecast (rip currents), the marine forecast
// for the zone, NOAA tide predictions and measured water temperature, and returns them as
// one JSON payload for the page.
// Use /api/locate first to get the zone and station for a place.
import { getJson, sendJson, query } from '../lib/http.js';
import { findStation, findZone, nearestTempStations } from '../lib/geo.js';
import { segmentFor, headlines, surfZone } from '../lib/nws-text.js';

const SRF_MAX_AGE_HOURS = 36;
// Surf zone fields already covered elsewhere on the page.
const SRF_SKIP = /^(Tides|Astronomical Tides|Weather|High Temperature|Winds?)$/;

async function forecast(point) {
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

async function alerts(lat, lon, zone) {
  // Land alerts for the point (incl. rip current / beach hazards) plus marine alerts for the zone; dedupe by id.
  const [land, marine] = await Promise.all([
    getJson(`https://api.weather.gov/alerts/active?point=${lat},${lon}`),
    getJson(`https://api.weather.gov/alerts/active/zone/${zone.id}`),
  ]);
  const seen = new Map();
  for (const f of [...land.features, ...marine.features]) {
    const p = f.properties;
    seen.set(p.id, { event: p.event, severity: p.severity, headline: p.headline, description: p.description, ends: p.ends || p.expires });
  }
  return [...seen.values()];
}

// Headlines like "...SMALL CRAFT ADVISORY IN EFFECT THROUGH SATURDAY MORNING..." only appear in the
// text Coastal Waters Forecast (CWF), not the JSON, so the office's latest CWF is fetched too.
async function marine(zone) {
  const [json, cwf] = await Promise.all([
    getJson(`https://api.weather.gov/zones/forecast/${zone.id}/forecast`),
    getJson(`https://api.weather.gov/products/types/CWF/locations/${zone.office}/latest`).catch(() => null),
  ]);
  return {
    zone: zone.id,
    name: zone.name,
    updated: json.properties.updated,
    headlines: headlines(cwf && segmentFor(cwf.productText, [zone.id]) || ''),
    periods: json.properties.periods.slice(0, 2).map(p => ({ name: p.name, text: p.detailedForecast })),
  };
}

// Rip current risk, surf height, forecast water temp, UV: from the NWS Surf Zone Forecast (SRF).
// Only some offices issue one, often only in beach season. Some use special narrow beach zones,
// so match on every public zone containing the point, not just its normal forecast zone.
async function beach(point, lat, lon) {
  const office = point.properties.cwa;
  const [srf, containing] = await Promise.all([
    getJson(`https://api.weather.gov/products/types/SRF/locations/${office}/latest`).catch(() => null),
    getJson(`https://api.weather.gov/zones?type=public&point=${lat},${lon}`).catch(() => null),
  ]);
  if (!srf?.productText) return { available: false, office };

  const zoneIds = [point.properties.forecastZone.split('/').pop(), ...(containing?.features ?? []).map(f => f.properties.id)];
  const segment = segmentFor(srf.productText, zoneIds);
  if (!segment) return { available: false, office };

  const ageHours = (Date.now() - Date.parse(srf.issuanceTime)) / 3600000;
  if (ageHours > SRF_MAX_AGE_HOURS) return { available: false, office, lastIssued: srf.issuanceTime };

  const area = segment.match(/^Including the beaches of ([\s\S]+?)\n\d/m)?.[1].replace(/\s+/g, ' ').trim();
  return {
    available: true,
    office,
    issued: srf.issuanceTime,
    area,
    headlines: headlines(segment),
    periods: surfZone(segment).slice(0, 2).map(p => ({ ...p, fields: p.fields.filter(f => !SRF_SKIP.test(f.label)) })),
  };
}

// Latest measured water temperature from the nearest CO-OPS sensor that reported in the last 3 hours.
async function waterTemp(lat, lon) {
  for (const s of nearestTempStations(lat, lon)) {
    const url = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter'
      + `?product=water_temperature&station=${s.id}&range=3&units=english&time_zone=lst_ldt&format=json`
      + '&application=plymouth-coastal-app';
    const data = await getJson(url).catch(() => null);
    const last = data?.data?.filter(d => d.v !== '').at(-1);
    if (last) return { station: s.id, name: `${s.name}, ${s.state}`, km: s.km, fahrenheit: Number(last.v), time: last.t };
  }
  return null; // no sensor nearby, or none reporting
}

async function tides(station, timeZone) {
  // Today and tomorrow, as explicit dates in the location's time zone: the server runs on UTC, so
  // "today" would be the wrong date in the evening. Tomorrow matters because Gulf stations often
  // have only one high and one low a day. lst_ldt = station local time, DST-aware.
  const today = new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date()); // YYYY-MM-DD
  const tomorrow = new Date(Date.parse(today + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10);
  const url = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter'
    + `?product=predictions&station=${station.id}&begin_date=${today.replace(/-/g, '')}&end_date=${tomorrow.replace(/-/g, '')}`
    + '&datum=MLLW&time_zone=lst_ldt'
    + '&interval=hilo&units=english&format=json&application=plymouth-coastal-app';
  const data = await getJson(url);
  if (data.error) throw new Error(data.error.message);
  return {
    station: station.id,
    name: `${station.name}, ${station.state}`,
    primary: station.primary,
    today,
    // Local "now" in the same "YYYY-MM-DD HH:MM" format as the predictions, so the page can dim past tides.
    now: new Intl.DateTimeFormat('sv-SE', { timeZone, dateStyle: 'short', timeStyle: 'short' }).format(new Date()),
    predictions: data.predictions.map(p => ({ time: p.t, feet: Number(p.v), type: p.type === 'H' ? 'High' : 'Low' })),
  };
}

export default async function handler(req, res) {
  const qs = query(req);
  const lat = +Number(qs.get('lat')).toFixed(3), lon = +Number(qs.get('lon')).toFixed(3);
  const zone = findZone(qs.get('zone'));
  const station = findStation(qs.get('station'));
  // Only accept zones/stations from our own lists, so the query string can't steer our upstream calls.
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !zone || !station) {
    return sendJson(res, 400, { error: 'Pass lat, lon, zone and station (get them from /api/locate).' });
  }

  let point;
  try {
    point = await getJson(`https://api.weather.gov/points/${lat},${lon}`);
  } catch (e) {
    return sendJson(res, 502, { error: String(e.message || e) });
  }
  const timeZone = point.properties.timeZone;

  // allSettled: one upstream being down shouldn't blank the whole page.
  const names = ['alerts', 'forecast', 'marine', 'tides', 'beach', 'waterTemp'];
  const results = await Promise.allSettled([alerts(lat, lon, zone), forecast(point), marine(zone), tides(station, timeZone),
    beach(point, lat, lon), waterTemp(lat, lon)]);

  const body = { generated: new Date().toLocaleString('en-US', { timeZone }), timeZone };
  results.forEach((r, i) => {
    body[names[i]] = r.status === 'fulfilled' ? r.value : { error: String(r.reason?.message || r.reason) };
  });
  // Let Vercel's CDN cache for 10 minutes so we don't hammer NWS/NOAA.
  sendJson(res, 200, body, 600);
}

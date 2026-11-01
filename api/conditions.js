// Serverless function: GET /api/conditions?lat=..&lon=..&zone=ANZ231&station=8446493
// Fetches NWS forecast (daily and hourly) + alerts, the surf zone forecast (rip currents), the
// marine forecast for the zone, NOAA tide predictions, measured water temperature, and sun/moon
// times from the US Naval Observatory, and returns them as one JSON payload for the page.
// Use /api/locate first to get the zone and station for a place.
import { getJson, sendJson, query } from '../lib/http.js';
import { findStation, findZone, nearestTempStations } from '../lib/geo.js';
import { segmentFor, headlines, surfZone } from '../lib/nws-text.js';
import { localDate, localDateTime, utcOffsetHours, addDays, daysBetween, gridValueAt } from '../lib/time.js';

const HOURS = 48;
const TO_MPH = { 'wmoUnit:km_h-1': 0.621371, 'wmoUnit:m_s-1': 2.23694 };

const SRF_MAX_AGE_HOURS = 36;
// Surf zone fields already covered elsewhere on the page.
const SRF_SKIP = /^(Tides|Astronomical Tides|Weather|High Temperature|Winds?|Sunrise|Sunset|Sunrise\/Sunset Times)$/;

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

// Next 48 hours: wind, rain chance, humidity. Gusts aren't in the hourly forecast, only in the
// raw gridpoint data (in km/h, as time ranges), so they're looked up per hour from there.
async function hourly(point) {
  const [fc, grid] = await Promise.all([
    getJson(point.properties.forecastHourly),
    getJson(point.properties.forecastGridData).catch(() => null),
  ]);
  const gusts = grid?.properties.windGust;
  const factor = TO_MPH[gusts?.uom] ?? 1;
  return fc.properties.periods.slice(0, HOURS).map(p => {
    const gust = gusts ? gridValueAt(gusts.values, Date.parse(p.startTime)) : null;
    return {
      time: p.startTime.slice(0, 16).replace('T', ' '), // already in the location's local time
      temp: p.temperature,
      wind: parseInt(p.windSpeed, 10) || 0,
      gust: gust == null ? null : Math.round(gust * factor),
      dir: p.windDirection,
      pop: p.probabilityOfPrecipitation?.value ?? 0,
      humidity: p.relativeHumidity?.value ?? null,
      short: p.shortForecast,
    };
  });
}

// Sun and moon times plus moon phases, from the US Naval Observatory. Their API takes a fixed
// UTC offset, so pass today's offset for the location (handles DST) with dst=false.
// Full and new moons bring spring tides (bigger range), usually peaking a day or two after.
async function astro(lat, lon, timeZone) {
  const today = localDate(timeZone);
  const tz = utcOffsetHours(timeZone);
  const [day, phases] = await Promise.all([
    getJson(`https://aa.usno.navy.mil/api/rstt/oneday?date=${today}&coords=${lat},${lon}&tz=${tz}&dst=false`),
    getJson(`https://aa.usno.navy.mil/api/moon/phases/date?date=${addDays(today, -8)}&nump=6`),
  ]);
  const d = day.properties.data;
  const at = (list, phen) => list?.find(x => x.phen === phen)?.time ?? null;
  // Phase times are UT; convert to the location's local date and time.
  const local = phases.phasedata.map(p => {
    const [hh, mm] = p.time.split(':').map(Number);
    const [date, time] = localDateTime(timeZone, new Date(Date.UTC(p.year, p.month - 1, p.day, hh, mm))).split(' ');
    return { phase: p.phase, date, time };
  });
  const next = name => local.find(p => p.phase === name && p.date >= today) ?? null;
  const spring = local.find(p => /^(Full|New) Moon$/.test(p.phase) && daysBetween(p.date, today) >= -2 && daysBetween(p.date, today) <= 3);
  return {
    today,
    sunrise: at(d.sundata, 'Rise'),
    sunset: at(d.sundata, 'Set'),
    dawn: at(d.sundata, 'Begin Civil Twilight'),
    dusk: at(d.sundata, 'End Civil Twilight'),
    moonrise: at(d.moondata, 'Rise'),
    moonset: at(d.moondata, 'Set'),
    phase: d.curphase,
    illumination: d.fracillum,
    nextFull: next('Full Moon'),
    nextNew: next('New Moon'),
    springTides: spring ? { phase: spring.phase, date: spring.date } : null,
  };
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
  const today = localDate(timeZone);
  const tomorrow = addDays(today, 1);
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
    now: localDateTime(timeZone),
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
  const names = ['alerts', 'forecast', 'marine', 'tides', 'beach', 'waterTemp', 'hourly', 'astro'];
  const results = await Promise.allSettled([alerts(lat, lon, zone), forecast(point), marine(zone), tides(station, timeZone),
    beach(point, lat, lon), waterTemp(lat, lon), hourly(point), astro(lat, lon, timeZone)]);

  const radar = point.properties.radarStation;
  const body = {
    generated: new Date().toLocaleString('en-US', { timeZone }),
    timeZone,
    // NWS's own radar page for the nearest radar site (a link, not embedded).
    radar: radar ? `https://radar.weather.gov/station/${radar}/standard` : null,
  };
  results.forEach((r, i) => {
    body[names[i]] = r.status === 'fulfilled' ? r.value : { error: String(r.reason?.message || r.reason) };
  });
  // Let Vercel's CDN cache for 10 minutes so we don't hammer NWS/NOAA.
  sendJson(res, 200, body, 600);
}

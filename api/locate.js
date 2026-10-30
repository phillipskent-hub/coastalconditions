// Serverless function: GET /api/locate?q=Nauset Beach   or   /api/locate?lat=41.95&lon=-70.63
// Resolves a place to everything /api/conditions needs: name, coordinates, time zone,
// up to three nearby marine zones, and the three nearest tide stations (best guess first).
import { getJson, sendJson, query } from '../lib/http.js';
import { nearestStations, nearbyZones, findZone, MAX_STATION_KM } from '../lib/geo.js';

const round = n => +Number(n).toFixed(3); // ~100 m; identical URLs let the CDN cache share results

// Nominatim (OpenStreetMap) search. Their policy: identify yourself, no search-as-you-type,
// cache results, and credit OpenStreetMap on the page. The CDN cache below covers caching.
async function geocode(q) {
  const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=us&limit=5&q=' + encodeURIComponent(q);
  const results = await getJson(url).catch(e => {
    throw new Error(/\b429\b/.test(e.message) ? 'Place search is busy right now. Try again in a minute, or use your location.' : e.message);
  });
  // "Galveston, TX" otherwise returns the county's center point (out in the bay) ahead of the city.
  const broad = r => ['county', 'state'].includes(r.addresstype) ? 1 : 0;
  results.sort((a, b) => broad(a) - broad(b));
  return results.map(r => ({ name: r.display_name.split(', ').slice(0, 3).join(', '), lat: round(r.lat), lon: round(r.lon) }));
}

async function marineZones(lat, lon) {
  // Beaches usually sit on land just outside a zone, so rank zones by distance...
  const near = nearbyZones(lat, lon);
  // ...but if NWS says the point is inside one, that one goes first.
  const live = await getJson(`https://api.weather.gov/zones?type=coastal&point=${lat},${lon}`).catch(() => null);
  const hit = live?.features.map(f => findZone(f.properties.id)).find(Boolean);
  if (!hit) return near;
  return [{ id: hit.id, name: hit.name, office: hit.office, km: 0 }, ...near.filter(z => z.id !== hit.id)].slice(0, 3);
}

async function resolve(lat, lon, name) {
  const stations = nearestStations(lat, lon);
  if (!stations.length || stations[0].km > MAX_STATION_KM) {
    return { error: `That spot isn't near the lower-48 ocean coast (nearest tide station is ${stations[0]?.km ?? '?'} km away).` };
  }
  const [point, zones] = await Promise.all([
    getJson(`https://api.weather.gov/points/${lat},${lon}`),
    marineZones(lat, lon),
  ]);
  const p = point.properties;
  const rel = p.relativeLocation?.properties;
  return {
    name: name || (rel ? `${rel.city}, ${rel.state}` : `${lat}, ${lon}`),
    lat, lon,
    timeZone: p.timeZone,
    office: p.cwa,
    zones,
    stations: stations.map(({ id, name, state, km, primary }) => ({ id, name, state, km, primary })),
  };
}

export default async function handler(req, res) {
  const qs = query(req);
  try {
    if (qs.get('q')) {
      const matches = await geocode(qs.get('q').slice(0, 100));
      if (!matches.length) return sendJson(res, 404, { error: 'No US place found by that name.' });
      const [first, ...alternatives] = matches;
      const place = await resolve(first.lat, first.lon, first.name);
      return sendJson(res, place.error ? 422 : 200, { ...place, alternatives }, 86400);
    }
    const lat = round(qs.get('lat')), lon = round(qs.get('lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return sendJson(res, 400, { error: 'Pass q, or lat and lon.' });
    const place = await resolve(lat, lon, qs.get('name'));
    return sendJson(res, place.error ? 422 : 200, place, 86400);
  } catch (e) {
    return sendJson(res, 502, { error: String(e.message || e) });
  }
}

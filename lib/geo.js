// Location math against the prebuilt lookup data (see scripts/build-data.js).
import stations from '../data/tide-stations.js';
import zones from '../data/marine-zones.js';
import tempStations from '../data/water-temp-stations.js';

// Beyond this distance from any tide station we treat the spot as "not on the lower-48 ocean coast".
export const MAX_STATION_KM = 60;

export function km(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180;
  const a = Math.sin((lat2 - lat1) * rad / 2) ** 2
    + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin((lon2 - lon1) * rad / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}

export function nearestStations(lat, lon, count = 3, list = stations) {
  return list
    .map(s => ({ ...s, km: km(lat, lon, s.lat, s.lon) }))
    .sort((a, b) => a.km - b.km)
    .slice(0, count)
    .map(s => ({ ...s, km: +s.km.toFixed(1) }));
}

// Zones ranked by distance to their nearest outline vertex. Zone edges near harbors are fuzzy
// (e.g. inner Plymouth Harbor is officially Massachusetts Bay, not Cape Cod Bay), so callers
// offer the runners-up as alternatives.
export function nearbyZones(lat, lon, count = 3, withinKm = 30) {
  const found = [];
  for (const z of zones) {
    let best = Infinity;
    for (const [zlon, zlat] of z.points) {
      // Cheap prefilter (~1 degree box) before the trig.
      if (Math.abs(zlat - lat) > 1 || Math.abs(zlon - lon) > 1.3) continue;
      best = Math.min(best, km(lat, lon, zlat, zlon));
    }
    if (best <= withinKm) found.push({ id: z.id, name: z.name, office: z.office, km: +best.toFixed(1) });
  }
  return found.sort((a, b) => a.km - b.km).slice(0, count);
}

// Water temperature sensors are sparse (Boston has none), so callers try a few within range.
// Kept short: 50 km from Plymouth reaches Woods Hole, which is a different body of water.
export const nearestTempStations = (lat, lon, withinKm = 30) =>
  nearestStations(lat, lon, 3, tempStations).filter(s => s.km <= withinKm);

export const findStation = id => stations.find(s => s.id === id);
export const findZone = id => zones.find(z => z.id === id);

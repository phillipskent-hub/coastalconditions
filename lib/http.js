// Shared fetch helpers. NWS requires a User-Agent identifying the app and a contact;
// Nominatim (OpenStreetMap) asks for the same.
export const UA = 'coastalconditions-app (https://coastalconditions.app)';

// The timeout keeps one slow upstream from stalling the whole response.
export async function getJson(url) {
  const r = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/geo+json, application/json' },
    signal: AbortSignal.timeout(9000),
  });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} from ${url}`);
  return r.json();
}

// Write a JSON response. cacheSeconds > 0 lets Vercel's CDN serve repeats without calling us.
export function sendJson(res, status, body, cacheSeconds = 0) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  if (cacheSeconds > 0) res.setHeader('Cache-Control', `s-maxage=${cacheSeconds}, stale-while-revalidate=300`);
  res.end(JSON.stringify(body));
}

export function query(req) {
  return new URL(req.url, 'http://x').searchParams;
}

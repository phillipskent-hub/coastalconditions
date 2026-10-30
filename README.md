# plymouth-coastal

Personal coastal-conditions page for Plymouth, MA.

- `index.html` – static page; calls `/api/conditions` and renders it.
- `api/conditions.js` – Vercel-style serverless function. Pulls:
  - NWS forecast (`api.weather.gov/points` → gridpoint forecast) and active alerts (Plymouth point + marine zone)
  - NWS marine forecast for ANZ231 Cape Cod Bay (JSON periods + text bulletin headline)
  - NOAA CO-OPS hi/lo tide predictions, station 8446493 (Plymouth, MA)
- `dev-server.js` – zero-dependency local server that mimics Vercel's routing.

Run locally (Node 20+): `npm run dev` → http://localhost:3000

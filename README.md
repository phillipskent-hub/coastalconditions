# plymouth-coastal

Shore conditions for beach-goers and anglers anywhere on the lower-48 US ocean coasts:
active alerts, today's forecast, today's and tomorrow's tides, and the nearshore marine forecast.

- `index.html` – the page. Search a beach/town or use your location; pick among nearby tide stations
  and marine zones. The chosen spot goes in the URL (bookmark/share) and is remembered in the browser.
- `api/locate.js` – place → coordinates, time zone, 3 nearby marine zones, 3 nearest tide stations.
  Search uses OpenStreetMap Nominatim (search on submit only, results CDN-cached, credited on page).
- `api/conditions.js` – NWS forecast + alerts, NWS marine forecast (JSON periods + headline parsed from the
  Coastal Waters Forecast text), NOAA CO-OPS hi/lo tide predictions.
- `lib/` – shared fetch helpers and distance math.
- `data/` – generated lookup tables (tide stations, simplified marine-zone outlines). Refresh with
  `npm run build-data`.
- `scripts/smoke-test.js` – runs both endpoints for 14 coastal spots: `node scripts/smoke-test.js [baseUrl]`.
- `dev-server.js` – zero-dependency local server that mimics Vercel's routing.

Run locally (Node 20+): `npm run dev` → http://localhost:3000 (restarts on file changes)

Data: NOAA National Weather Service, NOAA CO-OPS. Place search © OpenStreetMap contributors. Not for navigation.

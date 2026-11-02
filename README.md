# plymouth-coastal

Shore conditions for beach-goers and anglers anywhere on the lower-48 US ocean coasts:
active alerts, rip current risk and surf (NWS Surf Zone Forecast, where the local office issues one),
measured water temperature, today's forecast, today's and tomorrow's tides, and the nearshore marine forecast.

- `index.html` – the page. Search a beach/town or use your location; pick among nearby tide stations
  and marine zones. The chosen spot goes in the URL (bookmark/share) and is remembered in the browser.
- `api/locate.js` – place → coordinates, time zone, 3 nearby marine zones, 3 nearest tide stations.
  Search uses OpenStreetMap Nominatim (search on submit only, results CDN-cached, credited on page).
- `api/conditions.js` – NWS forecast + alerts, NWS marine forecast (JSON periods + headline parsed from the
  Coastal Waters Forecast text), NOAA CO-OPS hi/lo tide predictions.
- `lib/` – shared fetch helpers, distance math, and parsers for NWS text bulletins (`nws-text.js`).
- `data/` – generated lookup tables (tide stations, water-temperature stations, simplified marine-zone
  outlines). Refresh with `npm run build-data`.
- `test/` – parser unit tests: `npm test`.
- `scripts/smoke-test.js` – runs both endpoints for 14 coastal spots: `node scripts/smoke-test.js [baseUrl]`.
  Uses fixed coordinates so it doesn't bulk-query OpenStreetMap search.
- `manifest.webmanifest`, `sw.js`, `icons/` – installable app (Add to Home Screen) with offline support:
  the last conditions loaded stay viewable without signal. Icons are drawn by `scripts/make-icons.ps1`.
- `dev-server.js` – zero-dependency local server that mimics Vercel's routing.

Run locally (Node 20+): `npm run dev` → http://localhost:3000 (restarts on file changes)

Data: NOAA National Weather Service, NOAA CO-OPS. Place search © OpenStreetMap contributors. Not for navigation.

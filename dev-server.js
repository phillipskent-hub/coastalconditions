// Local dev server (no dependencies): serves the page and static files, and routes /api/<name>
// to api/<name>.js, mimicking what Vercel does in production.
// Run: node dev-server.js  ->  http://localhost:3000
import http from 'node:http';
import { readFile } from 'node:fs/promises';

const PORT = process.env.PORT || 3000;

// Static files the app serves, by exact path (no directory browsing, no path tricks).
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png',
  '.webmanifest': 'application/manifest+json' };
const STATIC = /^\/(index\.html|sw\.js|manifest\.webmanifest|icons\/[\w-]+\.png)$/;

http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  try {
    if (path.startsWith('/api/')) {
      const mod = await import(`./api/${path.slice(5).replace(/[^\w-]/g, '')}.js`);
      return await mod.default(req, res);
    }
    const file = path === '/' ? 'index.html' : STATIC.test(path) ? path.slice(1) : null;
    if (file) {
      res.setHeader('Content-Type', TYPES[file.slice(file.lastIndexOf('.'))]);
      res.setHeader('Cache-Control', 'no-cache'); // like Vercel: always revalidate
      return res.end(await readFile(file));
    }
    res.statusCode = 404;
    res.end('Not found');
  } catch (e) {
    res.statusCode = 500;
    res.end(String(e.stack || e));
  }
}).listen(PORT, () => console.log(`http://localhost:${PORT}`));

// Local dev server (no dependencies): serves index.html and routes /api/<name>
// to api/<name>.js, mimicking what Vercel does in production.
// Run: node dev-server.js  ->  http://localhost:3000
import http from 'node:http';
import { readFile } from 'node:fs/promises';

const PORT = process.env.PORT || 3000;

http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  try {
    if (path.startsWith('/api/')) {
      const mod = await import(`./api/${path.slice(5).replace(/[^\w-]/g, '')}.js`);
      return await mod.default(req, res);
    }
    if (path === '/' || path === '/index.html') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.end(await readFile('index.html'));
    }
    res.statusCode = 404;
    res.end('Not found');
  } catch (e) {
    res.statusCode = 500;
    res.end(String(e.stack || e));
  }
}).listen(PORT, () => console.log(`http://localhost:${PORT}`));

// Giving Tuesday donor tracker — local server, no dependencies.
// Run: node server.js   then open http://localhost:4321
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 4321;
const HOST = '127.0.0.1'; // only reachable from this computer
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function readState() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return null; // first run: the browser fills in defaults
  }
}

function writeState(state) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, DATA_FILE); // atomic replace
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/state') {
    if (req.method === 'GET') return send(res, 200, JSON.stringify(readState()));
    if (req.method === 'PUT') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > 20 * 1024 * 1024) req.destroy();
      });
      req.on('end', () => {
        try {
          const state = JSON.parse(body);
          if (!state || !Array.isArray(state.donors)) throw new Error('bad state');
          writeState(state);
          send(res, 200, '{"ok":true}');
        } catch (e) {
          send(res, 400, JSON.stringify({ error: e.message }));
        }
      });
      return;
    }
    return send(res, 405, '{"error":"method not allowed"}');
  }

  // Static files
  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, 'Forbidden', 'text/plain');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Not found', 'text/plain');
    send(res, 200, data, MIME[path.extname(file)] || 'application/octet-stream');
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Giving Tuesday tracker running at http://localhost:${PORT}`);
});

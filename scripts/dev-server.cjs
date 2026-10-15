const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.wasm': 'application/wasm', '.bcmap': 'application/octet-stream', '.ttf': 'font/ttf', '.pfb': 'application/octet-stream', '.icc': 'application/octet-stream' };
const port = Number(process.env.PORT || 8766);
http.createServer((request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname === '/favicon.ico') { response.writeHead(204); response.end(); return; }
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + path.sep) || !types[path.extname(file)]) {
      response.writeHead(404); response.end('Not found'); return;
    }
    response.setHeader('Content-Type', types[path.extname(file)]);
    response.setHeader('Cache-Control', 'no-store');
    let content = fs.readFileSync(file);
    if (path.extname(file) === '.html' && process.env.PDF_ORGANIZER_QA === '1' && new URL(request.url, 'http://localhost').searchParams.get('qa') === '1') {
      content = content.toString().replace('</body>', '<script src="/tests/browser-fixture.js" defer></script></body>');
    }
    response.end(content);
  } catch {
    response.writeHead(404); response.end('Not found');
  }
}).listen(port, '127.0.0.1', function () {
  console.log(`PDF Organizer: http://127.0.0.1:${this.address().port}`);
});

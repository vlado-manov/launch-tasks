// Local preview: serves public/ and runs api/tasks.js against a JSON file instead of Upstash.
// Usage: node dev-server.js  ->  http://localhost:3000   (data in .data/tasks.json)
const http = require('http');
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '.data', 'tasks.json');
const PORT = process.env.PORT || 3000;
process.env.KV_REST_API_URL = 'http://local-redis';
process.env.KV_REST_API_TOKEN = 'local';

const load = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (_) { return { hash: {}, keys: {} }; } };
const save = d => { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(d, null, 1)); };

const realFetch = global.fetch;
global.fetch = async (url, opts) => {
  if (url !== process.env.KV_REST_API_URL) return realFetch(url, opts);
  const [cmd, key, ...args] = JSON.parse(opts.body);
  const d = load();
  let result = null;
  if (cmd === 'HGETALL') result = Object.entries(d.hash).flat();
  if (cmd === 'HSET') { for (let i = 0; i < args.length; i += 2) d.hash[args[i]] = args[i + 1]; save(d); result = 1; }
  if (cmd === 'HDEL') { delete d.hash[args[0]]; save(d); result = 1; }
  if (cmd === 'GET') result = d.keys[key] || null;
  if (cmd === 'SET') { d.keys[key] = args[0]; save(d); result = 'OK'; }
  return { ok: true, json: async () => ({ result }) };
};

const handler = require('./api/tasks.js');

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/tasks') {
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => {
      let body;
      try { body = raw ? JSON.parse(raw) : undefined; } catch (_) { body = raw; }
      res.status = c => { res.statusCode = c; return res; };
      res.json = j => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(j)); };
      handler({ method: req.method, headers: req.headers, query: Object.fromEntries(url.searchParams), body }, res);
    });
    return;
  }
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(fs.readFileSync(path.join(__dirname, 'public', 'index.html')));
}).listen(PORT, () => console.log(`Launch board: http://localhost:${PORT}`));

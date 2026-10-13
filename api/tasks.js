// Shared task store for the launch board. Tasks live in one Redis hash (Upstash REST API).
const crypto = require('crypto');
const seed = require('../lib/seed.json');

const KEY = 'h7:tasks';
const SEEDED = 'h7:seeded';
const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

async function redis(...cmd) {
  const r = await fetch(REDIS_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${REDIS_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error || 'Redis request failed');
  return j.result;
}

const str = (v, max) => String(v == null ? '' : v).slice(0, max);

function clean(t) {
  if (!t || typeof t !== 'object') return null;
  const st = (Array.isArray(t.st) ? t.st : []).slice(0, 12).filter(s => s && typeof s === 'object')
    .map(s => ({ t: str(s.t, 8), label: str(s.label, 80), time: str(s.time, 40), by: str(s.by, 40) }));
  const title = str(t.title, 120).trim();
  if (!title) return null;
  return {
    title, sub: str(t.sub, 160), cat: str(t.cat, 16), icon: str(t.icon, 16),
    stars: Math.max(0, Math.min(5, t.stars | 0)), owner: t.owner ? str(t.owner, 40) : null,
    flag: str(t.flag, 60), info: str(t.info, 300), order: Number(t.order) || 0,
    st, dod: (Array.isArray(t.dod) ? t.dod : []).slice(0, 30).map(x => str(x, 300)),
    qs: (Array.isArray(t.qs) ? t.qs : []).slice(0, 30).filter(q => q && typeof q === 'object' && q.q)
      .map(q => ({ id: str(q.id, 16), q: str(q.q, 300), a: str(q.a, 1000) })),
  };
}

function allowed(req) {
  const need = process.env.BOARD_PASSWORD;
  if (!need) return true;
  let got = '';
  try { got = decodeURIComponent(String(req.headers['x-board-password'] || '')); } catch (_) {}
  const a = crypto.createHash('sha256').update(got).digest();
  const b = crypto.createHash('sha256').update(need).digest();
  return crypto.timingSafeEqual(a, b);
}

async function readAll() {
  let flat = await redis('HGETALL', KEY);
  if (!flat.length && !(await redis('GET', SEEDED))) {
    await redis('HSET', KEY, ...Object.entries(seed).flatMap(([id, t]) => [id, JSON.stringify(t)]));
    await redis('SET', SEEDED, '1');
    flat = await redis('HGETALL', KEY);
  }
  const tasks = [];
  for (let i = 0; i < flat.length; i += 2) {
    try { tasks.push({ ...JSON.parse(flat[i + 1]), id: flat[i] }); } catch (_) {}
  }
  return tasks;
}

module.exports = async (req, res) => {
  res.setHeader('cache-control', 'no-store');
  if (!REDIS_URL || !REDIS_TOKEN) return res.status(503).json({ error: 'Storage is not configured' });
  try {
    if (req.method === 'GET') return res.status(200).json({ tasks: await readAll() });
    if (req.method !== 'PUT' && req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });
    if (!allowed(req)) return res.status(401).json({ error: 'Password required' });

    if (req.method === 'DELETE') {
      const id = str(req.query.id, 40);
      if (!id) return res.status(400).json({ error: 'Missing id' });
      await redis('HDEL', KEY, id);
      return res.status(200).json({ ok: true });
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const task = clean(body.task);
    if (!task) return res.status(400).json({ error: 'Invalid task' });
    const id = /^[A-Za-z0-9_-]{1,40}$/.test(body.id || '') ? body.id : crypto.randomUUID().slice(0, 8);
    await redis('HSET', KEY, id, JSON.stringify(task));
    return res.status(200).json({ id });
  } catch (e) {
    return res.status(500).json({ error: 'Server error' });
  }
};

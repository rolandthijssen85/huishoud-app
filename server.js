// Huishoud-app: kleine webserver zonder framework.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { db, today } = require('./db');
const tasks = require('./tasks');
const lists = require('./lists');
const push = require('./push');
const calendar = require('./calendar');

const PORT = Number(process.env.PORT || 3000);
const PASSWORD = process.env.FAMILY_PASSWORD;
if (!PASSWORD) {
  console.error('Zet FAMILY_PASSWORD (het gezinswachtwoord) voordat je de app start.');
  process.exit(1);
}

const PUBLIC_DIR = path.join(__dirname, 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml',
};

function send(res, status, body, headers = {}) {
  const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
  res.writeHead(status, { 'Content-Type': isJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', ...headers });
  res.end(isJson ? JSON.stringify(body) : body);
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 100_000) throw new Error('te groot');
  }
  return raw ? JSON.parse(raw) : {};
}

function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=')).filter(c => c[0]));
}

function isLoggedIn(req) {
  const token = cookies(req).sessie;
  return !!token && !!db.prepare('SELECT 1 FROM sessions WHERE token = ?').get(token);
}

function passwordMatches(given) {
  const a = crypto.createHash('sha256').update(String(given)).digest();
  const b = crypto.createHash('sha256').update(PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}

function serveStatic(req, res) {
  let file = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (file === '/') file = '/index.html';
  const full = path.normalize(path.join(PUBLIC_DIR, file));
  if (!full.startsWith(PUBLIC_DIR) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
    return send(res, 404, 'Niet gevonden');
  }
  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(full)] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
  });
  fs.createReadStream(full).pipe(res);
}

function cleanTask(body) {
  const name = String(body.name || '').trim();
  if (!name) return { error: 'Geef de taak een naam.' };
  const interval = body.interval_days === null || body.interval_days === '' || body.interval_days === undefined
    ? null : Math.round(Number(body.interval_days));
  if (interval !== null && !(interval >= 1 && interval <= 3650)) return { error: 'Kies een herhaling van minstens 1 dag.' };
  const next = /^\d{4}-\d{2}-\d{2}$/.test(body.next_due || '') ? body.next_due : today();
  return { name, place: String(body.place || '').trim(), interval_days: interval, next_due: next };
}

function cleanText(value, max = 200) {
  return String(value ?? '').trim().slice(0, max);
}

function cleanRule(body) {
  const keyword = cleanText(body.keyword, 80);
  if (!keyword) return { error: 'Vul een woord in waar de afspraak op herkend wordt.' };
  const days = Math.round(Number(body.days_before) || 0);
  if (!(days >= 0 && days <= 60)) return { error: 'Kies tussen 0 en 60 dagen van tevoren.' };
  const mode = ['none', 'new', 'existing'].includes(body.list_mode) ? body.list_mode : 'none';
  const listId = mode === 'existing' ? Number(body.list_id) || null : null;
  if (mode === 'existing' && !lists.getList(listId)) return { error: 'Kies een lijst.' };
  const items = String(body.list_items || '').split('\n').map(s => cleanText(s)).filter(Boolean).slice(0, 100).join('\n');
  if (mode === 'existing' && !items) return { error: 'Vul in wat er op de lijst moet.' };
  const taskName = cleanText(body.task_name);
  if (!taskName && mode === 'none') return { error: 'Vul een taak in, of kies een lijst.' };
  return {
    keyword, task_name: taskName, days_before: days, list_mode: mode, list_id: listId,
    list_name: mode === 'new' ? cleanText(body.list_name, 80) : '', list_items: mode === 'none' ? '' : items,
  };
}

// Foutantwoord van een route, met HTTP-status.
class Fail {
  constructor(status, body) { this.status = status; this.body = body; }
}
const fail = (status, body) => new Fail(status, body);

// Routes: [methode, patroon, handler(req, res, params, body)]
const routes = [
  ['GET', /^\/api\/overview$/, () => ({
    today: today(),
    todo: tasks.todayList(),
    done: tasks.doneToday(),
    events: calendar.eventsOn(),
  })],
  ['GET', /^\/api\/week$/, () => calendar.withEvents(tasks.weekList())],
  ['GET', /^\/api\/stats$/, () => tasks.monthStats()],

  ['GET', /^\/api\/members$/, () => db.prepare('SELECT id, name FROM members WHERE active = 1 ORDER BY name').all()],
  ['POST', /^\/api\/members$/, (req, res, p, body) => {
    const name = String(body.name || '').trim();
    if (!name) return fail(400, { error: 'Vul een naam in.' });
    const r = db.prepare('INSERT INTO members (name) VALUES (?)').run(name);
    return { id: Number(r.lastInsertRowid), name };
  }],
  ['DELETE', /^\/api\/members\/(\d+)$/, (req, res, p) => {
    // Niet echt verwijderen, zodat de statistieken kloppen.
    db.prepare('UPDATE members SET active = 0 WHERE id = ?').run(p[1]);
    return { ok: true };
  }],

  ['GET', /^\/api\/tasks$/, () => tasks.allTasks().map(tasks.withLast)],
  ['POST', /^\/api\/tasks$/, (req, res, p, body) => {
    const t = cleanTask(body);
    if (t.error) return fail(400, t);
    const r = db.prepare('INSERT INTO tasks (name, place, interval_days, next_due) VALUES (?, ?, ?, ?)')
      .run(t.name, t.place, t.interval_days, t.next_due);
    return { id: Number(r.lastInsertRowid), ...t };
  }],
  ['PUT', /^\/api\/tasks\/(\d+)$/, (req, res, p, body) => {
    const t = cleanTask(body);
    if (t.error) return fail(400, t);
    db.prepare('UPDATE tasks SET name = ?, place = ?, interval_days = ?, next_due = ? WHERE id = ?')
      .run(t.name, t.place, t.interval_days, t.next_due, p[1]);
    return { id: Number(p[1]), ...t };
  }],
  ['DELETE', /^\/api\/tasks\/(\d+)$/, (req, res, p) => {
    db.prepare('DELETE FROM tasks WHERE id = ?').run(p[1]);
    return { ok: true };
  }],
  ['POST', /^\/api\/tasks\/(\d+)\/complete$/, (req, res, p, body) => {
    const memberId = body.member_id ? Number(body.member_id) : null;
    const completionId = tasks.complete(Number(p[1]), memberId);
    return completionId ? { ok: true, completion_id: completionId } : fail(404, { error: 'Taak niet gevonden.' });
  }],
  ['DELETE', /^\/api\/completions\/(\d+)$/, (req, res, p) =>
    tasks.undo(Number(p[1])) ? { ok: true } : fail(404, { error: 'Niet gevonden.' })],

  ['GET', /^\/api\/lists$/, () => lists.allLists()],
  ['POST', /^\/api\/lists$/, (req, res, p, body) => {
    const name = cleanText(body.name, 80);
    if (!name) return fail(400, { error: 'Geef de lijst een naam.' });
    return { id: lists.createList(name), name };
  }],
  ['GET', /^\/api\/lists\/(\d+)$/, (req, res, p) => {
    const list = lists.getList(Number(p[1]));
    if (!list) return fail(404, { error: 'Lijst niet gevonden.' });
    return { ...list, items: lists.items(list.id), history: lists.history(list.id) };
  }],
  ['PUT', /^\/api\/lists\/(\d+)$/, (req, res, p, body) => {
    const name = cleanText(body.name, 80);
    if (!name) return fail(400, { error: 'Geef de lijst een naam.' });
    return lists.renameList(Number(p[1]), name) ? { ok: true } : fail(404, { error: 'Lijst niet gevonden.' });
  }],
  ['DELETE', /^\/api\/lists\/(\d+)$/, (req, res, p) => {
    lists.deleteList(Number(p[1]));
    return { ok: true };
  }],
  ['POST', /^\/api\/lists\/(\d+)\/items$/, (req, res, p, body) => {
    if (!lists.getList(Number(p[1]))) return fail(404, { error: 'Lijst niet gevonden.' });
    const name = cleanText(body.name);
    if (!name) return fail(400, { error: 'Vul in wat er op de lijst moet.' });
    return lists.addItem(Number(p[1]), name, cleanText(body.note, 500));
  }],
  ['POST', /^\/api\/lists\/(\d+)\/clear$/, (req, res, p) => ({ removed: lists.clearDone(Number(p[1])) })],
  ['POST', /^\/api\/lists\/(\d+)\/order$/, (req, res, p, body) => {
    if (!Array.isArray(body.ids)) return fail(400, { error: 'Ongeldige volgorde.' });
    lists.reorder(Number(p[1]), body.ids);
    return { ok: true };
  }],
  ['PUT', /^\/api\/items\/(\d+)$/, (req, res, p, body) => {
    const fields = {};
    if (body.name !== undefined) {
      fields.name = cleanText(body.name);
      if (!fields.name) return fail(400, { error: 'Vul in wat er op de lijst moet.' });
    }
    if (body.note !== undefined) fields.note = cleanText(body.note, 500);
    if (body.done !== undefined) fields.done = !!body.done;
    return lists.updateItem(Number(p[1]), fields) ? { ok: true } : fail(404, { error: 'Item niet gevonden.' });
  }],
  ['DELETE', /^\/api\/items\/(\d+)$/, (req, res, p) => {
    lists.deleteItem(Number(p[1]));
    return { ok: true };
  }],

  ['GET', /^\/api\/calendar$/, () => calendar.status()],
  ['PUT', /^\/api\/calendar$/, async (req, res, p, body) => {
    try {
      await calendar.link(body.url);
    } catch (err) {
      return fail(400, { error: err.name === 'TimeoutError' ? 'De agenda reageert niet. Probeer het later nog eens.' : err.message });
    }
    return calendar.status();
  }],
  ['DELETE', /^\/api\/calendar$/, () => {
    calendar.unlink();
    return { ok: true };
  }],
  ['POST', /^\/api\/calendar\/sync$/, async () => {
    await calendar.sync();
    return calendar.status();
  }],
  ['GET', /^\/api\/calendar\/rules$/, () => calendar.allRules()],
  ['POST', /^\/api\/calendar\/rules$/, (req, res, p, body) => {
    const r = cleanRule(body);
    if (r.error) return fail(400, r);
    return { id: calendar.saveRule(r), ...r };
  }],
  ['PUT', /^\/api\/calendar\/rules\/(\d+)$/, (req, res, p, body) => {
    const r = cleanRule(body);
    if (r.error) return fail(400, r);
    calendar.saveRule(r, Number(p[1]));
    return { id: Number(p[1]), ...r };
  }],
  ['DELETE', /^\/api\/calendar\/rules\/(\d+)$/, (req, res, p) => {
    calendar.deleteRule(Number(p[1]));
    return { ok: true };
  }],

  ['GET', /^\/api\/push\/key$/, () => ({ key: push.publicKey() })],
  ['POST', /^\/api\/push\/subscribe$/, (req, res, p, body) => {
    if (!body.endpoint) return fail(400, { error: 'Ongeldige melding.' });
    push.saveSubscription(body);
    return { ok: true };
  }],
  ['POST', /^\/api\/push\/unsubscribe$/, (req, res, p, body) => {
    push.removeSubscription(body.endpoint);
    return { ok: true };
  }],
  ['POST', /^\/api\/push\/test$/, async () => {
    const list = tasks.todayList();
    const events = calendar.eventsOn();
    const msg = list.length || events.length ? push.dailyMessage(list, events) : { title: 'Testmelding', body: 'Meldingen werken! Vandaag staat er niets op de lijst.' };
    return push.sendToAll(msg);
  }],
];

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/api/login' && req.method === 'POST') {
      const body = await readJson(req);
      if (!passwordMatches(body.password || '')) return send(res, 401, { error: 'Wachtwoord klopt niet.' });
      const token = crypto.randomBytes(32).toString('hex');
      db.prepare('INSERT INTO sessions (token, created_at) VALUES (?, ?)').run(token, new Date().toISOString());
      const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
      return send(res, 200, { ok: true }, {
        'Set-Cookie': `sessie=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${365 * 86400}${secure}`,
      });
    }
    if (url.pathname === '/api/logout' && req.method === 'POST') {
      db.prepare('DELETE FROM sessions WHERE token = ?').run(cookies(req).sessie || '');
      return send(res, 200, { ok: true }, { 'Set-Cookie': 'sessie=; Path=/; Max-Age=0' });
    }
    if (url.pathname === '/api/session') return send(res, 200, { loggedIn: isLoggedIn(req) });

    if (url.pathname.startsWith('/api/')) {
      if (!isLoggedIn(req)) return send(res, 401, { error: 'Log eerst in.' });
      for (const [method, pattern, handler] of routes) {
        const m = url.pathname.match(pattern);
        if (m && req.method === method) {
          const body = method === 'GET' ? {} : await readJson(req);
          const out = await handler(req, res, m, body);
          return out instanceof Fail ? send(res, out.status, out.body) : send(res, 200, out);
        }
      }
      return send(res, 404, { error: 'Onbekende route.' });
    }
    serveStatic(req, res);
  } catch (err) {
    console.error(err);
    send(res, 500, { error: 'Er ging iets mis op de server.' });
  }
});

push.init();
calendar.init();
server.listen(PORT, () => console.log(`Huishoud-app draait op http://localhost:${PORT}`));

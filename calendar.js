// Gedeelde Outlook-agenda: ophalen via de publicatielink, afspraken per dag,
// en regels die bij afspraken automatisch taken en lijsten maken.
const { db, getSetting, setSetting, today, addDays } = require('./db');
const ics = require('./ics');
const lists = require('./lists');

const SYNC_MINUTES = 15;
// Taken uit regels worden aangemaakt zodra ze in het weekoverzicht vallen.
const HORIZON_DAYS = 6;
// Zo ver vooruit kijken of een afspraak nog bestaat (een verjaardag kan ver weg verplaatst zijn).
const LOOKAHEAD_DAYS = 400;

// ---------- agenda ophalen ----------

let parsedCache = { text: null, events: [] };
function events() {
  const text = getSetting('calendar_ics');
  if (!text) return [];
  if (parsedCache.text !== text) parsedCache = { text, events: ics.parseEvents(text) };
  return parsedCache.events;
}

function occurrences(from, to) {
  return ics.expand(events(), from, to);
}

function normalizeUrl(url) {
  url = String(url || '').trim().replace(/^webcals?:\/\//i, 'https://');
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? u.toString() : null;
  } catch {
    return null;
  }
}

async function download(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000), headers: { Accept: 'text/calendar' } });
  if (!res.ok) throw new Error(`De agenda gaf foutcode ${res.status}. Klopt de link nog?`);
  const text = await res.text();
  if (text.length > 20_000_000) throw new Error('Het agendabestand is te groot.');
  if (!/BEGIN:VCALENDAR/.test(text)) throw new Error('Deze link geeft geen agenda. Gebruik de ICS-link uit Outlook.');
  return text;
}

function saveIcs(text) {
  setSetting('calendar_ics', text);
  setSetting('calendar_synced_at', new Date().toISOString());
  setSetting('calendar_error', '');
}

// Nieuwe link instellen. Wordt alleen bewaard als de agenda echt te lezen is.
async function link(rawUrl) {
  const url = normalizeUrl(rawUrl);
  if (!url) throw new Error('Dit is geen geldige link.');
  const text = await download(url);
  ics.parseEvents(text);
  setSetting('calendar_url', url);
  saveIcs(text);
  applyRules();
}

function unlink() {
  for (const key of ['calendar_url', 'calendar_ics', 'calendar_synced_at', 'calendar_error']) {
    db.prepare('DELETE FROM settings WHERE key = ?').run(key);
  }
  applyRules();
}

async function sync() {
  const url = getSetting('calendar_url');
  if (!url) return { ok: false };
  try {
    saveIcs(await download(url));
    applyRules();
    return { ok: true };
  } catch (err) {
    setSetting('calendar_error', err.message);
    console.error('Agenda bijwerken mislukt:', err.message);
    applyRules(); // ook zonder verbinding moeten voorbije afspraken hun taken opruimen
    return { ok: false, error: err.message };
  }
}

// De link zelf geven we niet terug: wie hem heeft, kan de agenda inzien.
function status() {
  const url = getSetting('calendar_url');
  return {
    linked: !!url,
    host: url ? new URL(url).host : null,
    synced_at: getSetting('calendar_synced_at'),
    error: getSetting('calendar_error') || null,
    count: url ? occurrences(today(), addDays(today(), 6)).length : 0,
  };
}

function init() {
  setInterval(sync, SYNC_MINUTES * 60 * 1000);
  sync();
}

// ---------- afspraken per dag ----------

// Zoals de app het toont: begin- en eindtijd op die dag, of "hele dag".
function forDay(o, day) {
  const wholeDay = o.allDay || (o.startDate < day && o.lastDate > day);
  return {
    title: o.title,
    location: o.location,
    allDay: wholeDay,
    start: wholeDay || o.startDate !== day ? null : o.startTime,
    end: wholeDay || o.endDate !== day ? null : o.endTime,
  };
}

function eventsOn(day = today()) {
  return occurrences(day, day).map(o => forDay(o, day)).sort((a, b) => (a.allDay ? '' : a.start || '00:00').localeCompare(b.allDay ? '' : b.start || '00:00'));
}

function withEvents(days) {
  if (!days.length) return days;
  const all = occurrences(days[0].date, days[days.length - 1].date);
  return days.map(d => ({
    ...d,
    events: all.filter(o => o.startDate <= d.date && o.lastDate >= d.date).map(o => forDay(o, d.date))
      .sort((a, b) => (a.allDay ? '' : a.start || '00:00').localeCompare(b.allDay ? '' : b.start || '00:00')),
  }));
}

// ---------- regels ----------

function allRules() {
  return db.prepare(`
    SELECT r.*, l.name AS list_target_name FROM calendar_rules r LEFT JOIN lists l ON l.id = r.list_id
    ORDER BY r.keyword COLLATE NOCASE
  `).all();
}

function saveRule(rule, id = null) {
  const values = [rule.keyword, rule.task_name, rule.days_before, rule.list_mode, rule.list_id, rule.list_name, rule.list_items];
  if (id) {
    db.prepare(`UPDATE calendar_rules SET keyword = ?, task_name = ?, days_before = ?, list_mode = ?, list_id = ?, list_name = ?, list_items = ?
      WHERE id = ?`).run(...values, id);
  } else {
    id = Number(db.prepare(`INSERT INTO calendar_rules (keyword, task_name, days_before, list_mode, list_id, list_name, list_items)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(...values).lastInsertRowid);
  }
  applyRules();
  return id;
}

// Regel weg: taken die er nog open van staan gaan ook weg. Lijsten blijven.
function deleteRule(id) {
  for (const l of db.prepare('SELECT task_id FROM calendar_links WHERE rule_id = ?').all(id)) removeOpenTask(l.task_id);
  db.prepare('DELETE FROM calendar_rules WHERE id = ?').run(id);
}

function removeOpenTask(taskId) {
  if (taskId) db.prepare('DELETE FROM tasks WHERE id = ? AND done = 0').run(taskId);
}

function ruleItems(rule) {
  return rule.list_items.split('\n').map(s => s.trim()).filter(Boolean);
}

// Eerste keer dat een regel bij een afspraak hoort: taak maken en lijst vullen.
function firstTime(rule, o, appear) {
  let taskId = null;
  if (rule.task_name) {
    taskId = Number(db.prepare('INSERT INTO tasks (name, place, interval_days, next_due, event_date) VALUES (?, ?, NULL, ?, ?)')
      .run(rule.task_name, o.title, appear, o.startDate).lastInsertRowid);
  }
  if (rule.list_mode === 'new') {
    const listId = lists.createList(rule.list_name || o.title);
    for (const item of ruleItems(rule)) lists.addItem(listId, item);
  } else if (rule.list_mode === 'existing' && rule.list_id && lists.getList(rule.list_id)) {
    for (const item of ruleItems(rule)) lists.addItem(rule.list_id, item);
  }
  return taskId;
}

// Regels toepassen op de agenda. Draait na elk bijwerken en na het wijzigen van een regel.
// - Taak verschijnt "days_before" dagen voor de afspraak, en wordt aangemaakt zodra die
//   in het weekoverzicht valt.
// - Wordt de afspraak verplaatst, dan schuift de taak mee (zolang hij niet is afgevinkt).
// - Is de afspraak verwijderd of voorbij, dan verdwijnt een taak die nog open staat.
// - Een nieuwe lijst of items op een lijst komen er één keer per afspraak; die blijven staan.
function applyRules(day = today()) {
  const rules = allRules();
  const occ = getSetting('calendar_ics') ? occurrences(day, addDays(day, LOOKAHEAD_DAYS)) : [];
  const horizon = addDays(day, HORIZON_DAYS);
  const getLink = db.prepare('SELECT * FROM calendar_links WHERE rule_id = ? AND event_key = ?');
  const seen = new Set();

  db.exec('BEGIN');
  try {
    for (const rule of rules) {
      const kw = rule.keyword.toLowerCase();
      for (const o of occ) {
        if (!o.title.toLowerCase().includes(kw)) continue;
        seen.add(`${rule.id}|${o.key}`);
        const appear = addDays(o.startDate, -rule.days_before);
        const link = getLink.get(rule.id, o.key);
        if (!link) {
          if (appear > horizon) continue;
          const taskId = firstTime(rule, o, appear);
          db.prepare('INSERT INTO calendar_links (rule_id, event_key, task_id, appear_on, event_title) VALUES (?, ?, ?, ?, ?)')
            .run(rule.id, o.key, taskId, appear, o.title);
          continue;
        }
        if (link.appear_on === appear && link.event_title === o.title) continue;
        // Verplaatst, hernoemd of de regel is aangepast: taak bijwerken als die nog open staat.
        if (link.task_id) {
          db.prepare('UPDATE tasks SET next_due = ?, place = ?, event_date = ? WHERE id = ? AND done = 0')
            .run(appear, o.title, o.startDate, link.task_id);
        }
        db.prepare('UPDATE calendar_links SET appear_on = ?, event_title = ? WHERE rule_id = ? AND event_key = ?')
          .run(appear, o.title, rule.id, o.key);
      }
    }
    for (const link of db.prepare('SELECT * FROM calendar_links').all()) {
      if (seen.has(`${link.rule_id}|${link.event_key}`)) continue;
      removeOpenTask(link.task_id);
      db.prepare('DELETE FROM calendar_links WHERE rule_id = ? AND event_key = ?').run(link.rule_id, link.event_key);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = {
  init, sync, link, unlink, status, normalizeUrl,
  eventsOn, withEvents, occurrences,
  allRules, saveRule, deleteRule, applyRules,
};

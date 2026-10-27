// Database (SQLite via de ingebouwde node:sqlite module) en datumhulpjes.
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'huishouden.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS members (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    place TEXT NOT NULL DEFAULT '',
    interval_days INTEGER,          -- NULL = eenmalig klusje
    next_due TEXT NOT NULL,         -- YYYY-MM-DD
    done INTEGER NOT NULL DEFAULT 0 -- alleen voor eenmalige klusjes
  );

  CREATE TABLE IF NOT EXISTS completions (
    id INTEGER PRIMARY KEY,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
    done_on TEXT NOT NULL,          -- YYYY-MM-DD (Nederlandse tijd)
    done_at TEXT NOT NULL,          -- ISO tijdstip
    prev_next_due TEXT NOT NULL     -- om afvinken ongedaan te kunnen maken
  );

  CREATE TABLE IF NOT EXISTS subscriptions (
    endpoint TEXT PRIMARY KEY,
    data TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS lists (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS list_items (
    id INTEGER PRIMARY KEY,
    list_id INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    done INTEGER NOT NULL DEFAULT 0,  -- doorgestreept, tot de lijst wordt leeggemaakt
    position INTEGER NOT NULL DEFAULT 0
  );

  -- Eerder gebruikte items per lijst, voor suggesties tijdens het typen.
  CREATE TABLE IF NOT EXISTS list_history (
    list_id INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
    name TEXT NOT NULL COLLATE NOCASE,
    uses INTEGER NOT NULL DEFAULT 1,
    last_used TEXT NOT NULL,
    PRIMARY KEY (list_id, name)
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- Regels voor de agenda: bevat de titel van een afspraak het trefwoord, dan
  -- komt er een taak (en eventueel een lijst of items op een lijst).
  CREATE TABLE IF NOT EXISTS calendar_rules (
    id INTEGER PRIMARY KEY,
    keyword TEXT NOT NULL,
    task_name TEXT NOT NULL DEFAULT '',     -- leeg = geen taak
    days_before INTEGER NOT NULL DEFAULT 0, -- 0 = op de dag zelf
    list_mode TEXT NOT NULL DEFAULT 'none', -- none | new | existing
    list_id INTEGER REFERENCES lists(id) ON DELETE SET NULL,
    list_name TEXT NOT NULL DEFAULT '',     -- naam van de nieuwe lijst, leeg = titel van de afspraak
    list_items TEXT NOT NULL DEFAULT ''     -- één item per regel
  );

  -- Welke regel al bij welke keer van een afspraak is toegepast.
  CREATE TABLE IF NOT EXISTS calendar_links (
    rule_id INTEGER NOT NULL REFERENCES calendar_rules(id) ON DELETE CASCADE,
    event_key TEXT NOT NULL,
    task_id INTEGER,                        -- geen foreign key: de taak mag verwijderd worden
    appear_on TEXT NOT NULL,
    event_title TEXT NOT NULL,
    PRIMARY KEY (rule_id, event_key)
  );
`);

// Bestaande databases: kolom voor taken die bij een afspraak horen.
if (!db.prepare("SELECT 1 FROM pragma_table_info('tasks') WHERE name = 'event_date'").get()) {
  db.exec('ALTER TABLE tasks ADD COLUMN event_date TEXT'); // datum van de afspraak, NULL = gewone taak
}

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);
}

const TZ = 'Europe/Amsterdam';

// Datum en uur in Nederlandse tijd, inclusief zomer- en wintertijd.
function nowParts(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
    }).formatToParts(date).map(p => [p.type, p.value])
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

function today() {
  return nowParts().date;
}

function addDays(isoDate, days) {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

module.exports = { db, getSetting, setSetting, nowParts, today, addDays };

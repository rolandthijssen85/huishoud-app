// Agenda-bestand (iCalendar/ICS, zoals Outlook dat publiceert) lezen en
// herhalingen uitrekenen. Alle datums en tijden komen eruit in Nederlandse tijd.
const TZ = 'Europe/Amsterdam';

// Outlook gebruikt Windows-namen voor tijdzones.
const WINDOWS_ZONES = {
  'W. Europe Standard Time': 'Europe/Amsterdam',
  'Romance Standard Time': 'Europe/Paris',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Central European Standard Time': 'Europe/Warsaw',
  'GMT Standard Time': 'Europe/London',
  'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'E. Europe Standard Time': 'Europe/Chisinau',
  'FLE Standard Time': 'Europe/Helsinki',
  'GTB Standard Time': 'Europe/Athens',
  'Turkey Standard Time': 'Europe/Istanbul',
  'Eastern Standard Time': 'America/New_York',
  'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver',
  'Pacific Standard Time': 'America/Los_Angeles',
  'UTC': 'UTC',
  'Coordinated Universal Time': 'UTC',
};

function resolveZone(tzid) {
  if (!tzid) return TZ; // "zwevende" tijd: neem Nederlandse tijd
  if (/^(utc|z|gmt)$/i.test(tzid)) return 'UTC';
  if (WINDOWS_ZONES[tzid]) return WINDOWS_ZONES[tzid];
  try {
    new Intl.DateTimeFormat('en', { timeZone: tzid });
    return tzid;
  } catch {
    return TZ; // onbekende of zelfgemaakte zone (bijv. "Customized Time Zone")
  }
}

// ---------- datumrekenen op kale datums (YYYY-MM-DD) ----------

const DAY = 86400000;
const toNum = iso => Date.parse(iso + 'T00:00:00Z') / DAY;
const fromNum = n => new Date(n * DAY).toISOString().slice(0, 10);
const addDays = (iso, n) => fromNum(toNum(iso) + n);
const weekday = iso => (new Date(iso + 'T00:00:00Z').getUTCDay() + 6) % 7; // 0 = maandag
const ymd = (y, m, d) => `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

// ---------- tijdzones ----------

function zoneParts(ms, zone) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}:${p.second}` };
}

function wallMs(date, time) {
  return Date.parse(`${date}T${time || '00:00:00'}Z`);
}

// Kloktijd in een zone → absoluut tijdstip.
function zonedToMs(date, time, zone) {
  const guess = wallMs(date, time);
  if (zone === 'UTC') return guess;
  const offset = ms => { const p = zoneParts(ms, zone); return wallMs(p.date, p.time) - ms; };
  let ms = guess - offset(guess);
  const second = guess - offset(ms);
  if (second !== ms) ms = second; // rond de wissel van zomer- naar wintertijd
  return ms;
}

function msToLocal(ms) {
  const p = zoneParts(ms, TZ);
  return { date: p.date, time: p.time.slice(0, 5) };
}

// ---------- lezen ----------

function unfold(text) {
  return text.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '');
}

function parseLine(line) {
  let i = 0;
  let quoted = false;
  for (; i < line.length; i++) {
    if (line[i] === '"') quoted = !quoted;
    else if (line[i] === ':' && !quoted) break;
  }
  const [name, ...rawParams] = line.slice(0, i).split(';');
  const params = {};
  for (const p of rawParams) {
    const j = p.indexOf('=');
    if (j > 0) params[p.slice(0, j).toUpperCase()] = p.slice(j + 1).replace(/^"|"$/g, '');
  }
  return { name: name.toUpperCase(), params, value: line.slice(i + 1) };
}

function unescapeText(v) {
  return v.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').replace(/\s+/g, ' ').trim();
}

// "20261025", "20261025T090000" of "20261025T090000Z" → { date, time, zone }
function parseDate(value, params = {}) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  if (!m[4] || params.VALUE === 'DATE') return { date, time: null, zone: null };
  return { date, time: `${m[4]}:${m[5]}:${m[6] || '00'}`, zone: m[7] ? 'UTC' : resolveZone(params.TZID) };
}

function dateMs(d) {
  return d.time ? zonedToMs(d.date, d.time, d.zone) : wallMs(d.date);
}

// Sleutel van één keer van een afspraak, in Nederlandse tijd.
function localKey(d) {
  if (!d.time) return d.date;
  const l = msToLocal(dateMs(d));
  return `${l.date}T${l.time}`;
}

function parseDuration(v) {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim());
  if (!m) return 0;
  const ms = ((+m[2] || 0) * 7 * DAY) + ((+m[3] || 0) * DAY) + ((+m[4] || 0) * 3600000) + ((+m[5] || 0) * 60000) + ((+m[6] || 0) * 1000);
  return m[1] === '-' ? -ms : ms;
}

function parseRule(value) {
  const r = Object.fromEntries(value.split(';').map(p => p.split('=')).filter(p => p[1]).map(([k, v]) => [k.toUpperCase(), v]));
  const list = k => (r[k] ? r[k].split(',').map(Number) : null);
  return {
    freq: r.FREQ,
    interval: Math.max(1, Number(r.INTERVAL) || 1),
    count: r.COUNT ? Number(r.COUNT) : null,
    until: r.UNTIL ? parseDate(r.UNTIL) : null,
    byDay: r.BYDAY ? r.BYDAY.split(',').map(s => {
      const m = /^([+-]?\d+)?(MO|TU|WE|TH|FR|SA|SU)$/.exec(s.trim());
      return m ? { ord: m[1] ? Number(m[1]) : 0, wd: ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'].indexOf(m[2]) } : null;
    }).filter(Boolean) : null,
    byMonthDay: list('BYMONTHDAY'),
    byMonth: list('BYMONTH'),
    bySetPos: list('BYSETPOS'),
  };
}

// Alle afspraken uit het bestand, nog zonder herhalingen uit te rekenen.
function parseEvents(text) {
  const events = [];
  let cur = null;
  let nested = 0; // bijv. VALARM binnen een VEVENT
  for (const line of unfold(text).split('\n')) {
    if (!line) continue;
    const { name, params, value } = parseLine(line);
    if (name === 'BEGIN') {
      if (value.toUpperCase() === 'VEVENT' && !cur) cur = { exdates: new Set() };
      else if (cur) nested++;
      continue;
    }
    if (name === 'END') {
      if (cur && nested) nested--;
      else if (cur && value.toUpperCase() === 'VEVENT') {
        if (cur.start && cur.status !== 'CANCELLED') events.push(cur);
        cur = null;
      }
      continue;
    }
    if (!cur || nested) continue;
    switch (name) {
      case 'UID': cur.uid = value.trim(); break;
      case 'SUMMARY': cur.title = unescapeText(value); break;
      case 'LOCATION': cur.location = unescapeText(value); break;
      case 'STATUS': cur.status = value.trim().toUpperCase(); break;
      case 'DTSTART': cur.start = parseDate(value, params); break;
      case 'DTEND': cur.end = parseDate(value, params); break;
      case 'DURATION': cur.duration = parseDuration(value); break;
      case 'RRULE': cur.rule = parseRule(value); break;
      case 'RECURRENCE-ID': cur.recurrenceId = parseDate(value, params); break;
      case 'EXDATE':
        for (const v of value.split(',')) {
          const d = parseDate(v, params);
          if (d) cur.exdates.add(localKey(d));
        }
        break;
    }
  }
  return events;
}

// ---------- herhalingen ----------

function nthWeekdays(y, m, byDay) {
  const out = [];
  const last = daysInMonth(y, m);
  for (const { ord, wd } of byDay) {
    const all = [];
    for (let d = 1; d <= last; d++) if (weekday(ymd(y, m, d)) === wd) all.push(ymd(y, m, d));
    if (!ord) out.push(...all);
    else {
      const pick = ord > 0 ? all[ord - 1] : all[all.length + ord];
      if (pick) out.push(pick);
    }
  }
  return out;
}

function monthDays(y, m, list) {
  const last = daysInMonth(y, m);
  return list.map(d => (d < 0 ? last + d + 1 : d)).filter(d => d >= 1 && d <= last).map(d => ymd(y, m, d));
}

function setPos(dates, positions) {
  if (!positions) return dates;
  return positions.map(p => (p > 0 ? dates[p - 1] : dates[dates.length + p])).filter(Boolean);
}

// Datums (in de eigen zone van de afspraak) volgens de regel, vanaf de begindatum, tot "stop".
function* ruleDates(start, rule, stop) {
  const [sy, sm, sd] = start.split('-').map(Number);
  const uniq = arr => [...new Set(arr)].sort().filter(d => d >= start);
  for (let k = 0; k < 100000; k++) {
    let dates;
    if (rule.freq === 'DAILY') {
      const d = addDays(start, k * rule.interval);
      if (d > stop) return;
      const okDay = !rule.byDay || rule.byDay.some(b => b.wd === weekday(d));
      const okMonth = !rule.byMonth || rule.byMonth.includes(Number(d.slice(5, 7)));
      dates = okDay && okMonth ? [d] : [];
    } else if (rule.freq === 'WEEKLY') {
      const weekStart = addDays(start, -weekday(start) + k * 7 * rule.interval);
      if (weekStart > stop) return;
      const wds = rule.byDay ? rule.byDay.map(b => b.wd) : [weekday(start)];
      dates = uniq(wds.map(wd => addDays(weekStart, wd)));
    } else if (rule.freq === 'MONTHLY') {
      const mi = (sm - 1) + k * rule.interval;
      const y = sy + Math.floor(mi / 12);
      const m = (mi % 12) + 1;
      if (ymd(y, m, 1) > stop) return;
      if (rule.byMonth && !rule.byMonth.includes(m)) continue;
      let c;
      if (rule.byMonthDay) c = monthDays(y, m, rule.byMonthDay);
      else if (rule.byDay) c = nthWeekdays(y, m, rule.byDay);
      else c = monthDays(y, m, [sd]);
      dates = uniq(setPos([...new Set(c)].sort(), rule.bySetPos));
    } else if (rule.freq === 'YEARLY') {
      const y = sy + k * rule.interval;
      if (ymd(y, 1, 1) > stop) return;
      const months = rule.byMonth || [sm];
      let c = [];
      for (const m of months) {
        if (rule.byMonthDay) c.push(...monthDays(y, m, rule.byMonthDay));
        else if (rule.byDay) c.push(...nthWeekdays(y, m, rule.byDay));
        else if (sd <= daysInMonth(y, m)) c.push(ymd(y, m, sd)); // 29 februari alleen in schrikkeljaren
      }
      dates = uniq(setPos([...new Set(c)].sort(), rule.bySetPos));
    } else {
      yield start; // onbekende herhaling: alleen de eerste keer
      return;
    }
    for (const d of dates) yield d;
  }
}

// Alle keren dat afspraken plaatsvinden en de dagen from..to (YYYY-MM-DD,
// Nederlandse tijd) raken. Gesorteerd op begin.
function expand(events, from, to) {
  const overrides = new Map(); // uid|keer → gewijzigde versie van één keer uit een reeks
  for (const e of events) if (e.recurrenceId) overrides.set(`${e.uid}|${localKey(e.recurrenceId)}`, e);

  const out = [];
  const push = (e, start, key) => {
    const occ = occurrence(e, start, key);
    if (occ.lastDate >= from && occ.startDate <= to) out.push(occ);
  };

  for (const e of events) {
    if (e.recurrenceId) {
      // Een verplaatste keer telt alleen mee als de reeks er nog is; anders als losse afspraak.
      const master = events.some(m => m.uid === e.uid && m.rule && !m.recurrenceId);
      if (!master) push(e, e.start, `${e.uid}|${localKey(e.recurrenceId)}`);
      continue;
    }
    if (!e.rule) {
      push(e, e.start, e.uid || `${e.title}|${localKey(e.start)}`);
      continue;
    }
    const untilMs = e.rule.until ? dateMs(e.rule.until.time ? e.rule.until : { ...e.rule.until, time: '23:59:59', zone: e.start.zone || TZ }) : Infinity;
    // Ruim doorrekenen: afspraken die langer duren of in een andere zone staan.
    const stop = addDays(to, 2);
    let n = 0;
    for (const d of ruleDates(e.start.date, e.rule, stop)) {
      const start = { ...e.start, date: d };
      if (dateMs(start) > untilMs) break;
      if (e.rule.count && ++n > e.rule.count) break;
      const lk = localKey(start);
      if (e.exdates.has(lk)) continue;
      const key = `${e.uid}|${lk}`;
      const ov = overrides.get(key);
      if (ov) push(ov, ov.start, key);
      else push({ ...e, end: e.end && shiftEnd(e, start) }, start, key);
    }
  }
  return out.sort((a, b) => (a.startDate + (a.allDay ? '' : a.startTime)).localeCompare(b.startDate + (b.allDay ? '' : b.startTime)));
}

// Eind van een herhaalde keer: zelfde duur als de eerste keer.
function shiftEnd(e, start) {
  if (!e.start.time) return { ...e.end, date: addDays(start.date, toNum(e.end.date) - toNum(e.start.date)) };
  return { ms: dateMs(start) + (dateMs(e.end) - dateMs(e.start)) };
}

function occurrence(e, start, key) {
  const base = { key, title: e.title || '(geen titel)', location: e.location || '' };
  if (!start.time) {
    let endDate = e.end && !e.end.time ? e.end.date : addDays(start.date, Math.max(1, Math.round((e.duration || DAY) / DAY)));
    if (endDate <= start.date) endDate = addDays(start.date, 1);
    return { ...base, allDay: true, startDate: start.date, startTime: null, endDate: null, endTime: null, lastDate: addDays(endDate, -1) };
  }
  const startMs = dateMs(start);
  let endMs = startMs + (e.duration || 0);
  if (e.end) endMs = e.end.ms ?? dateMs(e.end);
  if (endMs < startMs) endMs = startMs;
  const s = msToLocal(startMs);
  const en = msToLocal(endMs);
  // Eindigt de afspraak om middernacht, dan hoort die niet meer bij de volgende dag.
  const lastDate = endMs > startMs && en.time === '00:00' ? addDays(en.date, -1) : en.date;
  return { ...base, allDay: false, startDate: s.date, startTime: s.time, endDate: en.date, endTime: en.time, lastDate };
}

module.exports = { parseEvents, expand, resolveZone };

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'huishouden-test-'));
const { db, setSetting, addDays, today } = require('../db');
const calendar = require('../calendar');
const lists = require('../lists');
const { dailyMessage } = require('../push');

const D = today();
const compact = d => d.replace(/-/g, '');
const ev = (uid, title, date, extra = '') =>
  `BEGIN:VEVENT\r\nUID:${uid}\r\nSUMMARY:${title}\r\nDTSTART;VALUE=DATE:${compact(date)}\r\n${extra}END:VEVENT\r\n`;
const setCal = (...events) => setSetting('calendar_ics', `BEGIN:VCALENDAR\r\n${events.join('')}END:VCALENDAR\r\n`);
const rule = (fields) => calendar.saveRule({ task_name: '', days_before: 0, list_mode: 'none', list_id: null, list_name: '', list_items: '', ...fields });
const openTasks = () => db.prepare('SELECT name, place, next_due, event_date FROM tasks WHERE done = 0 ORDER BY next_due').all().map(r => ({ ...r }));

test.beforeEach(() => db.exec('DELETE FROM calendar_links; DELETE FROM calendar_rules; DELETE FROM tasks; DELETE FROM lists;'));

test('taak verschijnt pas als hij in de week valt', () => {
  setCal(ev('v1', 'Verjaardag oma', addDays(D, 14)));
  rule({ keyword: 'verjaardag', task_name: 'Cadeau kopen', days_before: 7 });
  assert.strictEqual(openTasks().length, 0); // verschijnt over 7 dagen, nog buiten de week
  calendar.applyRules(addDays(D, 1));
  assert.deepStrictEqual(openTasks(), [{ name: 'Cadeau kopen', place: 'Verjaardag oma', next_due: addDays(D, 7), event_date: addDays(D, 14) }]);
});

test('afspraak verplaatst: taak schuift mee; verwijderd: taak weg', () => {
  setCal(ev('g1', 'Gym Sanne', addDays(D, 2)));
  rule({ keyword: 'GYM', task_name: 'Gymkleren mee', days_before: 1 });
  assert.strictEqual(openTasks()[0].next_due, addDays(D, 1));
  setCal(ev('g1', 'Gym Sanne', addDays(D, 4)));
  calendar.applyRules(D);
  assert.strictEqual(openTasks().length, 1);
  assert.strictEqual(openTasks()[0].next_due, addDays(D, 3));
  setCal();
  calendar.applyRules(D);
  assert.strictEqual(openTasks().length, 0);
});

test('afspraak voorbij: open taak verdwijnt, gedane taak blijft gedaan', () => {
  setCal(ev('g1', 'Gym', D), ev('g2', 'Gym', addDays(D, 1)));
  rule({ keyword: 'gym', task_name: 'Gymkleren mee' });
  assert.strictEqual(openTasks().length, 2);
  db.prepare("UPDATE tasks SET done = 1 WHERE event_date = ?").run(addDays(D, 1));
  calendar.applyRules(addDays(D, 2));
  assert.strictEqual(openTasks().length, 0);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM tasks WHERE done = 1').get().n, 1);
});

test('afgevinkte taak komt niet terug zolang de afspraak er nog is', () => {
  setCal(ev('v1', 'Verjaardag', addDays(D, 3)));
  rule({ keyword: 'verjaardag', task_name: 'Cadeau kopen', days_before: 2 });
  db.exec('UPDATE tasks SET done = 1');
  calendar.applyRules(D);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM tasks').get().n, 1);
});

test('nieuwe lijst met items, één keer per afspraak; ook items op een bestaande lijst', () => {
  const boodschappen = lists.createList('Boodschappen');
  setCal(ev('s1', 'Sinterklaas', addDays(D, 3)));
  rule({ keyword: 'sinterklaas', list_mode: 'new', list_name: 'Cadeautjes Sinterklaas', list_items: 'Gedicht\nSurprise' });
  rule({ keyword: 'sinterklaas', list_mode: 'existing', list_id: boodschappen, list_items: 'Pepernoten' });
  calendar.applyRules(D);
  calendar.applyRules(addDays(D, 1));
  const all = lists.allLists();
  assert.deepStrictEqual(all.map(l => l.name).sort(), ['Boodschappen', 'Cadeautjes Sinterklaas']);
  const sint = all.find(l => l.name === 'Cadeautjes Sinterklaas');
  assert.deepStrictEqual(lists.items(sint.id).map(i => i.name), ['Gedicht', 'Surprise']);
  assert.deepStrictEqual(lists.items(boodschappen).map(i => i.name), ['Pepernoten']);
  assert.strictEqual(openTasks().length, 0); // regel zonder taak
  // Na de afspraak blijft de lijst staan.
  setCal();
  calendar.applyRules(D);
  assert.strictEqual(lists.allLists().length, 2);
});

test('regel verwijderen haalt open taken weg', () => {
  setCal(ev('g1', 'Gym', addDays(D, 1)));
  const id = rule({ keyword: 'gym', task_name: 'Gymkleren mee' });
  assert.strictEqual(openTasks().length, 1);
  calendar.deleteRule(id);
  assert.strictEqual(openTasks().length, 0);
});

test('afspraken per dag, met tijden', () => {
  setCal(ev('h', 'Studiedag', D),
    `BEGIN:VEVENT\r\nUID:t\r\nSUMMARY:Tandarts\r\nDTSTART;TZID=W. Europe Standard Time:${compact(D)}T093000\r\nDTEND;TZID=W. Europe Standard Time:${compact(D)}T100000\r\nEND:VEVENT\r\n`);
  assert.deepStrictEqual(calendar.eventsOn(D), [
    { title: 'Studiedag', location: '', allDay: true, start: null, end: null },
    { title: 'Tandarts', location: '', allDay: false, start: '09:30', end: '10:00' },
  ]);
  const week = calendar.withEvents([{ date: D, tasks: [] }, { date: addDays(D, 1), tasks: [] }]);
  assert.strictEqual(week[0].events.length, 2);
  assert.strictEqual(week[1].events.length, 0);
});

test('ochtendmelding met afspraken', () => {
  const events = [{ title: 'Tandarts', start: '09:30' }, { title: 'Studiedag', start: null }];
  assert.deepStrictEqual(dailyMessage([{ name: 'Planten', place: '' }], events), {
    title: '1 klusje en 2 afspraken vandaag', body: '09:30 Tandarts, Studiedag\nPlanten',
  });
  assert.strictEqual(dailyMessage([], events.slice(0, 1)).title, '1 afspraak vandaag');
});

test('link: webcal wordt https, rare links worden geweigerd', () => {
  assert.strictEqual(calendar.normalizeUrl('webcal://outlook.live.com/owa/calendar/x/calendar.ics'), 'https://outlook.live.com/owa/calendar/x/calendar.ics');
  assert.strictEqual(calendar.normalizeUrl('file:///etc/passwd'), null);
  assert.strictEqual(calendar.normalizeUrl('geen link'), null);
});

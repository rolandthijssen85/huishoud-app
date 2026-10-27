const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'huishouden-test-'));
const { db, today, addDays } = require('../db');
const tasks = require('../tasks');
const { dailyMessage } = require('../push');

const T = today();
const addTask = (name, interval, due, place = '') =>
  Number(db.prepare('INSERT INTO tasks (name, place, interval_days, next_due) VALUES (?, ?, ?, ?)').run(name, place, interval, due).lastInsertRowid);
const roland = Number(db.prepare("INSERT INTO members (name) VALUES ('Roland')").run().lastInsertRowid);

test.beforeEach(() => db.exec('DELETE FROM completions; DELETE FROM tasks;'));

test('achterstallige taken staan op vandaag en vandaag-taken ook', () => {
  addTask('Planten', 3, addDays(T, -2));
  addTask('Stofzuigen', 7, T);
  addTask('Bed verschonen', 14, addDays(T, 1));
  const list = tasks.todayList();
  assert.deepStrictEqual(list.map(t => t.name), ['Planten', 'Stofzuigen']);
  assert.strictEqual(list[0].overdueDays, 2);
});

test('afvinken schuift het schema op vanaf vandaag', () => {
  const id = addTask('Planten', 3, addDays(T, -2));
  tasks.complete(id, roland);
  const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  assert.strictEqual(t.next_due, addDays(T, 3));
  assert.strictEqual(tasks.todayList().length, 0);
  assert.strictEqual(tasks.doneToday()[0].member_name, 'Roland');
});

test('eenmalig klusje verdwijnt na afvinken, ongedaan maken zet het terug', () => {
  const id = addTask('Lamp vervangen', null, T);
  const cid = tasks.complete(id, roland);
  assert.strictEqual(tasks.allTasks().length, 0);
  tasks.undo(cid);
  assert.strictEqual(tasks.todayList()[0].name, 'Lamp vervangen');
});

test('ongedaan maken herstelt de oude datum', () => {
  const due = addDays(T, -1);
  const id = addTask('Wc', 7, due);
  const cid = tasks.complete(id, roland);
  tasks.undo(cid);
  assert.strictEqual(db.prepare('SELECT next_due FROM tasks WHERE id = ?').get(id).next_due, due);
});

test('weekoverzicht rekent herhalingen door', () => {
  addTask('Planten', 3, addDays(T, -1)); // vandaag (te laat), +3, +6
  addTask('Ramen', 14, addDays(T, 2), 'Woonkamer');
  const week = tasks.weekList();
  assert.strictEqual(week.length, 7);
  const plantDays = week.map((d, i) => (d.tasks.some(t => t.name === 'Planten') ? i : null)).filter(i => i !== null);
  assert.deepStrictEqual(plantDays, [0, 3, 6]);
  assert.ok(week[0].tasks.find(t => t.name === 'Planten').overdue);
  assert.strictEqual(week[2].tasks[0].place, 'Woonkamer');
});

test('statistiek telt per persoon in de huidige maand', () => {
  const a = addTask('Was', 2, T);
  const b = addTask('Stofzuigen', 7, T);
  tasks.complete(a, roland);
  tasks.complete(b, null);
  const s = tasks.monthStats();
  assert.strictEqual(s.total, 2);
  assert.deepStrictEqual(s.perMember.map(m => m.name).sort(), ['Onbekend', 'Roland']);
  assert.strictEqual(tasks.monthStats('1999-01').total, 0);
});

test('ochtendmelding noemt de taken', () => {
  const msg = dailyMessage([{ name: 'Planten', place: '' }, { name: 'Ramen', place: 'Keuken' }]);
  assert.strictEqual(msg.title, '2 klusjes voor vandaag');
  assert.strictEqual(msg.body, 'Planten, Ramen (Keuken)');
});

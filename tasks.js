// Takenlogica: wat moet er vandaag, deze week, afvinken en statistieken.
const { db, today, addDays } = require('./db');

function allTasks() {
  return db.prepare('SELECT * FROM tasks WHERE done = 0 ORDER BY next_due, place, name').all();
}

function lastCompletion(taskId) {
  return db.prepare(`
    SELECT c.id, c.done_on, c.done_at, m.name AS member_name
    FROM completions c LEFT JOIN members m ON m.id = c.member_id
    WHERE c.task_id = ? ORDER BY c.id DESC LIMIT 1
  `).get(taskId) || null;
}

function withLast(task) {
  return { ...task, last: lastCompletion(task.id) };
}

// Alles wat vandaag of eerder gepland stond en nog niet is gedaan.
function todayList(day = today()) {
  return db.prepare('SELECT * FROM tasks WHERE done = 0 AND next_due <= ? ORDER BY next_due, place, name')
    .all(day)
    .map(t => ({ ...withLast(t), overdueDays: daysBetween(t.next_due, day) }));
}

// Vandaag gedaan, zodat je ziet wie wat al heeft afgevinkt.
function doneToday(day = today()) {
  return db.prepare(`
    SELECT c.id, c.task_id, t.name, t.place, m.name AS member_name, c.done_at
    FROM completions c JOIN tasks t ON t.id = c.task_id LEFT JOIN members m ON m.id = c.member_id
    WHERE c.done_on = ? ORDER BY c.id DESC
  `).all(day);
}

// Zeven dagen vooruit. Achterstallige taken staan op vandaag; herhalende taken
// worden doorgerekend alsof ze op hun geplande dag worden gedaan.
function weekList(start = today()) {
  const end = addDays(start, 6);
  const days = [];
  for (let i = 0; i < 7; i++) days.push({ date: addDays(start, i), tasks: [] });
  for (const t of allTasks()) {
    let d = t.next_due < start ? start : t.next_due;
    while (d <= end) {
      days[daysBetween(start, d)].tasks.push({ id: t.id, name: t.name, place: t.place, event_date: t.event_date, overdue: t.next_due < start && d === start });
      if (!t.interval_days) break;
      d = addDays(d, t.interval_days);
    }
  }
  return days;
}

function daysBetween(a, b) {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}

function complete(taskId, memberId) {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  if (!task || task.done) return null;
  const day = today();
  const r = db.prepare('INSERT INTO completions (task_id, member_id, done_on, done_at, prev_next_due) VALUES (?, ?, ?, ?, ?)')
    .run(taskId, memberId || null, day, new Date().toISOString(), task.next_due);
  if (task.interval_days) {
    // Het schema schuift op: de volgende keer telt vanaf het echte afvinken.
    db.prepare('UPDATE tasks SET next_due = ? WHERE id = ?').run(addDays(day, task.interval_days), taskId);
  } else {
    db.prepare('UPDATE tasks SET done = 1 WHERE id = ?').run(taskId);
  }
  return Number(r.lastInsertRowid);
}

function undo(completionId) {
  const c = db.prepare('SELECT * FROM completions WHERE id = ?').get(completionId);
  if (!c) return null;
  db.prepare('UPDATE tasks SET next_due = ?, done = 0 WHERE id = ?').run(c.prev_next_due, c.task_id);
  db.prepare('DELETE FROM completions WHERE id = ?').run(completionId);
  return true;
}

// Statistiek van de huidige maand: wie heeft hoeveel gedaan, en wat.
function monthStats(month = today().slice(0, 7)) {
  const from = month + '-01';
  const to = month + '-31';
  const perMember = db.prepare(`
    SELECT COALESCE(m.name, 'Onbekend') AS name, COUNT(*) AS count
    FROM completions c LEFT JOIN members m ON m.id = c.member_id
    WHERE c.done_on BETWEEN ? AND ? GROUP BY c.member_id ORDER BY count DESC
  `).all(from, to);
  const perTask = db.prepare(`
    SELECT t.name, t.place, COALESCE(m.name, 'Onbekend') AS member, COUNT(*) AS count
    FROM completions c JOIN tasks t ON t.id = c.task_id LEFT JOIN members m ON m.id = c.member_id
    WHERE c.done_on BETWEEN ? AND ? GROUP BY c.task_id, c.member_id ORDER BY t.place, t.name, count DESC
  `).all(from, to);
  return { month, total: perMember.reduce((s, r) => s + r.count, 0), perMember, perTask };
}

module.exports = { allTasks, withLast, todayList, doneToday, weekList, complete, undo, monthStats, daysBetween };

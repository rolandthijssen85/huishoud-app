// Lijsten (boodschappen, verlanglijstjes): items afstrepen, leegmaken, volgorde en suggesties.
const { db } = require('./db');

function allLists() {
  return db.prepare(`
    SELECT l.id, l.name,
      (SELECT COUNT(*) FROM list_items i WHERE i.list_id = l.id AND i.done = 0) AS open,
      (SELECT COUNT(*) FROM list_items i WHERE i.list_id = l.id AND i.done = 1) AS done
    FROM lists l ORDER BY l.position, l.id
  `).all();
}

function getList(id) {
  return db.prepare('SELECT id, name FROM lists WHERE id = ?').get(id) || null;
}

function createList(name) {
  const pos = db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM lists').get().p;
  return Number(db.prepare('INSERT INTO lists (name, position) VALUES (?, ?)').run(name, pos).lastInsertRowid);
}

function renameList(id, name) {
  return db.prepare('UPDATE lists SET name = ? WHERE id = ?').run(name, id).changes > 0;
}

function deleteList(id) {
  return db.prepare('DELETE FROM lists WHERE id = ?').run(id).changes > 0;
}

function items(listId) {
  return db.prepare('SELECT id, name, note, done FROM list_items WHERE list_id = ? ORDER BY position, id').all(listId);
}

function getItem(id) {
  return db.prepare('SELECT * FROM list_items WHERE id = ?').get(id) || null;
}

// Eerder gebruikte namen, vaakst gebruikt eerst.
function history(listId, limit = 300) {
  return db.prepare('SELECT name FROM list_history WHERE list_id = ? ORDER BY uses DESC, last_used DESC LIMIT ?')
    .all(listId, limit).map(r => r.name);
}

function remember(listId, name) {
  db.prepare(`
    INSERT INTO list_history (list_id, name, uses, last_used) VALUES (?, ?, 1, ?)
    ON CONFLICT(list_id, name) DO UPDATE SET uses = uses + 1, last_used = excluded.last_used, name = excluded.name
  `).run(listId, name, new Date().toISOString());
}

// Nieuw item onderaan. Staat het er al doorgestreept op, dan komt het terug in plaats van dubbel.
function addItem(listId, name, note = '') {
  remember(listId, name);
  const same = db.prepare('SELECT * FROM list_items WHERE list_id = ? AND name = ? COLLATE NOCASE').get(listId, name);
  if (same && !same.done) return { id: same.id, existed: true };
  const pos = db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM list_items WHERE list_id = ?').get(listId).p;
  if (same) {
    db.prepare('UPDATE list_items SET done = 0, position = ?, note = CASE WHEN ? = \'\' THEN note ELSE ? END WHERE id = ?')
      .run(pos, note, note, same.id);
    return { id: same.id, existed: false };
  }
  const r = db.prepare('INSERT INTO list_items (list_id, name, note, position) VALUES (?, ?, ?, ?)').run(listId, name, note, pos);
  return { id: Number(r.lastInsertRowid), existed: false };
}

function updateItem(id, fields) {
  const item = getItem(id);
  if (!item) return false;
  const name = fields.name ?? item.name;
  const note = fields.note ?? item.note;
  const done = fields.done === undefined ? item.done : (fields.done ? 1 : 0);
  db.prepare('UPDATE list_items SET name = ?, note = ?, done = ? WHERE id = ?').run(name, note, done, id);
  if (name !== item.name) remember(item.list_id, name);
  return true;
}

function deleteItem(id) {
  return db.prepare('DELETE FROM list_items WHERE id = ?').run(id).changes > 0;
}

// "Lijst leegmaken": alle doorgestreepte items weg.
function clearDone(listId) {
  return db.prepare('DELETE FROM list_items WHERE list_id = ? AND done = 1').run(listId).changes;
}

// Volgorde na slepen. Ids die niet bij de lijst horen worden genegeerd.
function reorder(listId, ids) {
  const set = db.prepare('UPDATE list_items SET position = ? WHERE id = ? AND list_id = ?');
  db.exec('BEGIN');
  try {
    ids.forEach((id, i) => set.run(i + 1, Number(id), listId));
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = {
  allLists, getList, createList, renameList, deleteList,
  items, getItem, history, addItem, updateItem, deleteItem, clearDone, reorder,
};

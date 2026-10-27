const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'huishouden-test-'));
const { db } = require('../db');
const lists = require('../lists');

test.beforeEach(() => db.exec('DELETE FROM lists;'));

const names = id => lists.items(id).map(i => i.name);

test('items komen onderaan in volgorde van toevoegen', () => {
  const id = lists.createList('Boodschappen');
  lists.addItem(id, 'Melk', 'halfvol');
  lists.addItem(id, 'Brood');
  assert.deepStrictEqual(names(id), ['Melk', 'Brood']);
  assert.strictEqual(lists.items(id)[0].note, 'halfvol');
});

test('afgevinkte items blijven staan tot de lijst wordt leeggemaakt', () => {
  const id = lists.createList('Boodschappen');
  const melk = lists.addItem(id, 'Melk').id;
  lists.addItem(id, 'Brood');
  lists.updateItem(melk, { done: true });
  assert.deepStrictEqual(names(id), ['Melk', 'Brood']);
  assert.strictEqual(lists.items(id)[0].done, 1);
  assert.strictEqual(lists.clearDone(id), 1);
  assert.deepStrictEqual(names(id), ['Brood']);
});

test('een item dat er al open op staat wordt niet dubbel toegevoegd', () => {
  const id = lists.createList('Boodschappen');
  lists.addItem(id, 'Melk');
  const r = lists.addItem(id, 'melk');
  assert.strictEqual(r.existed, true);
  assert.deepStrictEqual(names(id), ['Melk']);
});

test('een doorgestreept item komt terug als je het opnieuw toevoegt', () => {
  const id = lists.createList('Boodschappen');
  const melk = lists.addItem(id, 'Melk', 'halfvol').id;
  lists.addItem(id, 'Brood');
  lists.updateItem(melk, { done: true });
  const r = lists.addItem(id, 'Melk');
  assert.strictEqual(r.id, melk);
  assert.deepStrictEqual(names(id), ['Brood', 'Melk']);
  assert.deepStrictEqual(lists.items(id).map(i => i.done), [0, 0]);
  assert.strictEqual(lists.items(id)[1].note, 'halfvol');
});

test('slepen past de volgorde aan, alleen binnen de eigen lijst', () => {
  const id = lists.createList('Boodschappen');
  const other = lists.createList('Verlanglijst');
  const a = lists.addItem(id, 'A').id;
  const b = lists.addItem(id, 'B').id;
  const c = lists.addItem(id, 'C').id;
  const x = lists.addItem(other, 'X').id;
  lists.reorder(id, [c, a, b, x]);
  assert.deepStrictEqual(names(id), ['C', 'A', 'B']);
  assert.deepStrictEqual(names(other), ['X']);
});

test('suggesties: eerder gebruikte items per lijst, vaakst gebruikt eerst', () => {
  const id = lists.createList('Boodschappen');
  const other = lists.createList('Verlanglijst');
  for (const n of ['Melk', 'Brood', 'Melk', 'Kaas', 'melk']) {
    const item = lists.addItem(id, n);
    lists.updateItem(item.id, { done: true });
    lists.clearDone(id);
  }
  lists.addItem(other, 'Lego');
  assert.deepStrictEqual(lists.history(id).slice(0, 1), ['melk']);
  assert.deepStrictEqual([...lists.history(id)].sort(), ['Brood', 'Kaas', 'melk']);
  assert.deepStrictEqual(lists.history(other), ['Lego']);
});

test('lijst verwijderen haalt ook items en suggesties weg', () => {
  const id = lists.createList('Weg');
  lists.addItem(id, 'Iets');
  lists.deleteList(id);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM list_items').get().n, 0);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM list_history').get().n, 0);
});

test('overzicht telt open en afgevinkte items', () => {
  const id = lists.createList('Boodschappen');
  lists.addItem(id, 'Melk');
  lists.updateItem(lists.addItem(id, 'Brood').id, { done: true });
  assert.deepStrictEqual(lists.allLists().map(l => ({ ...l })), [{ id, name: 'Boodschappen', open: 1, done: 1 }]);
});

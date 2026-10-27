// Huishoud-app: telefoonscherm.
const view = document.getElementById('view');
const tabs = document.getElementById('tabs');
const who = document.getElementById('who');
const dialog = document.getElementById('dialog');
const toastEl = document.getElementById('toast');

let members = [];
let currentTab = 'vandaag';
let currentList = null; // id van de geopende lijst op het tabblad Lijsten
let settingsPage = null; // 'regels' = agendaregels onder Meer

// ---------- hulpjes ----------

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    method: options.method || 'GET',
    headers: options.body ? { 'Content-Type': 'application/json' } : {},
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/api/login') {
    showLogin();
    throw new Error('Niet ingelogd');
  }
  if (!res.ok) throw new Error(data.error || 'Er ging iets mis.');
  return data;
}

function me() {
  let id = null;
  try { id = Number(localStorage.getItem('memberId')); } catch {}
  return members.find(m => m.id === id) || null;
}

function setMe(id) {
  try { localStorage.setItem('memberId', String(id)); } catch {}
}

function dayLabel(iso, todayIso) {
  if (iso === todayIso) return 'Vandaag';
  const diff = Math.round((Date.parse(iso) - Date.parse(todayIso)) / 86400000);
  if (diff === 1) return 'Morgen';
  return new Date(iso + 'T12:00:00').toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' });
}

function shortDate(iso) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' });
}

function repeatText(t) {
  if (!t.interval_days) return 'eenmalig';
  if (t.interval_days === 1) return 'elke dag';
  if (t.interval_days === 7) return 'elke week';
  if (t.interval_days % 7 === 0) return `elke ${t.interval_days / 7} weken`;
  return `elke ${t.interval_days} dagen`;
}

function taskTitle(t) {
  return esc(t.name) + (t.place ? ` <span class="sub">· ${esc(t.place)}</span>` : '');
}

// Taak die bij een afspraak hoort: "Afspraak morgen", "Afspraak op zaterdag 25 oktober".
function eventTaskText(t, todayIso) {
  if (t.event_date < todayIso) return 'Afspraak bezig';
  const label = dayLabel(t.event_date, todayIso);
  return 'Afspraak ' + (label === 'Vandaag' || label === 'Morgen' ? label.toLowerCase() : 'op ' + label);
}

function eventRow(e) {
  const when = e.allDay ? 'Hele dag' : e.start ? esc(e.start) + (e.end ? `<span>${esc(e.end)}</span>` : '') : `<span>tot</span>${esc(e.end || '')}`;
  return `
    <div class="row event">
      <div class="when">${when}</div>
      <div class="main"><div class="name">${esc(e.title)}</div>${e.location ? `<div class="sub">${esc(e.location)}</div>` : ''}</div>
    </div>`;
}

let toastTimer;
function toast(text, action) {
  clearTimeout(toastTimer);
  toastEl.innerHTML = `<span>${esc(text)}</span>` + (action ? `<button class="link">${esc(action.label)}</button>` : '');
  toastEl.hidden = false;
  if (action) toastEl.querySelector('button').onclick = () => { toastEl.hidden = true; action.run(); };
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 6000);
}

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isInstalled() {
  return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

// ---------- start ----------

async function start() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  const { loggedIn } = await api('/api/session');
  if (!loggedIn) return showLogin();
  await afterLogin();
}

async function afterLogin() {
  members = await api('/api/members');
  if (members.length === 0) return showFirstMembers();
  if (!me()) return showPickMember();
  who.hidden = false;
  who.textContent = me().name;
  tabs.hidden = false;
  render();
}

function showLogin() {
  tabs.hidden = true;
  who.hidden = true;
  view.innerHTML = `
    <form id="login">
      <p>Log in met het gezinswachtwoord.</p>
      <label for="pw">Wachtwoord</label>
      <input id="pw" type="password" autocomplete="current-password" required>
      <p class="hint" id="err"></p>
      <button class="btn block" style="margin-top:16px">Inloggen</button>
    </form>`;
  view.querySelector('#login').onsubmit = async e => {
    e.preventDefault();
    try {
      await api('/api/login', { method: 'POST', body: { password: view.querySelector('#pw').value } });
      await afterLogin();
    } catch (err) {
      view.querySelector('#err').textContent = err.message;
    }
  };
}

function showFirstMembers() {
  tabs.hidden = true;
  view.innerHTML = `
    <p>Welkom! Wie horen er bij het gezin? Voeg iedereen toe die klusjes afvinkt.</p>
    <div class="card" id="list"></div>
    <form id="add" class="inline" style="margin-top:12px">
      <input id="name" placeholder="Naam" required>
      <button class="btn" style="flex:none">Toevoegen</button>
    </form>
    <button class="btn block" id="done" style="margin-top:24px" disabled>Klaar</button>`;
  const list = view.querySelector('#list');
  const drawList = () => {
    list.innerHTML = members.map(m => `<div class="row"><div class="main name">${esc(m.name)}</div></div>`).join('')
      || '<div class="row"><div class="main sub">Nog niemand toegevoegd.</div></div>';
    view.querySelector('#done').disabled = members.length === 0;
  };
  drawList();
  view.querySelector('#add').onsubmit = async e => {
    e.preventDefault();
    const input = view.querySelector('#name');
    members.push(await api('/api/members', { method: 'POST', body: { name: input.value } }));
    input.value = '';
    drawList();
  };
  view.querySelector('#done').onclick = showPickMember;
}

function showPickMember() {
  tabs.hidden = true;
  who.hidden = true;
  view.innerHTML = `
    <p>Wie gebruikt deze telefoon? Dan weet de app wie een klusje afvinkt.</p>
    <div class="members">${members.map(m => `<button class="btn secondary" data-id="${m.id}">${esc(m.name)}</button>`).join('')}</div>`;
  view.querySelectorAll('[data-id]').forEach(b => b.onclick = () => { setMe(Number(b.dataset.id)); afterLogin(); });
}

// ---------- tabbladen ----------

tabs.addEventListener('click', e => {
  const b = e.target.closest('button[data-tab]');
  if (!b) return;
  // Nog eens op Lijsten tikken brengt je terug naar het overzicht van lijsten.
  if (b.dataset.tab === 'lijsten' && currentTab === 'lijsten') currentList = null;
  if (b.dataset.tab === 'instellingen') settingsPage = null;
  currentTab = b.dataset.tab;
  tabs.querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
  render();
});

who.onclick = showPickMember;

function render() {
  const fn = { vandaag: renderToday, week: renderWeek, lijsten: renderLists, taken: renderTasks, stats: renderStats, instellingen: renderSettings }[currentTab];
  fn().catch(err => { view.innerHTML = `<p class="empty">${esc(err.message)}</p>`; });
}

async function renderToday() {
  const { today, todo, done, events } = await api('/api/overview');
  document.getElementById('title').textContent = 'Vandaag';
  const todoHtml = todo.length ? todo.map(t => `
    <div class="row">
      <div class="main">
        <div class="name">${taskTitle(t)}</div>
        ${t.event_date ? `<div class="sub">${esc(eventTaskText(t, today))}</div>` : `<div class="sub ${t.overdueDays > 0 ? 'warn' : ''}">${
          t.overdueDays > 0 ? `${t.overdueDays === 1 ? 'Sinds gisteren' : `${t.overdueDays} dagen te laat`}` : repeatText(t)
        }${t.last ? ` · laatst door ${esc(t.last.member_name || 'onbekend')} op ${shortDate(t.last.done_on)}` : ''}</div>`}
      </div>
      <button class="check" data-id="${t.id}" aria-label="Afvinken">✓</button>
    </div>`).join('') : `<div class="empty"><div class="big">🎉</div>Niets meer te doen vandaag.</div>`;
  const doneHtml = done.length ? `
    <h2>Gedaan vandaag</h2>
    <div class="card">${done.map(c => `
      <div class="row done">
        <div class="main"><div class="name">${taskTitle(c)}</div><div class="sub">door ${esc(c.member_name || 'onbekend')}</div></div>
        <button class="link" data-undo="${c.id}">Ongedaan</button>
      </div>`).join('')}</div>` : '';
  view.innerHTML = `
    <p class="sub" style="margin:0 0 12px;color:var(--muted)">${esc(new Date(today + 'T12:00:00').toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' }))}</p>
    ${events.length ? `<h2 style="margin-top:0">Agenda</h2><div class="card">${events.map(eventRow).join('')}</div><h2>Klusjes</h2>` : ''}
    <div class="card">${todoHtml}</div>${doneHtml}`;

  view.querySelectorAll('[data-id]').forEach(b => b.onclick = async () => {
    b.disabled = true;
    const r = await api(`/api/tasks/${b.dataset.id}/complete`, { method: 'POST', body: { member_id: me()?.id } });
    toast('Afgevinkt!', { label: 'Ongedaan maken', run: () => undo(r.completion_id) });
    render();
  });
  view.querySelectorAll('[data-undo]').forEach(b => b.onclick = () => undo(b.dataset.undo));
}

async function undo(id) {
  await api(`/api/completions/${id}`, { method: 'DELETE' });
  render();
}

async function renderWeek() {
  const days = await api('/api/week');
  document.getElementById('title').textContent = 'Deze week';
  const todayIso = days[0].date;
  view.innerHTML = days.map(d => `
    <div class="day">
      <h2><span>${esc(dayLabel(d.date, todayIso))}</span><span>${d.tasks.length || ''}</span></h2>
      <div class="card">${d.events.map(eventRow).join('')}${d.tasks.map(t => `
        <div class="row"><div class="main name">${taskTitle(t)}</div>${t.overdue && !t.event_date ? '<span class="tag">blijven liggen</span>' : ''}</div>`).join('')}${
        d.tasks.length || d.events.length ? '' : '<div class="row"><div class="main sub">Niets gepland</div></div>'}</div>
    </div>`).join('');
}

async function renderTasks() {
  const list = await api('/api/tasks');
  document.getElementById('title').textContent = 'Taken';
  view.innerHTML = `
    <button class="btn block" id="new">+ Nieuwe taak</button>
    <div class="card" style="margin-top:16px">${list.length ? list.map(t => `
      <div class="row" data-edit="${t.id}">
        <div class="main">
          <div class="name">${taskTitle(t)}</div>
          <div class="sub">${repeatText(t)} · volgende keer ${esc(shortDate(t.next_due))}</div>
        </div>
        <span class="sub">›</span>
      </div>`).join('') : '<div class="empty">Nog geen taken. Voeg je eerste klusje toe.</div>'}</div>`;
  view.querySelector('#new').onclick = () => editTask(null);
  view.querySelectorAll('[data-edit]').forEach(r => r.onclick = () => editTask(list.find(t => t.id === Number(r.dataset.edit))));
}

function editTask(task) {
  const t = task || { name: '', place: '', interval_days: 7, next_due: new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Amsterdam' }) };
  const oneOff = !t.interval_days;
  dialog.innerHTML = `
    <form method="dialog" id="taskform">
      <h1 style="font-size:20px">${task ? 'Taak wijzigen' : 'Nieuwe taak'}</h1>
      <label for="t-name">Wat moet er gebeuren?</label>
      <input id="t-name" value="${esc(t.name)}" placeholder="Bijv. ramen wassen" required>
      <label for="t-place">Waar? (optioneel)</label>
      <input id="t-place" value="${esc(t.place)}" placeholder="Bijv. woonkamer">
      <label for="t-kind">Hoe vaak?</label>
      <select id="t-kind">
        <option value="repeat" ${oneOff ? '' : 'selected'}>Herhalen</option>
        <option value="once" ${oneOff ? 'selected' : ''}>Eenmalig klusje</option>
      </select>
      <div id="repeat" ${oneOff ? 'hidden' : ''}>
        <label for="t-int">Elke hoeveel dagen?</label>
        <input id="t-int" type="number" min="1" max="3650" inputmode="numeric" value="${t.interval_days || 7}">
        <p class="hint">Wordt een taak later gedaan, dan telt de volgende keer vanaf dat moment.</p>
      </div>
      <label for="t-due">${task ? 'Volgende keer' : 'Eerste keer'}</label>
      <input id="t-due" type="date" value="${esc(t.next_due)}" required>
      <p class="hint" id="t-err"></p>
      <div class="actions">
        <button type="button" class="btn secondary" id="t-cancel">Annuleren</button>
        <button class="btn" id="t-save">Opslaan</button>
      </div>
      ${task ? `
      <div class="actions">
        <button type="button" class="btn secondary" id="t-donenow">Nu gedaan</button>
        <button type="button" class="btn danger" id="t-delete">Verwijderen</button>
      </div>` : ''}
    </form>`;
  const $ = s => dialog.querySelector(s);
  $('#t-kind').onchange = () => { $('#repeat').hidden = $('#t-kind').value === 'once'; };
  $('#t-cancel').onclick = () => dialog.close();
  $('#taskform').onsubmit = async e => {
    e.preventDefault();
    const body = {
      name: $('#t-name').value,
      place: $('#t-place').value,
      interval_days: $('#t-kind').value === 'once' ? null : Number($('#t-int').value),
      next_due: $('#t-due').value,
    };
    try {
      await api(task ? `/api/tasks/${task.id}` : '/api/tasks', { method: task ? 'PUT' : 'POST', body });
      dialog.close();
      render();
    } catch (err) {
      $('#t-err').textContent = err.message;
    }
  };
  if (task) {
    $('#t-donenow').onclick = async () => {
      await api(`/api/tasks/${task.id}/complete`, { method: 'POST', body: { member_id: me()?.id } });
      dialog.close();
      toast('Afgevinkt!');
      render();
    };
    $('#t-delete').onclick = async () => {
      if ($('#t-delete').dataset.sure !== '1') {
        $('#t-delete').dataset.sure = '1';
        $('#t-delete').textContent = 'Zeker weten?';
        return;
      }
      await api(`/api/tasks/${task.id}`, { method: 'DELETE' });
      dialog.close();
      render();
    };
  }
  dialog.showModal();
}

// ---------- lijsten ----------

async function renderLists() {
  if (currentList) return renderList(currentList);
  const all = await api('/api/lists');
  document.getElementById('title').textContent = 'Lijsten';
  view.innerHTML = `
    <button class="btn block" id="new">+ Nieuwe lijst</button>
    <div class="card" style="margin-top:16px">${all.length ? all.map(l => `
      <div class="row" data-open="${l.id}">
        <div class="main">
          <div class="name">${esc(l.name)}</div>
          <div class="sub">${l.open ? `${l.open} te doen` : 'Leeg'}${l.done ? ` · ${l.done} afgestreept` : ''}</div>
        </div>
        <span class="sub">›</span>
      </div>`).join('') : '<div class="empty">Nog geen lijsten. Maak er een, bijvoorbeeld <em>Boodschappen</em> of <em>Verlanglijst</em>.</div>'}</div>`;
  view.querySelector('#new').onclick = () => editList(null);
  view.querySelectorAll('[data-open]').forEach(r => r.onclick = () => { currentList = Number(r.dataset.open); render(); });
}

function editList(list) {
  dialog.innerHTML = `
    <form method="dialog" id="listform">
      <h1 style="font-size:20px">${list ? 'Lijst wijzigen' : 'Nieuwe lijst'}</h1>
      <label for="l-name">Naam</label>
      <input id="l-name" value="${esc(list?.name || '')}" placeholder="Bijv. Boodschappen" maxlength="80" required>
      <p class="hint" id="l-err"></p>
      <div class="actions">
        <button type="button" class="btn secondary" id="l-cancel">Annuleren</button>
        <button class="btn">Opslaan</button>
      </div>
      ${list ? '<div class="actions"><button type="button" class="btn danger" id="l-delete">Lijst verwijderen</button></div>' : ''}
    </form>`;
  const $ = s => dialog.querySelector(s);
  $('#l-cancel').onclick = () => dialog.close();
  $('#listform').onsubmit = async e => {
    e.preventDefault();
    try {
      const body = { name: $('#l-name').value };
      if (list) await api(`/api/lists/${list.id}`, { method: 'PUT', body });
      else currentList = (await api('/api/lists', { method: 'POST', body })).id;
      dialog.close();
      render();
    } catch (err) {
      $('#l-err').textContent = err.message;
    }
  };
  if (list) {
    $('#l-delete').onclick = async () => {
      if ($('#l-delete').dataset.sure !== '1') {
        $('#l-delete').dataset.sure = '1';
        $('#l-delete').textContent = 'Zeker weten? Alles op de lijst gaat weg.';
        return;
      }
      await api(`/api/lists/${list.id}`, { method: 'DELETE' });
      currentList = null;
      dialog.close();
      render();
    };
  }
  dialog.showModal();
  if (!list) $('#l-name').focus();
}

async function renderList(id) {
  let list;
  try {
    list = await api(`/api/lists/${id}`);
  } catch (err) {
    currentList = null; // bijv. door iemand anders verwijderd
    return renderLists();
  }
  document.getElementById('title').textContent = list.name;
  view.innerHTML = `
    <div class="listbar">
      <button class="link" id="back">‹ Lijsten</button>
      <button class="link" id="edit">Wijzigen</button>
    </div>
    <form id="additem" autocomplete="off">
      <div class="inline">
        <input id="i-name" placeholder="Toevoegen…" maxlength="200" enterkeyhint="done" autocapitalize="sentences">
        <button class="btn" style="flex:none;font-size:22px;padding:8px 18px" aria-label="Toevoegen">+</button>
      </div>
      <input id="i-note" placeholder="Notitie (optioneel)" maxlength="500" style="margin-top:8px" hidden>
      <div class="suggest" id="suggest"></div>
      <button type="button" class="link" id="addnote">+ notitie</button>
    </form>
    <div class="card" id="items" style="margin-top:12px"></div>
    <button class="btn secondary block" id="clear" style="margin-top:16px" hidden></button>`;
  const $ = s => view.querySelector(s);
  const nameInput = $('#i-name');
  const noteInput = $('#i-note');
  const itemsEl = $('#items');
  const suggestEl = $('#suggest');

  const drawItems = () => {
    itemsEl.innerHTML = list.items.length ? list.items.map(i => `
      <div class="row item ${i.done ? 'done' : ''}" data-item="${i.id}">
        <button class="tick" data-tick="${i.id}" aria-label="${i.done ? 'Terugzetten' : 'Afstrepen'}">${i.done ? '✓' : ''}</button>
        <div class="main" data-edititem="${i.id}">
          <div class="name">${esc(i.name)}</div>
          ${i.note ? `<div class="sub">${esc(i.note)}</div>` : ''}
        </div>
        <span class="handle" aria-label="Verslepen">≡</span>
      </div>`).join('') : '<div class="empty">De lijst is leeg.</div>';
    const done = list.items.filter(i => i.done).length;
    $('#clear').hidden = !done;
    $('#clear').textContent = `Lijst leegmaken (${done} afgestreept)`;
  };

  const reload = async () => {
    const fresh = await api(`/api/lists/${id}`);
    list.items = fresh.items;
    list.history = fresh.history;
    drawItems();
  };

  // Suggesties: eerder gebruikte items die nu niet open op de lijst staan.
  const drawSuggest = () => {
    const q = nameInput.value.trim().toLowerCase();
    if (!q) { suggestEl.innerHTML = ''; return; }
    const open = new Set(list.items.filter(i => !i.done).map(i => i.name.toLowerCase()));
    const pool = list.history.filter(n => !open.has(n.toLowerCase()) && n.toLowerCase() !== q);
    const hits = [...pool.filter(n => n.toLowerCase().startsWith(q)), ...pool.filter(n => !n.toLowerCase().startsWith(q) && n.toLowerCase().includes(q))].slice(0, 6);
    suggestEl.innerHTML = hits.map(n => `<button type="button" class="chip" data-suggest="${esc(n)}">${esc(n)}</button>`).join('');
  };

  const add = async name => {
    name = name.trim();
    if (!name) return;
    const r = await api(`/api/lists/${id}/items`, { method: 'POST', body: { name, note: noteInput.value } });
    if (r.existed) toast(`${name} staat er al op.`);
    nameInput.value = '';
    noteInput.value = '';
    noteInput.hidden = true;
    $('#addnote').hidden = false;
    suggestEl.innerHTML = '';
    await reload();
    nameInput.focus();
  };

  drawItems();
  $('#back').onclick = () => { currentList = null; render(); };
  $('#edit').onclick = () => editList(list);
  $('#addnote').onclick = () => { noteInput.hidden = false; $('#addnote').hidden = true; noteInput.focus(); };
  nameInput.oninput = drawSuggest;
  $('#additem').onsubmit = e => { e.preventDefault(); add(nameInput.value).catch(err => toast(err.message)); };
  // pointerdown zodat het toetsenbord open blijft bij een tik op een suggestie.
  suggestEl.addEventListener('pointerdown', e => {
    const b = e.target.closest('[data-suggest]');
    if (!b) return;
    e.preventDefault();
    add(b.dataset.suggest).catch(err => toast(err.message));
  });

  itemsEl.addEventListener('click', async e => {
    const tick = e.target.closest('[data-tick]');
    if (tick) {
      const item = list.items.find(i => i.id === Number(tick.dataset.tick));
      item.done = item.done ? 0 : 1;
      drawItems();
      await api(`/api/items/${item.id}`, { method: 'PUT', body: { done: !!item.done } }).catch(err => toast(err.message));
      return;
    }
    const ed = e.target.closest('[data-edititem]');
    if (ed) editItem(list.items.find(i => i.id === Number(ed.dataset.edititem)), reload);
  });

  $('#clear').onclick = async () => {
    await api(`/api/lists/${id}/clear`, { method: 'POST' });
    await reload();
  };

  enableDrag(itemsEl, async ids => {
    list.items.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
    await api(`/api/lists/${id}/order`, { method: 'POST', body: { ids } }).catch(err => toast(err.message));
  });
}

function editItem(item, after) {
  dialog.innerHTML = `
    <form method="dialog" id="itemform">
      <h1 style="font-size:20px">Wijzigen</h1>
      <label for="e-name">Wat</label>
      <input id="e-name" value="${esc(item.name)}" maxlength="200" required>
      <label for="e-note">Notitie</label>
      <input id="e-note" value="${esc(item.note)}" maxlength="500" placeholder="Bijv. halfvol, merk, maat">
      <p class="hint" id="e-err"></p>
      <div class="actions">
        <button type="button" class="btn secondary" id="e-cancel">Annuleren</button>
        <button class="btn">Opslaan</button>
      </div>
      <div class="actions"><button type="button" class="btn danger" id="e-delete">Verwijderen</button></div>
    </form>`;
  const $ = s => dialog.querySelector(s);
  $('#e-cancel').onclick = () => dialog.close();
  $('#itemform').onsubmit = async e => {
    e.preventDefault();
    try {
      await api(`/api/items/${item.id}`, { method: 'PUT', body: { name: $('#e-name').value, note: $('#e-note').value } });
      dialog.close();
      after();
    } catch (err) {
      $('#e-err').textContent = err.message;
    }
  };
  $('#e-delete').onclick = async () => {
    await api(`/api/items/${item.id}`, { method: 'DELETE' });
    dialog.close();
    after();
  };
  dialog.showModal();
}

// Verslepen aan het ≡-handvat; werkt met vinger en muis. Geeft de nieuwe volgorde van ids terug.
function enableDrag(container, onDrop) {
  container.addEventListener('pointerdown', e => {
    const handle = e.target.closest('.handle');
    if (!handle) return;
    e.preventDefault();
    const row = handle.closest('[data-item]');
    const startY = e.clientY;
    let offset = 0;
    row.classList.add('dragging');
    handle.setPointerCapture(e.pointerId);

    const move = ev => {
      row.style.transform = `translateY(${ev.clientY - startY - offset}px)`;
      const prev = row.previousElementSibling;
      const next = row.nextElementSibling;
      const r = row.getBoundingClientRect();
      const mid = r.top + r.height / 2;
      if (prev && mid < prev.getBoundingClientRect().top + prev.offsetHeight / 2) {
        offset -= prev.offsetHeight;
        container.insertBefore(row, prev);
        row.style.transform = `translateY(${ev.clientY - startY - offset}px)`;
      } else if (next && mid > next.getBoundingClientRect().top + next.offsetHeight / 2) {
        offset += next.offsetHeight;
        container.insertBefore(next, row);
        row.style.transform = `translateY(${ev.clientY - startY - offset}px)`;
      }
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      row.classList.remove('dragging');
      row.style.transform = '';
      onDrop([...container.querySelectorAll('[data-item]')].map(r => Number(r.dataset.item)));
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  });
}

async function renderStats() {
  const s = await api('/api/stats');
  const monthName = new Date(s.month + '-15T12:00:00').toLocaleDateString('nl-NL', { month: 'long', year: 'numeric' });
  document.getElementById('title').textContent = 'Statistiek';
  const max = Math.max(1, ...s.perMember.map(m => m.count));
  // Taken groeperen: per taak een regel met wie hoe vaak.
  const perTask = {};
  for (const r of s.perTask) {
    const key = r.name + '|' + r.place;
    (perTask[key] ||= { name: r.name, place: r.place, by: [] }).by.push(`${r.member} ${r.count}×`);
  }
  view.innerHTML = `
    <p style="margin:0 0 4px;color:var(--muted)">${esc(monthName)} · ${s.total} ${s.total === 1 ? "klusje" : "klusjes"} gedaan</p>
    <h2>Wie deed wat</h2>
    <div class="card">${s.perMember.length ? s.perMember.map(m => `
      <div class="row">
        <div style="width:90px" class="name">${esc(m.name)}</div>
        <div class="barwrap"><div class="bar" style="width:${(m.count / max) * 100}%"></div></div>
        <div style="width:28px;text-align:right">${m.count}</div>
      </div>`).join('') : '<div class="empty">Deze maand is er nog niets afgevinkt.</div>'}</div>
    ${Object.keys(perTask).length ? `
    <h2>Per taak</h2>
    <div class="card">${Object.values(perTask).map(t => `
      <div class="row"><div class="main"><div class="name">${taskTitle(t)}</div><div class="sub">${esc(t.by.join(', '))}</div></div></div>`).join('')}</div>` : ''}`;
}

async function renderSettings() {
  if (settingsPage === 'regels') return renderRules();
  document.getElementById('title').textContent = 'Meer';
  const cal = await api('/api/calendar');
  const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  let subscribed = false;
  if (pushSupported) {
    const reg = await navigator.serviceWorker.ready;
    subscribed = !!(await reg.pushManager.getSubscription());
  }
  let pushHtml;
  if (isIos() && !isInstalled()) {
    pushHtml = `<div class="notice">
      <p><strong>Eerst op je beginscherm zetten</strong></p>
      <p>Op een iPhone werken meldingen alleen als de app op je beginscherm staat. Tik in Safari onderaan op het deel-icoon (vierkantje met pijl) en kies <em>Zet op beginscherm</em>. Open daarna de app vanaf je beginscherm en kom hier terug.</p>
    </div>`;
  } else if (!pushSupported) {
    pushHtml = `<p class="hint">Deze browser ondersteunt geen meldingen.</p>`;
  } else if (subscribed) {
    pushHtml = `<p>Meldingen staan aan. Je krijgt elke ochtend om 8:00 de klusjes en afspraken van die dag.</p>
      <div class="inline"><button class="btn secondary" id="push-test">Stuur testmelding</button><button class="btn danger" id="push-off">Uitzetten</button></div>`;
  } else {
    pushHtml = `<p>Krijg elke ochtend om 8:00 een melding met de klusjes en afspraken van die dag.</p>
      <button class="btn block" id="push-on">Meldingen aanzetten</button>
      ${Notification.permission === 'denied' ? '<p class="hint">Meldingen zijn geblokkeerd. Zet ze aan in de instellingen van je telefoon.</p>' : ''}`;
  }

  view.innerHTML = `
    <h2>Meldingen op deze telefoon</h2>
    ${pushHtml}
    <h2>Agenda</h2>
    ${calendarHtml(cal)}
    <h2>Deze telefoon is van</h2>
    <button class="btn secondary block" id="switch">${esc(me()?.name || '')} · wisselen</button>
    <h2>Gezinsleden</h2>
    <div class="card">${members.map(m => `
      <div class="row"><div class="main name">${esc(m.name)}</div><button class="link" data-remove="${m.id}">Verwijderen</button></div>`).join('')}</div>
    <form id="add" class="inline" style="margin-top:12px">
      <input id="name" placeholder="Naam" required>
      <button class="btn" style="flex:none">Toevoegen</button>
    </form>
    <h2>Account</h2>
    <button class="btn danger block" id="logout">Uitloggen</button>`;

  const $ = s => view.querySelector(s);
  $('#switch').onclick = showPickMember;
  bindCalendar($);
  $('#push-on') && ($('#push-on').onclick = enablePush);
  $('#push-off') && ($('#push-off').onclick = disablePush);
  $('#push-test') && ($('#push-test').onclick = async () => {
    const r = await api('/api/push/test', { method: 'POST' });
    toast(`Testmelding verstuurd naar ${r.sent} telefoon${r.sent === 1 ? '' : 's'}.`);
  });
  view.querySelectorAll('[data-remove]').forEach(b => b.onclick = async () => {
    if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'Zeker weten?'; return; }
    await api(`/api/members/${b.dataset.remove}`, { method: 'DELETE' });
    members = await api('/api/members');
    if (!me()) return members.length ? showPickMember() : showFirstMembers();
    render();
  });
  $('#add').onsubmit = async e => {
    e.preventDefault();
    await api('/api/members', { method: 'POST', body: { name: $('#name').value } });
    members = await api('/api/members');
    render();
  };
  $('#logout').onclick = async () => {
    await api('/api/logout', { method: 'POST' });
    showLogin();
  };
}

// ---------- agenda ----------

function syncedText(cal) {
  if (!cal.synced_at) return '';
  const d = new Date(cal.synced_at);
  return `Bijgewerkt ${d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })} om ${d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}`;
}

function calendarHtml(cal) {
  if (!cal.linked) {
    return `
      <p>Koppel jullie gedeelde Outlook-agenda, dan staan de afspraken op Vandaag en Week en in de melding van 8:00.</p>
      <details class="notice">
        <summary><strong>Zo vind je de link</strong></summary>
        <ol>
          <li>Ga op een computer naar <em>outlook.live.com</em> en log in als eigenaar van de agenda.</li>
          <li>Kies <em>Instellingen</em> (tandwiel) → <em>Agenda</em> → <em>Gedeelde agenda's</em>.</li>
          <li>Kies bij <em>Een agenda publiceren</em> de gedeelde agenda en <em>Kan alle details weergeven</em>, en klik op <em>Publiceren</em>.</li>
          <li>Kopieer de <strong>ICS</strong>-link (eindigt op <em>.ics</em>) en plak hem hieronder.</li>
        </ol>
      </details>
      <form id="cal-form" style="margin-top:12px">
        <input id="cal-url" type="url" placeholder="https://outlook.live.com/owa/calendar/…/calendar.ics" required autocomplete="off">
        <p class="hint" id="cal-err"></p>
        <button class="btn block" id="cal-save" style="margin-top:8px">Agenda koppelen</button>
      </form>
      <p class="hint">Iedereen met deze link kan de agenda inzien. De link blijft op de server en is in de app niet meer te zien.</p>`;
  }
  return `
    <div class="card">
      <div class="row"><div class="main">
        <div class="name">Gekoppeld</div>
        <div class="sub">${esc(cal.host)} · ${cal.count} ${cal.count === 1 ? 'afspraak' : 'afspraken'} deze week</div>
        <div class="sub">${esc(syncedText(cal))}</div>
        ${cal.error ? `<div class="sub warn">Laatste keer bijwerken mislukt: ${esc(cal.error)}</div>` : ''}
      </div></div>
      <div class="row" id="cal-rules" style="cursor:pointer">
        <div class="main"><div class="name">Regels voor afspraken</div><div class="sub">Automatisch taken en lijsten bij afspraken</div></div>
        <span class="sub">›</span>
      </div>
    </div>
    <div class="inline" style="margin-top:12px">
      <button class="btn secondary" id="cal-sync">Nu bijwerken</button>
      <button class="btn danger" id="cal-off">Ontkoppelen</button>
    </div>`;
}

function bindCalendar($) {
  if ($('#cal-form')) {
    $('#cal-form').onsubmit = async e => {
      e.preventDefault();
      $('#cal-save').disabled = true;
      $('#cal-save').textContent = 'Agenda ophalen…';
      try {
        await api('/api/calendar', { method: 'PUT', body: { url: $('#cal-url').value } });
        toast('Agenda gekoppeld.');
        render();
      } catch (err) {
        $('#cal-err').textContent = err.message;
        $('#cal-save').disabled = false;
        $('#cal-save').textContent = 'Agenda koppelen';
      }
    };
    return;
  }
  $('#cal-rules').onclick = () => { settingsPage = 'regels'; render(); };
  $('#cal-sync').onclick = async () => {
    $('#cal-sync').disabled = true;
    const r = await api('/api/calendar/sync', { method: 'POST' });
    toast(r.error ? 'Bijwerken lukte niet.' : 'Agenda bijgewerkt.');
    render();
  };
  $('#cal-off').onclick = async () => {
    const b = $('#cal-off');
    if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'Zeker weten?'; return; }
    await api('/api/calendar', { method: 'DELETE' });
    render();
  };
}

function ruleText(r) {
  const when = r.days_before === 0 ? 'op de dag zelf' : r.days_before === 1 ? '1 dag van tevoren' : `${r.days_before} dagen van tevoren`;
  const parts = [];
  if (r.task_name) parts.push(`taak “${r.task_name}”, ${when}`);
  if (r.list_mode === 'new') parts.push(`nieuwe lijst${r.list_name ? ` “${r.list_name}”` : ''}`);
  if (r.list_mode === 'existing') parts.push(`items op ${r.list_target_name ? `“${r.list_target_name}”` : 'een verwijderde lijst'}`);
  return parts.join(' · ');
}

async function renderRules() {
  const rules = await api('/api/calendar/rules');
  document.getElementById('title').textContent = 'Agendaregels';
  view.innerHTML = `
    <div class="listbar"><button class="link" id="back">‹ Meer</button></div>
    <p style="margin-top:0">Staat het woord in de titel van een afspraak, dan maakt de app automatisch een taak, een lijst, of beide. Wordt de afspraak verplaatst of verwijderd, dan schuift de taak mee of verdwijnt hij. Na de afspraak verdwijnt een taak die niet is gedaan.</p>
    <button class="btn block" id="new">+ Nieuwe regel</button>
    <div class="card" style="margin-top:16px">${rules.length ? rules.map(r => `
      <div class="row" data-edit="${r.id}">
        <div class="main"><div class="name">“${esc(r.keyword)}”</div><div class="sub">${esc(ruleText(r))}</div></div>
        <span class="sub">›</span>
      </div>`).join('') : '<div class="empty">Nog geen regels. Bijvoorbeeld: <em>verjaardag</em> → taak <em>cadeau kopen</em>, een week van tevoren.</div>'}</div>`;
  view.querySelector('#back').onclick = () => { settingsPage = null; render(); };
  view.querySelector('#new').onclick = () => editRule(null);
  view.querySelectorAll('[data-edit]').forEach(r => r.onclick = () => editRule(rules.find(x => x.id === Number(r.dataset.edit))));
}

async function editRule(rule) {
  const all = await api('/api/lists');
  const r = rule || { keyword: '', task_name: '', days_before: 0, list_mode: 'none', list_id: null, list_name: '', list_items: '' };
  dialog.innerHTML = `
    <form method="dialog" id="ruleform">
      <h1 style="font-size:20px">${rule ? 'Regel wijzigen' : 'Nieuwe regel'}</h1>
      <label for="r-kw">Afspraken met dit woord in de titel</label>
      <input id="r-kw" value="${esc(r.keyword)}" placeholder="Bijv. verjaardag" maxlength="80" required>
      <p class="hint">Hoofdletters maken niet uit. “gym” vindt ook “Gym Sanne”.</p>
      <label for="r-task">Taak (optioneel)</label>
      <input id="r-task" value="${esc(r.task_name)}" placeholder="Bijv. cadeau kopen" maxlength="200">
      <label for="r-days">Wanneer moet de taak op de lijst staan?</label>
      <div class="inline" style="align-items:center">
        <input id="r-days" type="number" min="0" max="60" inputmode="numeric" value="${r.days_before}" style="flex:none;width:90px">
        <span>dagen voor de afspraak</span>
      </div>
      <p class="hint">0 = op de dag zelf, 1 = de dag ervoor.</p>
      <label for="r-mode">Lijst</label>
      <select id="r-mode">
        <option value="none" ${r.list_mode === 'none' ? 'selected' : ''}>Geen lijst</option>
        <option value="new" ${r.list_mode === 'new' ? 'selected' : ''}>Nieuwe lijst maken</option>
        <option value="existing" ${r.list_mode === 'existing' ? 'selected' : ''} ${all.length ? '' : 'disabled'}>Items op een bestaande lijst zetten</option>
      </select>
      <div id="r-new" ${r.list_mode === 'new' ? '' : 'hidden'}>
        <label for="r-lname">Naam van de nieuwe lijst</label>
        <input id="r-lname" value="${esc(r.list_name)}" placeholder="Leeg = titel van de afspraak" maxlength="80">
      </div>
      <div id="r-existing" ${r.list_mode === 'existing' ? '' : 'hidden'}>
        <label for="r-list">Welke lijst?</label>
        <select id="r-list">${all.map(l => `<option value="${l.id}" ${l.id === r.list_id ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select>
      </div>
      <div id="r-items" ${r.list_mode === 'none' ? 'hidden' : ''}>
        <label for="r-itemlist">Items (één per regel)</label>
        <textarea id="r-itemlist" rows="4" placeholder="Bijv. inpakpapier&#10;kaart">${esc(r.list_items)}</textarea>
      </div>
      <p class="hint">De lijst wordt gemaakt op het moment dat de taak verschijnt, en blijft staan tot je hem zelf verwijdert.</p>
      <p class="hint" id="r-err"></p>
      <div class="actions">
        <button type="button" class="btn secondary" id="r-cancel">Annuleren</button>
        <button class="btn">Opslaan</button>
      </div>
      ${rule ? '<div class="actions"><button type="button" class="btn danger" id="r-delete">Regel verwijderen</button></div>' : ''}
    </form>`;
  const $ = s => dialog.querySelector(s);
  $('#r-mode').onchange = () => {
    const m = $('#r-mode').value;
    $('#r-new').hidden = m !== 'new';
    $('#r-existing').hidden = m !== 'existing';
    $('#r-items').hidden = m === 'none';
  };
  $('#r-cancel').onclick = () => dialog.close();
  $('#ruleform').onsubmit = async e => {
    e.preventDefault();
    const body = {
      keyword: $('#r-kw').value,
      task_name: $('#r-task').value,
      days_before: Number($('#r-days').value),
      list_mode: $('#r-mode').value,
      list_id: Number($('#r-list')?.value) || null,
      list_name: $('#r-lname').value,
      list_items: $('#r-itemlist').value,
    };
    try {
      await api(rule ? `/api/calendar/rules/${rule.id}` : '/api/calendar/rules', { method: rule ? 'PUT' : 'POST', body });
      dialog.close();
      render();
    } catch (err) {
      $('#r-err').textContent = err.message;
    }
  };
  if (rule) {
    $('#r-delete').onclick = async () => {
      if ($('#r-delete').dataset.sure !== '1') {
        $('#r-delete').dataset.sure = '1';
        $('#r-delete').textContent = 'Zeker weten? Open taken van deze regel gaan ook weg.';
        return;
      }
      await api(`/api/calendar/rules/${rule.id}`, { method: 'DELETE' });
      dialog.close();
      render();
    };
  }
  dialog.showModal();
}

function urlBase64ToUint8Array(base64) {
  const padded = (base64 + '='.repeat((4 - base64.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
}

async function enablePush() {
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return toast('Meldingen zijn niet toegestaan.');
    const reg = await navigator.serviceWorker.ready;
    const { key } = await api('/api/push/key');
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) });
    await api('/api/push/subscribe', { method: 'POST', body: sub.toJSON() });
    toast('Meldingen staan aan.');
  } catch (err) {
    toast('Meldingen aanzetten lukte niet: ' + err.message);
  }
  render();
}

async function disablePush() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    await api('/api/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } });
    await sub.unsubscribe();
  }
  render();
}

// Terug naar de app (bijv. na een melding): lijst verversen.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !tabs.hidden && !dialog.open) render();
});

start();

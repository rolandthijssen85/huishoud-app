// Pushmeldingen: elke ochtend om 8:00 de afspraken en takenlijst van vandaag naar alle telefoons.
const webpush = require('web-push');
const { db, getSetting, setSetting, nowParts } = require('./db');
const { todayList } = require('./tasks');
const calendar = require('./calendar');

const SEND_HOUR = 8;
// Start de server later op de dag opnieuw, dan wordt een gemiste melding nog
// verstuurd, maar 's avonds niet meer.
const LAST_CATCH_UP_HOUR = 21;

function vapidKeys() {
  let keys = getSetting('vapid');
  if (!keys) {
    keys = JSON.stringify(webpush.generateVAPIDKeys());
    setSetting('vapid', keys);
  }
  return JSON.parse(keys);
}

function init() {
  const keys = vapidKeys();
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:huishouden@example.com', keys.publicKey, keys.privateKey);
  setInterval(tick, 60 * 1000);
  tick();
}

function publicKey() {
  return vapidKeys().publicKey;
}

function saveSubscription(sub) {
  db.prepare('INSERT INTO subscriptions (endpoint, data) VALUES (?, ?) ON CONFLICT(endpoint) DO UPDATE SET data = excluded.data')
    .run(sub.endpoint, JSON.stringify(sub));
}

function removeSubscription(endpoint) {
  db.prepare('DELETE FROM subscriptions WHERE endpoint = ?').run(endpoint);
}

function listText(names, max) {
  return names.slice(0, max).join(', ') + (names.length > max ? ` en nog ${names.length - max}` : '');
}

// Afspraken eerst (met tijd), dan de klusjes op een eigen regel.
function dailyMessage(tasks, events = []) {
  const taskCount = tasks.length === 1 ? '1 klusje' : `${tasks.length} klusjes`;
  const eventCount = events.length === 1 ? '1 afspraak' : `${events.length} afspraken`;
  let title;
  if (!events.length) title = `${taskCount} voor vandaag`;
  else if (!tasks.length) title = `${eventCount} vandaag`;
  else title = `${taskCount} en ${eventCount} vandaag`;
  const eventNames = events.map(e => (e.start ? `${e.start} ${e.title}` : e.title));
  const taskNames = tasks.map(t => (t.place ? `${t.name} (${t.place})` : t.name));
  return {
    title,
    body: [events.length && listText(eventNames, 4), tasks.length && listText(taskNames, 6)].filter(Boolean).join('\n'),
  };
}

async function sendToAll(message) {
  const subs = db.prepare('SELECT * FROM subscriptions').all();
  let sent = 0;
  await Promise.all(subs.map(async s => {
    try {
      await webpush.sendNotification(JSON.parse(s.data), JSON.stringify(message), { TTL: 12 * 3600 });
      sent++;
    } catch (err) {
      // 404/410: de telefoon heeft de melding uitgezet of de app verwijderd.
      if (err.statusCode === 404 || err.statusCode === 410) removeSubscription(s.endpoint);
      else console.error('Pushmelding mislukt:', err.statusCode || err.message);
    }
  }));
  return { sent, total: subs.length };
}

async function tick() {
  const { date, hour } = nowParts();
  if (hour < SEND_HOUR || hour > LAST_CATCH_UP_HOUR) return;
  if (getSetting('last_daily_push') === date) return;
  setSetting('last_daily_push', date);
  const tasks = todayList(date);
  const events = calendar.eventsOn(date);
  if (tasks.length === 0 && events.length === 0) return; // lege dag: geen melding
  const result = await sendToAll(dailyMessage(tasks, events));
  console.log(`Ochtendmelding ${date}: ${tasks.length} taken, ${events.length} afspraken, ${result.sent}/${result.total} telefoons`);
}

module.exports = { init, publicKey, saveSubscription, removeSubscription, sendToAll, dailyMessage };

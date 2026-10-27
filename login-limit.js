// Bescherming tegen wachtwoorden raden. Per adres: na 5 foute pogingen een
// kwartier wachten. Voor iedereen samen: hooguit 50 foute pogingen per uur,
// zodat ook iemand met steeds een ander adres niet ver komt. Wie al
// ingelogd is, merkt hier niets van.
const PER_CLIENT = { max: 5, windowMs: 15 * 60_000 };
const OVERALL = { max: 50, windowMs: 60 * 60_000 };

function createLimiter(now = () => Date.now()) {
  const failures = new Map(); // adres -> tijdstippen van foute pogingen
  let overall = [];

  const recent = (times, windowMs) => times.filter(t => t > now() - windowMs);

  // Hoeveel seconden iemand nog moet wachten (0 = mag proberen).
  function waitSeconds(client) {
    const mine = recent(failures.get(client) || [], PER_CLIENT.windowMs);
    overall = recent(overall, OVERALL.windowMs);
    let until = 0;
    if (mine.length >= PER_CLIENT.max) until = Math.max(until, mine[mine.length - PER_CLIENT.max] + PER_CLIENT.windowMs);
    if (overall.length >= OVERALL.max) until = Math.max(until, overall[overall.length - OVERALL.max] + OVERALL.windowMs);
    return until ? Math.max(1, Math.ceil((until - now()) / 1000)) : 0;
  }

  function failed(client) {
    const mine = recent(failures.get(client) || [], PER_CLIENT.windowMs);
    mine.push(now());
    failures.set(client, mine);
    overall.push(now());
    if (failures.size > 10_000) {
      for (const [key, times] of failures) if (!recent(times, PER_CLIENT.windowMs).length) failures.delete(key);
    }
  }

  function succeeded(client) {
    failures.delete(client);
  }

  return { waitSeconds, failed, succeeded };
}

// Achter Tailscale Funnel komt alles binnen via de proxy; die zet het echte
// adres in X-Forwarded-For. Dat kopje is te vervalsen, daarom is er ook de
// limiet voor iedereen samen.
function clientAddress(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket.remoteAddress || 'onbekend';
}

module.exports = { createLimiter, clientAddress, PER_CLIENT, OVERALL };

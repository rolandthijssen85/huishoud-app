const test = require('node:test');
const assert = require('node:assert');
const { createLimiter, clientAddress, PER_CLIENT, OVERALL } = require('../login-limit');

function clock() {
  let t = 1_000_000;
  return { now: () => t, advance: ms => { t += ms; } };
}

test('na 5 foute pogingen moet hetzelfde adres een kwartier wachten', () => {
  const c = clock();
  const limit = createLimiter(c.now);
  for (let i = 0; i < PER_CLIENT.max - 1; i++) limit.failed('a');
  assert.strictEqual(limit.waitSeconds('a'), 0);
  limit.failed('a');
  assert.strictEqual(limit.waitSeconds('a'), 15 * 60);
  assert.strictEqual(limit.waitSeconds('b'), 0);
  c.advance(PER_CLIENT.windowMs);
  assert.strictEqual(limit.waitSeconds('a'), 0);
});

test('goed inloggen wist de foute pogingen van dat adres', () => {
  const limit = createLimiter(clock().now);
  for (let i = 0; i < PER_CLIENT.max - 1; i++) limit.failed('a');
  limit.succeeded('a');
  limit.failed('a');
  assert.strictEqual(limit.waitSeconds('a'), 0);
});

test('steeds een ander adres helpt niet: limiet voor iedereen samen', () => {
  const c = clock();
  const limit = createLimiter(c.now);
  for (let i = 0; i < OVERALL.max; i++) limit.failed(`adres-${i}`);
  assert.ok(limit.waitSeconds('nieuw') > 0);
  c.advance(OVERALL.windowMs);
  assert.strictEqual(limit.waitSeconds('nieuw'), 0);
});

test('adres komt uit X-Forwarded-For als de proxy dat meestuurt', () => {
  const req = { headers: { 'x-forwarded-for': '203.0.113.5, 100.64.0.1' }, socket: { remoteAddress: '172.17.0.1' } };
  assert.strictEqual(clientAddress(req), '203.0.113.5');
  assert.strictEqual(clientAddress({ headers: {}, socket: { remoteAddress: '172.17.0.1' } }), '172.17.0.1');
});

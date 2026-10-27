const test = require('node:test');
const assert = require('node:assert');
const { parseEvents, expand } = require('../ics');

const cal = body => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:Microsoft Exchange Server 2010\r\n${body.trim().split('\n').map(l => l.trim()).join('\r\n')}\r\nEND:VCALENDAR\r\n`;

test('afspraak met Windows-tijdzone, UTC en hele dag', () => {
  const ev = parseEvents(cal(`
    BEGIN:VEVENT
    UID:a
    SUMMARY:Tandarts Sanne
    LOCATION:Dorpsstraat 1\\, Utrecht
    DTSTART;TZID=W. Europe Standard Time:20261027T093000
    DTEND;TZID=W. Europe Standard Time:20261027T100000
    BEGIN:VALARM
    TRIGGER:-PT15M
    SUMMARY:niet dit
    END:VALARM
    END:VEVENT
    BEGIN:VEVENT
    UID:b
    SUMMARY:Bellen
    DTSTART:20260701T120000Z
    DTEND:20260701T123000Z
    END:VEVENT
    BEGIN:VEVENT
    UID:c
    SUMMARY:Vakantie
    DTSTART;VALUE=DATE:20261026
    DTEND;VALUE=DATE:20261029
    END:VEVENT`));
  const [tand] = expand(ev, '2026-10-27', '2026-10-27').filter(o => o.key === 'a');
  assert.strictEqual(tand.title, 'Tandarts Sanne');
  assert.strictEqual(tand.location, 'Dorpsstraat 1, Utrecht');
  assert.deepStrictEqual([tand.startTime, tand.endTime], ['09:30', '10:00']);
  const [bel] = expand(ev, '2026-07-01', '2026-07-01');
  assert.strictEqual(bel.startTime, '14:00'); // zomertijd: UTC+2
  const vak = expand(ev, '2026-10-28', '2026-10-28').find(o => o.key === 'c');
  assert.ok(vak.allDay);
  assert.strictEqual(vak.lastDate, '2026-10-28');
  assert.strictEqual(expand(ev, '2026-10-29', '2026-10-29').length, 0);
});

test('wekelijkse gym met uitzondering en verplaatste keer', () => {
  const ev = parseEvents(cal(`
    BEGIN:VEVENT
    UID:gym
    SUMMARY:Gym
    DTSTART;TZID=W. Europe Standard Time:20260907T183000
    DTEND;TZID=W. Europe Standard Time:20260907T193000
    RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TH;WKST=MO
    EXDATE;TZID=W. Europe Standard Time:20261029T183000
    END:VEVENT
    BEGIN:VEVENT
    UID:gym
    RECURRENCE-ID;TZID=W. Europe Standard Time:20261102T183000
    SUMMARY:Gym (later)
    DTSTART;TZID=W. Europe Standard Time:20261102T200000
    DTEND;TZID=W. Europe Standard Time:20261102T210000
    END:VEVENT`));
  const occ = expand(ev, '2026-10-26', '2026-11-05');
  assert.deepStrictEqual(occ.map(o => `${o.startDate} ${o.startTime} ${o.title}`), [
    '2026-10-26 18:30 Gym', // na de overgang naar wintertijd nog steeds 18:30
    '2026-11-02 20:00 Gym (later)',
    '2026-11-05 18:30 Gym',
  ]);
  assert.strictEqual(occ[1].key, 'gym|2026-11-02T18:30');
});

test('jaarlijkse verjaardag, maandelijks op de tweede dinsdag, COUNT en UNTIL', () => {
  const ev = parseEvents(cal(`
    BEGIN:VEVENT
    UID:oma
    SUMMARY:Verjaardag oma
    DTSTART;VALUE=DATE:19500314
    DTEND;VALUE=DATE:19500315
    RRULE:FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=14
    END:VEVENT
    BEGIN:VEVENT
    UID:ouder
    SUMMARY:Ouderavond
    DTSTART;TZID=W. Europe Standard Time:20260908T200000
    DTEND;TZID=W. Europe Standard Time:20260908T210000
    RRULE:FREQ=MONTHLY;BYDAY=TU;BYSETPOS=2;COUNT=3
    END:VEVENT
    BEGIN:VEVENT
    UID:zwem
    SUMMARY:Zwemles
    DTSTART;TZID=W. Europe Standard Time:20261001T160000
    DTEND;TZID=W. Europe Standard Time:20261001T170000
    RRULE:FREQ=DAILY;INTERVAL=7;UNTIL=20261015T140000Z
    END:VEVENT`));
  const oma = expand(ev, '2027-01-01', '2027-12-31').filter(o => o.key.startsWith('oma'));
  assert.deepStrictEqual(oma.map(o => o.startDate), ['2027-03-14']);
  const ouder = expand(ev, '2026-01-01', '2027-12-31').filter(o => o.key.startsWith('ouder')).map(o => o.startDate);
  assert.deepStrictEqual(ouder, ['2026-09-08', '2026-10-13', '2026-11-10']);
  const zwem = expand(ev, '2026-01-01', '2026-12-31').filter(o => o.key.startsWith('zwem')).map(o => o.startDate);
  assert.deepStrictEqual(zwem, ['2026-10-01', '2026-10-08', '2026-10-15']);
});

test('geannuleerde afspraken tellen niet mee', () => {
  const ev = parseEvents(cal(`
    BEGIN:VEVENT
    UID:x
    SUMMARY:Feest
    STATUS:CANCELLED
    DTSTART;VALUE=DATE:20261101
    END:VEVENT`));
  assert.strictEqual(ev.length, 0);
});

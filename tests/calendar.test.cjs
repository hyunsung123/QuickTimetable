const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { mkdtempSync, unlinkSync, rmdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { execFileSync } = require('node:child_process');
const { CalendarRepository } = require('../.test-build/lib/repository');
const dates = require('../.test-build/lib/dates');
const { dragEvent, eventLanes } = require('../.test-build/lib/timetable');

function database(path = ':memory:') {
  const db = new DatabaseSync(path);
  const driver = {
    execAsync: async sql => { db.exec(sql); },
    runAsync: async (sql, ...values) => db.prepare(sql).run(...values),
    getAllAsync: async (sql, ...values) => db.prepare(sql).all(...values),
  };
  return { db, driver, repo: new CalendarRepository(driver) };
}
const base = { title: '수업', weekday: 0, startMinute: 540, endMinute: 660, color: '#426FD0' };
const event = { id: 'drag', title: '공부', day: 2, startMinute: 540, endMinute: 660, color: '#426FD0' };

test('local date arithmetic handles leap days, month ends, and year boundaries', () => {
  assert.equal(dates.addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(dates.addDays('2024-12-31', 1), '2025-01-01');
  assert.equal(dates.mondayOf('2025-01-01'), '2024-12-30');
  assert.equal(dates.mondayOf('2025-01-05'), '2024-12-30');
  assert.equal(dates.shiftMonth('2024-01-31', 1), '2024-02-29');
  assert.throws(() => dates.parseDate('2025-02-29'));
  assert.throws(() => dates.parseDate('2025-13-01'));
  for (const date of ['2026-02-01', '2026-05-01', '2026-11-01']) {
    const cells = dates.monthDays(date);
    assert.equal(cells.length % 7, 0);
    assert.equal(dates.parseDate(cells[0]).getDay(), 0);
    assert.equal(dates.parseDate(cells.at(-1)).getDay(), 6);
    assert(cells.includes(date));
  }
});

test('24:00 is the end of a civil day; invalid times never roll into another date', () => {
  assert.equal(dates.parseTime('24:00'), 1440);
  assert.equal(dates.formatTime(1440), '24:00');
  for (const time of ['24:30', '09:60', '-1:00', 'abc']) assert(Number.isNaN(dates.parseTime(time)));
});

test('civil dates remain stable in Seoul, across US DST, and in a UTC+14 timezone', () => {
  const modulePath = require.resolve('../.test-build/lib/dates');
  const script = `const d=require(${JSON.stringify(modulePath)});process.stdout.write(JSON.stringify([d.addDays('2026-03-07',1),d.addDays('2026-03-08',1),d.addDays('2026-11-01',1),d.dateKey(d.parseDate('2026-01-01'))]));`;
  for (const timezone of ['Asia/Seoul', 'America/New_York', 'Pacific/Kiritimati']) {
    const actual = JSON.parse(execFileSync(process.execPath, ['-e', script], { env: { ...process.env, TZ: timezone }, encoding: 'utf8' }));
    assert.deepEqual(actual, ['2026-03-08', '2026-03-09', '2026-11-02', '2026-01-01']);
  }
});

test('bottom resize snaps to 30 minutes, preserves start, and respects midnight/minimum duration', () => {
  assert.equal(dragEvent(event, 'end', 0, 44, 100, 44).endMinute, 690);
  assert.equal(dragEvent(event, 'end', 0, 20, 100, 44).endMinute, 660);
  assert.equal(dragEvent(event, 'end', 0, -9999, 100, 44).endMinute, 570);
  assert.equal(dragEvent(event, 'end', 0, 9999, 100, 44).endMinute, 1440);
  assert.equal(dragEvent(event, 'end', 0, 44, 100, 44).startMinute, 540);
});

test('top resize preserves end and clamps at zero and minimum duration', () => {
  assert.equal(dragEvent(event, 'start', 0, 44, 100, 44).startMinute, 570);
  assert.equal(dragEvent(event, 'start', 0, -44, 100, 44).startMinute, 510);
  assert.equal(dragEvent(event, 'start', 0, 9999, 100, 44).startMinute, 630);
  assert.equal(dragEvent(event, 'start', 0, -9999, 100, 44).startMinute, 0);
  assert.equal(dragEvent(event, 'start', 0, 44, 100, 44).endMinute, 660);
});

test('block movement changes days, keeps duration, snaps, and stays within day/week bounds', () => {
  const moved = dragEvent(event, 'move', 100, 44, 100, 44);
  assert.equal(moved.day, 3);
  assert.equal(moved.startMinute, 570);
  assert.equal(moved.endMinute - moved.startMinute, 120);
  const late = dragEvent(event, 'move', 9999, 9999, 100, 44);
  assert.equal(late.day, 6);
  assert.equal(late.startMinute, 1320);
  assert.equal(late.endMinute, 1440);
  const early = dragEvent(event, 'move', -9999, -9999, 100, 44);
  assert.equal(early.day, 0);
  assert.equal(early.startMinute, 0);
});

test('overlapping blocks get separate lanes and adjacent blocks reuse space', () => {
  const lanes = eventLanes([event, { ...event, id: 'overlap', startMinute: 600, endMinute: 690 }, { ...event, id: 'after', startMinute: 690, endMinute: 720 }]);
  assert.equal(lanes.get('drag').lanes, 2);
  assert.notEqual(lanes.get('drag').lane, lanes.get('overlap').lane);
  assert.equal(lanes.get('after').lanes, 1);
});

test('SQLite event CRUD shares one ordered snapshot and preserves creation/origin metadata', async t => {
  const { repo, db } = database(); t.after(() => db.close());
  await repo.initialize();
  await repo.saveEvent({ ...base, date: '2026-11-10', startMinute: 600, endMinute: 630 }, 'later');
  let snapshot = await repo.saveEvent({ ...base, date: '2026-11-10' }, 'first');
  assert.deepEqual(snapshot.events.map(item => item.id), ['first', 'later']);
  assert.equal(snapshot.events[0].calendarId, 'personal');
  const createdAt = snapshot.events[0].createdAt;
  snapshot = await repo.saveEvent({ ...base, title: '수정', date: '2026-11-11' }, 'first');
  assert.equal(snapshot.events.find(item => item.id === 'first').createdAt, createdAt);
  assert.equal(snapshot.events.find(item => item.id === 'first').date, '2026-11-11');
  snapshot = await repo.deleteEvent('first');
  assert.deepEqual(snapshot.events.map(item => item.id), ['later']);
});

test('concurrent initialization of the same week produces exactly one copy', async t => {
  const { repo, db } = database(); t.after(() => db.close());
  await repo.initialize(); await repo.saveTemplate(base, 'template');
  await Promise.all([repo.ensureWeek('2026-11-09'), repo.ensureWeek('2026-11-10'), repo.ensureWeek('2026-11-15')]);
  const snapshot = await repo.initialize();
  assert.equal(snapshot.events.length, 1);
  assert.equal(snapshot.events[0].date, '2026-11-09');
  assert.equal(snapshot.events[0].templateId, 'template');
});

test('deleted default events never reappear on revisiting an initialized week', async t => {
  const { repo, db } = database(); t.after(() => db.close());
  await repo.initialize(); await repo.saveTemplate(base, 'template');
  let snapshot = await repo.ensureWeek('2026-11-09');
  await repo.deleteEvent(snapshot.events[0].id);
  snapshot = await repo.ensureWeek('2026-11-09');
  assert.equal(snapshot.events.length, 0);
  snapshot = await repo.ensureWeek('2026-11-16');
  assert.equal(snapshot.events.length, 1);
});

test('editing a generated instance never changes its template or another week', async t => {
  const { repo, db } = database(); t.after(() => db.close());
  await repo.initialize(); await repo.saveTemplate(base, 'template');
  let snapshot = await repo.ensureWeek('2026-11-09');
  const original = snapshot.events[0];
  await repo.saveEvent({ ...original, title: '이번 주만 변경', date: '2026-11-11', startMinute: 600 }, original.id);
  snapshot = await repo.ensureWeek('2026-11-16');
  assert.equal(snapshot.templates[0].title, '수업');
  assert.equal(snapshot.events.find(item => item.date === '2026-11-16').startMinute, 540);
  assert.equal(snapshot.events.find(item => item.id === original.id).templateId, 'template');
});

test('template edits affect only unopened weeks, including preopened future weeks', async t => {
  const { repo, db } = database(); t.after(() => db.close());
  await repo.initialize(); await repo.saveTemplate(base, 'template');
  await repo.ensureWeek('2026-12-07');
  await repo.saveTemplate({ ...base, title: '새 기본 일정', weekday: 4 }, 'template');
  let snapshot = await repo.ensureWeek('2026-12-14');
  assert.equal(snapshot.events.find(item => item.date === '2026-12-07').title, '수업');
  assert.equal(snapshot.events.find(item => item.date === '2026-12-18').title, '새 기본 일정');
  await repo.deleteTemplate('template');
  snapshot = await repo.ensureWeek('2026-12-21');
  assert.equal(snapshot.events.length, 2);
  assert.equal(snapshot.templates.length, 0);
});

test('a week opened without templates stays initialized after templates are added', async t => {
  const { repo, db } = database(); t.after(() => db.close());
  await repo.initialize(); await repo.ensureWeek('2026-11-09');
  await repo.saveTemplate(base);
  const snapshot = await repo.ensureWeek('2026-11-09');
  assert.equal(snapshot.events.length, 0);
});

test('initialization rollback removes partial copies and permits a clean retry', async t => {
  const { repo, db, driver } = database(); t.after(() => db.close());
  await repo.initialize(); await repo.saveTemplate(base); await repo.saveTemplate({ ...base, weekday: 1 });
  const run = driver.runAsync;
  let inserted = 0;
  driver.runAsync = async (sql, ...values) => {
    if (sql.startsWith('INSERT INTO events') && ++inserted === 2) throw new Error('simulated disk failure');
    return run(sql, ...values);
  };
  await assert.rejects(repo.ensureWeek('2026-11-09'));
  assert.equal((await repo.initialize()).events.length, 0);
  driver.runAsync = run;
  assert.equal((await repo.ensureWeek('2026-11-09')).events.length, 2);
});

test('invalid data is rejected without writing; 23:30–24:00 persists on its original date', async t => {
  const { repo, db } = database(); t.after(() => db.close());
  await repo.initialize();
  for (const input of [
    { title: '' }, { startMinute: 541 }, { endMinute: 540 }, { date: '2026-02-30' }, { color: 'invalid' },
  ]) await assert.rejects(repo.saveEvent({ ...base, date: '2026-11-10', ...input }));
  const snapshot = await repo.saveEvent({ ...base, date: '2026-12-31', startMinute: 1410, endMinute: 1440 });
  assert.equal(snapshot.events.length, 1);
  assert.equal(snapshot.events[0].date, '2026-12-31');
});

test('SQLite file reopen preserves events, templates, and deleted-instance initialization markers', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'quicktimetable-test-'));
  const file = join(folder, 'calendar.db');
  let first;
  let reopened;
  try {
    first = database(file);
    await first.repo.initialize(); await first.repo.saveTemplate(base, 'template');
    const snapshot = await first.repo.ensureWeek('2026-11-09');
    await first.repo.deleteEvent(snapshot.events[0].id);
    await first.repo.saveEvent({ ...base, date: '2026-11-10' }, 'manual');
    first.db.close(); first = null;
    reopened = database(file);
    const persisted = await reopened.repo.initialize();
    assert.equal(persisted.templates.length, 1);
    assert.deepEqual(persisted.events.map(item => item.id), ['manual']);
    assert.equal((await reopened.repo.ensureWeek('2026-11-09')).events.length, 1);
  } finally {
    first?.db.close(); reopened?.db.close();
    unlinkSync(file); rmdirSync(folder);
  }
});

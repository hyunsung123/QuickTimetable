const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { mkdtempSync, unlinkSync, rmdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { execFileSync } = require('node:child_process');
const { CalendarRepository } = require('../.test-build/lib/repository');
const dates = require('../.test-build/lib/dates');
const { dragEvent, conflictingEventIds, resizeBoundary, beginTimetableDrag, updateTimetableDrag, finishTimetableDrag, copyEvent, pastedEvent } = require('../.test-build/lib/timetable');
const { BlockPressSession } = require('../.test-build/lib/timetable-press');
const { contextMenuPosition, contextMenuSize } = require('../.test-build/lib/context-menu');

function database(path = ':memory:') {
  const db = new DatabaseSync(path);
  const driver = {
    execAsync: async sql => { db.exec(sql); },
    runAsync: async (sql, ...values) => db.prepare(sql).run(...values),
    getAllAsync: async (sql, ...values) => db.prepare(sql).all(...values),
  };
  return { db, driver, repo: new CalendarRepository(driver, () => new Date(2026, 10, 1, 12)) };
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
  assert.equal(late.startMinute, 1410);
  assert.equal(late.endMinute, 1440);
  const early = dragEvent(event, 'move', -9999, -9999, 100, 44);
  assert.equal(early.day, 0);
  assert.equal(early.startMinute, 0);
});

test('legacy overlap detection preserves records and excludes adjacent blocks', () => {
  const input = [event, { ...event, id: 'overlap', startMinute: 600, endMinute: 690 }, { ...event, id: 'after', startMinute: 690, endMinute: 720 }];
  const before = structuredClone(input);
  assert.deepEqual([...conflictingEventIds(input)], ['drag', 'overlap']);
  assert.deepEqual(input, before);
});

test('SQLite event CRUD shares one ordered snapshot and preserves creation/origin metadata', async t => {
  const { repo, db } = database(); t.after(() => db.close());
  await repo.initialize();
  await repo.saveEvent({ ...base, date: '2026-11-10', startMinute: 660, endMinute: 690 }, 'later');
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

const adjacent = [
  { ...event, id: 'A', day: 0, startMinute: 540, endMinute: 600 },
  { ...event, id: 'B', day: 0, startMinute: 600, endMinute: 660 },
  { ...event, id: 'C', day: 0, startMinute: 660, endMinute: 720 },
  { ...event, id: 'other-day', day: 1, startMinute: 540, endMinute: 660 },
];
const changedTimes = result => result.changes.map(({ id, startMinute, endMinute }) => ({ id, startMinute, endMinute }));

test('shared bottom edge down grows A and shortens B, leaving outer edges and C fixed', () => {
  const input = structuredClone(adjacent);
  assert.deepEqual(changedTimes(resizeBoundary(input, 'A', 'end', 30)), [
    { id: 'A', startMinute: 540, endMinute: 630 }, { id: 'B', startMinute: 630, endMinute: 660 },
  ]);
  assert.deepEqual(input, adjacent);
});

test('shared bottom edge up shortens A and grows B without opening a gap', () => {
  assert.deepEqual(changedTimes(resizeBoundary(adjacent, 'A', 'end', -30)), [
    { id: 'A', startMinute: 540, endMinute: 570 }, { id: 'B', startMinute: 570, endMinute: 660 },
  ]);
});

test('dragging B top or A bottom produces exactly the same shared boundary', () => {
  for (const delta of [-600, -30, 0, 30, 600]) {
    assert.deepEqual(resizeBoundary(adjacent, 'A', 'end', delta).changes, resizeBoundary(adjacent, 'B', 'start', delta).changes);
  }
});

test('shared boundary is snapped and cannot reduce either block below 30 minutes', () => {
  assert.deepEqual(changedTimes(resizeBoundary(adjacent, 'A', 'end', 14)), []);
  for (let delta = -600; delta <= 600; delta += 5) {
    const result = resizeBoundary(adjacent, 'A', 'end', delta);
    for (const change of result.changes) {
      assert.equal(change.startMinute % 30, 0);
      assert.equal(change.endMinute % 30, 0);
      assert(change.endMinute - change.startMinute >= 30);
      assert(change.startMinute >= 0 && change.endMinute <= 1440);
    }
  }
  const shortB = [{ ...adjacent[0] }, { ...adjacent[1], endMinute: 630 }];
  assert.deepEqual(resizeBoundary(shortB, 'A', 'end', 30).changes, []);
});

test('a gap permits independent resizing, then latches the neighbor on contact', () => {
  const input = [adjacent[0], { ...adjacent[1], startMinute: 660, endMinute: 720 }, { ...adjacent[2], startMinute: 720, endMinute: 780 }];
  assert.deepEqual(changedTimes(resizeBoundary(input, 'A', 'end', 30)), [{ id: 'A', startMinute: 540, endMinute: 630 }]);
  const contact = resizeBoundary(input, 'A', 'end', 60);
  assert.equal(contact.linkedId, 'B');
  const beyond = resizeBoundary(input, 'A', 'end', 90, contact.linkedId);
  assert.deepEqual(changedTimes(beyond), [{ id: 'A', startMinute: 540, endMinute: 690 }, { id: 'B', startMinute: 690, endMinute: 720 }]);
  const reversed = resizeBoundary(input, 'A', 'end', 30, beyond.linkedId);
  assert.deepEqual(changedTimes(reversed), [{ id: 'A', startMinute: 540, endMinute: 630 }, { id: 'B', startMinute: 630, endMinute: 720 }]);
});

test('top resizing across a gap also links the preceding block and fixes both outer ends', () => {
  const input = [adjacent[0], { ...adjacent[1], startMinute: 660, endMinute: 720 }];
  assert.deepEqual(changedTimes(resizeBoundary(input, 'B', 'start', -30)), [{ id: 'B', startMinute: 630, endMinute: 720 }]);
  const contact = resizeBoundary(input, 'B', 'start', -60);
  assert.equal(contact.linkedId, 'A');
  assert.deepEqual(changedTimes(resizeBoundary(input, 'B', 'start', -90, contact.linkedId)), [
    { id: 'A', startMinute: 540, endMinute: 570 }, { id: 'B', startMinute: 570, endMinute: 720 },
  ]);
});

test('one fast update may cross a gap, but it never pushes a chain of blocks', () => {
  const input = [adjacent[0], { ...adjacent[1], startMinute: 660, endMinute: 720 }, { ...adjacent[2], startMinute: 720, endMinute: 780 }];
  assert.deepEqual(changedTimes(resizeBoundary(input, 'A', 'end', 9999)), [
    { id: 'A', startMinute: 540, endMinute: 690 }, { id: 'B', startMinute: 690, endMinute: 720 },
  ]);
});

test('ambiguous overlaps are preserved and resizing cannot cross them', () => {
  const overlapping = [adjacent[0], { ...adjacent[1], startMinute: 570 }];
  assert.deepEqual(resizeBoundary(overlapping, 'A', 'end', 30), { changes: [], blocked: true });
  const ambiguous = [adjacent[0], adjacent[1], { ...adjacent[2], startMinute: 630 }];
  for (const delta of [-30, 30, 300]) assert.deepEqual(resizeBoundary(ambiguous, 'A', 'end', delta), { changes: [], blocked: true });
  const gap = [adjacent[0], { ...adjacent[1], startMinute: 660, endMinute: 720 }, { ...adjacent[2], startMinute: 660, endMinute: 750 }];
  assert.deepEqual(changedTimes(resizeBoundary(gap, 'A', 'end', 120)), [{ id: 'A', startMinute: 540, endMinute: 660 }]);
});

test('a single block retains independent resizing at both day boundaries', () => {
  assert.equal(resizeBoundary([adjacent[0]], 'A', 'start', -9999).changes[0].startMinute, 0);
  assert.equal(resizeBoundary([adjacent[0]], 'A', 'end', 9999).changes[0].endMinute, 1440);
});

test('drag preview changes both blocks and cancel restores every original record', () => {
  const start = beginTimetableDrag(adjacent, 'A', 'end');
  const updated = updateTimetableDrag(start, 0, 44, 100, 44);
  const preview = finishTimetableDrag(updated, true);
  assert.equal(preview.events[0].endMinute, 630);
  assert.equal(preview.events[1].startMinute, 630);
  assert.deepEqual(preview.events.slice(2), adjacent.slice(2));
  const cancelled = finishTimetableDrag(updated, false);
  assert.deepEqual(cancelled.events, adjacent);
  assert.deepEqual(cancelled.changes, []);
  assert.deepEqual(start.original, adjacent);
  const moved = updateTimetableDrag(beginTimetableDrag(adjacent, 'A', 'move'), 200, 44, 100, 44);
  assert.equal(finishTimetableDrag(moved, true).movedEvent.day, 2);
  assert.deepEqual(finishTimetableDrag(moved, false).events, adjacent);
});

test('hold release opens copy only after 350ms and actual dragging permanently suppresses it', () => {
  const press = new BlockPressSession();
  assert.equal(press.releaseHold(349, true), false);
  assert.equal(press.releaseHold(350, true), true);
  assert.equal(press.releaseHold(1000, false), false);
  press.move(9, 0);
  press.move(0, 0);
  assert.equal(press.releaseHold(1000, true), false);
  assert.equal(press.releaseTap(true), false);
  press.reset();
  press.move(1, 1);
  assert.equal(press.releaseHold(500, true), true);
  assert.equal(press.releaseTap(true), true);
});

test('copy payload has only title, color and duration, and paste fits before midnight', () => {
  const clipboard = copyEvent({ ...adjacent[0], date: '2026-11-10', calendarId: 'personal' });
  assert.deepEqual(clipboard, { title: '공부', color: '#426FD0', durationMinute: 60 });
  assert.deepEqual(pastedEvent(clipboard, 1380), { title: '공부', color: '#426FD0', startMinute: 1380, endMinute: 1440 });
  assert.equal(pastedEvent(clipboard, 1410).endMinute, 1440);
  assert.throws(() => pastedEvent({ ...clipboard, durationMinute: 15 }, 540));
});

test('context menu stays inside viewport and Safe Area at every screen edge', () => {
  const viewport = { width: 320, height: 568 };
  const insets = { top: 44, bottom: 34, left: 0, right: 0 };
  for (const labels of [['복사', '삭제'], ['붙여넣기']]) for (const fontScale of [1, 1.4]) for (const anchor of [
    { x: -100, y: -100, width: 44, height: 44 }, { x: 300, y: 30, width: 100, height: 44 },
    { x: 300, y: 550, width: 100, height: 44 }, { x: 50, y: 180, width: 100, height: 88 },
  ]) {
    const size = contextMenuSize(labels, fontScale);
    const position = contextMenuPosition(anchor, viewport, insets, size.width, size.height);
    assert(position.left >= 12 && position.left + size.width <= 308);
    assert(position.top >= 52 && position.top + size.height <= 526);
    assert(position.tailLeft >= 12 && position.tailLeft <= size.width - 24);
  }
  assert.equal(contextMenuPosition({ x: 50, y: 200, width: 100, height: 44 }, viewport, insets).placement, 'above');
  assert.equal(contextMenuPosition({ x: 50, y: 50, width: 100, height: 44 }, viewport, insets).placement, 'below');
});

async function seedAdjacent(repo, template = false) {
  for (const item of adjacent.slice(0, 3)) {
    if (template) await repo.saveTemplate({ ...item, weekday: item.day }, item.id);
    else await repo.saveEvent({ ...item, date: '2026-11-10' }, item.id);
  }
}

test('SQLite shared resize changes only two time ranges and preserves all identities and metadata', async t => {
  const { repo, db } = database(); t.after(() => db.close());
  await repo.initialize(); await seedAdjacent(repo);
  const before = await repo.initialize();
  const changes = resizeBoundary(adjacent, 'A', 'end', 30).changes;
  const after = await repo.updateEventTimes(changes);
  assert.deepEqual(after.events.map(({ id, startMinute, endMinute }) => ({ id, startMinute, endMinute })), [
    { id: 'A', startMinute: 540, endMinute: 630 }, { id: 'B', startMinute: 630, endMinute: 660 }, { id: 'C', startMinute: 660, endMinute: 720 },
  ]);
  for (const old of before.events) {
    const next = after.events.find(item => item.id === old.id);
    for (const field of ['id', 'calendarId', 'title', 'color', 'date', 'createdAt', 'templateId']) assert.equal(next[field], old[field]);
  }
});

for (const template of [false, true]) {
  test(`SQLite ${template ? 'template' : 'event'} resize rolls back first update when second update fails`, async t => {
    const { repo, db, driver } = database(); t.after(() => db.close());
    await repo.initialize(); await seedAdjacent(repo, template);
    const before = await repo.initialize();
    const originalRun = driver.runAsync;
    let updates = 0;
    driver.runAsync = async (sql, ...values) => {
      if (sql.startsWith(`UPDATE ${template ? 'templates' : 'events'}`) && ++updates === 2) throw new Error('simulated write failure');
      return originalRun(sql, ...values);
    };
    await assert.rejects(template ? repo.updateTemplateTimes(resizeBoundary(adjacent, 'A', 'end', 30).changes) : repo.updateEventTimes(resizeBoundary(adjacent, 'A', 'end', 30).changes));
    assert.equal(updates, 2);
    assert.deepEqual(await repo.initialize(), before);
    driver.runAsync = originalRun;
    const after = await (template ? repo.updateTemplateTimes(resizeBoundary(adjacent, 'A', 'end', 30).changes) : repo.updateEventTimes(resizeBoundary(adjacent, 'A', 'end', 30).changes));
    assert.equal((template ? after.templates : after.events).find(item => item.id === 'A').endMinute, 630);
  });
}

test('SQLite template resize leaves already generated dates and unrelated templates intact', async t => {
  const { repo, db } = database(); t.after(() => db.close());
  await repo.initialize(); await seedAdjacent(repo, true);
  const before = await repo.ensureWeek('2026-11-09');
  const after = await repo.updateTemplateTimes(resizeBoundary(adjacent, 'B', 'start', -30).changes);
  assert.deepEqual(after.events, before.events);
  assert.equal(after.templates.find(item => item.id === 'A').endMinute, 570);
  assert.equal(after.templates.find(item => item.id === 'B').startMinute, 570);
  assert.deepEqual(after.templates.find(item => item.id === 'C'), before.templates.find(item => item.id === 'C'));
});

test('stale/deleted rows, cross-date pairs and newly overlapping data reject the whole resize', async t => {
  const { repo, db } = database(); t.after(() => db.close());
  await repo.initialize(); await seedAdjacent(repo);
  const changes = resizeBoundary(adjacent, 'A', 'end', 30).changes;
  await repo.saveEvent({ ...base, date: '2026-11-10', startMinute: 510, endMinute: 600 }, 'A');
  const stale = await repo.initialize();
  await assert.rejects(repo.updateEventTimes(changes));
  assert.deepEqual(await repo.initialize(), stale);
  await repo.deleteEvent('A');
  await assert.rejects(repo.updateEventTimes(changes));
  assert.equal((await repo.initialize()).events.some(item => item.id === 'A'), false);
  await repo.saveEvent({ ...base, date: '2026-11-10', startMinute: 540, endMinute: 600 }, 'A');
  await repo.saveEvent({ ...base, date: '2026-11-11', startMinute: 600, endMinute: 660 }, 'B');
  const crossDate = await repo.initialize();
  await assert.rejects(repo.updateEventTimes(changes));
  assert.deepEqual(await repo.initialize(), crossDate);
  await repo.saveEvent({ ...base, date: '2026-11-10', startMinute: 600, endMinute: 660 }, 'B');
  // Simulate a row already stored by the older overlap-permitting version.
  db.exec("INSERT INTO events VALUES ('overlap', 'personal', '기존 겹침', '2026-11-10', 600, 630, '#426FD0', 'old', 'old', NULL)");
  const overlap = await repo.initialize();
  await assert.rejects(repo.updateEventTimes(changes));
  assert.deepEqual(await repo.initialize(), overlap);
});

test('repeated paste gives new IDs, keeps the source, and never overwrites colliding events', async t => {
  const { repo, db } = database(); t.after(() => db.close());
  await repo.initialize(); await repo.saveEvent({ ...base, date: '2026-11-10' }, 'source');
  const before = (await repo.initialize()).events[0];
  const clipboard = copyEvent(before);
  await repo.pasteEvent(clipboard, '2026-11-11', 600);
  const after = await repo.pasteEvent(clipboard, '2026-11-11', 720);
  assert.equal(new Set(after.events.map(item => item.id)).size, 3);
  assert.deepEqual(after.events.find(item => item.id === 'source'), before);
  for (const item of after.events.filter(item => item.id !== 'source')) {
    assert.equal(item.endMinute - item.startMinute, clipboard.durationMinute);
    assert.equal(item.title, before.title); assert.equal(item.color, before.color);
    assert.equal(item.templateId, null);
  }
  for (const start of [600, 630, 690]) await assert.rejects(repo.pasteEvent(clipboard, '2026-11-11', start));
  assert.deepEqual(await repo.initialize(), after);
  const fitted = await repo.pasteEvent(clipboard, '2026-11-11', 570);
  assert.equal(fitted.events.find(row => row.startMinute === 570).endMinute, 600);
  const midnight = await repo.pasteEvent(clipboard, '2026-11-11', 1410);
  assert.equal(midnight.events.find(row => row.startMinute === 1410).endMinute, 1440);
});

test('concurrent pastes recheck collisions in their transaction and produce only one new row', async t => {
  const { repo, db } = database(); t.after(() => db.close());
  await repo.initialize();
  const results = await Promise.allSettled([repo.pasteEvent(copyEvent(adjacent[0]), '2026-11-10', 540), repo.pasteEvent(copyEvent(adjacent[0]), '2026-11-10', 540)]);
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal((await repo.initialize()).events.length, 1);
});

test('template paste checks template collisions, retains copies and leaves dated events unchanged', async t => {
  const { repo, db } = database(); t.after(() => db.close());
  await repo.initialize(); await repo.saveTemplate(base, 'source');
  const before = await repo.ensureWeek('2026-11-09');
  const clipboard = copyEvent(before.templates[0]);
  let after = await repo.pasteTemplate(clipboard, 1, 540);
  after = await repo.pasteTemplate(clipboard, 2, 540);
  assert.equal(after.templates.length, 3);
  assert.equal(new Set(after.templates.map(item => item.id)).size, 3);
  assert.deepEqual(after.events, before.events);
  assert.deepEqual(after.templates.find(item => item.id === 'source'), before.templates[0]);
  await assert.rejects(repo.pasteTemplate(clipboard, 1, 570));
  assert.deepEqual(await repo.initialize(), after);
});

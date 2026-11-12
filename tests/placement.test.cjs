const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { CalendarRepository } = require('../.test-build/lib/repository');
const { beginTimetableDrag, updateTimetableDrag, finishTimetableDrag, previewTimetableDrag, fitInFreeSpace, copyEvent, overlaps, TimetableActionError } = require('../.test-build/lib/timetable');

const rows = [
  { id: 'A', title: '수업', color: '#426FD0', day: 0, startMinute: 660, endMinute: 720 },
  { id: 'B', title: '운동', color: '#4F8A72', day: 0, startMinute: 780, endMinute: 840 },
  { id: 'C', title: '공부', color: '#9875BD', day: 0, startMinute: 900, endMinute: 1020 },
];
const moveTo = (input, day, minute) => updateTimetableDrag(beginTimetableDrag(input, 'C', 'move'), day * 100, (minute - 900) / 30 * 26, 100, 26);
const times = ({ day, startMinute, endMinute }) => [day, startMinute, endMinute];
function database(t) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const driver = {
    execAsync: async sql => { db.exec(sql); },
    runAsync: async (sql, ...args) => db.prepare(sql).run(...args),
    getAllAsync: async (sql, ...args) => db.prepare(sql).all(...args),
  };
  return { db, driver, repo: new CalendarRepository(driver, () => new Date(2026, 10, 10, 12)) };
}
const date = '2026-11-16';
const input = { title: '일정', color: '#426FD0', startMinute: 660, endMinute: 720, date, weekday: 0 };

test('complete and partial occupied-start moves show an invalid ghost and cannot commit', () => {
  for (const minute of [660, 690, 780, 810]) {
    const session = moveTo(rows, 0, minute);
    assert.equal(session.blocked, true);
    assert.equal(previewTimetableDrag(session).find(row => row.id === 'C').startMinute, minute);
    assert.deepEqual(finishTimetableDrag(session, true).events, rows);
    assert.equal(finishTimetableDrag(session, true).movedEvent, undefined);
    assert.deepEqual(session.original, rows);
  }
});

test('two-hour moves fit into one-hour or half-hour gaps without changing the neighbors', () => {
  for (const end of [750, 780]) {
    const source = [rows[0], { ...rows[1], startMinute: end }, rows[2]];
    const session = moveTo(source, 0, 720);
    assert.equal(session.blocked, false); assert.equal(session.shortened, true);
    const result = finishTimetableDrag(session, true);
    assert.deepEqual(times(result.movedEvent), [0, 720, end]);
    assert.deepEqual(result.events.slice(0, 2), source.slice(0, 2));
    for (const key of ['id', 'title', 'color']) assert.equal(result.movedEvent[key], rows[2][key]);
    assert.deepEqual(finishTimetableDrag(session, false).events, source);
  }
});

test('sufficient space retains the original duration and shortened previews can grow back', () => {
  const source = [rows[0], { ...rows[1], startMinute: 840, endMinute: 900 }, rows[2]];
  assert.deepEqual(times(finishTimetableDrag(moveTo(source, 0, 720), true).movedEvent), [0, 720, 840]);
  const short = moveTo(rows, 0, 720);
  assert.equal(short.movedEvent.endMinute, 780);
  const free = updateTimetableDrag(short, 100, -156, 100, 26);
  assert.deepEqual(times(free.movedEvent), [1, 720, 840]);
  assert.equal(free.shortened, false);
  assert.deepEqual(rows[2], short.original[2]);
});

test('destination weekday, half-open boundaries, self exclusion and midnight determine the fit', () => {
  assert.equal(moveTo(rows, 1, 660).blocked, false);
  assert.equal(moveTo(rows, 0, 840).blocked, false);
  assert.deepEqual(times(moveTo(rows, 0, 900).movedEvent), [0, 900, 1020]);
  const late = [{ ...rows[2], startMinute: 1260, endMinute: 1440 }];
  const session = updateTimetableDrag(beginTimetableDrag(late, 'C', 'move'), 100, 104, 100, 26);
  assert.deepEqual(times(session.movedEvent), [1, 1380, 1440]);
  assert.equal(session.shortened, true);
  assert.equal(fitInFreeSpace([{ startMinute: 720, endMinute: 780 }], 690, 30).blocked, false);
  assert.equal(fitInFreeSpace([{ startMinute: 720, endMinute: 780 }], 720, 30).blocked, true);
  assert.equal(fitInFreeSpace([{ startMinute: 720, endMinute: 780 }], 780, 30).blocked, false);
});

test('26px rows snap at half a row, clamp at day edges, and refuse less than 30 minutes', () => {
  const single = [rows[2]];
  for (const [pixels, minute] of [[12.9, 900], [13, 930], [26, 930], [52, 960]]) {
    const session = updateTimetableDrag(beginTimetableDrag(single, 'C', 'move'), 0, pixels, 100, 26);
    assert.equal(session.movedEvent.startMinute, minute);
  }
  assert.equal(updateTimetableDrag(beginTimetableDrag(single, 'C', 'move'), -9999, -9999, 100, 26).movedEvent.startMinute, 0);
  assert.deepEqual(times(moveTo(single, 99, 9999).movedEvent), [6, 1410, 1440]);
  assert.equal(fitInFreeSpace([{ startMinute: 735, endMinute: 780 }], 720, 120).blocked, true);
  for (const start of [-30, 1440, 721, NaN]) assert.equal(fitInFreeSpace([], start, 120).blocked, true);
});

test('every allowed 30-minute destination is non-overlapping, bounded, and never grows duration', () => {
  for (let day = 0; day < 7; day++) for (let minute = 0; minute <= 1410; minute += 30) {
    const session = moveTo(rows, day, minute);
    if (session.blocked) continue;
    const moved = finishTimetableDrag(session, true).movedEvent;
    assert(moved.startMinute >= 0 && moved.endMinute <= 1440);
    assert(moved.endMinute - moved.startMinute >= 30 && moved.endMinute - moved.startMinute <= 120);
    assert.equal(moved.endMinute % 30, 0);
    assert(!rows.some(row => row.id !== moved.id && row.day === moved.day && overlaps(row, moved)));
  }
});

test('event create/edit rejects collisions atomically, allows touching/different dates and keeps explicit times', async t => {
  const { db, repo } = database(t); await repo.initialize();
  await repo.saveEvent(input, 'A');
  await repo.saveEvent({ ...input, startMinute: 900, endMinute: 1020 }, 'C');
  const before = await repo.initialize();
  const markers = db.prepare('SELECT * FROM initialized_weeks').all();
  for (const value of [{ ...input }, { ...input, startMinute: 630, endMinute: 690 }, { ...input, startMinute: 690, endMinute: 810 }]) {
    await assert.rejects(repo.saveEvent(value), TimetableActionError);
    await assert.rejects(repo.saveEvent(value, 'C'), TimetableActionError);
    assert.deepEqual(await repo.initialize(), before);
    assert.deepEqual(db.prepare('SELECT * FROM initialized_weeks').all(), markers);
  }
  await repo.saveEvent({ ...input, startMinute: 720, endMinute: 750 }, 'touch');
  await repo.saveEvent({ ...input, date: '2026-11-17' }, 'other-day');
  await assert.rejects(repo.saveEvent({ ...input, startMinute: 630, endMinute: 750 }, 'C'), /다른 일정/);
  assert.equal((await repo.initialize()).events.find(row => row.id === 'C').startMinute, 900);
});

test('template creation and day edits reject clashes within a preset, while other presets/days stay independent', async t => {
  const { repo } = database(t); const first = (await repo.initialize()).presets[0].id;
  const second = (await repo.createPreset()).presets.at(-1).id;
  await repo.saveTemplate(input, 'A', first);
  await repo.saveTemplate({ ...input, weekday: 1 }, 'B', first);
  const before = await repo.initialize();
  await assert.rejects(repo.saveTemplate(input, undefined, first), /다른 일정/);
  await assert.rejects(repo.saveTemplate(input, 'B', first), /다른 일정/);
  assert.deepEqual(await repo.initialize(), before);
  await repo.saveTemplate(input, 'C', second);
  const after = await repo.saveTemplate({ ...input, startMinute: 720, endMinute: 750 }, 'D', first);
  assert.equal(after.templates.length, 4);
});

for (const template of [false, true]) test(`${template ? 'template' : 'event'} paste fits shorter gaps and midnight, retains source/clipboard, and rejects occupied starts`, async t => {
  const { repo } = database(t); const preset = (await repo.initialize()).presets[0].id;
  for (const row of rows) {
    if (template) await repo.saveTemplate({ ...row, weekday: 0 }, row.id, preset);
    else await repo.saveEvent({ ...row, date }, row.id);
  }
  const before = await repo.initialize(); const clipboard = copyEvent(rows[2]); const copy = { ...clipboard };
  const paste = (day, start) => template ? repo.pasteTemplate(clipboard, day, start, preset) : repo.pasteEvent(clipboard, day === 0 ? date : '2026-11-17', start);
  for (const start of [660, 690, 780, 810]) await assert.rejects(paste(0, start), /붙여넣/);
  assert.deepEqual(await repo.initialize(), before);
  await paste(0, 720);
  const after = await paste(1, 1380);
  const target = template ? after.templates : after.events;
  const old = template ? before.templates : before.events;
  for (const row of old) assert.deepEqual(target.find(value => value.id === row.id), row);
  assert.equal(target.find(row => !['A', 'B', 'C'].includes(row.id) && row.startMinute === 720).endMinute, 780);
  assert.equal(target.find(row => row.startMinute === 1380).endMinute, 1440);
  assert.equal(new Set(target.map(row => row.id)).size, target.length);
  assert.deepEqual(clipboard, copy);
});

test('concurrent create/edit checks run in the same transaction and only the first conflicting write wins', async t => {
  const { repo } = database(t); await repo.initialize();
  const outcomes = await Promise.allSettled([repo.saveEvent(input, 'first'), repo.saveEvent(input, 'second')]);
  assert.equal(outcomes.filter(row => row.status === 'fulfilled').length, 1);
  const after = await repo.initialize(); assert.deepEqual(after.events.map(row => row.id), ['first']);
});

test('legacy overlaps survive startup and metadata edits; new clashes are refused and a free correction is allowed', async t => {
  const { db, repo } = database(t); await repo.initialize(); await repo.saveEvent(input, 'A');
  db.exec(`INSERT INTO events VALUES ('old', 'personal', '겹친 원본', '${date}', 690, 750, '#426FD0', 'old-created', 'old-updated', 'provenance')`);
  const before = await repo.initialize();
  assert.equal(before.events.length, 2);
  await assert.rejects(repo.saveEvent({ ...input, startMinute: 660, endMinute: 750 }, 'old'), /다른 일정/);
  assert.deepEqual(await repo.initialize(), before);
  const renamed = await repo.saveEvent({ ...before.events.find(row => row.id === 'old'), title: '새 제목' }, 'old');
  const row = renamed.events.find(row => row.id === 'old');
  assert.equal(row.startMinute, 690); assert.equal(row.endMinute, 750);
  assert.equal(row.createdAt, 'old-created'); assert.equal(row.templateId, 'provenance');
  const corrected = await repo.saveEvent({ ...row, startMinute: 720, endMinute: 780 }, 'old');
  assert.deepEqual(corrected.events.find(row => row.id === 'A'), before.events[0]);
});

test('overlapping legacy import rejects the entire replacement/creation, preserving all source and target data', async t => {
  const { db, repo } = database(t); const target = (await repo.initialize()).presets[0].id;
  await repo.saveTemplate(input, 'target', target); await repo.saveEvent(input, 'source');
  db.exec(`INSERT INTO events VALUES ('legacy', 'personal', '기존 겹침', '${date}', 690, 750, '#426FD0', 'created', 'updated', NULL)`);
  const before = await repo.initialize();
  const source = { kind: 'week', weekStart: date };
  await assert.rejects(repo.replacePreset(target, source), /겹치는 일정/);
  assert.deepEqual(await repo.initialize(), before);
  await assert.rejects(repo.createPreset(source), /겹치는 일정/);
  assert.deepEqual(await repo.initialize(), before);
});

test('overlapping legacy presets are preserved and neither cloned nor auto-applied until corrected', async t => {
  const { db, repo } = database(t); const preset = (await repo.initialize()).presets[0].id;
  await repo.saveTemplate(input, 'A', preset);
  db.prepare('INSERT INTO templates VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('legacy', preset, 'personal', '기존 겹침', 0, 690, 750, '#426FD0', 'created', 'updated');
  const before = await repo.initialize();
  await assert.rejects(repo.createPreset({ kind: 'preset', presetId: preset }), /겹치는 일정/);
  await assert.rejects(repo.ensureWeek(date), /기본 시간표에 겹치는 일정/);
  assert.deepEqual(await repo.initialize(), before);
  assert.equal(db.prepare('SELECT * FROM initialized_weeks').all().length, 0);
  const original = before.templates.find(row => row.id === 'legacy');
  await repo.saveTemplate({ ...original, title: '제목 수정' }, original.id, preset);
  await repo.saveTemplate({ ...original, startMinute: 720, endMinute: 780 }, original.id, preset);
  assert.equal((await repo.ensureWeek(date)).events.length, 2);
});

test('move writes preserve identity/metadata, and a later write failure rolls back times plus week markers', async t => {
  const { db, driver, repo } = database(t); await repo.initialize(); await repo.saveEvent(input, 'C');
  const before = await repo.initialize(); const original = before.events[0];
  const markers = db.prepare('SELECT * FROM initialized_weeks').all();
  const run = driver.runAsync;
  driver.runAsync = async (sql, ...args) => { if (sql.startsWith('INSERT OR IGNORE INTO initialized_weeks')) throw new Error('disk full'); return run(sql, ...args); };
  await assert.rejects(repo.saveEvent({ ...original, date: '2026-11-23', startMinute: 720, endMinute: 750 }, 'C'));
  driver.runAsync = run;
  assert.deepEqual(await repo.initialize(), before);
  assert.deepEqual(db.prepare('SELECT * FROM initialized_weeks').all(), markers);
  const after = await repo.saveEvent({ ...original, date: '2026-11-23', startMinute: 720, endMinute: 750 }, 'C');
  for (const key of ['id', 'title', 'color', 'createdAt', 'calendarId', 'templateId']) assert.equal(after.events[0][key], original[key]);
});

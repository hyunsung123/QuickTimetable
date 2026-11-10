const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { mkdtempSync, unlinkSync, rmdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { CalendarRepository, schema } = require('../.test-build/lib/repository');
const { availableWeeks } = require('../.test-build/lib/presets');
const { resizeBoundary, copyEvent } = require('../.test-build/lib/timetable');

function database(path = ':memory:') {
  const db = new DatabaseSync(path);
  const driver = {
    execAsync: async sql => { db.exec(sql); },
    runAsync: async (sql, ...values) => db.prepare(sql).run(...values),
    getAllAsync: async (sql, ...values) => db.prepare(sql).all(...values),
  };
  return { db, driver, repo: new CalendarRepository(driver) };
}
const base = { title: '수업', weekday: 0, startMinute: 540, endMinute: 600, color: '#426FD0' };
const lastPreset = snapshot => snapshot.presets.at(-1);
const forPreset = (snapshot, id) => snapshot.templates.filter(row => row.presetId === id);
function seedLegacy(db) {
  db.exec(schema);
  db.exec(`INSERT INTO templates VALUES ('old-block', 'personal', '기존 시간표', 2, 600, 660, '#426FD0', '2020-created', '2021-updated');
    INSERT INTO templates VALUES ('old-sunday', 'personal', '기존 일요일', 6, 1410, 1440, '#426FD0', '2020-created', '2021-updated');
    INSERT INTO events VALUES ('old-event', 'personal', '수정한 일정', '2026-11-11', 630, 690, '#426FD0', 'created', 'updated', 'old-block');
    INSERT INTO initialized_weeks VALUES ('2026-11-09', 'old-marker'); PRAGMA user_version = 1;`);
}

test('v1 migration preserves old IDs, metadata, dated events and initialization markers; rerun is idempotent', async t => {
  const { db, repo } = database(); t.after(() => db.close());
  seedLegacy(db);
  const beforeEvents = db.prepare('SELECT * FROM events').all();
  const beforeTemplates = db.prepare('SELECT * FROM templates ORDER BY weekday').all();
  const snapshot = await repo.initialize();
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 2);
  assert.equal(snapshot.presets.length, 1);
  assert.equal(snapshot.presets[0].name, '기본 시간표 1');
  assert.equal(snapshot.presets[0].isDefault, 1);
  assert.deepEqual(snapshot.events, beforeEvents);
  for (const [index, template] of snapshot.templates.entries()) {
    const { presetId, ...record } = template;
    assert.equal(presetId, snapshot.presets[0].id);
    assert.deepEqual(record, { ...beforeTemplates[index] });
  }
  assert.deepEqual(db.prepare('SELECT * FROM initialized_weeks').all().map(row => ({ ...row })), [{ weekStart: '2026-11-09', initializedAt: 'old-marker' }]);
  assert.deepEqual(await repo.initialize(), snapshot);
  assert.deepEqual((await repo.ensureWeek('2026-11-09')).events, snapshot.events);
});

test('migration failure rolls back schema, version and all data before a clean retry', async t => {
  const { db, repo, driver } = database(); t.after(() => db.close()); seedLegacy(db);
  const before = db.prepare('SELECT * FROM templates').all();
  const run = driver.runAsync;
  driver.runAsync = async (sql, ...args) => { if (sql.startsWith('INSERT INTO templates_v2')) throw new Error('disk full'); return run(sql, ...args); };
  await assert.rejects(repo.initialize());
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 1);
  assert.deepEqual(db.prepare('SELECT * FROM templates').all(), before);
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name = 'timetable_presets'").all().length, 0);
  driver.runAsync = run;
  assert.equal((await repo.initialize()).templates.length, 2);
});

test('preset names avoid existing numbered names, default is single, and FK prevents orphan blocks', async t => {
  const { db, repo } = database(); t.after(() => db.close());
  let snapshot = await repo.initialize();
  const first = snapshot.presets[0].id;
  snapshot = await repo.createPreset(); const second = lastPreset(snapshot).id;
  assert.equal(lastPreset(snapshot).name, '기본 시간표 2');
  await repo.renamePreset(second, '기본 시간표 3');
  snapshot = await repo.createPreset();
  assert.equal(lastPreset(snapshot).name, '기본 시간표 2');
  assert.equal(snapshot.presets.filter(row => row.isDefault).length, 1);
  assert.equal(snapshot.presets.find(row => row.isDefault).id, first);
  await assert.rejects(repo.renamePreset(first, ' '));
  await assert.rejects(repo.renamePreset(first, 'x'.repeat(101)));
  snapshot = await repo.setDefaultPreset(second);
  assert.equal(snapshot.presets.find(row => row.isDefault).id, second);
  assert.throws(() => db.exec('UPDATE timetable_presets SET isDefault = 1'));
  assert.equal(db.prepare('SELECT * FROM timetable_presets WHERE isDefault = 1').all().length, 1);
  assert.throws(() => db.prepare('INSERT INTO templates VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('orphan', 'missing', 'personal', '제목', 0, 540, 600, '#426FD0', 'now', 'now'));
});

test('template edit, paste, shared resize and deletion are scoped to the selected preset', async t => {
  const { db, repo } = database(); t.after(() => db.close());
  let snapshot = await repo.initialize(); const first = snapshot.presets[0].id;
  snapshot = await repo.createPreset(); const second = lastPreset(snapshot).id;
  for (const [preset, prefix] of [[first, 'A'], [second, 'B']]) {
    await repo.saveTemplate(base, `${prefix}1`, preset);
    await repo.saveTemplate({ ...base, startMinute: 600, endMinute: 660 }, `${prefix}2`, preset);
  }
  const before = await repo.ensureWeek('2026-11-09');
  const grid = forPreset(before, first).map(row => ({ ...row, day: row.weekday }));
  snapshot = await repo.updateTemplateTimes(resizeBoundary(grid, 'A1', 'end', 30).changes, first);
  assert.equal(snapshot.templates.find(row => row.id === 'A2').startMinute, 630);
  assert.deepEqual(forPreset(snapshot, second), forPreset(before, second));
  await assert.rejects(repo.updateTemplateTimes(resizeBoundary(grid, 'A1', 'end', 30).changes, second));
  await assert.rejects(repo.saveTemplate({ ...base, title: '잘못된 저장' }, 'B1', first));
  snapshot = await repo.pasteTemplate(copyEvent(base), 1, 540, first);
  snapshot = await repo.pasteTemplate(copyEvent(base), 1, 540, second);
  await assert.rejects(repo.pasteTemplate(copyEvent(base), 1, 540, first));
  snapshot = await repo.deleteTemplate('B1', first);
  assert(snapshot.templates.some(row => row.id === 'B1'));
  snapshot = await repo.deleteTemplate('A1', first);
  assert(!snapshot.templates.some(row => row.id === 'A1'));
  assert.deepEqual(snapshot.events, before.events);
});

test('default changes apply only to untouched weeks, including no-default and previously opened future weeks', async t => {
  const { db, repo } = database(); t.after(() => db.close());
  let snapshot = await repo.initialize(); const first = snapshot.presets[0].id;
  await repo.saveTemplate(base, 'first-block', first);
  const old = await repo.ensureWeek('2026-11-09');
  await repo.ensureWeek('2027-01-04');
  snapshot = await repo.createPreset(); const second = lastPreset(snapshot).id;
  await repo.saveTemplate({ ...base, title: '시험 기간', weekday: 6 }, 'second-block', second);
  await repo.setDefaultPreset(second);
  snapshot = await repo.ensureWeek('2026-11-16');
  assert.equal(snapshot.events.find(row => row.date === '2026-11-22').title, '시험 기간');
  assert.deepEqual(snapshot.events.find(row => row.id === old.events[0].id), old.events[0]);
  assert.equal(snapshot.events.find(row => row.date === '2027-01-04').title, '수업');
  await repo.setDefaultPreset(null);
  snapshot = await repo.ensureWeek('2026-11-23');
  assert(!snapshot.events.some(row => row.date >= '2026-11-23' && row.date < '2026-11-30'));
  await repo.setDefaultPreset(first);
  assert.deepEqual((await repo.ensureWeek('2026-11-23')).events, snapshot.events);
});

test('manually authored weeks remain protected even after their last event is deleted', async t => {
  const { db, repo } = database(); t.after(() => db.close());
  await repo.initialize(); await repo.saveTemplate(base);
  await repo.saveEvent({ ...base, date: '2026-11-10' }, 'manual');
  let snapshot = await repo.ensureWeek('2026-11-09');
  assert.deepEqual(snapshot.events.map(row => row.id), ['manual']);
  await repo.deleteEvent('manual');
  snapshot = await repo.ensureWeek('2026-11-09');
  assert.equal(snapshot.events.length, 0);
});

test('week import copies weekdays, title, color and time with fresh IDs/metadata; source stays independent', async t => {
  const { db, repo } = database(); t.after(() => db.close());
  await repo.initialize();
  await repo.saveEvent({ ...base, date: '2026-11-09' }, 'monday');
  await repo.saveEvent({ ...base, title: '자정', date: '2026-11-15', startMinute: 1410, endMinute: 1440 }, 'sunday');
  db.exec("UPDATE events SET createdAt = 'old-created', updatedAt = 'old-updated'");
  const before = await repo.initialize();
  let snapshot = await repo.createPreset({ kind: 'week', weekStart: '2026-11-09' });
  const id = lastPreset(snapshot).id;
  const imported = forPreset(snapshot, id);
  assert.deepEqual(imported.map(row => row.weekday), [0, 6]);
  assert.deepEqual(snapshot.events, before.events);
  for (const [index, row] of imported.entries()) {
    const original = before.events[index];
    assert.notEqual(row.id, original.id); assert.notEqual(row.createdAt, original.createdAt); assert.notEqual(row.updatedAt, original.updatedAt);
    for (const field of ['title', 'color', 'startMinute', 'endMinute']) assert.equal(row[field], original[field]);
    assert(!('date' in row));
  }
  snapshot = await repo.saveTemplate({ ...imported[0], title: '새 템플릿에서 수정' }, imported[0].id, id);
  assert.deepEqual(snapshot.events, before.events);
  assert.deepEqual(availableWeeks(snapshot.events), ['2026-11-09']);
});

test('saved preset duplication issues fresh block IDs and preserves source preset, default and dated copies', async t => {
  const { db, repo } = database(); t.after(() => db.close());
  let snapshot = await repo.initialize(); const first = snapshot.presets[0].id;
  await repo.saveTemplate(base, 'original', first);
  const before = await repo.ensureWeek('2026-11-09');
  snapshot = await repo.createPreset({ kind: 'preset', presetId: first }); const second = lastPreset(snapshot).id;
  const cloned = forPreset(snapshot, second)[0];
  assert.notEqual(cloned.id, 'original');
  assert.equal(cloned.title, '수업');
  assert.deepEqual(forPreset(snapshot, first), before.templates);
  assert.equal(snapshot.presets.find(row => row.isDefault).id, first);
  snapshot = await repo.saveTemplate({ ...cloned, weekday: 5, title: '복제본만 변경' }, cloned.id, second);
  assert.deepEqual(forPreset(snapshot, first), before.templates);
  assert.deepEqual(snapshot.events, before.events);
});

test('replacement rolls back delete and partial insertion on write OR snapshot failure; successful import preserves others', async t => {
  const { db, repo, driver } = database(); t.after(() => db.close());
  let snapshot = await repo.initialize(); const source = snapshot.presets[0].id;
  await repo.saveTemplate(base, 'source1', source);
  await repo.saveTemplate({ ...base, weekday: 1 }, 'source2', source);
  snapshot = await repo.createPreset(); const target = lastPreset(snapshot).id;
  await repo.saveTemplate({ ...base, title: '교체 전', weekday: 6 }, 'target', target);
  const before = await repo.ensureWeek('2026-11-09');
  const run = driver.runAsync; let inserts = 0;
  driver.runAsync = async (sql, ...args) => { if (sql.startsWith('INSERT INTO templates') && ++inserts === 2) throw new Error('write failure'); return run(sql, ...args); };
  await assert.rejects(repo.replacePreset(target, { kind: 'preset', presetId: source }));
  driver.runAsync = run;
  assert.deepEqual(await repo.initialize(), before);
  const get = driver.getAllAsync;
  driver.getAllAsync = async (sql, ...args) => { if (sql === 'SELECT * FROM events ORDER BY date, startMinute, id') throw new Error('snapshot failure'); return get(sql, ...args); };
  await assert.rejects(repo.replacePreset(target, { kind: 'preset', presetId: source }));
  driver.getAllAsync = get;
  assert.deepEqual(await repo.initialize(), before);
  snapshot = await repo.replacePreset(target, { kind: 'preset', presetId: source });
  assert.equal(forPreset(snapshot, target).length, 2);
  assert(!snapshot.templates.some(row => row.id === 'target'));
  assert.deepEqual(forPreset(snapshot, source), forPreset(before, source));
  assert.deepEqual(snapshot.events, before.events);
});

test('failed preset creation, default switch and deletion are atomic; missing sources never erase a target', async t => {
  const { db, repo, driver } = database(); t.after(() => db.close());
  let snapshot = await repo.initialize(); const first = snapshot.presets[0].id;
  await repo.saveTemplate(base, 'first', first);
  snapshot = await repo.createPreset(); const second = lastPreset(snapshot).id;
  const before = await repo.initialize(); const run = driver.runAsync;
  driver.runAsync = async (sql, ...args) => {
    if (sql.startsWith('INSERT INTO templates') || sql.startsWith('UPDATE timetable_presets SET isDefault = 1') || sql.startsWith('DELETE FROM timetable_presets')) throw new Error('injected failure');
    return run(sql, ...args);
  };
  await assert.rejects(repo.createPreset({ kind: 'preset', presetId: first }));
  await assert.rejects(repo.setDefaultPreset(second));
  await assert.rejects(repo.deletePreset(first));
  driver.runAsync = run;
  assert.deepEqual(await repo.initialize(), before);
  await assert.rejects(repo.replacePreset(first, { kind: 'preset', presetId: 'missing' }));
  await assert.rejects(repo.replacePreset(first, { kind: 'week', weekStart: '2020-01-06' }));
  assert.deepEqual(await repo.initialize(), before);
});

test('deleting a default or all presets preserves generated weeks and leaves the default unset', async t => {
  const { db, repo } = database(); t.after(() => db.close());
  let snapshot = await repo.initialize(); const first = snapshot.presets[0].id;
  await repo.saveTemplate(base, 'origin', first);
  const before = await repo.ensureWeek('2026-11-09');
  snapshot = await repo.createPreset(); const second = lastPreset(snapshot).id;
  await repo.saveTemplate({ ...base, weekday: 1 }, 'other', second);
  snapshot = await repo.deletePreset(first);
  assert.equal(snapshot.templates.length, 1); assert.equal(snapshot.templates[0].id, 'other');
  assert.deepEqual(snapshot.events, before.events);
  assert.equal(snapshot.presets.some(row => row.isDefault), false);
  assert.equal((await repo.ensureWeek('2026-11-16')).events.length, 1);
  snapshot = await repo.deletePreset(second);
  assert.equal(snapshot.presets.length, 0); assert.equal(snapshot.templates.length, 0);
  assert.deepEqual(snapshot.events, before.events);
  assert.deepEqual((await repo.initialize()).presets, []);
});

test('SQLite close/reopen restores multiple preset names, selection and scoped blocks exactly', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'quick-presets-')); const path = join(dir, 'presets.db');
  let connection;
  try {
    connection = database(path);
    let snapshot = await connection.repo.initialize(); const first = snapshot.presets[0].id;
    await connection.repo.saveTemplate(base, 'first', first);
    snapshot = await connection.repo.createPreset({ kind: 'preset', presetId: first }); const second = lastPreset(snapshot).id;
    await connection.repo.renamePreset(second, '시험 기간');
    const expected = await connection.repo.setDefaultPreset(second);
    connection.db.close(); connection = database(path);
    assert.deepEqual(await connection.repo.initialize(), expected);
  } finally { connection?.db.close(); unlinkSync(path); rmdirSync(dir); }
});

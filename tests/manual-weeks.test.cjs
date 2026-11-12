const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { mkdtempSync, unlinkSync, rmdirSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { CalendarRepository } = require('../.test-build/lib/repository');
const { WeekReplacementRequiredError } = require('../.test-build/lib/timetable');
const { addDays } = require('../.test-build/lib/dates');

const base = { title: '학기 일정', weekday: 0, startMinute: 540, endMinute: 600, color: '#426FD0' };
function database(path = ':memory:') {
  const db = new DatabaseSync(path);
  const driver = {
    execAsync: async sql => db.exec(sql),
    runAsync: async (sql, ...args) => db.prepare(sql).run(...args),
    getAllAsync: async (sql, ...args) => db.prepare(sql).all(...args),
  };
  return { db, driver, repo: new CalendarRepository(driver, () => new Date(2026, 10, 12, 12)) };
}
const inWeek = (snapshot, week) => snapshot.events.filter(row => row.date >= week && row.date < addDays(week, 7));
const markers = db => db.prepare('SELECT * FROM initialized_weeks ORDER BY weekStart').all();
async function seed(repo) {
  const id = (await repo.initialize()).presets[0].id;
  await repo.saveTemplate(base, 'monday', id);
  await repo.saveTemplate({ ...base, title: '일요일 밤', weekday: 6, startMinute: 1410, endMinute: 1440, color: '#E487A5' }, 'sunday', id);
  return id;
}

for (const week of ['2024-12-30', '2026-11-09', '2027-01-04']) {
  test(`manual import into ${week} keeps weekdays, midnight, new IDs and source/default/other weeks`, async t => {
    const { db, repo } = database(); t.after(() => db.close()); const id = await seed(repo);
    await repo.saveEvent({ ...base, date: addDays(week, -1) }, 'before');
    await repo.saveEvent({ ...base, date: addDays(week, 7) }, 'after');
    const before = await repo.ensureWeek(week); assert.equal(inWeek(before, week).length, 0);
    const result = await repo.applyPresetToWeek(id, addDays(week, 3));
    assert.deepEqual(result.templates, before.templates); assert.deepEqual(result.presets, before.presets);
    assert.deepEqual(result.events.filter(row => ['before', 'after'].includes(row.id)), before.events);
    const copied = inWeek(result, week);
    assert.equal(copied.length, 2);
    for (const [index, row] of copied.entries()) {
      const source = before.templates[index];
      assert.equal(row.date, addDays(week, source.weekday));
      assert.notEqual(row.id, source.id);
      for (const key of ['title', 'color', 'startMinute', 'endMinute', 'calendarId']) assert.equal(row[key], source[key]);
    }
    await repo.saveEvent({ ...copied[0], title: '주간에서 수정' }, copied[0].id);
    assert.deepEqual((await repo.initialize()).templates, before.templates);
    await repo.deletePreset(id);
    assert.equal(inWeek(await repo.initialize(), week).length, 2);
  });
}

test('occupied week requires explicit replacement; confirmation changes only its rows', async t => {
  const { db, repo } = database(); t.after(() => db.close()); const id = await seed(repo);
  await repo.saveEvent({ ...base, date: '2026-11-10' }, 'manual');
  await repo.saveEvent({ ...base, date: '2026-11-16' }, 'other');
  const before = await repo.initialize(), oldMarkers = markers(db);
  await assert.rejects(repo.applyPresetToWeek(id, '2026-11-09'), WeekReplacementRequiredError);
  assert.deepEqual(await repo.initialize(), before); assert.deepEqual(markers(db), oldMarkers);
  const result = await repo.applyPresetToWeek(id, '2026-11-09', true);
  assert(!result.events.some(row => row.id === 'manual'));
  assert.deepEqual(result.events.find(row => row.id === 'other'), before.events.find(row => row.id === 'other'));
  assert.equal(inWeek(result, '2026-11-09').length, 2);
  assert.deepEqual(result.templates, before.templates); assert.deepEqual(result.presets, before.presets);
});

test('empty preset cannot silently clear an occupied week; missing or overlapping source never replaces it', async t => {
  const { db, repo } = database(); t.after(() => db.close()); const id = await seed(repo);
  await repo.saveEvent({ ...base, date: '2026-11-09' }, 'manual');
  const empty = (await repo.createPreset()).presets.at(-1).id;
  const before = await repo.initialize();
  await assert.rejects(repo.applyPresetToWeek(empty, '2026-11-09'), WeekReplacementRequiredError);
  await assert.rejects(repo.applyPresetToWeek('missing', '2026-11-09', true));
  assert.deepEqual(await repo.initialize(), before);
  db.prepare('INSERT INTO templates VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('overlap', id, 'personal', '기존 겹침', 0, 570, 630, '#426FD0', 'created', 'updated');
  const legacy = await repo.initialize();
  await assert.rejects(repo.applyPresetToWeek(id, '2026-11-09', true), /겹치는 일정/);
  assert.deepEqual(await repo.initialize(), legacy);
  assert.deepEqual((await repo.ensureWeek('2027-05-03')).events, legacy.events);
  assert.equal((await repo.applyPresetToWeek(empty, '2026-11-09', true)).events.length, 0);
});

for (const failure of ['delete', 'second-copy', 'marker', 'snapshot', 'commit']) {
  test(`replacement failure at ${failure} restores all original rows and week markers`, async t => {
    const { db, driver, repo } = database(); t.after(() => db.close()); const id = await seed(repo);
    await repo.saveEvent({ ...base, date: '2026-11-09' }, 'original');
    await repo.saveEvent({ ...base, date: '2026-11-15' }, 'original-sunday');
    await repo.saveEvent({ ...base, date: '2026-11-16' }, 'other-week');
    const before = await repo.initialize(), oldMarkers = markers(db);
    const run = driver.runAsync, get = driver.getAllAsync, exec = driver.execAsync; let inserts = 0;
    driver.runAsync = async (sql, ...args) => {
      if ((failure === 'delete' && sql.startsWith('DELETE FROM events')) || (failure === 'second-copy' && sql.startsWith('INSERT INTO events') && ++inserts === 2) ||
          (failure === 'marker' && sql.includes('INSERT OR IGNORE INTO initialized_weeks'))) throw new Error('injected write failure');
      return run(sql, ...args);
    };
    driver.getAllAsync = async (sql, ...args) => { if (failure === 'snapshot' && sql === 'SELECT * FROM events ORDER BY date, startMinute, id') throw new Error('injected read failure'); return get(sql, ...args); };
    driver.execAsync = async sql => { if (failure === 'commit' && sql === 'COMMIT') throw new Error('injected commit failure'); return exec(sql); };
    await assert.rejects(repo.applyPresetToWeek(id, '2026-11-09', true));
    Object.assign(driver, { runAsync: run, getAllAsync: get, execAsync: exec });
    assert.deepEqual(await repo.initialize(), before); assert.deepEqual(markers(db), oldMarkers);
    assert.equal(inWeek(await repo.applyPresetToWeek(id, '2026-11-09', true), '2026-11-09').length, 2);
  });
}

test('concurrent empty-week imports cannot duplicate or replace without confirmation', async t => {
  const { db, repo } = database(); t.after(() => db.close()); const id = await seed(repo);
  const results = await Promise.allSettled([repo.applyPresetToWeek(id, '2026-11-09'), repo.applyPresetToWeek(id, '2026-11-09'), repo.ensureWeek('2026-11-09')]);
  assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].status, 'rejected');
  assert(results[1].reason instanceof WeekReplacementRequiredError);
  assert.equal((await repo.initialize()).events.length, 2); assert.equal(markers(db).length, 1);
});

for (const failure of ['delete', 'marker', 'snapshot', 'commit']) {
  test(`clearWeek failure at ${failure} is atomic and retry clears only Monday through Sunday`, async t => {
    const { db, repo, driver } = database(); t.after(() => db.close()); const id = await seed(repo);
    await repo.applyPresetToWeek(id, '2026-11-09');
    for (const date of ['2026-11-08', '2026-11-10', '2026-11-16']) await repo.saveEvent({ ...base, date }, date);
    const before = await repo.initialize(), oldMarkers = markers(db);
    const run = driver.runAsync, get = driver.getAllAsync, exec = driver.execAsync;
    driver.runAsync = async (sql, ...args) => { if ((failure === 'delete' && sql.startsWith('DELETE FROM events')) || (failure === 'marker' && sql.includes('INSERT OR IGNORE INTO initialized_weeks'))) throw new Error('write failure'); return run(sql, ...args); };
    driver.getAllAsync = async (sql, ...args) => { if (failure === 'snapshot' && sql === 'SELECT * FROM events ORDER BY date, startMinute, id') throw new Error('read failure'); return get(sql, ...args); };
    driver.execAsync = async sql => { if (failure === 'commit' && sql === 'COMMIT') throw new Error('commit failure'); return exec(sql); };
    await assert.rejects(repo.clearWeek('2026-11-12'));
    Object.assign(driver, { runAsync: run, getAllAsync: get, execAsync: exec });
    assert.deepEqual(await repo.initialize(), before); assert.deepEqual(markers(db), oldMarkers);
    const after = await repo.clearWeek('2026-11-12');
    assert.deepEqual(after.events, before.events.filter(row => ['2026-11-08', '2026-11-16'].includes(row.id)));
    assert.deepEqual(after.templates, before.templates); assert.deepEqual(after.presets, before.presets);
    assert.deepEqual((await repo.ensureWeek('2026-11-09')).events, after.events);
  });
}

test('cleared week stays empty on file reopen and accepts a different preset without touching other weeks', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'quick-manual-')), file = join(folder, 'calendar.db'); let connection;
  try {
    connection = database(file); const id = await seed(connection.repo);
    await connection.repo.applyPresetToWeek(id, '2026-11-09');
    await connection.repo.applyPresetToWeek(id, '2026-11-16');
    const next = (await connection.repo.createPreset()).presets.at(-1).id;
    await connection.repo.saveTemplate({ ...base, title: '방학 일정' }, 'vacation', next);
    const cleared = await connection.repo.clearWeek('2026-11-09');
    connection.db.close(); connection = database(file);
    assert.deepEqual(await connection.repo.initialize(), cleared);
    assert.deepEqual(await connection.repo.ensureWeek('2026-11-09'), cleared);
    const result = await connection.repo.applyPresetToWeek(next, '2026-11-09');
    assert.equal(inWeek(result, '2026-11-09')[0].title, '방학 일정');
    assert.deepEqual(inWeek(result, '2026-11-16'), cleared.events);
    assert.deepEqual(result.templates, cleared.templates); assert.deepEqual(result.presets, cleared.presets);
  } finally { connection?.db.close(); unlinkSync(file); rmdirSync(folder); }
});

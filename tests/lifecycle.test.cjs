const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { readFileSync, mkdtempSync, unlinkSync, rmdirSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { CalendarRepository } = require('../.test-build/lib/repository');
const { nextApplyWeek } = require('../.test-build/lib/presets');

const base = { title: '새 기본 일정', weekday: 0, startMinute: 540, endMinute: 600, color: '#426FD0' };
function database(path = ':memory:', now = () => new Date(2026, 10, 10, 12)) {
  const db = new DatabaseSync(path);
  const driver = {
    execAsync: async sql => { db.exec(sql); },
    runAsync: async (sql, ...values) => db.prepare(sql).run(...values),
    getAllAsync: async (sql, ...values) => db.prepare(sql).all(...values),
  };
  return { db, driver, repo: new CalendarRepository(driver, now) };
}
const inWeek = (snapshot, week) => snapshot.events.filter(event => event.date >= week && event.date <= require('../.test-build/lib/dates').addDays(week, 6));
function records(db) {
  return Object.fromEntries(['events', 'templates', 'timetable_presets', 'initialized_weeks', 'calendars'].map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()]));
}
function seedV2(db, selected = true) {
  db.exec(readFileSync(join(__dirname, 'fixtures/schema-v2.sql'), 'utf8'));
  db.prepare('INSERT INTO timetable_presets VALUES (?, ?, ?, ?, ?)').run('old-preset', '시험 기간', Number(selected), 'created', 'updated');
  db.prepare('INSERT INTO timetable_presets VALUES (?, ?, ?, ?, ?)').run('other-preset', '방학', 0, 'created-other', 'updated-other');
  db.exec(`INSERT INTO templates VALUES ('block', 'old-preset', 'personal', '보존할 원본', 0, 540, 600, '#426FD0', 'created-block', 'updated-block');
    INSERT INTO events VALUES ('instance', 'personal', '수정한 주간 사본', '2026-11-09', 600, 660, '#426FD0', 'created-event', 'updated-event', 'block');
    INSERT INTO initialized_weeks VALUES ('2026-11-09', 'old-marker');
    INSERT INTO initialized_weeks VALUES ('2026-11-23', 'opened-empty');`);
}
async function seedData(repo, db) {
  const first = (await repo.initialize()).presets[0].id;
  await repo.saveTemplate(base, 'template', first);
  await repo.ensureWeek('2026-11-16');
  await repo.saveEvent({ ...base, date: '2026-11-10' }, 'manual');
  await repo.createPreset({ kind: 'preset', presetId: first });
  await repo.ensureWeek('2026-12-07');
  db.exec("INSERT INTO calendars VALUES ('extra-calendar', '테스트 캘린더')");
}

test('activation always starts next local Monday, including Monday, Sunday, leap day and year end', () => {
  for (const [date, expected] of [
    [new Date(2026, 10, 10, 12), '2026-11-16'], [new Date(2026, 10, 9, 0, 0), '2026-11-16'],
    [new Date(2026, 10, 8, 23, 59), '2026-11-09'], [new Date(2026, 11, 31, 23, 59), '2027-01-04'],
    [new Date(2024, 1, 29, 12), '2024-03-04'],
  ]) assert.equal(nextApplyWeek(date), expected);
});

test('v2 -> v3 only adds activation metadata and preserves IDs, presets, dated events and empty-week markers', async t => {
  const { db, repo } = database(); t.after(() => db.close()); seedV2(db);
  const before = records(db);
  const snapshot = await repo.initialize();
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 3);
  const after = records(db);
  for (const table of ['events', 'templates', 'initialized_weeks', 'calendars']) assert.deepEqual(after[table], before[table]);
  for (const preset of snapshot.presets) {
    const { applyFromWeek, ...original } = preset;
    assert.deepEqual(original, { ...before.timetable_presets.find(row => row.id === preset.id) });
    assert.equal(applyFromWeek, preset.isDefault ? '2026-11-16' : null);
  }
  assert.deepEqual(await new CalendarRepository({
    execAsync: async sql => db.exec(sql), runAsync: async (sql, ...args) => db.prepare(sql).run(...args), getAllAsync: async (sql, ...args) => db.prepare(sql).all(...args),
  }, () => new Date(2027, 0, 5, 12)).initialize(), snapshot);
  assert.deepEqual(inWeek(await repo.ensureWeek('2026-11-02'), '2026-11-02'), []);
  assert.deepEqual(inWeek(await repo.ensureWeek('2026-11-09'), '2026-11-09'), snapshot.events);
  assert.deepEqual(inWeek(await repo.ensureWeek('2026-11-23'), '2026-11-23'), []);
  assert.equal(inWeek(await repo.ensureWeek('2026-11-16'), '2026-11-16').length, 1);
});

test('v2 with no default stays unselected; failed activation migration rolls back the column and version', async t => {
  const { db, repo, driver } = database(); t.after(() => db.close()); seedV2(db, false);
  const before = records(db); const run = driver.runAsync;
  driver.runAsync = async (sql, ...args) => { if (sql.startsWith('UPDATE timetable_presets SET applyFromWeek')) throw new Error('migration failure'); return run(sql, ...args); };
  await assert.rejects(repo.initialize());
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 2);
  assert(!db.prepare('PRAGMA table_info(timetable_presets)').all().some(row => row.name === 'applyFromWeek'));
  assert.deepEqual(records(db), before);
  driver.runAsync = run;
  const after = await repo.initialize();
  assert(after.presets.every(preset => !preset.isDefault && preset.applyFromWeek === null));
  assert.deepEqual(after.events, before.events);
});

test('Nov 10 activation preserves past/current, opened-empty and manual future weeks; only untouched Nov 16+ can copy', async t => {
  let now = new Date(2026, 10, 10, 12);
  const { db, repo } = database(':memory:', () => now); t.after(() => db.close());
  await repo.initialize(); await repo.setDefaultPreset(null);
  await repo.ensureWeek('2026-11-23');
  await repo.saveEvent({ ...base, title: '수동 미래 일정', date: '2026-12-01' }, 'manual');
  const originalEvents = (await repo.initialize()).events;
  const created = await repo.createPreset(); const preset = created.presets.at(-1);
  assert.deepEqual(created.events, originalEvents); assert.equal(preset.applyFromWeek, null); assert.equal(preset.isDefault, 0);
  await repo.saveTemplate(base, 'new-default', preset.id);
  const selected = await repo.setDefaultPreset(preset.id);
  assert.deepEqual(selected.events, originalEvents);
  assert.equal(selected.presets.find(row => row.id === preset.id).applyFromWeek, '2026-11-16');
  for (const week of ['2026-11-02', '2026-11-09', '2026-11-23']) assert.deepEqual(inWeek(await repo.ensureWeek(week), week), []);
  assert.deepEqual(inWeek(await repo.ensureWeek('2026-11-30'), '2026-11-30'), originalEvents);
  let snapshot = await repo.ensureWeek('2026-11-16');
  const generated = inWeek(snapshot, '2026-11-16')[0];
  assert.equal(generated.title, base.title); assert.equal(generated.date, '2026-11-16');
  await repo.deleteEvent(generated.id);
  assert.deepEqual(inWeek(await repo.ensureWeek('2026-11-16'), '2026-11-16'), []);
  now = new Date(2026, 10, 17, 12);
  const next = (await repo.createPreset()).presets.at(-1);
  await repo.saveTemplate({ ...base, title: '바꾼 기본 일정' }, 'replacement-default', next.id);
  const beforeChange = await repo.initialize();
  snapshot = await repo.setDefaultPreset(next.id);
  assert.deepEqual(snapshot.events, beforeChange.events);
  assert.equal(snapshot.presets.find(row => row.id === next.id).applyFromWeek, '2026-11-23');
  assert.deepEqual(inWeek(await repo.ensureWeek('2026-11-23'), '2026-11-23'), []);
  assert.deepEqual(inWeek(await repo.ensureWeek('2026-11-16'), '2026-11-16'), []);
  assert.equal(inWeek(await repo.ensureWeek('2026-12-07'), '2026-12-07')[0].title, '바꾼 기본 일정');
  assert.deepEqual(inWeek(await repo.ensureWeek('2026-11-30'), '2026-11-30'), originalEvents);
});

test('changing default never rewrites dated copies; unselecting clears policy and protects subsequently opened empty weeks', async t => {
  let now = new Date(2026, 10, 1, 12);
  const { db, repo } = database(':memory:', () => now); t.after(() => db.close());
  const first = (await repo.initialize()).presets[0]; await repo.saveTemplate(base, 'first-block', first.id);
  const before = await repo.ensureWeek('2026-11-09');
  now = new Date(2026, 10, 10, 12);
  const next = (await repo.createPreset()).presets.at(-1); await repo.saveTemplate({ ...base, title: '두 번째 기본 일정' }, 'second-block', next.id);
  let snapshot = await repo.setDefaultPreset(next.id);
  assert.deepEqual(snapshot.events, before.events);
  assert.equal(snapshot.presets.find(row => row.id === first.id).applyFromWeek, null);
  await repo.setDefaultPreset(null);
  snapshot = await repo.ensureWeek('2026-11-16');
  assert.deepEqual(inWeek(snapshot, '2026-11-16'), []);
  assert(snapshot.presets.every(row => !row.isDefault && row.applyFromWeek === null));
  await repo.setDefaultPreset(next.id);
  now = new Date(2026, 10, 24, 12);
  // Tapping the already selected preset is idempotent, not a new activation.
  snapshot = await repo.setDefaultPreset(next.id);
  assert.equal(snapshot.presets.find(row => row.id === next.id).applyFromWeek, '2026-11-16');
  assert.deepEqual(inWeek(await repo.ensureWeek('2026-11-16'), '2026-11-16'), []);
  assert.deepEqual(inWeek(await repo.ensureWeek('2026-11-09'), '2026-11-09'), before.events);
});

test('file reopen preserves original activation date without rebasing to restart time', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'quick-activation-')); const path = join(folder, 'calendar.db');
  let connection;
  try {
    connection = database(path);
    const preset = (await connection.repo.initialize()).presets[0]; await connection.repo.saveTemplate(base, 'source', preset.id);
    connection.db.close(); connection = database(path, () => new Date(2027, 0, 5, 12));
    const snapshot = await connection.repo.initialize();
    assert.equal(snapshot.presets[0].applyFromWeek, '2026-11-16');
    assert.deepEqual(inWeek(await connection.repo.ensureWeek('2026-11-09'), '2026-11-09'), []);
    assert.equal(inWeek(await connection.repo.ensureWeek('2026-11-16'), '2026-11-16').length, 1);
  } finally { connection?.db.close(); unlinkSync(path); rmdirSync(folder); }
});

test('reset clears all app data and activation records, preserves schema and other DBs, and allows a fresh event/template', async t => {
  const { db, repo } = database(); t.after(() => db.close()); await seedData(repo, db);
  const other = database(); t.after(() => other.db.close()); await other.repo.initialize(); await other.repo.saveEvent({ ...base, date: '2026-11-10' }, 'other-project');
  const otherBefore = await other.repo.initialize();
  db.exec("CREATE TABLE unrelated_data (value TEXT); INSERT INTO unrelated_data VALUES ('leave-alone')");
  const schemaBefore = db.prepare('SELECT type, name, sql FROM sqlite_master ORDER BY name').all();
  const snapshot = await repo.resetData();
  assert.deepEqual(snapshot, { events: [], templates: [], presets: [] });
  assert.equal(db.prepare('SELECT * FROM initialized_weeks').all().length, 0);
  assert.deepEqual(db.prepare('SELECT id FROM calendars').all().map(row => row.id), ['personal']);
  assert.deepEqual(db.prepare('SELECT type, name, sql FROM sqlite_master ORDER BY name').all(), schemaBefore);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 3);
  assert.equal(db.prepare('SELECT value FROM unrelated_data').get().value, 'leave-alone');
  assert.deepEqual(await other.repo.initialize(), otherBefore);
  assert.deepEqual(await repo.initialize(), snapshot);
  assert.equal((await repo.saveEvent({ ...base, date: '2026-11-11' })).events.length, 1);
  const fresh = await repo.createPreset(); assert.equal(fresh.presets[0].name, '기본 시간표 1'); assert.equal(fresh.presets[0].isDefault, 0); assert.equal(fresh.presets[0].applyFromWeek, null);
  assert.equal(inWeek(await repo.ensureWeek('2026-12-14'), '2026-12-14').length, 0);
});

for (const failure of ['DELETE FROM events', 'DELETE FROM templates', 'DELETE FROM timetable_presets', 'DELETE FROM initialized_weeks', 'DELETE FROM calendars', 'snapshot']) {
  test(`reset failure at ${failure} rolls back every deletion and permits retry`, async t => {
    const { db, repo, driver } = database(); t.after(() => db.close()); await seedData(repo, db);
    const before = records(db); const snapshot = await repo.initialize();
    const run = driver.runAsync, get = driver.getAllAsync;
    driver.runAsync = async (sql, ...args) => { if (sql.startsWith(failure)) throw new Error('delete failure'); return run(sql, ...args); };
    driver.getAllAsync = async (sql, ...args) => { if (failure === 'snapshot' && sql === 'SELECT * FROM events ORDER BY date, startMinute, id') throw new Error('snapshot failure'); return get(sql, ...args); };
    await assert.rejects(repo.resetData());
    driver.runAsync = run; driver.getAllAsync = get;
    assert.deepEqual(records(db), before); assert.deepEqual(await repo.initialize(), snapshot);
    assert.deepEqual(await repo.resetData(), { events: [], templates: [], presets: [] });
  });
}

test('reset persists as an empty v3 database on file reopen and never recreates the migrated default preset', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'quick-reset-')); const path = join(folder, 'calendar.db'); let connection;
  try {
    connection = database(path); await seedData(connection.repo, connection.db); await connection.repo.resetData();
    connection.db.close(); connection = database(path);
    assert.deepEqual(await connection.repo.initialize(), { events: [], templates: [], presets: [] });
    assert.equal(connection.db.prepare('SELECT * FROM initialized_weeks').all().length, 0);
    assert.equal(connection.db.prepare('PRAGMA user_version').get().user_version, 3);
  } finally { connection?.db.close(); unlinkSync(path); rmdirSync(folder); }
});

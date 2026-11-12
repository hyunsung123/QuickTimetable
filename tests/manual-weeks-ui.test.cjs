const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { CalendarRepository } = require('../.test-build/lib/repository');
const { createUiHarness } = require('./ui-harness.cjs');
const base = { title: '학기 일정', weekday: 0, startMinute: 540, endMinute: 600, color: '#426FD0' };
const week = '2026-11-09';
const button = (ui, label) => ui.renderer.root.findAllByType('Pressable').find(node => node.props.accessibilityLabel === label);
const radio = ui => ui.renderer.root.findAllByType('Pressable').filter(node => node.props.accessibilityRole === 'radio');
const texts = ui => ui.renderer.root.findAllByType('Text').map(node => node.props.children);
const dialog = ui => ui.renderer.root.findByType(ui.load('src/components/ui/confirmation-dialog.tsx').ConfirmationDialog);
const grids = ui => ui.renderer.root.findAllByType(ui.load('src/components/timetable/timetable-grid.tsx').TimetableGrid);
async function mount(t, { screen = 'picker', occupied = false, empty = false, template = false } = {}) {
  const db = new DatabaseSync(':memory:');
  const driver = {
    execAsync: async sql => db.exec(sql), runAsync: async (sql, ...args) => db.prepare(sql).run(...args), getAllAsync: async (sql, ...args) => db.prepare(sql).all(...args),
  };
  const repo = new CalendarRepository(driver, () => new Date(2026, 10, 12, 12));
  const first = (await repo.initialize()).presets[0].id;
  await repo.saveTemplate(base, 'first-block', first);
  const second = (await repo.createPreset()).presets.at(-1).id;
  await repo.saveTemplate({ ...base, title: '방학 일정', weekday: 2 }, 'second-block', second);
  await repo.setDefaultPreset(second);
  if (occupied) await repo.applyPresetToWeek(first, week);
  await repo.saveEvent({ ...base, date: '2026-11-16' }, 'other-week');
  if (empty) await repo.resetData();
  const ui = createUiHarness({ repository: repo });
  const { CalendarProvider, useCalendar } = ui.load('src/hooks/use-calendar.tsx');
  const Component = screen === 'picker' ? ui.load('src/components/timetable/timetable-picker.tsx').TimetablePicker : ui.load('src/components/timetable/planning-screen.tsx').PlanningScreen;
  let calendar;
  function Content() { calendar = useCalendar(); return calendar.initialized ? ui.React.createElement(Component, screen === 'picker' ? { weekStart: week } : template ? { presetId: first } : {}) : null; }
  let renderer;
  await ui.TestRenderer.act(async () => { renderer = ui.TestRenderer.create(ui.React.createElement(CalendarProvider, null, ui.React.createElement(Content))); });
  await ui.TestRenderer.act(async () => { calendar.setSelectedDate('2026-11-12'); calendar.setClipboard({ title: base.title, color: base.color, durationMinute: 60 }); });
  t.after(async () => { await ui.TestRenderer.act(async () => renderer.unmount()); db.close(); });
  return { ...ui, renderer, repo, db, driver, first, second, calendar: () => calendar, act: ui.TestRenderer.act };
}

test('picker puts checked default first; choosing and previewing another preset writes nothing', async t => {
  const ui = await mount(t), before = await ui.repo.initialize();
  assert.deepEqual(radio(ui).map(row => row.props.accessibilityLabel), ['기본 시간표 2, 기본', '기본 시간표 1']);
  assert(texts(ui).includes('✓ 기본')); assert.equal(button(ui, '불러오기').props.disabled, true);
  await ui.act(async () => radio(ui)[1].props.onPress());
  assert.equal(grids(ui)[0].props.readOnly, true); assert.equal(grids(ui)[0].props.weekStart, week);
  assert.equal(grids(ui)[0].props.events[0].title, base.title);
  assert.equal(button(ui, '불러오기').props.disabled, false);
  assert.deepEqual(await ui.repo.initialize(), before);
  assert.deepEqual(ui.calendar().presets, before.presets);
  await ui.act(async () => ui.calendar().setDefaultPreset(null));
  assert.deepEqual(radio(ui).map(row => row.props.accessibilityLabel), ['기본 시간표 1', '기본 시간표 2']);
});

test('empty-week apply has no replacement dialog, targets the captured week, updates Provider and keeps clipboard/default', async t => {
  const ui = await mount(t), before = await ui.repo.initialize();
  await ui.act(async () => { ui.calendar().setSelectedDate('2027-05-03'); radio(ui)[1].props.onPress(); });
  await ui.act(async () => { const apply = button(ui, '불러오기').props.onPress; apply(); apply(); });
  assert.equal(ui.renderer.root.findAllByType('Modal').length, 0);
  assert.equal(ui.calendar().events.filter(row => row.date === week).length, 1);
  assert.equal(ui.calendar().events.find(row => row.id === 'other-week').date, '2026-11-16');
  assert.equal(ui.calendar().events.some(row => row.date === '2027-05-03'), false);
  assert.equal(ui.calendar().selectedDate, week);
  assert.deepEqual(ui.calendar().templates, before.templates); assert.deepEqual(ui.calendar().presets, before.presets);
  assert.equal(ui.calendar().clipboard.title, base.title);
  assert.deepEqual(ui.calendar().events, (await ui.repo.initialize()).events);
  assert.deepEqual(ui.navigation, [{ method: 'back', args: [] }]);
});

test('replacement cancellation preserves all data; confirming replaces only selected week without changing default', async t => {
  const ui = await mount(t, { occupied: true }), before = await ui.repo.initialize();
  await ui.act(async () => radio(ui)[0].props.onPress());
  await ui.act(async () => button(ui, '불러오기').props.onPress());
  assert.equal(dialog(ui).props.title, '이 주의 시간표를 변경할까요?');
  assert.equal(dialog(ui).props.message, '현재 주의 기존 일정이 삭제되고 선택한 시간표로 교체됩니다.');
  assert.equal(dialog(ui).props.confirmLabel, '시간표 교체');
  await ui.act(async () => dialog(ui).props.onCancel());
  assert.deepEqual(await ui.repo.initialize(), before); assert.deepEqual(ui.calendar().events, before.events);
  await ui.act(async () => button(ui, '불러오기').props.onPress());
  await ui.act(async () => dialog(ui).props.onConfirm());
  assert.equal(ui.calendar().events.length, 2);
  assert.equal(ui.calendar().events.find(row => row.date === '2026-11-11').title, '방학 일정');
  assert(!ui.calendar().events.some(row => row.id === before.events[0].id));
  assert.deepEqual(ui.calendar().presets, before.presets); assert.deepEqual(ui.calendar().templates, before.templates);
});

test('week populated after preview requires confirmation at the repository boundary', async t => {
  const ui = await mount(t);
  await ui.act(async () => radio(ui)[0].props.onPress());
  await ui.repo.saveEvent({ ...base, date: week }, 'late-manual'); // Provider intentionally still has the earlier snapshot.
  await ui.act(async () => button(ui, '불러오기').props.onPress());
  assert.equal(dialog(ui).props.confirmLabel, '시간표 교체');
  assert((await ui.repo.initialize()).events.some(row => row.id === 'late-manual'));
  await ui.act(async () => dialog(ui).props.onCancel());
  assert((await ui.repo.initialize()).events.some(row => row.id === 'late-manual'));
  assert.deepEqual(ui.navigation, []);
});

test('replacement write failure keeps SQLite and Provider intact and shows error without navigating', async t => {
  const ui = await mount(t, { occupied: true }), before = await ui.repo.initialize();
  const run = ui.driver.runAsync;
  ui.driver.runAsync = async (sql, ...args) => { if (sql.startsWith('INSERT INTO events')) throw new Error('disk full'); return run(sql, ...args); };
  await ui.act(async () => radio(ui)[0].props.onPress());
  await ui.act(async () => button(ui, '불러오기').props.onPress());
  await ui.act(async () => dialog(ui).props.onConfirm());
  assert.match(dialog(ui).props.error, /기존 일정은 유지/);
  assert.equal(dialog(ui).props.busy, false); assert.deepEqual(ui.navigation, []);
  assert.deepEqual(ui.calendar().events, before.events); assert.deepEqual(await ui.repo.initialize(), before);
});

test('picker with no stored presets offers creation and does not apply a default implicitly', async t => {
  const ui = await mount(t, { empty: true });
  assert(texts(ui).includes('저장된 시간표가 없습니다.')); assert.equal(button(ui, '불러오기').props.disabled, true);
  await ui.act(async () => button(ui, '기본 시간표 만들기').props.onPress());
  assert.deepEqual(ui.navigation, [{ method: 'push', args: ['/default-timetable'] }]);
  assert.deepEqual(await ui.repo.initialize(), { events: [], templates: [], presets: [] });
});

test('weekly toolbar captures selected week; clearing cancel preserves data and confirm refreshes the grid only for that week', async t => {
  const ui = await mount(t, { screen: 'weekly', occupied: true }), before = await ui.repo.initialize();
  await ui.act(async () => button(ui, '시간표 불러오기').props.onPress());
  assert.deepEqual(ui.navigation.at(-1), { method: 'push', args: [{ pathname: '/select-timetable', params: { weekStart: week } }] });
  await ui.act(async () => button(ui, '전체 삭제').props.onPress());
  assert.equal(dialog(ui).props.title, '이번 주의 일정을 모두 지울까요?');
  assert.equal(dialog(ui).props.message, '선택한 주의 모든 일정이 삭제됩니다. 이 작업은 되돌릴 수 없습니다.');
  assert.equal(dialog(ui).props.destructive, true);
  await ui.act(async () => dialog(ui).props.onCancel()); assert.deepEqual(await ui.repo.initialize(), before);
  await ui.act(async () => button(ui, '전체 삭제').props.onPress());
  await ui.act(async () => { const clear = dialog(ui).props.onConfirm; clear(); clear(); });
  assert.equal(grids(ui)[0].props.events.length, 0); assert.equal(button(ui, '전체 삭제').props.disabled, true);
  assert.deepEqual(ui.calendar().events.map(row => row.id), ['other-week']);
  assert.deepEqual(ui.calendar().templates, before.templates); assert.deepEqual(ui.calendar().presets, before.presets);
  assert.equal(ui.calendar().clipboard.title, base.title);
  assert.equal(ui.renderer.root.findAllByType('Modal').length, 0);
  await ui.act(async () => button(ui, '다음 주').props.onPress());
  assert.equal(grids(ui)[0].props.events[0].id, 'other-week');
  await ui.act(async () => button(ui, '시간표 불러오기').props.onPress());
  assert.equal(ui.navigation.at(-1).args[0].params.weekStart, '2026-11-16');
});

test('clear failure keeps grid and clipboard, shows an error and allows retry', async t => {
  const ui = await mount(t, { screen: 'weekly', occupied: true }), before = await ui.repo.initialize();
  const run = ui.driver.runAsync;
  ui.driver.runAsync = async (sql, ...args) => { if (sql.includes('INSERT OR IGNORE INTO initialized_weeks')) throw new Error('marker failure'); return run(sql, ...args); };
  await ui.act(async () => button(ui, '전체 삭제').props.onPress());
  await ui.act(async () => dialog(ui).props.onConfirm());
  assert.match(dialog(ui).props.error, /기존 일정은 유지/); assert.equal(grids(ui)[0].props.events.length, 1);
  assert.deepEqual(await ui.repo.initialize(), before); assert.deepEqual(ui.calendar().events, before.events);
  ui.driver.runAsync = run;
  await ui.act(async () => dialog(ui).props.onConfirm());
  assert.equal(grids(ui)[0].props.events.length, 0); assert.equal(ui.calendar().clipboard.title, base.title);
});

test('new weekly screen stays empty despite checked default; template editor never has weekly actions', async t => {
  const weekly = await mount(t, { screen: 'weekly' });
  assert.equal(grids(weekly)[0].props.events.length, 0); assert.equal(button(weekly, '전체 삭제').props.disabled, true);
  await weekly.act(async () => button(weekly, '이전 주').props.onPress()); assert.equal(grids(weekly)[0].props.events.length, 0);
  const template = await mount(t, { screen: 'weekly', template: true });
  assert.equal(button(template, '전체 삭제'), undefined); assert.equal(button(template, '시간표 불러오기'), undefined);
  assert.equal(grids(template)[0].props.template, true); assert.equal(grids(template)[0].props.events.length, 1);
});

test('month dots use chronological event colors, four columns and at most two rows; compact is unchanged', async () => {
  const ui = createUiHarness(), { MonthCalendar } = ui.load('src/components/calendar/month-calendar.tsx');
  const events = Array.from({ length: 10 }, (_, i) => ({ ...base, id: `event-${i}`, date: week, startMinute: i * 60, endMinute: i * 60 + 30, color: `#${String(i).repeat(6)}` })).reverse();
  const before = structuredClone(events); let renderer;
  const flatten = value => Array.isArray(value) ? Object.assign({}, ...value.map(flatten)) : value ?? {};
  const props = { selected: week, events, onSelect: () => {} };
  await ui.TestRenderer.act(async () => { renderer = ui.TestRenderer.create(ui.React.createElement(MonthCalendar, props)); });
  const cells = renderer.root.findAllByType('Pressable'); assert.equal(cells.length % 7, 0);
  assert(cells.every(cell => flatten(cell.props.style).width === `${100 / 7}%`));
  const cell = cells.find(cell => cell.props.accessibilityLabel.startsWith(week));
  const dots = cell.findAllByType('View').filter(node => flatten(node.props.style).width === 4);
  assert.deepEqual(dots.map(dot => flatten(dot.props.style).backgroundColor), Array.from({ length: 8 }, (_, i) => `#${String(i).repeat(6)}`));
  const rows = cell.findAllByType('View').filter(node => flatten(node.props.style).flexDirection === 'row');
  assert.deepEqual(rows.map(row => row.children.length), [4, 4]);
  assert(!renderer.root.findAllByType('Text').some(node => node.props.children === '+'));
  assert.deepEqual(events, before);
  await ui.TestRenderer.act(async () => renderer.update(ui.React.createElement(MonthCalendar, { ...props, compact: true })));
  assert.equal(renderer.root.findAllByType('View').filter(node => flatten(node.props.style).width === 4).length, 0);
  await ui.TestRenderer.act(async () => renderer.unmount());
});

test('mypage route has only the requested placeholder and safe-area edges', async () => {
  const ui = createUiHarness(), Component = ui.load('src/app/(tabs)/mypage.tsx').default; let renderer;
  await ui.TestRenderer.act(async () => { renderer = ui.TestRenderer.create(ui.React.createElement(Component)); });
  assert.deepEqual(texts({ renderer }), ['마이페이지', '개발 중', '마이페이지 기능을 준비하고 있어요.']);
  assert.deepEqual(renderer.root.findAllByType('View').find(node => node.props.edges).props.edges, ['top', 'left', 'right']);
  assert.equal(renderer.root.findAllByType('Pressable').length, 0);
  await ui.TestRenderer.act(async () => renderer.unmount());
});

test('picker route rejects missing or malformed target dates instead of changing an unintended week', async () => {
  for (const routeParams of [{}, { weekStart: '2026-02-30' }, { weekStart: ['2026-11-09', '2026-11-16'] }]) {
    const ui = createUiHarness({ routeParams }), Component = ui.load('src/app/select-timetable.tsx').default; let renderer;
    await ui.TestRenderer.act(async () => { renderer = ui.TestRenderer.create(ui.React.createElement(Component)); });
    assert(texts({ renderer }).includes('주간 계획을 선택해 주세요'));
    assert.equal(button({ renderer }, '불러오기'), undefined);
    await ui.TestRenderer.act(async () => renderer.unmount());
  }
});

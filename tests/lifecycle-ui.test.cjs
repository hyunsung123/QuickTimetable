const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { CalendarRepository } = require('../.test-build/lib/repository');
const { dateKey } = require('../.test-build/lib/dates');
const { createUiHarness } = require('./ui-harness.cjs');

const base = { title: '테스트 일정', weekday: 0, startMinute: 540, endMinute: 600, color: '#426FD0' };
async function mountedData(t, screen = 'settings') {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const driver = {
    execAsync: async sql => { db.exec(sql); },
    runAsync: async (sql, ...args) => db.prepare(sql).run(...args),
    getAllAsync: async (sql, ...args) => db.prepare(sql).all(...args),
  };
  const repo = new CalendarRepository(driver, () => new Date(2026, 10, 10, 12));
  const preset = (await repo.initialize()).presets[0];
  await repo.saveTemplate(base, 'template', preset.id);
  await repo.ensureWeek('2026-11-16');
  await repo.saveEvent({ ...base, date: '2026-11-10' }, 'manual');
  const ui = createUiHarness({ repository: repo });
  const { React, TestRenderer, load } = ui;
  const { CalendarProvider, useCalendar } = load('src/hooks/use-calendar.tsx');
  const Component = screen === 'settings' ? load('src/app/settings.tsx').default : load('src/components/timetable/preset-list.tsx').PresetList;
  const consumers = new Map(); let mounts = 0;
  function Consumer({ name }) { consumers.set(name, useCalendar()); return null; }
  function Content() {
    const calendar = useCalendar();
    React.useEffect(() => { mounts++; }, []);
    return calendar.initialized ? React.createElement(React.Fragment, null,
      React.createElement(Component), ...['calendar', 'weekly', 'presets'].map(name => React.createElement(Consumer, { key: name, name }))) : null;
  }
  let renderer;
  await TestRenderer.act(async () => { renderer = TestRenderer.create(React.createElement(CalendarProvider, null, React.createElement(Content))); });
  await TestRenderer.act(async () => {
    consumers.get('calendar').setClipboard({ title: base.title, color: base.color, durationMinute: 60 });
    consumers.get('calendar').setSelectedDate('2027-05-01');
  });
  return { ...ui, db, driver, repo, renderer, consumers, mounts: () => mounts };
}
const button = (renderer, label) => renderer.root.findAllByType('Pressable').find(node => node.props.accessibilityLabel === label);
async function openReset(ui) {
  await ui.TestRenderer.act(async () => button(ui.renderer, '테스트 데이터 초기화').props.onPress());
  return ui.load('src/components/ui/confirmation-dialog.tsx').ConfirmationDialog;
}

test('reset cancellation preserves SQLite, clipboard, selected date and every mounted screen', async t => {
  const ui = await mountedData(t); const { act } = ui.TestRenderer;
  const before = await ui.repo.initialize(); const mounts = ui.mounts();
  const weeks = ui.db.prepare('SELECT * FROM initialized_weeks ORDER BY weekStart').all();
  const Dialog = await openReset(ui);
  const confirmation = ui.renderer.root.findByType(Dialog);
  assert.equal(confirmation.props.title, '테스트 데이터를 모두 삭제할까요?');
  assert.equal(confirmation.props.message, '모든 일정과 저장된 시간표가 삭제됩니다. 이 작업은 되돌릴 수 없습니다.');
  assert.equal(confirmation.props.confirmLabel, '전체 초기화'); assert.equal(confirmation.props.destructive, true);
  await act(async () => confirmation.props.onCancel());
  assert.deepEqual(await ui.repo.initialize(), before);
  assert.deepEqual(ui.db.prepare('SELECT * FROM initialized_weeks ORDER BY weekStart').all(), weeks);
  assert.equal(ui.consumers.get('calendar').clipboard.title, base.title);
  assert.equal(ui.consumers.get('calendar').selectedDate, '2027-05-01'); assert.equal(ui.mounts(), mounts);
  await act(async () => ui.renderer.unmount());
});

test('successful reset publishes empty data to all consumers, clears clipboard and drops local screen state; new events work', async t => {
  const ui = await mountedData(t); const { act } = ui.TestRenderer; const mounts = ui.mounts();
  const Dialog = await openReset(ui);
  await act(async () => ui.renderer.root.findByType(Dialog).props.onConfirm());
  for (const name of ['calendar', 'weekly', 'presets']) {
    const context = ui.consumers.get(name);
    assert.deepEqual(context.events, []); assert.deepEqual(context.templates, []); assert.deepEqual(context.presets, []);
    assert.equal(context.clipboard, null); assert.equal(context.selectedDate, dateKey());
  }
  assert.equal(ui.mounts(), mounts + 1);
  assert.equal(ui.renderer.root.findAllByType(Dialog).length, 0);
  assert.deepEqual(ui.db.prepare('SELECT * FROM initialized_weeks').all(), []);
  await act(async () => ui.consumers.get('calendar').saveEvent({ ...base, date: '2026-11-11' }));
  assert.equal(ui.consumers.get('weekly').events.length, 1);
  await act(async () => {
    const newId = await ui.consumers.get('presets').createPreset();
    await ui.consumers.get('presets').saveTemplate(base, undefined, newId);
  });
  assert.equal(ui.consumers.get('presets').templates.length, 1);
  assert(ui.consumers.get('presets').presets.every(row => !row.isDefault && row.applyFromWeek === null));
  await act(async () => ui.renderer.unmount());
});

test('reset failure preserves Provider snapshots/clipboard/screens, shows an error and allows retry', async t => {
  const ui = await mountedData(t); const { act } = ui.TestRenderer;
  const before = await ui.repo.initialize(); const mounts = ui.mounts(); const run = ui.driver.runAsync;
  ui.driver.runAsync = async (sql, ...args) => { if (sql === 'DELETE FROM templates') throw new Error('disk full'); return run(sql, ...args); };
  const Dialog = await openReset(ui);
  await act(async () => ui.renderer.root.findByType(Dialog).props.onConfirm());
  assert.deepEqual(await ui.repo.initialize(), before);
  for (const context of ui.consumers.values()) {
    assert.deepEqual(context.events, before.events); assert.deepEqual(context.templates, before.templates); assert.deepEqual(context.presets, before.presets);
    assert.equal(context.clipboard.title, base.title);
  }
  assert.equal(ui.mounts(), mounts);
  assert(ui.renderer.root.findByType(Dialog).props.error.includes('기존 데이터는 유지됩니다'));
  assert.equal(ui.renderer.root.findByType(Dialog).props.busy, false);
  ui.driver.runAsync = run;
  await act(async () => ui.renderer.root.findByType(Dialog).props.onConfirm());
  assert.equal(ui.consumers.get('calendar').clipboard, null);
  assert.deepEqual(ui.consumers.get('calendar').events, []);
  await act(async () => ui.renderer.unmount());
});

test('writes attempted while resetting cannot resurrect stale data after reset commit', async t => {
  const ui = await mountedData(t); const { act } = ui.TestRenderer; const run = ui.driver.runAsync;
  let release, reached;
  const waiting = new Promise(resolve => { reached = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  ui.driver.runAsync = async (sql, ...args) => { if (sql === 'DELETE FROM events') { reached(); await gate; } return run(sql, ...args); };
  await act(async () => {
    const reset = ui.consumers.get('calendar').resetData();
    await waiting;
    await assert.rejects(ui.consumers.get('weekly').saveEvent({ ...base, date: '2026-11-11' }), /초기화 중/);
    release(); await reset;
  });
  assert.deepEqual(await ui.repo.initialize(), { events: [], templates: [], presets: [] });
  assert.equal(ui.consumers.get('calendar').clipboard, null);
  await act(async () => ui.renderer.unmount());
});

test('preset list displays the persisted apply date and can unselect the default without editing dated events', async t => {
  const ui = await mountedData(t, 'presets'); const { act } = ui.TestRenderer;
  const before = ui.consumers.get('calendar').events;
  assert(ui.renderer.root.findAllByType('Text').some(node => String(node.props.children).includes('2026. 11. 16')));
  await act(async () => button(ui.renderer, '기본 지정 해제').props.onPress());
  assert(ui.consumers.get('presets').presets.every(preset => !preset.isDefault && preset.applyFromWeek === null));
  assert.deepEqual(ui.consumers.get('calendar').events, before);
  await act(async () => ui.consumers.get('weekly').ensureWeek('2026-12-07'));
  assert.deepEqual(ui.consumers.get('calendar').events, before);
  await act(async () => ui.renderer.unmount());
});

test('three tab routes retain selection styling and bottom safe-area padding', async () => {
  for (const bottom of [0, 34, 59]) {
    const ui = createUiHarness({ safeAreaInsets: { top: 44, bottom, left: 0, right: 0 } });
    const { React, TestRenderer: { act }, load } = ui;
    const TabLayout = load('src/app/(tabs)/_layout.tsx').default;
    const { palette } = load('src/constants/calendar.ts');
    let renderer;
    await act(async () => { renderer = ui.TestRenderer.create(React.createElement(TabLayout)); });
    assert.deepEqual(renderer.root.findAllByType('TabTrigger').map(node => [node.props.name, node.props.href]), [['calendar', './'], ['weekly', '/weekly'], ['sharing', '/sharing']]);
    const tabs = () => renderer.root.findAllByType('Pressable').filter(node => node.props.accessibilityRole === 'tab');
    assert.deepEqual(tabs().map(tab => tab.findByType('Text').props.children), ['달력', '주간 계획', '캘린더 공유']);
    const bar = renderer.root.findAllByType('View').find(node => Array.isArray(node.props.style) && node.props.style[1]?.paddingBottom !== undefined);
    assert.equal(bar.props.style[1].paddingBottom, Math.max(bottom, 10));
    for (const index of [2, 0, 1]) {
      await act(async () => tabs()[index].props.onPress());
      assert.deepEqual(tabs().map(tab => !!tab.props.accessibilityState.selected), [0, 1, 2].map(value => value === index));
      assert.equal(tabs()[index].findByType('Text').props.style[1].color, palette.blue);
    }
    await act(async () => renderer.unmount());
  }
});

test('sharing route renders only the requested coming-soon screen with safe-area edges', async () => {
  const ui = createUiHarness(); const { React, TestRenderer: { act }, load } = ui;
  const SharingScreen = load('src/app/(tabs)/sharing.tsx').default;
  let renderer;
  await act(async () => { renderer = ui.TestRenderer.create(React.createElement(SharingScreen)); });
  assert.deepEqual(renderer.root.findAllByType('Text').map(node => node.props.children), ['캘린더 공유', '개발 중', '다른 사람과 캘린더를 공유하는 기능을 준비하고 있어요.']);
  const safe = renderer.root.findAllByType('View').find(node => node.props.edges);
  assert.deepEqual(safe.props.edges, ['top', 'left', 'right']);
  assert.equal(renderer.root.findAllByType('Pressable').length, 0);
  await act(async () => renderer.unmount());
});

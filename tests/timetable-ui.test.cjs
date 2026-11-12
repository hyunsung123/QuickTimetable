const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { CalendarRepository } = require('../.test-build/lib/repository');
const { resizeBoundary, copyEvent, TimetableActionError } = require('../.test-build/lib/timetable');
const { createUiHarness } = require('./ui-harness.cjs');

const events = [
  { id: 'A', title: '공부', color: '#426FD0', day: 0, startMinute: 540, endMinute: 600 },
  { id: 'B', title: '운동', color: '#4F8A72', day: 0, startMinute: 600, endMinute: 660 },
  { id: 'C', title: '식사', color: '#9875BD', day: 0, startMinute: 660, endMinute: 720 },
];
function gestures(detector) {
  return Object.fromEntries(detector.props.gesture.gestures.map(gesture => [gesture.kind, gesture]));
}
function blockPart(renderer, EventBlock, id, part = 1) {
  const block = renderer.root.findAllByType(EventBlock).find(node => node.props.event.id === id);
  return gestures(block.findAllByType('GestureDetector')[part]);
}
function backdrop(renderer) {
  return gestures(renderer.root.findAllByType('GestureDetector').find(node => node.props.gesture.kind === 'Exclusive'));
}

test('EventBlock callbacks distinguish short tap, stationary hold release, real move and move-back', async () => {
  const { React, TestRenderer, load } = createUiHarness();
  const { act } = TestRenderer;
  const { EventBlock } = load('src/components/timetable/event-block.tsx');
  const edits = [], copies = [], starts = [], updates = [], ends = [];
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(EventBlock, {
      event: events[0], dayWidth: 100, lane: 0, lanes: 1, scrollGestures: [], active: false, selected: false, disabled: false,
      onEdit: id => edits.push(id), onCopy: (...args) => copies.push(args), onBegin: (...args) => { starts.push(args); return true; },
      onUpdate: (...args) => updates.push(args), onEnd: async (...args) => { ends.push(args); },
    }));
  });
  const { Pan: pan, LongPress: hold, Tap: tap } = blockPart(renderer, EventBlock, 'A');
  assert.equal(pan.config.activateAfterLongPress, 350);
  assert.equal(hold.config.minDuration, 350);
  assert.equal(hold.config.maxDistance, 8);
  await act(async () => { pan.callbacks.onBegin(); tap.callbacks.onEnd({}, true); pan.callbacks.onFinalize({}, false); });
  assert.deepEqual(edits, ['A']);
  await act(async () => { pan.callbacks.onBegin(); pan.callbacks.onStart(); hold.callbacks.onEnd({ duration: 500 }, true); pan.callbacks.onFinalize({}, false); });
  assert.deepEqual(copies, [['A', { x: 80, y: 240, width: 100, height: 88 }]]);
  assert.equal(starts.length, 0);
  await act(async () => {
    pan.callbacks.onBegin(); pan.callbacks.onStart();
    pan.callbacks.onUpdate({ translationX: 0, translationY: 10 });
    pan.callbacks.onUpdate({ translationX: 100, translationY: 26 });
    pan.callbacks.onUpdate({ translationX: 0, translationY: 0 });
    pan.callbacks.onFinalize({}, true);
    hold.callbacks.onEnd({ duration: 800 }, true);
    tap.callbacks.onEnd({}, true);
  });
  assert.deepEqual(starts, [['A', 'move']]);
  assert.equal(updates.length, 3);
  assert.deepEqual(ends, [['A', true]]);
  assert.equal(copies.length, 1);
  assert.equal(edits.length, 1);
  await act(async () => renderer.unmount());
});

async function mountedGrid(options = {}) {
  const calendar = { clipboard: null, setClipboard(value) { this.clipboard = value; }, ...options.calendar };
  // The real Provider setter is closure-bound, so use the same calling convention.
  calendar.setClipboard = value => { calendar.clipboard = value; };
  const harness = createUiHarness({ calendar });
  const { React, TestRenderer, load } = harness;
  const { TimetableGrid } = load('src/components/timetable/timetable-grid.tsx');
  const { EventBlock } = load('src/components/timetable/event-block.tsx');
  const { TimetableContextMenu } = load('src/components/timetable/context-menu.tsx');
  const props = {
    events, weekStart: '2026-11-09', selectedDay: 0, onSelectDay: () => {}, onCreate: () => {}, onEdit: () => {},
    onChange: async () => {}, onResize: async () => {}, onPaste: async () => {}, onDelete: async () => {}, ...options.props,
  };
  let renderer;
  await TestRenderer.act(async () => { renderer = TestRenderer.create(React.createElement(TimetableGrid, props)); });
  await TestRenderer.act(async () => { renderer.root.findAllByType('View').find(node => node.props.onLayout).props.onLayout({ nativeEvent: { layout: { width: 390 } } }); });
  return { ...harness, calendar, props, renderer, TimetableGrid, EventBlock, TimetableContextMenu };
}

test('grid renders both resized blocks live; cancellation restores both and performs no write', async () => {
  const writes = [];
  const ui = await mountedGrid({ props: { onResize: async changes => writes.push(changes) } });
  const { renderer, EventBlock, TestRenderer: { act } } = ui;
  let pan = blockPart(renderer, EventBlock, 'A', 2).Pan;
  await act(async () => { pan.callbacks.onBegin(); pan.callbacks.onStart(); pan.callbacks.onUpdate({ translationX: 0, translationY: 26 }); });
  const visible = renderer.root.findAllByType(EventBlock).map(node => node.props.event);
  assert.equal(visible[0].endMinute, 630);
  assert.equal(visible[1].startMinute, 630);
  assert.deepEqual(visible[2], events[2]);
  await act(async () => pan.callbacks.onFinalize({}, false));
  assert.deepEqual(renderer.root.findAllByType(EventBlock).map(node => node.props.event), events);
  assert.equal(writes.length, 0);
  pan = blockPart(renderer, EventBlock, 'B', 0).Pan;
  await act(async () => { pan.callbacks.onBegin(); pan.callbacks.onStart(); pan.callbacks.onUpdate({ translationX: 0, translationY: -26 }); pan.callbacks.onFinalize({}, true); });
  assert.deepEqual(writes[0], resizeBoundary(events, 'B', 'start', -30).changes);
  await act(async () => renderer.unmount());
});

test('failed resize restores both visible blocks and shows a Korean save error', async () => {
  const ui = await mountedGrid({ props: { onResize: async () => { throw new Error('disk failure'); } } });
  const { renderer, EventBlock, TestRenderer: { act } } = ui;
  const pan = blockPart(renderer, EventBlock, 'A', 2).Pan;
  await act(async () => { pan.callbacks.onBegin(); pan.callbacks.onStart(); pan.callbacks.onUpdate({ translationX: 0, translationY: 26 }); pan.callbacks.onFinalize({}, true); });
  assert.deepEqual(renderer.root.findAllByType(EventBlock).map(node => node.props.event), events);
  assert(renderer.root.findAllByType('Text').some(node => String(node.props.children).includes('저장하지 못했습니다')));
  await act(async () => renderer.unmount());
});

test('blank tap creates; hold without clipboard is disabled; cancelled scroll never opens paste', async () => {
  const creates = [], pastes = [];
  const ui = await mountedGrid({ props: { onCreate: (...args) => creates.push(args), onPaste: async (...args) => pastes.push(args) } });
  const { renderer, TestRenderer: { act }, TimetableContextMenu } = ui;
  assert.equal(backdrop(renderer).LongPress.config.enabled, false);
  await act(async () => backdrop(renderer).Tap.callbacks.onEnd({ x: 50, y: 18 * 26 }, true));
  assert.deepEqual(creates, [[1, 540]]);
  ui.calendar.clipboard = copyEvent(events[0]);
  await act(async () => renderer.update(ui.React.createElement(ui.TimetableGrid, { ...ui.props })));
  assert.equal(backdrop(renderer).LongPress.config.enabled, true);
  assert.equal(backdrop(renderer).LongPress.config.maxDistance, 8);
  const point = { x: 50, y: 20 * 26, absoluteX: 98, absoluteY: 400 };
  await act(async () => backdrop(renderer).LongPress.callbacks.onEnd(point, false));
  assert.equal(renderer.root.findAllByType(TimetableContextMenu).length, 0);
  await act(async () => backdrop(renderer).LongPress.callbacks.onEnd(point, true));
  assert.equal(renderer.root.findByType(TimetableContextMenu).props.kind, 'paste');
  await act(async () => renderer.root.findByType(TimetableContextMenu).props.onClose());
  assert.equal(renderer.root.findAllByType(TimetableContextMenu).length, 0);
  await act(async () => backdrop(renderer).LongPress.callbacks.onEnd(point, true));
  await act(async () => renderer.root.findByType(TimetableContextMenu).props.onPaste());
  assert.deepEqual(pastes, [[1, 600]]);
  assert.equal(creates.length, 1);
  await act(async () => renderer.unmount());
});

test('copy menu appears on release, copies only the clipboard fields, and outside touch dismisses it', async () => {
  const ui = await mountedGrid();
  const { renderer, EventBlock, TimetableContextMenu, TestRenderer: { act } } = ui;
  let part = blockPart(renderer, EventBlock, 'A');
  await act(async () => { part.Pan.callbacks.onBegin(); part.LongPress.callbacks.onEnd({ duration: 500 }, true); part.Pan.callbacks.onFinalize({}, false); });
  assert.equal(renderer.root.findByType(TimetableContextMenu).props.kind, 'copy');
  assert.deepEqual(renderer.root.findAllByType('Pressable').filter(node => ['복사', '삭제'].includes(node.props.accessibilityLabel)).map(node => node.props.accessibilityLabel), ['복사', '삭제']);
  const dismiss = renderer.root.findAllByType('Pressable').find(node => node.props.accessibilityLabel === '메뉴 닫기');
  await act(async () => dismiss.props.onPress());
  assert.equal(renderer.root.findAllByType(TimetableContextMenu).length, 0);
  part = blockPart(renderer, EventBlock, 'A');
  await act(async () => { part.Pan.callbacks.onBegin(); part.LongPress.callbacks.onEnd({ duration: 500 }, true); part.Pan.callbacks.onFinalize({}, false); });
  await act(async () => renderer.root.findByType(TimetableContextMenu).props.onCopy());
  assert.deepEqual(ui.calendar.clipboard, { title: '공부', color: '#426FD0', durationMinute: 60 });
  assert.deepEqual(ui.props.events, events);
  await act(async () => renderer.unmount());
});

test('paste collision closes the menu, reports the conflict and keeps every original block', async () => {
  const message = '해당 시간에 다른 일정이 있어 붙여넣기를 취소했습니다.';
  const ui = await mountedGrid({
    calendar: { clipboard: copyEvent(events[0]) },
    props: { onPaste: async () => { throw new TimetableActionError(message); } },
  });
  const { renderer, EventBlock, TimetableContextMenu, TestRenderer: { act } } = ui;
  await act(async () => backdrop(renderer).LongPress.callbacks.onEnd({ x: 1, y: 540 / 30 * 26, absoluteX: 49, absoluteY: 400 }, true));
  await act(async () => renderer.root.findByType(TimetableContextMenu).props.onPaste());
  assert.equal(renderer.root.findAllByType(TimetableContextMenu).length, 0);
  assert(renderer.root.findAllByType('Text').some(node => node.props.children === message));
  assert.deepEqual(renderer.root.findAllByType(EventBlock).map(node => node.props.event), events);
  assert.deepEqual(ui.calendar.clipboard, copyEvent(events[0]));
  await act(async () => renderer.unmount());
});

test('Provider retains clipboard across screen changes and publishes atomic snapshots to every consumer', async t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const driver = {
    execAsync: async sql => { db.exec(sql); },
    runAsync: async (sql, ...values) => db.prepare(sql).run(...values),
    getAllAsync: async (sql, ...values) => db.prepare(sql).all(...values),
  };
  const repo = new CalendarRepository(driver, () => new Date(2026, 10, 1, 12));
  await repo.initialize();
  for (const event of events) await repo.saveEvent({ ...event, date: '2026-11-10' }, event.id);
  const { React, TestRenderer, load } = createUiHarness({ repository: repo });
  const { CalendarProvider, useCalendar } = load('src/hooks/use-calendar.tsx');
  const consumers = new Map();
  function Consumer({ name }) { consumers.set(name, useCalendar()); return null; }
  const tree = second => React.createElement(CalendarProvider, null,
    React.createElement(Consumer, { name: 'calendar' }), React.createElement(Consumer, { name: second }));
  let renderer;
  await TestRenderer.act(async () => { renderer = TestRenderer.create(tree('weekly')); });
  await TestRenderer.act(async () => consumers.get('weekly').setClipboard(copyEvent(events[0])));
  await TestRenderer.act(async () => renderer.update(tree('template')));
  assert.deepEqual(consumers.get('template').clipboard, { title: '공부', color: '#426FD0', durationMinute: 60 });
  assert.equal(consumers.get('template').clipboard, consumers.get('calendar').clipboard);
  const before = consumers.get('calendar').events;
  const run = driver.runAsync;
  let updates = 0;
  driver.runAsync = async (sql, ...values) => {
    if (sql.startsWith('UPDATE events') && ++updates === 2) throw new Error('disk full');
    return run(sql, ...values);
  };
  await TestRenderer.act(async () => { await assert.rejects(consumers.get('calendar').updateEventTimes(resizeBoundary(events, 'A', 'end', 30).changes)); });
  assert.deepEqual(consumers.get('calendar').events, before);
  assert.deepEqual(consumers.get('template').events, before);
  driver.runAsync = run;
  await TestRenderer.act(async () => { await consumers.get('template').updateEventTimes(resizeBoundary(events, 'A', 'end', 30).changes); });
  for (const name of ['calendar', 'template']) {
    assert.equal(consumers.get(name).events.find(event => event.id === 'A').endMinute, 630);
    assert.equal(consumers.get(name).events.find(event => event.id === 'B').startMinute, 630);
  }
  await TestRenderer.act(async () => { await consumers.get('template').deleteEvent('B'); });
  for (const name of ['calendar', 'template']) assert.deepEqual(consumers.get(name).events.map(event => event.id), ['A', 'C']);
  await TestRenderer.act(async () => renderer.unmount());
});

test('press feedback animates immediately, recognizes hold, follows unsnapped movement and resets on release/blur', async () => {
  const ui = createUiHarness();
  const { React, TestRenderer: { act }, load, sharedValues, animations } = ui;
  const { EventBlock } = load('src/components/timetable/event-block.tsx');
  const copies = [], ends = [];
  let renderer;
  await act(async () => { renderer = ui.TestRenderer.create(React.createElement(EventBlock, {
    event: events[0], dayWidth: 100, lane: 0, lanes: 1, scrollGestures: [], active: false, selected: false, disabled: false,
    onEdit: () => {}, onCopy: (...args) => copies.push(args), onBegin: () => true, onUpdate: () => {}, onEnd: async (...args) => ends.push(args),
  })); });
  let part = blockPart(renderer, EventBlock, 'A');
  await act(async () => part.Pan.callbacks.onBegin());
  assert.equal(sharedValues[0].value, 0.97);
  await act(async () => part.LongPress.callbacks.onStart());
  assert.equal(sharedValues[0].value, 0.985); assert.equal(sharedValues[1].value, 1.5);
  await act(async () => part.Pan.callbacks.onUpdate({ translationX: 12.5, translationY: 45.5 }));
  assert.equal(sharedValues[0].value, 1.015); assert.equal(sharedValues[2].value, 1);
  assert.equal(sharedValues[3].value, 14.5); assert.equal(sharedValues[4].value, 540 / 30 * 26 + 1 + 45.5);
  await act(async () => { part.Pan.callbacks.onFinalize({}, true); part.LongPress.callbacks.onEnd({ duration: 700 }, true); });
  assert.equal(sharedValues[0].value, 1); assert.equal(sharedValues[2].value, 0); assert.equal(sharedValues[4].value, 540 / 30 * 26 + 1);
  assert.equal(copies.length, 0); assert.deepEqual(ends, [['A', true]]);
  part = blockPart(renderer, EventBlock, 'A');
  await act(async () => { part.Pan.callbacks.onBegin(); part.LongPress.callbacks.onStart(); ui.blur(); });
  assert.equal(sharedValues[0].value, 1); assert.equal(sharedValues[1].value, 0);
  await act(async () => part.LongPress.callbacks.onEnd({ duration: 800 }, true));
  assert.equal(copies.length, 0);
  assert(animations.some(animation => animation.kind === 'spring' && animation.value === 0.97));
  await act(async () => renderer.unmount());
});

test('compact copy/delete menu requires confirmation; cancel writes nothing and confirm deletes only the chosen ID', async () => {
  const deleted = [];
  const ui = await mountedGrid({ props: { onDelete: async id => deleted.push(id) } });
  const { renderer, EventBlock, TestRenderer: { act }, load, TimetableContextMenu } = ui;
  const { ConfirmationCard } = load('src/components/ui/confirmation-dialog.tsx');
  const open = async () => {
    const part = blockPart(renderer, EventBlock, 'B');
    await act(async () => { part.Pan.callbacks.onBegin(); part.LongPress.callbacks.onStart(); part.LongPress.callbacks.onEnd({ duration: 500 }, true); part.Pan.callbacks.onFinalize({}, false); });
  };
  await open();
  await act(async () => renderer.root.findAllByType('Pressable').find(node => node.props.accessibilityLabel === '삭제').props.onPress());
  assert.equal(renderer.root.findByType(ConfirmationCard).props.title, '일정을 삭제할까요?');
  assert.deepEqual(deleted, []);
  await act(async () => renderer.root.findByType(ConfirmationCard).props.onCancel());
  assert.deepEqual(deleted, []); assert.equal(renderer.root.findAllByType(TimetableContextMenu).length, 0);
  await open();
  await act(async () => renderer.root.findAllByType('Pressable').find(node => node.props.accessibilityLabel === '삭제').props.onPress());
  await act(async () => renderer.root.findByType(ConfirmationCard).props.onConfirm());
  assert.deepEqual(deleted, ['B']); assert.equal(renderer.root.findAllByType(TimetableContextMenu).length, 0);
  await act(async () => renderer.unmount());
});

test('one aligned weekday header selects expanded editing and tracks horizontal scroll for weeks and templates', async () => {
  for (const template of [false, true]) {
    const selected = [];
    const ui = await mountedGrid({ props: { template, onSelectDay: day => selected.push(day) } });
    const { renderer, EventBlock, TestRenderer: { act } } = ui;
    const headers = renderer.root.findAllByType('Pressable').filter(node => node.props.accessibilityLabel?.endsWith('요일 선택'));
    assert.equal(headers.length, 7);
    await act(async () => headers[2].props.onPress());
    assert.deepEqual(selected, [2]);
    const dayWidth = renderer.root.findAllByType(EventBlock)[0].props.dayWidth;
    assert.equal(dayWidth, (390 - 48) / 2.4);
    const horizontal = renderer.root.findAllByType('View').find(node => node.props.horizontal);
    await act(async () => { horizontal.props.onScroll({ nativeEvent: { contentOffset: { x: 123 } } }); renderer.update(ui.React.createElement(ui.TimetableGrid, { ...ui.props })); });
    const header = renderer.root.findAllByType('View').find(node => Array.isArray(node.props.style) && node.props.style[0]?.width === dayWidth * 7 && node.props.style[1]?.transform);
    assert.equal(header.props.style[1].transform[0].translateX, -123);
    await act(async () => renderer.unmount());
  }
});

test('import preview disables block mutations and blank creation/paste while allowing header zoom', async () => {
  const ui = await mountedGrid({ calendar: { clipboard: copyEvent(events[0]) }, props: { readOnly: true } });
  assert(ui.renderer.root.findAllByType(ui.EventBlock).every(node => node.props.disabled));
  assert.equal(backdrop(ui.renderer).Tap.config.enabled, false);
  assert.equal(backdrop(ui.renderer).LongPress.config.enabled, false);
  await ui.TestRenderer.act(async () => ui.renderer.unmount());
});

test('leaving a screen during shared resizing restores both blocks and never commits the later release', async () => {
  const writes = [];
  const ui = await mountedGrid({ props: { onResize: async changes => writes.push(changes) } });
  const { act } = ui.TestRenderer;
  const pan = blockPart(ui.renderer, ui.EventBlock, 'A', 2).Pan;
  await act(async () => { pan.callbacks.onBegin(); pan.callbacks.onStart(); pan.callbacks.onUpdate({ translationX: 0, translationY: 26 }); });
  assert.equal(ui.renderer.root.findAllByType(ui.EventBlock)[0].props.event.endMinute, 630);
  await act(async () => ui.blur());
  assert.deepEqual(ui.renderer.root.findAllByType(ui.EventBlock).map(node => node.props.event), events);
  await act(async () => pan.callbacks.onFinalize({}, true));
  assert.deepEqual(writes, []);
  await act(async () => ui.renderer.unmount());
});

function repository(t) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  return new CalendarRepository({ execAsync: async sql => { db.exec(sql); }, runAsync: async (sql, ...args) => db.prepare(sql).run(...args), getAllAsync: async (sql, ...args) => db.prepare(sql).all(...args) }, () => new Date(2026, 10, 1, 12));
}
async function mountedRepositoryUi(repo, filename, name, props = {}) {
  const ui = createUiHarness({ repository: repo });
  const { CalendarProvider, useCalendar } = ui.load('src/hooks/use-calendar.tsx');
  const Component = ui.load(filename)[name];
  let state;
  function Consumer() { state = useCalendar(); return state.initialized ? ui.React.createElement(Component, props) : null; }
  let renderer;
  await ui.TestRenderer.act(async () => { renderer = ui.TestRenderer.create(ui.React.createElement(CalendarProvider, null, ui.React.createElement(Consumer))); });
  return { ...ui, renderer, calendar: () => state };
}
function button(renderer, label) { return renderer.root.findAllByType('Pressable').find(node => node.props.accessibilityLabel === label); }

test('preset list opens details, chooses a single default and creates a blank timetable from the add sheet', async t => {
  const repo = repository(t); const initial = await repo.initialize();
  const ui = await mountedRepositoryUi(repo, 'src/components/timetable/preset-list.tsx', 'PresetList');
  const { act } = ui.TestRenderer;
  const textButton = text => ui.renderer.root.findAllByType('Pressable').find(node => node.findAllByType('Text').some(label => label.props.children === text));
  await act(async () => textButton('+ 시간표 추가').props.onPress());
  await act(async () => textButton('빈 시간표 만들기').props.onPress());
  await act(async () => ui.renderer.root.findByType('Modal').props.onDismiss());
  assert.equal(ui.calendar().presets.length, 2);
  const second = ui.calendar().presets.at(-1);
  assert.equal(second.name, '기본 시간표 2');
  assert.equal(ui.navigation.at(-1).args[0].params.id, second.id);
  await act(async () => button(ui.renderer, `${second.name} 기본으로 설정`).props.onPress());
  const radios = ui.renderer.root.findAllByType('Pressable').filter(node => node.props.accessibilityRole === 'radio');
  assert.equal(radios.filter(node => node.props.accessibilityState.checked).length, 1);
  assert.equal(ui.calendar().presets.find(row => row.isDefault).id, second.id);
  await act(async () => button(ui.renderer, `${initial.presets[0].name} 편집`).props.onPress());
  assert.equal(ui.navigation.at(-1).args[0].params.id, initial.presets[0].id);
  await act(async () => ui.renderer.unmount());
});

test('preset editor scopes create/delete to its own blocks and publishes dated-calendar preservation', async t => {
  const repo = repository(t); const initial = await repo.initialize(); const first = initial.presets[0].id;
  await repo.saveTemplate({ ...events[0], weekday: 0 }, 'first', first);
  const second = (await repo.createPreset()).presets.at(-1).id;
  await repo.saveTemplate({ ...events[1], weekday: 0 }, 'second', second);
  const before = await repo.ensureWeek('2026-11-09');
  const ui = await mountedRepositoryUi(repo, 'src/components/timetable/preset-editor.tsx', 'PresetEditor', { presetId: second });
  const { act } = ui.TestRenderer;
  const { TimetableGrid } = ui.load('src/components/timetable/timetable-grid.tsx');
  const grid = () => ui.renderer.root.findByType(TimetableGrid);
  assert.deepEqual(grid().props.events.map(row => row.id), ['second']);
  await act(async () => grid().props.onDelete('second'));
  assert.deepEqual(ui.calendar().templates.map(row => row.id), ['first']);
  assert.deepEqual(ui.calendar().events, before.events);
  await act(async () => button(ui.renderer, '이름 변경').props.onPress());
  await act(async () => ui.renderer.root.findByType('TextInput').props.onChangeText('시험 기간'));
  await act(async () => button(ui.renderer, '저장').props.onPress());
  assert.equal(ui.calendar().presets.find(row => row.id === second).name, '시험 기간');
  assert.equal(ui.calendar().presets.find(row => row.id === first).name, '기본 시간표 1');
  await act(async () => ui.renderer.unmount());
});

test('week import previews read-only data, cancellation preserves target, and confirmation replaces only that preset', async t => {
  const repo = repository(t); const target = (await repo.initialize()).presets[0].id;
  await repo.saveTemplate({ ...events[1], weekday: 6 }, 'old-target', target);
  await repo.saveEvent({ ...events[0], date: '2026-11-09' }, 'source-event');
  const before = await repo.initialize();
  const ui = await mountedRepositoryUi(repo, 'src/components/timetable/import-timetable.tsx', 'ImportTimetable', { presetId: target });
  const { act } = ui.TestRenderer;
  const { TimetableGrid } = ui.load('src/components/timetable/timetable-grid.tsx');
  const { ConfirmationDialog } = ui.load('src/components/ui/confirmation-dialog.tsx');
  const row = ui.renderer.root.findAllByType('Pressable').find(node => node.props.accessibilityRole === 'radio');
  await act(async () => row.props.onPress());
  const preview = ui.renderer.root.findByType(TimetableGrid);
  assert.equal(preview.props.readOnly, true); assert.deepEqual(preview.props.events.map(row => row.id), ['source-event']);
  await act(async () => button(ui.renderer, '불러오기').props.onPress());
  await act(async () => ui.renderer.root.findByType(ConfirmationDialog).props.onCancel());
  assert.deepEqual(await repo.initialize(), before);
  await act(async () => button(ui.renderer, '불러오기').props.onPress());
  await act(async () => ui.renderer.root.findByType(ConfirmationDialog).props.onConfirm());
  assert.equal(ui.calendar().templates.length, 1);
  assert.notEqual(ui.calendar().templates[0].id, 'old-target'); assert.notEqual(ui.calendar().templates[0].id, 'source-event');
  assert.equal(ui.calendar().templates[0].weekday, 0); assert.deepEqual(ui.calendar().events, before.events);
  assert.equal(ui.navigation.at(-1).method, 'back');
  await act(async () => ui.renderer.unmount());
});

test('new timetable import can clone a saved preset without changing its source or creating data before confirmation', async t => {
  const repo = repository(t); const initial = await repo.initialize(); const source = initial.presets[0].id;
  await repo.saveTemplate({ ...events[0], weekday: 0 }, 'original', source);
  const before = await repo.initialize();
  const ui = await mountedRepositoryUi(repo, 'src/components/timetable/import-timetable.tsx', 'ImportTimetable');
  const { act } = ui.TestRenderer;
  const tabs = ui.renderer.root.findAllByType('Pressable').filter(node => node.props.accessibilityRole === 'tab');
  await act(async () => tabs[1].props.onPress());
  const row = ui.renderer.root.findAllByType('Pressable').find(node => node.props.accessibilityRole === 'radio');
  await act(async () => row.props.onPress());
  assert.deepEqual(await repo.initialize(), before);
  await act(async () => button(ui.renderer, '불러오기').props.onPress());
  assert.equal(ui.calendar().presets.length, 2); assert.equal(ui.calendar().templates.length, 2);
  assert.deepEqual(ui.calendar().templates.find(row => row.id === 'original'), before.templates[0]);
  assert.equal(ui.navigation.at(-1).method, 'replace');
  assert.equal(ui.navigation.at(-1).args[0].pathname, '/preset-editor');
  await act(async () => ui.renderer.unmount());
});

const placementEvents = [
  { ...events[0], startMinute: 660, endMinute: 720 },
  { ...events[1], startMinute: 780, endMinute: 840 },
  { ...events[2], startMinute: 900, endMinute: 1020 },
];
const flatStyle = style => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
function blockView(renderer, EventBlock, id) {
  const block = renderer.root.findAllByType(EventBlock).find(node => node.props.event.id === id);
  return block.findAllByType('View').find(node => flatStyle(node.props.style).position === 'absolute');
}

test('occupied-start move displays a full-width red ghost; release restores the block with no save and failure feedback', async () => {
  for (const minute of [660, 690]) {
    const writes = [];
    const ui = await mountedGrid({ props: { events: placementEvents, onChange: async value => writes.push(value) } });
    const { act } = ui.TestRenderer;
    const pan = blockPart(ui.renderer, ui.EventBlock, 'C').Pan;
    await act(async () => {
      pan.callbacks.onBegin(); pan.callbacks.onStart();
      pan.callbacks.onUpdate({ translationX: 0, translationY: (minute - 900) / 30 * 26 });
    });
    const ghost = ui.renderer.root.findAllByType(ui.EventBlock).find(node => node.props.event.id === 'C');
    assert.equal(ghost.props.blocked, true);
    const style = flatStyle(blockView(ui.renderer, ui.EventBlock, 'C').props.style);
    assert.equal(style.width, ghost.props.dayWidth - 4);
    assert.equal(style.borderColor, '#C63245'); assert.equal(style.opacity, 0.58);
    assert.deepEqual(ui.renderer.root.findAllByType(ui.EventBlock).slice(0, 2).map(node => node.props.event), placementEvents.slice(0, 2));
    await act(async () => pan.callbacks.onFinalize({}, true));
    assert.deepEqual(writes, []);
    assert.deepEqual(ui.renderer.root.findAllByType(ui.EventBlock).map(node => node.props.event), placementEvents);
    assert(ui.haptics.includes('rejection'));
    assert(ui.animations.some(value => value.kind === 'spring' && value.value === 900 / 30 * 26 + 1));
    await act(async () => ui.renderer.unmount());
  }
});

for (const template of [false, true]) test(`${template ? 'preset' : 'dated'} move previews a shortened height, then persists only that block at the fitted time`, async t => {
  const repo = repository(t); const preset = (await repo.initialize()).presets[0].id;
  for (const event of placementEvents) {
    if (template) await repo.saveTemplate({ ...event, weekday: 0 }, event.id, preset);
    else await repo.saveEvent({ ...event, date: '2026-11-16' }, event.id);
  }
  const before = await repo.initialize();
  let ui;
  const props = { template, events: placementEvents, onChange: async value => {
    const after = template ? await repo.saveTemplate({ ...value, weekday: value.day }, value.id, preset)
      : await repo.saveEvent({ ...value, date: '2026-11-16' }, value.id);
    props.events = (template ? after.templates : after.events).map(row => ({ ...row, day: template ? row.weekday : 0 }));
    ui.renderer.update(ui.React.createElement(ui.TimetableGrid, props));
  } };
  ui = await mountedGrid({ props });
  Object.assign(props, ui.props);
  const { act } = ui.TestRenderer;
  const pan = blockPart(ui.renderer, ui.EventBlock, 'C').Pan;
  await act(async () => { pan.callbacks.onBegin(); pan.callbacks.onStart(); pan.callbacks.onUpdate({ translationX: 0, translationY: -156 }); });
  const preview = ui.renderer.root.findAllByType(ui.EventBlock).find(node => node.props.event.id === 'C').props;
  assert.equal(preview.event.startMinute, 720); assert.equal(preview.event.endMinute, 780);
  assert.equal(preview.blocked, false);
  assert(ui.renderer.root.findAllByType('Text').some(node => String(node.props.children).includes('빈 공간에 맞춰 축소')));
  // Shared values update in the effect; render once to inspect the animated style.
  await act(async () => ui.renderer.update(ui.React.createElement(ui.TimetableGrid, props)));
  assert.equal(flatStyle(blockView(ui.renderer, ui.EventBlock, 'C').props.style).height, 50);
  await act(async () => pan.callbacks.onFinalize({}, true));
  const after = await repo.initialize(); const saved = (template ? after.templates : after.events).find(row => row.id === 'C');
  assert.equal(saved.startMinute, 720); assert.equal(saved.endMinute, 780);
  const original = (template ? before.templates : before.events).find(row => row.id === 'C');
  for (const key of ['id', 'title', 'color', 'createdAt']) assert.equal(saved[key], original[key]);
  assert.deepEqual((template ? after.templates : after.events).filter(row => row.id !== 'C'), (template ? before.templates : before.events).filter(row => row.id !== 'C'));
  await act(async () => ui.renderer.unmount());
});

test('cancelled or failed shortened moves restore both original position and original height', async () => {
  for (const success of [false, true]) {
    let writes = 0;
    const ui = await mountedGrid({ props: { events: placementEvents, onChange: async () => { writes++; throw new Error('disk failure'); } } });
    const { act } = ui.TestRenderer;
    const pan = blockPart(ui.renderer, ui.EventBlock, 'C').Pan;
    await act(async () => { pan.callbacks.onBegin(); pan.callbacks.onStart(); pan.callbacks.onUpdate({ translationX: 0, translationY: -156 }); });
    await act(async () => pan.callbacks.onFinalize({}, success));
    assert.equal(writes, success ? 1 : 0);
    assert.deepEqual(ui.renderer.root.findAllByType(ui.EventBlock).map(node => node.props.event), placementEvents);
    assert(ui.animations.some(value => value.kind === 'spring' && value.value === 102));
    assert(ui.animations.some(value => value.kind === 'spring' && value.value === 781));
    if (success) assert(ui.renderer.root.findAllByType('Text').some(node => String(node.props.children).includes('저장하지 못했습니다')));
    await act(async () => ui.renderer.unmount());
  }
});

test('a newly occupied destination is checked again before the final move save', async () => {
  const writes = [];
  const ui = await mountedGrid({ props: { events: [placementEvents[2]], onChange: async value => writes.push(value) } });
  const { act } = ui.TestRenderer;
  const block = () => ui.renderer.root.findByType(ui.EventBlock);
  const originalEnd = block().props.onEnd;
  await act(async () => { block().props.onBegin('C', 'move'); block().props.onUpdate('C', 0, -156); });
  const updated = [placementEvents[2], { ...placementEvents[0], startMinute: 720, endMinute: 780 }];
  await act(async () => ui.renderer.update(ui.React.createElement(ui.TimetableGrid, { ...ui.props, events: updated })));
  await act(async () => originalEnd('C', true));
  assert.deepEqual(writes, []);
  assert.deepEqual(ui.renderer.root.findAllByType(ui.EventBlock).map(node => node.props.event), updated);
  await act(async () => ui.renderer.unmount());
});

test('26px rows keep short blocks and both handle targets inside the row in weeks, presets and import previews', async () => {
  const short = [
    { ...events[0], startMinute: 540, endMinute: 570 },
    { ...events[1], startMinute: 570, endMinute: 600 },
    { ...events[2], startMinute: 600, endMinute: 660 },
  ];
  for (const variant of [{}, { template: true }, { readOnly: true }]) {
    const ui = await mountedGrid({ props: { ...variant, events: short } });
    const { act } = ui.TestRenderer;
    for (const expanded of [false, true]) {
      if (expanded) await act(async () => ui.renderer.root.findAllByType('Pressable').find(node => node.findAllByType('Text').some(text => text.props.children === '확대 편집')).props.onPress());
      const blocks = ui.renderer.root.findAllByType(ui.EventBlock);
      const first = flatStyle(blockView(ui.renderer, ui.EventBlock, 'A').props.style);
      const next = flatStyle(blockView(ui.renderer, ui.EventBlock, 'B').props.style);
      assert.equal(first.height, 24); assert(first.top + first.height <= next.top);
      assert.equal(first.width, blocks[0].props.dayWidth - 4);
      assert.equal(first.minHeight, undefined);
      const parts = blocks[0].findAllByType('GestureDetector');
      const top = flatStyle(parts[0].findAllByType('View')[0].props.style);
      const bottom = flatStyle(parts[2].findAllByType('View')[0].props.style);
      assert.equal(top.top, 0); assert.equal(bottom.bottom, 0);
      assert(top.height + bottom.height <= first.height);
      assert.equal(parts[0].findAllByType('View')[0].props.hitSlop, undefined);
      assert.equal(parts[1].findAllByType('Text').length, 1);
      assert.equal(parts[1].findByType('Text').props.numberOfLines, 1);
      assert.equal(blocks[2].findAllByType('GestureDetector')[1].findAllByType('Text').length, 2);
    }
    const scrollers = ui.renderer.root.findAllByType('View').filter(node => node.props.contentOffset);
    assert(scrollers.every(node => node.props.contentOffset.y === 416));
    assert(ui.renderer.root.findAllByType('View').some(node => node.props.style?.height === 1248));
    await act(async () => ui.renderer.unmount());
  }
});

test('legacy overlapping blocks use full width and every hidden row has a direct edit entry', async () => {
  const edits = [];
  const overlapping = [events[0], { ...events[1], startMinute: 570, endMinute: 630 }, events[2]];
  const ui = await mountedGrid({ props: { events: overlapping, onEdit: id => edits.push(id) } });
  const { act } = ui.TestRenderer;
  for (const block of ui.renderer.root.findAllByType(ui.EventBlock)) {
    const style = flatStyle(blockView(ui.renderer, ui.EventBlock, block.props.event.id).props.style);
    assert.equal(style.width, block.props.dayWidth - 4);
    assert.equal(style.left, 2);
    assert.equal(block.props.lane, undefined); assert.equal(block.props.lanes, undefined);
  }
  const entries = ui.renderer.root.findAllByType('Pressable').filter(node => node.props.accessibilityLabel?.startsWith('겹친 일정'));
  assert.equal(entries.length, 2);
  for (const entry of entries) await act(async () => entry.props.onPress());
  assert.deepEqual(edits, ['A', 'B']);
  assert.deepEqual(ui.props.events, overlapping);
  await act(async () => ui.renderer.unmount());
});

test('event editor displays the repository collision message and retains the manually entered times', async t => {
  const repo = repository(t); await repo.initialize();
  await repo.saveEvent({ ...placementEvents[0], date: '2026-11-16' }, 'A');
  await repo.saveEvent({ ...placementEvents[2], date: '2026-11-16' }, 'C');
  const before = await repo.initialize();
  const ui = createUiHarness(); const { act } = ui.TestRenderer;
  const { EventEditor } = ui.load('src/components/events/event-editor.tsx');
  let closes = 0, renderer;
  await act(async () => { renderer = ui.TestRenderer.create(ui.React.createElement(EventEditor, {
    draft: { ...placementEvents[2], date: '2026-11-16', startMinute: 690, endMinute: 810 },
    onClose: () => { closes++; }, onSave: (value, id) => repo.saveEvent(value, id), onDelete: async () => {},
  })); });
  await act(async () => button(renderer, '저장').props.onPress());
  assert.equal(closes, 0);
  assert(renderer.root.findAllByType('Text').some(node => String(node.props.children).includes('겹치지 않는 시간')));
  assert.equal(renderer.root.findAllByType('TextInput').find(node => node.props.accessibilityLabel === '시작 시간').props.value, '11:30');
  assert.equal(renderer.root.findAllByType('TextInput').find(node => node.props.accessibilityLabel === '종료 시간').props.value, '13:30');
  assert.deepEqual(await repo.initialize(), before);
  await act(async () => renderer.unmount());
});

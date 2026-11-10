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
    pan.callbacks.onUpdate({ translationX: 100, translationY: 44 });
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
    onChange: async () => {}, onResize: async () => {}, onPaste: async () => {}, ...options.props,
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
  await act(async () => { pan.callbacks.onBegin(); pan.callbacks.onStart(); pan.callbacks.onUpdate({ translationX: 0, translationY: 44 }); });
  const visible = renderer.root.findAllByType(EventBlock).map(node => node.props.event);
  assert.equal(visible[0].endMinute, 630);
  assert.equal(visible[1].startMinute, 630);
  assert.deepEqual(visible[2], events[2]);
  await act(async () => pan.callbacks.onFinalize({}, false));
  assert.deepEqual(renderer.root.findAllByType(EventBlock).map(node => node.props.event), events);
  assert.equal(writes.length, 0);
  pan = blockPart(renderer, EventBlock, 'B', 0).Pan;
  await act(async () => { pan.callbacks.onBegin(); pan.callbacks.onStart(); pan.callbacks.onUpdate({ translationX: 0, translationY: -44 }); pan.callbacks.onFinalize({}, true); });
  assert.deepEqual(writes[0], resizeBoundary(events, 'B', 'start', -30).changes);
  await act(async () => renderer.unmount());
});

test('failed resize restores both visible blocks and shows a Korean save error', async () => {
  const ui = await mountedGrid({ props: { onResize: async () => { throw new Error('disk failure'); } } });
  const { renderer, EventBlock, TestRenderer: { act } } = ui;
  const pan = blockPart(renderer, EventBlock, 'A', 2).Pan;
  await act(async () => { pan.callbacks.onBegin(); pan.callbacks.onStart(); pan.callbacks.onUpdate({ translationX: 0, translationY: 44 }); pan.callbacks.onFinalize({}, true); });
  assert.deepEqual(renderer.root.findAllByType(EventBlock).map(node => node.props.event), events);
  assert(renderer.root.findAllByType('Text').some(node => String(node.props.children).includes('저장하지 못했습니다')));
  await act(async () => renderer.unmount());
});

test('blank tap creates; hold without clipboard is disabled; cancelled scroll never opens paste', async () => {
  const creates = [], pastes = [];
  const ui = await mountedGrid({ props: { onCreate: (...args) => creates.push(args), onPaste: async (...args) => pastes.push(args) } });
  const { renderer, TestRenderer: { act }, TimetableContextMenu } = ui;
  assert.equal(backdrop(renderer).LongPress.config.enabled, false);
  await act(async () => backdrop(renderer).Tap.callbacks.onEnd({ x: 50, y: 18 * 44 }, true));
  assert.deepEqual(creates, [[1, 540]]);
  ui.calendar.clipboard = copyEvent(events[0]);
  await act(async () => renderer.update(ui.React.createElement(ui.TimetableGrid, { ...ui.props })));
  assert.equal(backdrop(renderer).LongPress.config.enabled, true);
  assert.equal(backdrop(renderer).LongPress.config.maxDistance, 8);
  const point = { x: 50, y: 20 * 44, absoluteX: 98, absoluteY: 400 };
  await act(async () => backdrop(renderer).LongPress.callbacks.onEnd(point, false));
  assert.equal(renderer.root.findAllByType(TimetableContextMenu).length, 0);
  await act(async () => backdrop(renderer).LongPress.callbacks.onEnd(point, true));
  assert.equal(renderer.root.findByType(TimetableContextMenu).props.label, '붙여넣기');
  await act(async () => renderer.root.findByType(TimetableContextMenu).props.onClose());
  assert.equal(renderer.root.findAllByType(TimetableContextMenu).length, 0);
  await act(async () => backdrop(renderer).LongPress.callbacks.onEnd(point, true));
  await act(async () => renderer.root.findByType(TimetableContextMenu).props.onPress());
  assert.deepEqual(pastes, [[1, 600]]);
  assert.equal(creates.length, 1);
  await act(async () => renderer.unmount());
});

test('copy menu appears on release, copies only the clipboard fields, and outside touch dismisses it', async () => {
  const ui = await mountedGrid();
  const { renderer, EventBlock, TimetableContextMenu, TestRenderer: { act } } = ui;
  let part = blockPart(renderer, EventBlock, 'A');
  await act(async () => { part.Pan.callbacks.onBegin(); part.LongPress.callbacks.onEnd({ duration: 500 }, true); part.Pan.callbacks.onFinalize({}, false); });
  assert.equal(renderer.root.findByType(TimetableContextMenu).props.label, '복사');
  const dismiss = renderer.root.findAllByType('Pressable').find(node => node.props.accessibilityLabel === '메뉴 닫기');
  await act(async () => dismiss.props.onPress());
  assert.equal(renderer.root.findAllByType(TimetableContextMenu).length, 0);
  part = blockPart(renderer, EventBlock, 'A');
  await act(async () => { part.Pan.callbacks.onBegin(); part.LongPress.callbacks.onEnd({ duration: 500 }, true); part.Pan.callbacks.onFinalize({}, false); });
  await act(async () => renderer.root.findByType(TimetableContextMenu).props.onPress());
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
  await act(async () => backdrop(renderer).LongPress.callbacks.onEnd({ x: 1, y: 540 / 30 * 44, absoluteX: 49, absoluteY: 400 }, true));
  await act(async () => renderer.root.findByType(TimetableContextMenu).props.onPress());
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
  const repo = new CalendarRepository(driver);
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
  await TestRenderer.act(async () => renderer.unmount());
});

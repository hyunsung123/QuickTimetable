import { useMemo, useRef, type ComponentRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector, type GestureType } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';
import { slotHeight } from '@/constants/calendar';
import { formatTime } from '@/lib/dates';
import { BlockPressSession, holdDurationMs, pressMovementTolerance } from '@/lib/timetable-press';
import type { DragMode } from '@/lib/timetable';
import type { GridEvent, MenuAnchor } from '@/types/calendar';

interface DragCallbacks {
  reset: () => void;
  begin: (mode: DragMode) => void;
  update: (mode: DragMode, x: number, y: number) => void;
  finalize: (success: boolean) => void;
  copy: (durationMs: number, success: boolean) => void;
  edit: () => void;
}

// Gesture builders register callbacks; they never read mutable drag state.
function blockGestures(mode: DragMode, enabled: boolean, scrollGestures: GestureType[], callbacks: DragCallbacks) {
  const pan = Gesture.Pan().enabled(enabled).minDistance(mode === 'move' ? pressMovementTolerance : 3).maxPointers(1).runOnJS(true)
    .blocksExternalGesture(...scrollGestures)
    .onBegin(() => callbacks.reset())
    .onStart(() => { if (mode !== 'move') callbacks.begin(mode); })
    .onUpdate(event => callbacks.update(mode, event.translationX, event.translationY))
    .onFinalize((_event, success) => callbacks.finalize(success));
  if (mode === 'move') pan.activateAfterLongPress(holdDurationMs);
  const hold = Gesture.LongPress().enabled(enabled).minDuration(holdDurationMs).maxDistance(pressMovementTolerance).numberOfPointers(1).runOnJS(true)
    .blocksExternalGesture(...scrollGestures)
    .onEnd((event, success) => callbacks.copy(event.duration, success));
  const tap = Gesture.Tap().enabled(enabled).maxDuration(holdDurationMs - 1).maxDistance(pressMovementTolerance).runOnJS(true)
    .onEnd((_event, success) => { if (success) callbacks.edit(); });
  // Hold and pan can arm together. Only a stationary successful release opens
  // the menu; a drag remains a drag even if it returns to its original slot.
  return Gesture.Simultaneous(pan, hold, tap);
}

export function EventBlock({ event, dayWidth, lane, lanes, scrollGestures, active, selected, disabled, onEdit, onCopy, onBegin, onUpdate, onEnd }: {
  event: GridEvent; dayWidth: number; lane: number; lanes: number; scrollGestures: GestureType[];
  active: boolean; selected: boolean; disabled: boolean;
  onEdit: (id: string) => void; onCopy: (id: string, anchor: MenuAnchor) => void;
  onBegin: (id: string, mode: DragMode) => boolean;
  onUpdate: (id: string, x: number, y: number) => void;
  onEnd: (id: string, success: boolean) => Promise<void>;
}) {
  const view = useRef<ComponentRef<typeof View>>(null);
  const started = useRef(false);
  const press = useMemo(() => new BlockPressSession(), []);
  const callbacks: DragCallbacks = {
    reset: () => { started.current = false; press.reset(); },
    begin: mode => {
      press.move(pressMovementTolerance + 1, 0);
      started.current = onBegin(event.id, mode);
    },
    update: (mode, x, y) => {
      if (mode === 'move' && press.move(x, y) && !started.current) started.current = onBegin(event.id, mode);
      if (started.current) onUpdate(event.id, x, y);
    },
    finalize: success => { if (started.current) { started.current = false; void onEnd(event.id, success); } },
    copy: (durationMs, success) => {
      if (press.releaseHold(durationMs, success)) view.current?.measureInWindow((x, y, width, height) => onCopy(event.id, { x, y, width, height }));
    },
    edit: () => { if (!started.current && press.releaseTap(true)) onEdit(event.id); },
  };
  // RNGH registers callbacks here; all ref reads happen in touch callbacks.
  /* eslint-disable react-hooks/refs */
  const start = blockGestures('start', !disabled, scrollGestures, callbacks);
  const move = blockGestures('move', !disabled, scrollGestures, callbacks);
  const end = blockGestures('end', !disabled, scrollGestures, callbacks);
  /* eslint-enable react-hooks/refs */
  const height = (event.endMinute - event.startMinute) / 30 * slotHeight;
  const width = active ? dayWidth - 4 : dayWidth / lanes - 4;
  const expanded = width >= 85;

  return <Animated.View ref={view} collapsable={false} style={[styles.block, {
    top: event.startMinute / 30 * slotHeight + 1,
    height: height - 2,
    left: event.day * dayWidth + (active ? 0 : lane * dayWidth / lanes) + 2,
    width, backgroundColor: event.color, zIndex: active ? 100 : 2,
    borderWidth: active || selected ? 2 : 0, borderColor: '#173D86',
  }]}>
    <GestureDetector gesture={start} touchAction="none">
      <View accessible accessibilityLabel={`${event.title}, 시작 시간 조절`} style={styles.handle}><View style={styles.grip} /></View>
    </GestureDetector>
    <GestureDetector gesture={move} touchAction="pan-y">
      <View accessible accessibilityRole="button" accessibilityLabel={`${event.title}, ${formatTime(event.startMinute)}부터 ${formatTime(event.endMinute)}까지. 탭하여 편집, 길게 눌러 복사 또는 이동`} style={styles.body}>
        <Text numberOfLines={height <= 44 ? 1 : 2} style={[styles.title, { fontSize: expanded ? 12 : 10 }]}>{event.title}</Text>
        {(height >= 64 || expanded && height > 45) && <Text numberOfLines={2} style={styles.time}>{formatTime(event.startMinute)}{expanded ? ' – ' : '\n'}{formatTime(event.endMinute)}</Text>}
      </View>
    </GestureDetector>
    <GestureDetector gesture={end} touchAction="none">
      <View accessible accessibilityLabel={`${event.title}, 종료 시간 조절`} style={styles.handle}><View style={styles.grip} /></View>
    </GestureDetector>
  </Animated.View>;
}

const styles = StyleSheet.create({
  block: { position: 'absolute', borderRadius: 4, minHeight: 32 },
  handle: { height: 12, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  grip: { width: 16, maxWidth: '55%', height: 2, borderRadius: 1, backgroundColor: '#FFFFFF90' },
  body: { flex: 1, paddingHorizontal: 5, overflow: 'hidden', justifyContent: 'center' },
  title: { color: '#FFF', fontWeight: '600', lineHeight: 14 },
  time: { color: '#FFFFFFD9', fontSize: 9, lineHeight: 12, marginTop: 2, fontVariant: ['tabular-nums'] },
});

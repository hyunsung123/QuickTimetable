import { useCallback, useEffect, useMemo, useRef, type ComponentRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector, type GestureType } from 'react-native-gesture-handler';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useFocusEffect } from 'expo-router';
import { slotHeight } from '@/constants/calendar';
import { formatTime } from '@/lib/dates';
import { BlockPressSession, holdDurationMs, pressMovementTolerance } from '@/lib/timetable-press';
import type { DragMode } from '@/lib/timetable';
import { clamp } from '@/lib/timetable';
import { selectionHaptic } from '@/lib/haptics';
import type { GridEvent, MenuAnchor } from '@/types/calendar';

interface DragCallbacks {
  reset: () => void;
  recognize: () => void;
  releaseHold: () => void;
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
    .onStart(() => callbacks.recognize())
    .onEnd((event, success) => callbacks.copy(event.duration, success))
    .onFinalize(() => callbacks.releaseHold());
  const tap = Gesture.Tap().enabled(enabled).maxDuration(holdDurationMs - 1).maxDistance(pressMovementTolerance).runOnJS(true)
    .onEnd((_event, success) => { if (success) callbacks.edit(); });
  // Hold and pan can arm together. Only a stationary successful release opens
  // the menu; a drag remains a drag even if it returns to its original slot.
  return Gesture.Simultaneous(pan, hold, tap);
}

const spring = { damping: 24, stiffness: 320, overshootClamping: true };

export function EventBlock({ event, dayWidth, scrollGestures, active, blocked = false, selected, disabled, onEdit, onCopy, onBegin, onUpdate, onEnd }: {
  event: GridEvent; dayWidth: number; scrollGestures: GestureType[];
  active: boolean; blocked?: boolean; selected: boolean; disabled: boolean;
  onEdit: (id: string) => void; onCopy: (id: string, anchor: MenuAnchor) => void;
  onBegin: (id: string, mode: DragMode) => boolean;
  onUpdate: (id: string, x: number, y: number) => void;
  onEnd: (id: string, success: boolean) => Promise<boolean>;
}) {
  const view = useRef<ComponentRef<typeof View>>(null);
  const started = useRef(false);
  const focused = useRef(true);
  const origin = useRef(event);
  const latest = useRef(event);
  const mode = useRef<DragMode>('move');
  const press = useMemo(() => new BlockPressSession(), []);
  const scale = useSharedValue(1);
  const held = useSharedValue(0);
  const lift = useSharedValue(0);
  const left = useSharedValue(event.day * dayWidth + 2);
  const top = useSharedValue(event.startMinute / 30 * slotHeight + 1);
  const visualHeight = useSharedValue((event.endMinute - event.startMinute) / 30 * slotHeight - 2);
  const settle = useCallback((target: GridEvent) => {
    left.set(withSpring(target.day * dayWidth + 2, spring));
    top.set(withSpring(target.startMinute / 30 * slotHeight + 1, spring));
    visualHeight.set(withSpring((target.endMinute - target.startMinute) / 30 * slotHeight - 2, spring));
  }, [dayWidth, left, top, visualHeight]);
  useEffect(() => {
    latest.current = event;
    // While moving, position follows the raw finger; duration follows the
    // snapped fit preview. After release, animate to the committed or old row.
    if (!started.current) settle(event);
    else {
      if (mode.current !== 'move') top.set(event.startMinute / 30 * slotHeight + 1);
      visualHeight.set((event.endMinute - event.startMinute) / 30 * slotHeight - 2);
    }
  }, [event, settle, top, visualHeight]);
  const resetVisual = useCallback(() => {
    scale.set(withSpring(1, { damping: 20, stiffness: 320 }));
    held.set(0);
    lift.set(0);
  }, [scale, held, lift]);
  useFocusEffect(useCallback(() => {
    focused.current = true;
    return () => {
      focused.current = false;
      started.current = false;
      cancelAnimation(scale);
      scale.set(1);
      held.set(0);
      lift.set(0);
      cancelAnimation(left); cancelAnimation(top); cancelAnimation(visualHeight);
      left.set(latest.current.day * dayWidth + 2);
      top.set(latest.current.startMinute / 30 * slotHeight + 1);
      visualHeight.set((latest.current.endMinute - latest.current.startMinute) / 30 * slotHeight - 2);
    };
  }, [scale, held, lift, left, top, visualHeight, dayWidth]));
  const feedbackStyle = useAnimatedStyle(() => ({
    left: left.value, top: top.value, height: visualHeight.value,
    transform: [{ scale: scale.value }],
    borderWidth: active || selected || blocked ? 1.5 : held.value,
    opacity: blocked ? 0.58 : 1,
    shadowOpacity: lift.value * 0.22,
    elevation: lift.value * 6,
  }));
  const callbacks: DragCallbacks = {
    reset: () => {
      started.current = false; press.reset(); origin.current = event; mode.current = 'move';
      scale.set(withSpring(0.97, { damping: 22, stiffness: 400 }));
    },
    recognize: () => {
      if (!focused.current) return;
      held.set(1.5);
      scale.set(withSpring(0.985, { damping: 20, stiffness: 320 }));
      selectionHaptic();
    },
    releaseHold: () => { if (!started.current) resetVisual(); },
    begin: value => {
      press.move(pressMovementTolerance + 1, 0);
      mode.current = value;
      started.current = onBegin(event.id, value);
    },
    update: (mode, x, y) => {
      if (mode === 'move' && press.move(x, y) && !started.current) {
        started.current = onBegin(event.id, mode);
        if (started.current) {
          // The separate resize handles never enter this whole-block path.
          // The source time remains fixed even if fit previews get shorter.
          scale.set(withSpring(1.015, { damping: 22, stiffness: 320 }));
          lift.set(1);
        }
      }
      if (started.current) {
        if (mode === 'move') {
          const source = origin.current;
          left.set(source.day * dayWidth + 2 + clamp(x, -source.day * dayWidth, (6 - source.day) * dayWidth));
          top.set(source.startMinute / 30 * slotHeight + 1 + clamp(y, -source.startMinute / 30 * slotHeight, (1410 - source.startMinute) / 30 * slotHeight));
        }
        onUpdate(event.id, x, y);
      }
    },
    finalize: success => {
      if (started.current) {
        started.current = false;
        const source = origin.current;
        settle(success && !blocked ? latest.current : source);
        void onEnd(event.id, success).then(saved => {
          if (!saved && focused.current && !started.current) settle(source);
        });
      }
      resetVisual();
    },
    copy: (durationMs, success) => {
      if (focused.current && press.releaseHold(durationMs, success)) view.current?.measureInWindow((x, y, width, height) => {
        if (focused.current) onCopy(event.id, { x, y, width, height });
      });
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
  const width = dayWidth - 4;
  const expanded = width >= 85;
  const compact = height <= slotHeight;

  return <Animated.View ref={view} collapsable={false} style={[styles.block, {
    width, backgroundColor: event.color, zIndex: active ? 100 : 2,
    borderColor: blocked ? '#C63245' : '#173D86',
  }, feedbackStyle]}>
    <GestureDetector gesture={start} touchAction="none">
      <View accessible accessibilityLabel={`${event.title}, 시작 시간 조절`} style={[styles.handle, { top: 0 }]}><View style={styles.grip} /></View>
    </GestureDetector>
    <GestureDetector gesture={move} touchAction="pan-y">
      <View accessible accessibilityRole="button" accessibilityLabel={`${event.title}, ${formatTime(event.startMinute)}부터 ${formatTime(event.endMinute)}까지. 탭하여 편집, 길게 눌러 복사, 삭제 또는 이동`} style={styles.body}>
        <Text numberOfLines={compact || height < slotHeight * 3 ? 1 : 2} maxFontSizeMultiplier={1.2} style={[styles.title, { fontSize: expanded ? 11 : 9 }]}>{event.title}</Text>
        {!compact && <Text numberOfLines={expanded ? 1 : 2} maxFontSizeMultiplier={1.1} style={styles.time}>{formatTime(event.startMinute)}{expanded ? ' – ' : '\n'}{formatTime(event.endMinute)}</Text>}
      </View>
    </GestureDetector>
    <GestureDetector gesture={end} touchAction="none">
      <View accessible accessibilityLabel={`${event.title}, 종료 시간 조절`} style={[styles.handle, { bottom: 0 }]}><View style={styles.grip} /></View>
    </GestureDetector>
  </Animated.View>;
}

const styles = StyleSheet.create({
  block: { position: 'absolute', borderRadius: 4, shadowColor: '#18243A', shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
  // Handle targets stay inside their own block, including 24px half-hour blocks.
  // The left side remains a full-height move/tap target. Zoom widens all targets.
  handle: { position: 'absolute', right: 0, width: '45%', maxWidth: 32, height: 10, zIndex: 2, alignItems: 'center', justifyContent: 'center' },
  grip: { width: 12, maxWidth: '75%', height: 2, borderRadius: 1, backgroundColor: '#FFFFFF90' },
  body: { flex: 1, paddingHorizontal: 3, paddingVertical: 3, overflow: 'hidden', justifyContent: 'center' },
  title: { color: '#FFF', fontWeight: '600', lineHeight: 12 },
  time: { color: '#FFFFFFD9', fontSize: 8, lineHeight: 9, marginTop: 1, fontVariant: ['tabular-nums'] },
});

import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector, type GestureType } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { slotHeight } from '@/constants/calendar';
import { formatTime } from '@/lib/dates';
import { dragEvent, type DragMode } from '@/lib/timetable';
import type { GridEvent } from '@/types/calendar';

interface DragCallbacks {
  begin: () => void;
  update: (mode: DragMode, x: number, y: number) => void;
  finish: () => Promise<void>;
  finalize: (success: boolean) => void;
}

// Gesture builders register callbacks; they never read mutable drag state.
function createPan(mode: DragMode, enabled: boolean, scrollGestures: GestureType[], callbacks: DragCallbacks) {
  const gesture = Gesture.Pan().enabled(enabled).minDistance(3).maxPointers(1).runOnJS(true)
    .blocksExternalGesture(...scrollGestures)
    .onStart(() => callbacks.begin())
    .onUpdate(e => callbacks.update(mode, e.translationX, e.translationY))
    .onEnd(() => { void callbacks.finish(); })
    .onFinalize((_e, success) => callbacks.finalize(success));
  return mode === 'move' ? gesture.activateAfterLongPress(280) : gesture;
}

export function EventBlock({ event, dayWidth, lane, lanes, scrollGestures, onEdit, onChange, onDragActive, onPreview }: {
  event: GridEvent; dayWidth: number; lane: number; lanes: number; scrollGestures: GestureType[];
  onEdit: (id: string) => void; onChange: (event: GridEvent) => Promise<void>; onDragActive: (active: boolean) => void;
  onPreview: (event: GridEvent) => void;
}) {
  const [preview, setPreview] = useState<GridEvent | null>(null);
  const [active, setActive] = useState(false);
  const [saving, setSaving] = useState(false);
  const current = useRef(event);
  const origin = useRef(event);
  const dragging = useRef(false);
  const changed = useRef(false);
  useEffect(() => { if (!dragging.current) current.current = event; }, [event]);

  const haptic = () => { if (Platform.OS !== 'web') void Haptics.selectionAsync().catch(() => undefined); };
  const begin = () => {
    origin.current = event;
    current.current = event;
    dragging.current = true;
    changed.current = false;
    setPreview(event);
    setActive(true);
    onDragActive(true);
    onPreview(event);
    haptic();
  };
  const update = (mode: DragMode, x: number, y: number) => {
    const next = dragEvent(origin.current, mode, x, y, dayWidth, slotHeight);
    const previous = current.current;
    if (previous.day !== next.day || previous.startMinute !== next.startMinute || previous.endMinute !== next.endMinute) {
      current.current = next;
      changed.current = true;
      setPreview(next);
      onPreview(next);
      haptic();
    }
  };
  const finish = async () => {
    const next = current.current;
    if (!changed.current) { setPreview(null); return; }
    setSaving(true);
    try { await onChange(next); }
    catch { /* Provider displays the storage error; the persisted event remains intact. */ }
    finally { setSaving(false); setPreview(null); }
  };
  const finalize = (success: boolean) => {
    dragging.current = false;
    setActive(false);
    onDragActive(false);
    if (!success) setPreview(null);
  };
  const callbacks = { begin, update, finish, finalize };
  // RNGH only registers these callbacks. The compiler's refs rule cannot infer
  // that the callback factory defers every ref read until a touch event.
  /* eslint-disable react-hooks/refs */
  const startPan = createPan('start', !saving, scrollGestures, callbacks);
  const movePan = createPan('move', !saving, scrollGestures, callbacks);
  const endPan = createPan('end', !saving, scrollGestures, callbacks);
  /* eslint-enable react-hooks/refs */
  const tap = Gesture.Tap().enabled(!saving).maxDuration(270).runOnJS(true).onEnd((_event, success) => { if (success) onEdit(event.id); });
  const visible = preview ?? event;
  const height = (visible.endMinute - visible.startMinute) / 30 * slotHeight;
  const width = active ? dayWidth - 4 : dayWidth / lanes - 4;
  const expanded = width >= 85;

  return <Animated.View style={[styles.block, {
    top: visible.startMinute / 30 * slotHeight + 1,
    height: height - 2,
    left: visible.day * dayWidth + (active ? 0 : lane * dayWidth / lanes) + 2,
    width, backgroundColor: visible.color, zIndex: active ? 100 : 2,
    opacity: saving ? 0.65 : 1, borderWidth: active ? 2 : 0, borderColor: '#173D86',
  }]}>
    <GestureDetector gesture={startPan} touchAction="none">
      <View accessible accessibilityLabel={`${event.title}, 시작 시간 조절`} style={styles.handle}><View style={styles.grip} /></View>
    </GestureDetector>
    <GestureDetector gesture={Gesture.Race(movePan, tap)} touchAction="pan-y">
      <View accessible accessibilityRole="button" accessibilityLabel={`${event.title}, ${formatTime(visible.startMinute)}부터 ${formatTime(visible.endMinute)}까지. 길게 눌러 이동, 탭하여 편집`} style={styles.body}>
        <Text numberOfLines={height <= 40 ? 1 : 2} style={[styles.title, { fontSize: expanded ? 12 : 10 }]}>{visible.title}</Text>
        {(height >= 64 || expanded && height > 45) && <Text numberOfLines={2} style={styles.time}>{formatTime(visible.startMinute)}{expanded ? ' – ' : '\n'}{formatTime(visible.endMinute)}</Text>}
      </View>
    </GestureDetector>
    <GestureDetector gesture={endPan} touchAction="none">
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

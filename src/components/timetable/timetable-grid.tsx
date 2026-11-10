import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useFocusEffect } from 'expo-router';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { palette, slotHeight, weekdays } from '@/constants/calendar';
import { addDays, dateKey, formatTime, parseDate } from '@/lib/dates';
import { clamp, copyEvent, eventLanes, TimetableActionError } from '@/lib/timetable';
import { holdDurationMs, pressMovementTolerance } from '@/lib/timetable-press';
import { selectionHaptic } from '@/lib/haptics';
import { useCalendar } from '@/hooks/use-calendar';
import { useTimetableDrag } from '@/hooks/use-timetable-drag';
import type { EventTimeChange, GridEvent, MenuAnchor } from '@/types/calendar';
import { EventBlock } from './event-block';
import { TimetableContextMenu } from './context-menu';

const rulerWidth = 48;
const gridHeight = slotHeight * 48;

type ContextTarget = { kind: 'copy'; id: string; anchor: MenuAnchor } | { kind: 'paste'; day: number; minute: number; anchor: MenuAnchor };

export function TimetableGrid({ events, weekStart, template = false, selectedDay, onSelectDay, onCreate, onEdit, onChange, onResize, onPaste }: {
  events: GridEvent[]; weekStart: string; template?: boolean; selectedDay: number;
  onSelectDay: (day: number) => void; onCreate: (day: number, minute: number) => void;
  onEdit: (id: string) => void; onChange: (event: GridEvent) => Promise<void>;
  onResize: (changes: EventTimeChange[]) => Promise<void>;
  onPaste: (day: number, minute: number) => Promise<void>;
}) {
  const [width, setWidth] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [menu, setMenu] = useState<ContextTarget | null>(null);
  const [notice, setNotice] = useState('');
  const [pasting, setPasting] = useState(false);
  const pasteLock = useRef(false);
  const { clipboard, setClipboard } = useCalendar();
  const vertical = useRef<ComponentRef<typeof ScrollView>>(null);
  const horizontal = useRef<ComponentRef<typeof ScrollView>>(null);
  const ruler = useRef<ComponentRef<typeof ScrollView>>(null);
  const offsetX = useSharedValue(0);
  const headerStyle = useAnimatedStyle(() => ({ transform: [{ translateX: -offsetX.value }] }));
  const verticalGesture = useMemo(() => Gesture.Native(), []);
  const horizontalGesture = useMemo(() => Gesture.Native(), []);
  const scrollGestures = useMemo(() => [verticalGesture, horizontalGesture], [verticalGesture, horizontalGesture]);
  const dayWidth = Math.max(1, (width - rulerWidth) / (expanded ? 2.4 : 7));
  const showError = (error: unknown) => setNotice(error instanceof TimetableActionError ? error.message : '변경 사항을 저장하지 못했습니다. 다시 시도해 주세요.');
  const drag = useTimetableDrag(events, dayWidth, slotHeight, onChange, onResize, showError);
  const { dragging, visibleEvents } = drag;
  const busy = pasting || drag.saving;
  const lanes = useMemo(() => eventLanes(visibleEvents), [visibleEvents]);
  const activeEvent = visibleEvents.find(event => event.id === drag.activeId);
  const previewTime = activeEvent ? `${weekdays[activeEvent.day]}요일 ${formatTime(activeEvent.startMinute)} – ${formatTime(activeEvent.endMinute)}` : '';
  const today = dateKey();
  const dates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  useFocusEffect(useCallback(() => () => setMenu(null), []));

  useEffect(() => {
    if (width > 0) {
      vertical.current?.scrollTo({ y: 16 * slotHeight, animated: false });
      ruler.current?.scrollTo({ y: 16 * slotHeight, animated: false });
    }
  }, [width]);

  useEffect(() => {
    const x = expanded ? Math.min(selectedDay * dayWidth, dayWidth * 7 - (width - rulerWidth)) : 0;
    horizontal.current?.scrollTo({ x: Math.max(0, x), animated: true });
  }, [expanded, selectedDay, width, dayWidth]);

  const backgroundTap = Gesture.Tap().enabled(!busy && !dragging).maxDuration(holdDurationMs - 1).maxDistance(pressMovementTolerance).runOnJS(true).onEnd((event, success) => {
    if (success) onCreate(clamp(Math.floor(event.x / dayWidth), 0, 6), clamp(Math.floor(event.y / slotHeight), 0, 47) * 30);
  });
  const backgroundHold = Gesture.LongPress().enabled(!!clipboard && !busy && !dragging).minDuration(holdDurationMs).maxDistance(pressMovementTolerance).numberOfPointers(1).runOnJS(true)
    .blocksExternalGesture(...scrollGestures)
    .onEnd((event, success) => {
      if (!success) return;
      const day = clamp(Math.floor(event.x / dayWidth), 0, 6);
      const slot = clamp(Math.floor(event.y / slotHeight), 0, 47);
      setMenu({ kind: 'paste', day, minute: slot * 30, anchor: {
        x: event.absoluteX - (event.x - day * dayWidth), y: event.absoluteY - (event.y - slot * slotHeight), width: dayWidth, height: slotHeight,
      } });
      selectionHaptic();
    });
  const menuAction = async () => {
    const target = menu;
    if (!target || pasteLock.current) return;
    setMenu(null);
    if (target.kind === 'copy') {
      const event = events.find(value => value.id === target.id);
      if (event) { setClipboard(copyEvent(event)); setNotice('일정을 복사했습니다. 빈 시간대를 길게 눌러 붙여넣으세요.'); selectionHaptic(); }
      return;
    }
    pasteLock.current = true;
    setPasting(true);
    try { await onPaste(target.day, target.minute); setNotice('일정을 붙여넣었습니다.'); selectionHaptic(); }
    catch (error) { showError(error); }
    finally { pasteLock.current = false; setPasting(false); }
  };

  return <View style={styles.container} onLayout={e => setWidth(e.nativeEvent.layout.width)}>
    <View style={styles.viewToolbar}>
      <View style={styles.segmented}>{[false, true].map(value => <Pressable key={String(value)} accessibilityRole="button" accessibilityState={{ selected: expanded === value }} onPress={() => setExpanded(value)} style={[styles.segment, expanded === value && styles.segmentActive]}><Text style={[styles.segmentText, expanded === value && { color: palette.blue }]}>{value ? '확대 편집' : '주 전체'}</Text></Pressable>)}</View>
      <Text style={styles.modeHint}>{expanded ? '좌우로 밀어 요일 이동' : '월요일 – 일요일'}</Text>
    </View>
    <View style={styles.daysBar}>
      {weekdays.map((day, i) => <Pressable key={day} accessibilityRole="button" accessibilityLabel={`${day}요일 선택`} accessibilityState={{ selected: selectedDay === i }} onPress={() => { onSelectDay(i); if (!expanded) setExpanded(true); }} style={[styles.dayButton, selectedDay === i && { backgroundColor: palette.blueLight }]}><Text style={[styles.dayButtonText, selectedDay === i && { color: palette.blue, fontWeight: '700' }]}>{day}</Text></Pressable>)}
    </View>
    {width > rulerWidth && <>
      <View style={styles.header}>
        <View style={{ width: rulerWidth }}><Text style={styles.rulerTitle}>시간</Text></View>
        <View style={styles.headerWindow}><Animated.View style={[{ width: dayWidth * 7, flexDirection: 'row' }, headerStyle]}>
          {dates.map((date, i) => <Pressable accessibilityRole="button" onPress={() => onSelectDay(i)} key={date} style={[styles.columnHeader, { width: dayWidth }, selectedDay === i && { backgroundColor: palette.blueLight }]}>
            <Text style={[styles.columnDay, i === 6 && { color: palette.red }]}>{weekdays[i]}</Text>
            {!template && <Text style={[styles.columnDate, date === today && styles.todayDate]}>{parseDate(date).getDate()}</Text>}
          </Pressable>)}
        </Animated.View></View>
      </View>
      <View style={styles.bodyRow}>
        <ScrollView ref={ruler} contentOffset={{ x: 0, y: 16 * slotHeight }} scrollEnabled={false} showsVerticalScrollIndicator={false} style={{ width: rulerWidth, flexGrow: 0 }}>
          <View style={{ height: gridHeight + 20 }}>{Array.from({ length: 49 }, (_, i) => <Text key={i} style={[styles.timeLabel, { top: i * slotHeight - (i === 0 ? 0 : 7) }, i % 2 === 1 && styles.halfTime]}>{formatTime(i * 30)}</Text>)}</View>
        </ScrollView>
        <GestureDetector gesture={horizontalGesture}>
          <ScrollView ref={horizontal} horizontal scrollEnabled={expanded && !dragging} showsHorizontalScrollIndicator={expanded} bounces={false} style={{ flex: 1 }} contentContainerStyle={{ width: dayWidth * 7 }}
            onScroll={e => { offsetX.value = e.nativeEvent.contentOffset.x; }} scrollEventThrottle={16}>
            <GestureDetector gesture={verticalGesture}>
              <ScrollView ref={vertical} contentOffset={{ x: 0, y: 16 * slotHeight }} scrollEnabled={!dragging} showsVerticalScrollIndicator bounces={false} style={{ width: dayWidth * 7 }}
                contentContainerStyle={{ paddingBottom: 20 }} scrollEventThrottle={16}
                onScroll={e => ruler.current?.scrollTo({ y: e.nativeEvent.contentOffset.y, animated: false })}>
                <View style={{ width: dayWidth * 7, height: gridHeight }}>
                  <GestureDetector gesture={Gesture.Exclusive(backgroundHold, backgroundTap)}>
                    <View style={StyleSheet.absoluteFill} collapsable={false}>
                      {dates.map((date, i) => <View key={date} pointerEvents="none" style={[styles.column, { left: i * dayWidth, width: dayWidth, height: gridHeight }, date === today && !template && { backgroundColor: '#F8FAFF' }]} />)}
                      {Array.from({ length: 49 }, (_, i) => <View key={i} pointerEvents="none" style={[styles.line, { top: i * slotHeight }, i % 2 === 1 && styles.halfLine]} />)}
                    </View>
                  </GestureDetector>
                  {visibleEvents.map(event => <EventBlock key={event.id} event={event} dayWidth={dayWidth} {...(lanes.get(event.id) ?? { lane: 0, lanes: 1 })} scrollGestures={scrollGestures} onEdit={onEdit}
                    active={event.id === drag.activeId && drag.activeMode === 'move'} selected={menu?.kind === 'copy' && menu.id === event.id}
                    disabled={busy || dragging && drag.activeId !== event.id}
                    onCopy={(id, anchor) => { setMenu({ kind: 'copy', id, anchor }); selectionHaptic(); }}
                    onBegin={(id, mode) => { setMenu(null); setNotice(''); return drag.begin(id, mode); }} onUpdate={drag.update} onEnd={drag.end} />)}
                </View>
              </ScrollView>
            </GestureDetector>
          </ScrollView>
        </GestureDetector>
      </View>
    </>}
    {!!notice && <View accessibilityRole="alert" style={styles.notice}><Text style={styles.noticeText}>{notice}</Text><Pressable accessibilityRole="button" accessibilityLabel="안내 닫기" onPress={() => setNotice('')} style={styles.noticeClose}><Text style={{ color: palette.blue }}>닫기</Text></Pressable></View>}
    <View style={styles.footer}><Text style={styles.footerText}>{drag.blocked ? '겹치는 일정이 있어 이 경계선은 더 조절할 수 없어요.' : dragging ? previewTime || '30분 단위로 조절 중 · 놓으면 저장' : busy ? '저장 중…' : '길게 눌러 복사 · 누른 채 이동 · 맞닿은 경계선 함께 조절'}</Text></View>
    {menu && <TimetableContextMenu label={menu.kind === 'copy' ? '복사' : '붙여넣기'} anchor={menu.anchor} onPress={() => { void menuAction(); }} onClose={() => setMenu(null)} />}
  </View>;
}

const styles = StyleSheet.create({
  container: { flex: 1 }, viewToolbar: { paddingHorizontal: 20, paddingBottom: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  segmented: { flexDirection: 'row', backgroundColor: palette.surface, padding: 3, borderRadius: 9 }, segment: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 7 },
  segmentActive: { backgroundColor: '#FFF' }, segmentText: { fontSize: 12, color: palette.muted, fontWeight: '600' }, modeHint: { color: palette.muted, fontSize: 10 },
  daysBar: { flexDirection: 'row', paddingHorizontal: 20, gap: 5, paddingBottom: 12 }, dayButton: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 36, borderRadius: 7 }, dayButtonText: { color: palette.muted, fontSize: 12 },
  header: { flexDirection: 'row', borderTopWidth: 1, borderBottomWidth: 1, borderColor: palette.line, backgroundColor: '#FFF', overflow: 'hidden' },
  rulerTitle: { color: palette.muted, fontSize: 10, paddingTop: 21, textAlign: 'center' }, headerWindow: { flex: 1, overflow: 'hidden' },
  columnHeader: { alignItems: 'center', justifyContent: 'center', gap: 5, minHeight: 61, borderLeftWidth: 1, borderColor: palette.line }, columnDay: { color: palette.muted, fontSize: 10 },
  columnDate: { color: palette.text, fontSize: 14, fontWeight: '600', width: 24, height: 24, textAlign: 'center', lineHeight: 24, borderRadius: 12 }, todayDate: { backgroundColor: palette.blue, color: '#FFF' },
  bodyRow: { flex: 1, flexDirection: 'row' }, timeLabel: { position: 'absolute', right: 6, color: '#657185', fontSize: 10, fontVariant: ['tabular-nums'] }, halfTime: { fontSize: 8, color: '#A6AEBB' },
  column: { position: 'absolute', borderLeftWidth: 1, borderColor: palette.line }, line: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: '#DFE5ED' }, halfLine: { backgroundColor: '#EFF2F6' },
  footer: { paddingVertical: 11, paddingHorizontal: 12, borderTopWidth: 1, borderColor: palette.line }, footerText: { color: palette.muted, fontSize: 10, textAlign: 'center' },
  notice: { flexDirection: 'row', alignItems: 'center', paddingLeft: 16, backgroundColor: palette.blueLight }, noticeText: { flex: 1, color: palette.text, fontSize: 12, lineHeight: 19, paddingVertical: 10 }, noticeClose: { minHeight: 44, paddingHorizontal: 16, justifyContent: 'center' },
});

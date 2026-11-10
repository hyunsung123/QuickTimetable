import { useState } from 'react';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MonthCalendar } from '@/components/calendar/month-calendar';
import { EventEditor, type EditorDraft } from '@/components/events/event-editor';
import { Action, Screen, ScreenHeader } from '@/components/ui/calendar-ui';
import { eventColors, palette } from '@/constants/calendar';
import { useCalendar } from '@/hooks/use-calendar';
import { dateKey, dayTitle, formatTime, monthTitle, shiftMonth } from '@/lib/dates';

export default function CalendarScreen() {
  const { events, selectedDate, setSelectedDate, saveEvent, deleteEvent } = useCalendar();
  const [draft, setDraft] = useState<EditorDraft | null>(null);
  const today = dateKey();
  const daily = events.filter(event => event.date === selectedDate).sort((a, b) => a.startMinute - b.startMinute || a.id.localeCompare(b.id));
  const create = () => setDraft({ title: '', date: selectedDate, startMinute: 540, endMinute: 570, color: eventColors[0] });

  return <Screen>
    <ScreenHeader title={monthTitle(selectedDate)} subtitle="나의 하루를, 가볍게.">
      <Action label="설정" onPress={() => router.push('/settings')} />
    </ScreenHeader>
    <ScrollView contentContainerStyle={{ paddingBottom: 30 }}>
      <View style={styles.monthNav}><View style={styles.arrows}>
        <Action label="‹" accessibilityLabel="이전 달" onPress={() => setSelectedDate(shiftMonth(selectedDate, -1))} />
        <Action label="›" accessibilityLabel="다음 달" onPress={() => setSelectedDate(shiftMonth(selectedDate, 1))} />
      </View><Action label="오늘" onPress={() => setSelectedDate(dateKey())} /></View>
      <MonthCalendar selected={selectedDate} events={events} onSelect={setSelectedDate} />
      <View style={styles.divider} />
      <View style={styles.agendaHeader}><View><Text style={styles.dayTitle}>{dayTitle(selectedDate)}</Text><Text style={styles.count}>{selectedDate === today ? '오늘 · ' : ''}{daily.length}개의 일정</Text></View><Action label="+ 일정" primary onPress={create} /></View>
      {daily.length ? daily.map(event => <Pressable key={event.id} accessibilityRole="button" accessibilityLabel={`${event.title} ${formatTime(event.startMinute)}부터 ${formatTime(event.endMinute)}까지, 편집`} onPress={() => setDraft(event)} style={({ pressed }) => [styles.event, pressed && { backgroundColor: palette.surface }]}>
        <View style={styles.eventTime}><Text style={styles.start}>{formatTime(event.startMinute)}</Text><Text style={styles.end}>{formatTime(event.endMinute)}</Text></View>
        <View style={[styles.eventStripe, { backgroundColor: event.color }]} /><View style={{ flex: 1 }}><Text style={styles.eventTitle}>{event.title}</Text>{event.templateId && <Text style={styles.source}>기본 시간표에서 추가</Text>}</View><Text style={styles.chevron}>›</Text>
      </Pressable>) : <View style={styles.empty}><View style={styles.emptyLine} /><Text style={styles.emptyTitle}>여유로운 하루예요</Text><Text style={styles.emptyText}>하고 싶은 일을 하나 추가해 보세요.</Text><Action label="첫 일정 추가" onPress={create} /></View>}
    </ScrollView>
    {draft && <EventEditor draft={draft} onClose={() => setDraft(null)} onSave={saveEvent} onDelete={deleteEvent} />}
  </Screen>;
}

const styles = StyleSheet.create({
  monthNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 14 }, arrows: { flexDirection: 'row', gap: 4 },
  divider: { height: 8, backgroundColor: palette.surface, marginTop: 18 }, agendaHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 22 },
  dayTitle: { fontSize: 16, fontWeight: '700', color: palette.text }, count: { marginTop: 6, fontSize: 11, color: palette.muted },
  event: { marginHorizontal: 20, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', gap: 14, borderBottomWidth: 1, borderColor: palette.line },
  eventTime: { width: 42, gap: 5 }, start: { fontSize: 13, fontWeight: '600', color: palette.text, fontVariant: ['tabular-nums'] }, end: { fontSize: 11, color: palette.muted, fontVariant: ['tabular-nums'] },
  eventStripe: { height: 36, width: 3, borderRadius: 2 }, eventTitle: { fontSize: 15, fontWeight: '500', color: palette.text }, source: { fontSize: 10, color: palette.muted, marginTop: 6 }, chevron: { fontSize: 21, color: '#ACB4BF' },
  empty: { alignItems: 'center', paddingTop: 26, paddingBottom: 10, gap: 8 }, emptyLine: { width: 28, height: 3, borderRadius: 2, backgroundColor: '#D8E1EF', marginBottom: 6 },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: palette.text }, emptyText: { color: palette.muted, fontSize: 12, marginBottom: 6 },
});

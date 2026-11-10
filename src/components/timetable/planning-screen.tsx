import { useCallback, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { EventEditor, type EditorDraft } from '@/components/events/event-editor';
import { Action, Screen, ScreenHeader } from '@/components/ui/calendar-ui';
import { eventColors, palette } from '@/constants/calendar';
import { useCalendar } from '@/hooks/use-calendar';
import { addDays, dateKey, mondayOf, monthTitle, weekdayOf, weekTitle } from '@/lib/dates';
import type { GridEvent } from '@/types/calendar';
import { TimetableGrid } from './timetable-grid';

export function PlanningScreen({ template = false }: { template?: boolean }) {
  const calendar = useCalendar();
  const { selectedDate, setSelectedDate, ensureWeek } = calendar;
  const [templateDay, setTemplateDay] = useState(0);
  const [draft, setDraft] = useState<EditorDraft | null>(null);
  const [readyWeek, setReadyWeek] = useState('');
  const [failedWeek, setFailedWeek] = useState('');
  const week = mondayOf(selectedDate);
  const selectedDay = template ? templateDay : weekdayOf(selectedDate);
  const templateWeek = '2024-01-01'; // A fixed Monday; templates have weekdays, not dates.

  const loadWeek = useCallback((isActive: () => boolean = () => true) => {
    return ensureWeek(week).then(() => { if (isActive()) { setReadyWeek(week); setFailedWeek(''); } })
      .catch(() => { if (isActive()) setFailedWeek(week); });
  }, [ensureWeek, week]);

  useFocusEffect(useCallback(() => {
    if (template) return;
    let alive = true;
    void loadWeek(() => alive);
    return () => { alive = false; };
  }, [template, loadWeek]));

  const events: GridEvent[] = template ? calendar.templates.map(item => ({ ...item, day: item.weekday }))
    : calendar.events.filter(item => item.date >= week && item.date < addDays(week, 7)).map(item => ({ ...item, day: weekdayOf(item.date) }));
  const create = (day: number, startMinute: number) => {
    setDraft({ title: '', date: addDays(template ? templateWeek : week, day), weekday: day, startMinute, endMinute: startMinute + 30, color: eventColors[0] });
  };
  const edit = (id: string) => {
    if (template) {
      const item = calendar.templates.find(value => value.id === id);
      if (item) setDraft({ ...item, date: addDays(templateWeek, item.weekday) });
    } else {
      const item = calendar.events.find(value => value.id === id);
      if (item) setDraft(item);
    }
  };
  const change = async (value: GridEvent) => {
    if (template) await calendar.saveTemplate({ ...value, weekday: value.day }, value.id);
    else await calendar.saveEvent({ ...value, date: addDays(week, value.day) }, value.id);
  };

  return <Screen>
    <ScreenHeader title={template ? '기본 시간표' : '주간 계획'} subtitle={template ? '매주 반복할 나의 리듬' : monthTitle(selectedDate)} back={template}>
      {!template && <Action label="설정" onPress={() => router.push('/settings')} />}
    </ScreenHeader>
    {template ? <View style={styles.templateInfo}><Text style={styles.templateDescription}>아직 열지 않은 주에만 적용돼요.{ '\n' }이미 만들어 둔 주간 계획은 그대로 유지됩니다.</Text><Action label="+ 일정" onPress={() => create(selectedDay, 540)} /></View>
      : <View style={styles.nav}><Action label="‹" accessibilityLabel="이전 주" onPress={() => setSelectedDate(addDays(selectedDate, -7))} /><Text numberOfLines={1} style={styles.range}>{weekTitle(week)}</Text><Action label="›" accessibilityLabel="다음 주" onPress={() => setSelectedDate(addDays(selectedDate, 7))} /><Action label="이번 주" onPress={() => setSelectedDate(dateKey())} /></View>}
    {template || readyWeek === week ? <TimetableGrid events={events} weekStart={template ? templateWeek : week} template={template} selectedDay={selectedDay}
      onSelectDay={day => template ? setTemplateDay(day) : setSelectedDate(addDays(week, day))} onCreate={create} onEdit={edit} onChange={change} />
      : <View style={styles.loading}>{failedWeek === week ? <><Text style={styles.templateDescription}>주간 계획을 불러오지 못했습니다.</Text><Action label="다시 시도" onPress={() => { void loadWeek(); }} /></> : <ActivityIndicator color={palette.blue} />}</View>}
    {draft && <EventEditor template={template} draft={draft} onClose={() => setDraft(null)} onSave={template ? calendar.saveTemplate : calendar.saveEvent} onDelete={template ? calendar.deleteTemplate : calendar.deleteEvent} />}
  </Screen>;
}

const styles = StyleSheet.create({
  nav: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingBottom: 12 }, range: { flex: 1, fontSize: 11, color: palette.text, textAlign: 'center' },
  templateInfo: { paddingHorizontal: 20, paddingBottom: 16, flexDirection: 'row', alignItems: 'center', gap: 10 }, templateDescription: { flex: 1, color: palette.muted, fontSize: 11, lineHeight: 18 }, loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
});

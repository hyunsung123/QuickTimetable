import { useCallback, useState, type ReactNode } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { EventEditor, type EditorDraft } from '@/components/events/event-editor';
import { Action, Screen, ScreenHeader } from '@/components/ui/calendar-ui';
import { eventColors, palette } from '@/constants/calendar';
import { useCalendar } from '@/hooks/use-calendar';
import { addDays, dateKey, mondayOf, monthTitle, weekdayOf, weekTitle } from '@/lib/dates';
import type { EventTimeChange, GridEvent } from '@/types/calendar';
import { TimetableActionError } from '@/lib/timetable';
import { TimetableGrid } from './timetable-grid';

export function PlanningScreen({ presetId, headerAction, templateToolbar }: { presetId?: string; headerAction?: ReactNode; templateToolbar?: ReactNode }) {
  const template = presetId !== undefined;
  const calendar = useCalendar();
  const preset = calendar.presets.find(value => value.id === presetId);
  const { selectedDate, setSelectedDate, ensureWeek } = calendar;
  const [templateDay, setTemplateDay] = useState(0);
  const [draft, setDraft] = useState<EditorDraft | null>(null);
  const [readyWeek, setReadyWeek] = useState('');
  const [failedWeek, setFailedWeek] = useState('');
  const [weekError, setWeekError] = useState('');
  const week = mondayOf(selectedDate);
  const selectedDay = template ? templateDay : weekdayOf(selectedDate);
  const templateWeek = '2024-01-01'; // A fixed Monday; templates have weekdays, not dates.

  const loadWeek = useCallback((isActive: () => boolean = () => true) => {
    return ensureWeek(week).then(() => { if (isActive()) { setReadyWeek(week); setFailedWeek(''); } })
      .catch(cause => { if (isActive()) { setFailedWeek(week); setWeekError(cause instanceof TimetableActionError ? cause.message : '주간 계획을 불러오지 못했습니다.'); } });
  }, [ensureWeek, week]);

  useFocusEffect(useCallback(() => {
    if (template) return;
    let alive = true;
    void loadWeek(() => alive);
    return () => { alive = false; };
  }, [template, loadWeek]));

  const templateEvents = calendar.templates.filter(item => item.presetId === presetId);
  const events: GridEvent[] = template ? templateEvents.map(item => ({ ...item, day: item.weekday }))
    : calendar.events.filter(item => item.date >= week && item.date < addDays(week, 7)).map(item => ({ ...item, day: weekdayOf(item.date) }));
  const create = (day: number, startMinute: number) => {
    setDraft({ title: '', date: addDays(template ? templateWeek : week, day), weekday: day, startMinute, endMinute: startMinute + 30, color: eventColors[0] });
  };
  const edit = (id: string) => {
    if (template) {
      const item = templateEvents.find(value => value.id === id);
      if (item) setDraft({ ...item, date: addDays(templateWeek, item.weekday) });
    } else {
      const item = calendar.events.find(value => value.id === id);
      if (item) setDraft(item);
    }
  };
  const change = async (value: GridEvent) => {
    if (template) await calendar.saveTemplate({ ...value, weekday: value.day }, value.id, presetId);
    else await calendar.saveEvent({ ...value, date: addDays(week, value.day) }, value.id);
  };
  const resize = (changes: EventTimeChange[]) => template ? calendar.updateTemplateTimes(changes, presetId) : calendar.updateEventTimes(changes);
  const remove = (id: string) => template ? calendar.deleteTemplate(id, presetId) : calendar.deleteEvent(id);
  const paste = async (day: number, minute: number) => {
    if (!calendar.clipboard) return;
    if (template) await calendar.pasteTemplate(calendar.clipboard, day, minute, presetId);
    else await calendar.pasteEvent(calendar.clipboard, addDays(week, day), minute);
  };

  return <Screen>
    <ScreenHeader title={template ? preset?.name ?? '시간표' : '주간 계획'} subtitle={template ? preset?.isDefault ? '기본 시간표' : undefined : monthTitle(selectedDate)} back={template}>
      {template ? headerAction : <Action label="설정" onPress={() => router.push('/settings')} />}
    </ScreenHeader>
    {template ? <View style={styles.templateInfo}>{templateToolbar}<Action label="+" accessibilityLabel="일정 추가" onPress={() => create(selectedDay, 540)} /></View>
      : <View style={styles.nav}><Action label="‹" accessibilityLabel="이전 주" onPress={() => setSelectedDate(addDays(selectedDate, -7))} /><Text numberOfLines={1} style={styles.range}>{weekTitle(week)}</Text><Action label="›" accessibilityLabel="다음 주" onPress={() => setSelectedDate(addDays(selectedDate, 7))} /><Action label="이번 주" onPress={() => setSelectedDate(dateKey())} /></View>}
    {template || readyWeek === week ? <TimetableGrid key={template ? presetId : week} events={events} weekStart={template ? templateWeek : week} template={template} selectedDay={selectedDay}
      onSelectDay={day => template ? setTemplateDay(day) : setSelectedDate(addDays(week, day))} onCreate={create} onEdit={edit} onChange={change} onResize={resize} onPaste={paste} onDelete={remove} />
      : <View style={styles.loading}>{failedWeek === week ? <><Text style={styles.templateDescription}>{weekError}</Text><Action label="다시 시도" onPress={() => { void loadWeek(); }} /><Action label="설정" onPress={() => router.push('/settings')} /></> : <ActivityIndicator color={palette.blue} />}</View>}
    {draft && <EventEditor template={template} draft={draft} onClose={() => setDraft(null)} onSave={template ? (value, id) => calendar.saveTemplate(value, id, presetId) : calendar.saveEvent} onDelete={remove} />}
  </Screen>;
}

const styles = StyleSheet.create({
  nav: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingBottom: 12 }, range: { flex: 1, fontSize: 11, color: palette.text, textAlign: 'center' },
  templateInfo: { paddingHorizontal: 12, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 4 }, templateDescription: { color: palette.muted, fontSize: 11, lineHeight: 18 }, loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
});

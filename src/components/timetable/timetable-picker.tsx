import { useRef, useState } from 'react';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Action, Screen, ScreenHeader } from '@/components/ui/calendar-ui';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { palette } from '@/constants/calendar';
import { useCalendar } from '@/hooks/use-calendar';
import { addDays, mondayOf, weekTitle } from '@/lib/dates';
import { presetsForPicker } from '@/lib/presets';
import { TimetableActionError, WeekReplacementRequiredError } from '@/lib/timetable';
import { TimetableGrid } from './timetable-grid';

const noop = () => {};
const noopAsync = async () => {};

export function TimetablePicker({ weekStart }: { weekStart: string }) {
  const calendar = useCalendar();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const presets = presetsForPicker(calendar.presets);
  const selected = presets.find(preset => preset.id === selectedId);
  const events = calendar.templates.filter(event => event.presetId === selectedId).map(event => ({ ...event, day: event.weekday }));
  const hasEvents = calendar.events.some(event => event.date >= weekStart && event.date < addDays(weekStart, 7));
  const apply = async (replaceExisting = false) => {
    if (!selected || pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try {
      await calendar.applyPresetToWeek(selected.id, weekStart, replaceExisting);
      if (mondayOf(calendar.selectedDate) !== weekStart) calendar.setSelectedDate(weekStart);
      router.back();
    } catch (cause) {
      if (cause instanceof WeekReplacementRequiredError) setConfirming(true);
      else setError(cause instanceof TimetableActionError ? cause.message : '불러오지 못했습니다. 기존 일정은 유지됩니다. 다시 시도해 주세요.');
    } finally { pending.current = false; setBusy(false); }
  };
  return <Screen>
    <ScreenHeader title="시간표 불러오기" subtitle={weekTitle(weekStart)} back>
      <Action label="불러오기" primary disabled={!selected || busy} onPress={() => { if (hasEvents) setConfirming(true); else void apply(); }} />
    </ScreenHeader>
    {!presets.length ? <View style={styles.emptyArea}><Text style={styles.note}>저장된 시간표가 없습니다.</Text><Action label="기본 시간표 만들기" onPress={() => router.push('/default-timetable')} /></View>
      : <>
        <ScrollView style={styles.sources} contentContainerStyle={{ paddingHorizontal: 20 }}>
          {presets.map(preset => <Pressable key={preset.id} accessibilityRole="radio" accessibilityLabel={`${preset.name}${preset.isDefault ? ', 기본' : ''}`} accessibilityState={{ checked: preset.id === selectedId }} disabled={busy}
            onPress={() => { setSelectedId(preset.id); setSelectedDay(0); setError(''); }} style={[styles.source, preset.id === selectedId && styles.selected]}>
            <Text numberOfLines={1} style={styles.name}>{preset.name}</Text>{!!preset.isDefault && <Text style={styles.badge}>✓ 기본</Text>}<Text style={styles.selection}>{preset.id === selectedId ? '선택됨' : '›'}</Text>
          </Pressable>)}
        </ScrollView>
        {!!error && !confirming && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
        {selected ? <><Text style={styles.previewTitle}>{selected.name} 미리보기{!events.length ? ' · 일정 없음' : ''}</Text>
          <TimetableGrid key={selected.id} events={events} weekStart={weekStart} readOnly selectedDay={selectedDay} onSelectDay={setSelectedDay}
            onCreate={noop} onEdit={noop} onChange={noopAsync} onResize={noopAsync} onPaste={noopAsync} onDelete={noopAsync} /></>
          : <View style={styles.emptyArea}><Text style={styles.note}>불러올 시간표를 선택하세요.</Text></View>}
      </>}
    {confirming && <ConfirmationDialog title="이 주의 시간표를 변경할까요?" message="현재 주의 기존 일정이 삭제되고 선택한 시간표로 교체됩니다."
      confirmLabel="시간표 교체" destructive busy={busy} error={error} onCancel={() => { setConfirming(false); setError(''); }} onConfirm={() => { void apply(true); }} />}
  </Screen>;
}

const styles = StyleSheet.create({
  sources: { maxHeight: 168, flexGrow: 0, marginBottom: 12 }, source: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, borderRadius: 8 }, selected: { backgroundColor: palette.blueLight },
  name: { flex: 1, fontSize: 14, color: palette.text }, badge: { fontSize: 12, color: palette.blue }, selection: { fontSize: 12, color: palette.muted },
  previewTitle: { paddingHorizontal: 20, paddingBottom: 12, fontSize: 13, color: palette.text }, emptyArea: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 }, note: { fontSize: 13, color: palette.muted },
  error: { padding: 16, fontSize: 12, lineHeight: 19, color: palette.red },
});

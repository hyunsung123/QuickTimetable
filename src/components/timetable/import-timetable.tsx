import { useRef, useState } from 'react';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Action, Screen, ScreenHeader } from '@/components/ui/calendar-ui';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { palette } from '@/constants/calendar';
import { useCalendar } from '@/hooks/use-calendar';
import { addDays, weekdayOf, weekTitle } from '@/lib/dates';
import { availableWeeks } from '@/lib/presets';
import { TimetableActionError } from '@/lib/timetable';
import type { GridEvent, TimetableImportSource } from '@/types/calendar';
import { TimetableGrid } from './timetable-grid';

const noop = () => {};
const noopAsync = async () => {};

export function ImportTimetable({ presetId }: { presetId?: string }) {
  const calendar = useCalendar();
  const [kind, setKind] = useState<'week' | 'preset'>('week');
  const [source, setSource] = useState<TimetableImportSource | null>(null);
  const [selectedDay, setSelectedDay] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const weeks = availableWeeks(calendar.events);
  const presets = calendar.presets.filter(preset => preset.id !== presetId);
  const target = calendar.presets.find(preset => preset.id === presetId);
  const targetHasEvents = calendar.templates.some(event => event.presetId === presetId);
  const events: GridEvent[] = source?.kind === 'week'
    ? calendar.events.filter(event => event.date >= source.weekStart && event.date < addDays(source.weekStart, 7)).map(event => ({ ...event, day: weekdayOf(event.date) }))
    : source?.kind === 'preset' ? calendar.templates.filter(event => event.presetId === source.presetId).map(event => ({ ...event, day: event.weekday })) : [];
  const importSource = async () => {
    if (!source || pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try {
      if (presetId !== undefined) { await calendar.replacePreset(presetId, source); router.back(); }
      else { const id = await calendar.createPreset(source); router.replace({ pathname: '/preset-editor', params: { id } }); }
    } catch (cause) { setError(cause instanceof TimetableActionError ? cause.message : '불러오지 못했습니다. 원래 시간표는 유지됩니다. 다시 시도해 주세요.'); }
    finally { pending.current = false; setBusy(false); }
  };
  if (presetId !== undefined && !target) return <Screen><ScreenHeader title="시간표를 찾을 수 없습니다" back /></Screen>;
  const select = (value: TimetableImportSource) => { setSource(value); setSelectedDay(0); setError(''); };
  return <Screen>
    <ScreenHeader title="시간표 불러오기" back>
      <Action label="불러오기" primary disabled={!source || busy} onPress={() => { if (targetHasEvents) setConfirming(true); else void importSource(); }} />
    </ScreenHeader>
    <View style={styles.tabs}>{(['week', 'preset'] as const).map(value => <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected: kind === value }} disabled={busy}
      onPress={() => { setKind(value); setSource(null); setError(''); }} style={[styles.tab, kind === value && styles.activeTab]}><Text style={[styles.tabText, kind === value && { color: palette.blue }]}>{value === 'week' ? '이전 주간계획' : '저장된 시간표'}</Text></Pressable>)}</View>
    <ScrollView style={styles.sources} contentContainerStyle={{ paddingHorizontal: 20 }}>
      {kind === 'week' ? weeks.map(week => <SourceRow key={week} label={weekTitle(week)} selected={source?.kind === 'week' && source.weekStart === week} disabled={busy} onPress={() => select({ kind: 'week', weekStart: week })} />)
        : presets.map(preset => <SourceRow key={preset.id} label={preset.name} selected={source?.kind === 'preset' && source.presetId === preset.id} disabled={busy} onPress={() => select({ kind: 'preset', presetId: preset.id })} />)}
      {!(kind === 'week' ? weeks.length : presets.length) && <Text style={styles.empty}>불러올 시간표가 없습니다.</Text>}
    </ScrollView>
    {!!error && !confirming && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    {source ? <TimetableGrid key={JSON.stringify(source)} events={events} weekStart={source.kind === 'week' ? source.weekStart : '2024-01-01'} template={source.kind === 'preset'} readOnly
      selectedDay={selectedDay} onSelectDay={setSelectedDay} onCreate={noop} onEdit={noop} onChange={noopAsync} onResize={noopAsync} onPaste={noopAsync} onDelete={noopAsync} />
      : <View style={styles.previewEmpty}><Text style={styles.empty}>불러올 시간표를 선택하세요.</Text></View>}
    {confirming && <ConfirmationDialog title="현재 시간표를 불러온 시간표로 바꿀까요?" confirmLabel="불러오기" busy={busy} error={error}
      onCancel={() => { setConfirming(false); setError(''); }} onConfirm={() => { void importSource(); }} />}
  </Screen>;
}

function SourceRow({ label, selected, disabled, onPress }: { label: string; selected: boolean; disabled: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="radio" accessibilityLabel={label} accessibilityState={{ checked: selected }} disabled={disabled} onPress={onPress} style={styles.sourceRow}>
    <Text numberOfLines={1} style={styles.sourceLabel}>{label}</Text><Text style={{ color: palette.blue }}>{selected ? '✓' : ''}</Text>
  </Pressable>;
}
const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', marginHorizontal: 20, marginBottom: 10, padding: 3, backgroundColor: palette.surface, borderRadius: 9 }, tab: { flex: 1, minHeight: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 7 }, activeTab: { backgroundColor: '#FFF' }, tabText: { color: palette.muted, fontSize: 13, fontWeight: '500' },
  sources: { maxHeight: 150, flexGrow: 0, marginBottom: 12 }, sourceRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: palette.line }, sourceLabel: { flex: 1, color: palette.text, fontSize: 14 },
  previewEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center' }, empty: { color: palette.muted, fontSize: 13, paddingVertical: 16 }, error: { color: palette.red, padding: 16, fontSize: 12, lineHeight: 19 },
});

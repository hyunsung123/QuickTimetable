import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { eventColors, palette, weekdays } from '@/constants/calendar';
import { addDays, formatTime, monthTitle, parseTime, shiftMonth } from '@/lib/dates';
import { MonthCalendar } from '@/components/calendar/month-calendar';
import { Action } from '@/components/ui/calendar-ui';
import type { EventInput, TemplateInput } from '@/types/calendar';

export interface EditorDraft extends EventInput { id?: string; weekday?: number }

export function EventEditor({ draft, template = false, onClose, onSave, onDelete }: {
  draft: EditorDraft; template?: boolean; onClose: () => void;
  onSave: (value: EventInput & TemplateInput, id?: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [title, setTitle] = useState(draft.title);
  const [date, setDate] = useState(draft.date);
  const [weekday, setWeekday] = useState(draft.weekday ?? 0);
  const [start, setStart] = useState(formatTime(draft.startMinute));
  const [end, setEnd] = useState(formatTime(draft.endMinute));
  const [color, setColor] = useState(draft.color);
  const [dateOpen, setDateOpen] = useState(false);
  const [month, setMonth] = useState(date);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const submit = async () => {
    const startMinute = parseTime(start);
    const endMinute = parseTime(end);
    if (!title.trim()) { setError('일정 제목을 입력해 주세요.'); return; }
    if (!Number.isFinite(startMinute) || !Number.isFinite(endMinute) || startMinute % 30 || endMinute % 30 || endMinute > 1440 || startMinute < 0 || endMinute - startMinute < 30) {
      setError('30분 단위로 입력해 주세요. 종료는 시작보다 늦어야 합니다.'); return;
    }
    setBusy(true);
    try { await onSave({ title, date, weekday, startMinute, endMinute, color }, draft.id); onClose(); }
    catch { setError('저장하지 못했습니다. 다시 시도해 주세요.'); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!draft.id) return;
    setBusy(true);
    try { await onDelete(draft.id); onClose(); }
    catch { setError('삭제하지 못했습니다. 다시 시도해 주세요.'); }
    finally { setBusy(false); }
  };

  return <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={() => { if (!busy) onClose(); }}>
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.toolbar}>
          <Action label="취소" onPress={onClose} disabled={busy} />
          <Text style={styles.heading}>{template ? '기본 ' : ''}{draft.id ? '일정 편집' : '새 일정'}</Text>
          <Action label={busy ? '저장 중' : '저장'} onPress={submit} primary disabled={busy} />
        </View>
        <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>제목</Text>
          <TextInput accessibilityLabel="일정 제목" placeholder="어떤 일정인가요?" placeholderTextColor={palette.muted} value={title} onChangeText={setTitle} maxLength={100}
            editable={!busy} style={styles.titleInput} returnKeyType="done" onSubmitEditing={submit} />
          <Text style={styles.label}>{template ? '요일' : '날짜'}</Text>
          {template ? <View style={styles.weekdays}>{weekdays.map((day, i) => <Pressable key={day} accessibilityRole="button" accessibilityState={{ selected: weekday === i }} onPress={() => setWeekday(i)} style={[styles.weekday, weekday === i && { backgroundColor: palette.blue }]}><Text style={{ color: weekday === i ? '#FFF' : palette.text }}>{day}</Text></Pressable>)}</View> : <>
            <View style={styles.dateRow}>
              <Action label="‹" accessibilityLabel="이전 날짜" onPress={() => setDate(addDays(date, -1))} />
              <Pressable accessibilityRole="button" accessibilityLabel="날짜 선택" onPress={() => { setMonth(date); setDateOpen(!dateOpen); }} style={styles.dateButton}><Text style={styles.dateText}>{date.replace(/-/g, '. ')}　⌄</Text></Pressable>
              <Action label="›" accessibilityLabel="다음 날짜" onPress={() => setDate(addDays(date, 1))} />
            </View>
            {dateOpen && <View style={styles.dateCalendar}><View style={styles.dateRow}><Action label="‹" accessibilityLabel="이전 달" onPress={() => setMonth(shiftMonth(month, -1))} /><Text style={styles.dateText}>{monthTitle(month)}</Text><Action label="›" accessibilityLabel="다음 달" onPress={() => setMonth(shiftMonth(month, 1))} /></View><MonthCalendar compact selected={date} month={month} onSelect={value => { setDate(value); setDateOpen(false); }} /></View>}
          </>}
          <View style={styles.timeRow}>
            <TimeField label="시작" value={start} onChange={setStart} max={1410} />
            <Text style={styles.dash}>–</Text>
            <TimeField label="종료" value={end} onChange={setEnd} max={1440} />
          </View>
          <Text style={styles.hint}>30분 단위 · 자정에 끝나는 일정은 24:00</Text>
          <Text style={styles.label}>색상</Text>
          <View style={styles.colors}>{eventColors.map((item, i) => <Pressable key={item} accessibilityRole="button" accessibilityLabel={['파랑', '초록', '갈색', '보라', '분홍', '청록'][i]} accessibilityState={{ selected: item === color }} onPress={() => setColor(item)} style={[styles.color, { backgroundColor: item }, item === color && styles.selectedColor]}><Text style={{ color: '#FFF', fontSize: 19 }}>{item === color ? '✓' : ''}</Text></Pressable>)}</View>
          {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
          {draft.id && <View style={styles.deleteArea}>
            {confirmDelete ? <View style={styles.confirm}><Text style={styles.hint}>이 일정을 삭제할까요?</Text><View style={styles.dateRow}><Action label="유지" onPress={() => setConfirmDelete(false)} disabled={busy} /><Pressable disabled={busy} onPress={remove} style={styles.delete}><Text style={styles.deleteText}>삭제하기</Text></Pressable></View></View> : <Pressable accessibilityRole="button" disabled={busy} onPress={() => setConfirmDelete(true)} style={styles.delete}><Text style={styles.deleteText}>일정 삭제</Text></Pressable>}
          </View>}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  </Modal>;
}

function TimeField({ label, value, onChange, max }: { label: string; value: string; onChange: (value: string) => void; max: number }) {
  const step = (amount: number) => {
    const current = parseTime(value);
    const next = Math.max(0, Math.min(max, (Number.isFinite(current) ? Math.round(current / 30) * 30 : 540) + amount));
    onChange(formatTime(next));
  };
  return <View style={{ flex: 1 }}><Text style={styles.label}>{label}</Text><View style={styles.timeControl}>
    <TextInput accessibilityLabel={`${label} 시간`} value={value} onChangeText={onChange} placeholder="09:00" style={styles.timeInput} maxLength={5} keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default'} />
    <View style={styles.dateRow}><Action label="−" accessibilityLabel={`${label} 30분 이전`} onPress={() => step(-30)} /><Action label="+" accessibilityLabel={`${label} 30분 이후`} onPress={() => step(30)} /></View>
  </View></View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFF' }, toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12, borderBottomWidth: 1, borderColor: palette.line },
  heading: { fontSize: 16, fontWeight: '600', color: palette.text }, form: { padding: 24, paddingBottom: 40 },
  label: { fontSize: 12, fontWeight: '600', color: palette.muted, marginTop: 24, marginBottom: 12 },
  titleInput: { fontSize: 23, paddingVertical: 10, color: palette.text, borderBottomWidth: 1, borderColor: palette.line },
  dateRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dateButton: { flex: 1, alignItems: 'center', paddingVertical: 14 }, dateText: { fontSize: 15, color: palette.text },
  dateCalendar: { backgroundColor: palette.surface, borderRadius: 10, paddingBottom: 12 },
  weekdays: { flexDirection: 'row', gap: 6 }, weekday: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: palette.surface },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 12 }, dash: { marginTop: 50, color: palette.muted },
  timeControl: { backgroundColor: palette.surface, borderRadius: 10, alignItems: 'center', paddingTop: 14 },
  timeInput: { fontSize: 24, color: palette.text, textAlign: 'center', fontVariant: ['tabular-nums'], width: '100%' },
  hint: { fontSize: 12, color: palette.muted, lineHeight: 19, marginTop: 10 }, colors: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  color: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  selectedColor: { borderWidth: 3, borderColor: '#D7E3FA' }, error: { color: palette.red, lineHeight: 20, marginTop: 24, fontSize: 13 },
  deleteArea: { marginTop: 40, borderTopWidth: 1, borderColor: palette.line, paddingTop: 16 },
  delete: { minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 }, deleteText: { color: palette.red, fontSize: 14 }, confirm: { gap: 8 },
});

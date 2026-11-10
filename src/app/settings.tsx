import { useRef, useState } from 'react';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen, ScreenHeader } from '@/components/ui/calendar-ui';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { palette } from '@/constants/calendar';
import { useCalendar } from '@/hooks/use-calendar';

export default function SettingsScreen() {
  const { presets, resetData } = useCalendar();
  const insets = useSafeAreaInsets();
  const [confirmReset, setConfirmReset] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const reset = async () => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try { await resetData(); setConfirmReset(false); }
    catch { setError('초기화하지 못했습니다. 기존 데이터는 유지됩니다. 다시 시도해 주세요.'); }
    finally { pending.current = false; setBusy(false); }
  };
  const active = presets.find(preset => preset.isDefault);
  return <Screen><ScreenHeader title="설정" back /><ScrollView contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 24) }]}>
    <Text style={styles.label}>나의 계획</Text>
    <Pressable accessibilityRole="button" onPress={() => router.push('/default-timetable')} style={styles.row}>
      <View style={{ flex: 1 }}><Text style={styles.title}>기본 시간표 관리</Text><Text style={styles.description}>{active?.name ?? '기본 시간표 없음'} · 저장된 시간표 {presets.length}개</Text></View><Text style={styles.chevron}>›</Text>
    </Pressable>
    <View style={styles.note}><Text style={styles.noteTitle}>일정은 자동으로 저장돼요</Text><Text style={styles.description}>이 기기에 저장되어 앱을 다시 열어도 그대로 이어집니다. 새 기본 시간표는 지정한 다음 주부터 적용되며, 이미 열거나 작성한 주간 계획은 바뀌지 않아요.</Text></View>
    <Text style={[styles.label, styles.testSection]}>테스트</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="테스트 데이터 초기화" disabled={busy} onPress={() => { setError(''); setConfirmReset(true); }} style={styles.row}>
      <Text style={[styles.title, { color: palette.red }]}>테스트 데이터 초기화</Text>
    </Pressable>
    <Text style={styles.brand}>QuickTimeTable</Text><Text style={styles.version}>나의 시간을 간결하게 · 1.0.0</Text>
  </ScrollView>
    {confirmReset && <ConfirmationDialog title="테스트 데이터를 모두 삭제할까요?" message="모든 일정과 저장된 시간표가 삭제됩니다. 이 작업은 되돌릴 수 없습니다."
      confirmLabel="전체 초기화" destructive busy={busy} error={error} onCancel={() => setConfirmReset(false)} onConfirm={() => { void reset(); }} />}
  </Screen>;
}

const styles = StyleSheet.create({
  content: { padding: 24 }, label: { color: palette.muted, fontSize: 11, marginBottom: 14 }, row: { paddingVertical: 22, borderBottomWidth: 1, borderColor: palette.line, flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { color: palette.text, fontSize: 16, fontWeight: '600' }, description: { color: palette.muted, fontSize: 12, lineHeight: 21, marginTop: 7 }, chevron: { color: palette.muted, fontSize: 22 },
  note: { backgroundColor: palette.surface, padding: 20, borderRadius: 10, marginTop: 28 }, noteTitle: { color: palette.text, fontSize: 13, fontWeight: '600' }, brand: { color: palette.text, fontSize: 15, fontWeight: '700', marginTop: 56 }, version: { color: palette.muted, fontSize: 11, marginTop: 8 },
  testSection: { marginTop: 32, marginBottom: 0 },
});

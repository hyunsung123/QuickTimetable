import { useRef, useState } from 'react';
import { router } from 'expo-router';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Action, Screen, ScreenHeader } from '@/components/ui/calendar-ui';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { palette } from '@/constants/calendar';
import { useCalendar } from '@/hooks/use-calendar';
import { TimetableActionError } from '@/lib/timetable';
import { PlanningScreen } from './planning-screen';

export function PresetEditor({ presetId }: { presetId: string }) {
  const calendar = useCalendar();
  const preset = calendar.presets.find(item => item.id === presetId);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const perform = async (work: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try { await work(); }
    catch (cause) { setError(cause instanceof TimetableActionError ? cause.message : '변경 사항을 저장하지 못했습니다. 다시 시도해 주세요.'); }
    finally { pending.current = false; setBusy(false); }
  };
  if (!preset) return <Screen><ScreenHeader title="시간표를 찾을 수 없습니다" back /><Action label="시간표 목록" onPress={() => router.replace('/default-timetable')} /></Screen>;
  const rename = () => { void perform(async () => { await calendar.renamePreset(presetId, name); setRenaming(false); }); };
  const remove = () => { void perform(async () => { await calendar.deletePreset(presetId); router.replace('/default-timetable'); }); };
  return <View style={{ flex: 1 }}>
    <PlanningScreen presetId={presetId}
      headerAction={<Action label="이름 변경" disabled={busy} onPress={() => { setName(preset.name); setError(''); setRenaming(true); }} />}
      templateToolbar={<ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ alignItems: 'center' }}>
        <Action label="시간표 불러오기" disabled={busy} onPress={() => router.push({ pathname: '/import-timetable', params: { presetId } })} />
        <Action label={preset.isDefault ? '✓ 기본 시간표' : '기본으로 설정'} disabled={busy || !!preset.isDefault} onPress={() => { void perform(() => calendar.setDefaultPreset(presetId)); }} />
        <Pressable accessibilityRole="button" accessibilityLabel="템플릿 삭제" disabled={busy} onPress={() => { setError(''); setDeleting(true); }} style={styles.deleteButton}><Text style={{ color: palette.red, fontSize: 13 }}>삭제</Text></Pressable>
      </ScrollView>} />
    {!!error && !deleting && !renaming && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    {renaming && <Modal transparent animationType="fade" onRequestClose={() => { if (!busy) setRenaming(false); }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.overlay}>
        <View accessibilityViewIsModal style={styles.renameCard}>
          <Text style={styles.title}>시간표 이름</Text>
          <TextInput autoFocus accessibilityLabel="시간표 이름" value={name} onChangeText={setName} maxLength={100} editable={!busy} returnKeyType="done" onSubmitEditing={rename} style={styles.input} />
          {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
          <View style={styles.actions}><Action label="취소" disabled={busy} onPress={() => setRenaming(false)} /><Action label="저장" disabled={busy || !name.trim()} onPress={rename} /></View>
        </View>
      </KeyboardAvoidingView>
    </Modal>}
    {deleting && <ConfirmationDialog title="시간표를 삭제할까요?" message={preset.isDefault ? '기본 지정이 해제됩니다. 이미 불러온 주간 일정과 다른 시간표는 유지됩니다.' : '이미 만든 주간 일정과 다른 시간표는 유지됩니다.'}
      confirmLabel="삭제" destructive busy={busy} error={error} onCancel={() => setDeleting(false)} onConfirm={remove} />}
  </View>;
}
const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: '#00000045', alignItems: 'center', justifyContent: 'center', padding: 28 },
  renameCard: { width: 300, maxWidth: '100%', backgroundColor: '#F5F5F7', borderRadius: 14, padding: 18 }, title: { color: palette.text, fontSize: 17, fontWeight: '600', textAlign: 'center', marginBottom: 16 },
  input: { color: palette.text, backgroundColor: '#FFF', padding: 12, borderRadius: 7, fontSize: 16, minHeight: 44 }, actions: { flexDirection: 'row', justifyContent: 'flex-end', paddingTop: 12 },
  deleteButton: { minHeight: 44, paddingHorizontal: 12, justifyContent: 'center' }, error: { color: palette.red, fontSize: 12, lineHeight: 18, padding: 12 },
});

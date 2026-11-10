import { useRef, useState } from 'react';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Screen, ScreenHeader } from '@/components/ui/calendar-ui';
import { ChoiceSheet } from '@/components/ui/choice-sheet';
import { palette } from '@/constants/calendar';
import { useCalendar } from '@/hooks/use-calendar';

export function PresetList() {
  const calendar = useCalendar();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const perform = async (work: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try { await work(); } catch { setError('시간표를 저장하지 못했습니다. 다시 시도해 주세요.'); }
    finally { pending.current = false; setBusy(false); }
  };
  const create = () => { void perform(async () => {
    const id = await calendar.createPreset();
    router.push({ pathname: '/preset-editor', params: { id } });
  }); };
  return <Screen><ScreenHeader title="기본 시간표 관리" back /><ScrollView contentContainerStyle={styles.content}>
    <View style={styles.group}>{calendar.presets.map(preset => <View key={preset.id} style={styles.row}>
      <Pressable accessibilityRole="radio" accessibilityLabel={`${preset.name} 기본으로 설정`} accessibilityState={{ checked: !!preset.isDefault, disabled: busy }} disabled={busy}
        onPress={() => { void perform(() => calendar.setDefaultPreset(preset.id)); }} style={styles.checkTarget}>
        <View style={[styles.check, !!preset.isDefault && styles.checked]}><Text style={styles.tick}>{preset.isDefault ? '✓' : ''}</Text></View>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`${preset.name} 편집`} disabled={busy} onPress={() => router.push({ pathname: '/preset-editor', params: { id: preset.id } })} style={styles.detail}>
        <Text numberOfLines={1} style={styles.name}>{preset.name}</Text><Text style={styles.chevron}>›</Text>
      </Pressable>
    </View>)}</View>
    {!calendar.presets.length && <Text style={styles.empty}>저장된 시간표가 없습니다.</Text>}
    <Pressable accessibilityRole="button" disabled={busy} onPress={() => setAdding(true)} style={styles.add}><Text style={styles.addText}>+ 시간표 추가</Text></Pressable>
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    {!calendar.presets.some(preset => preset.isDefault) && <Text style={styles.empty}>기본 시간표 없음</Text>}
  </ScrollView>
    {adding && <ChoiceSheet onClose={() => setAdding(false)} choices={[
      { label: '빈 시간표 만들기', onPress: create },
      { label: '이전 시간표 불러오기', onPress: () => router.push('/import-timetable') },
    ]} />}
  </Screen>;
}
const styles = StyleSheet.create({
  content: { padding: 20 }, group: { backgroundColor: palette.surface, borderRadius: 12, overflow: 'hidden' }, row: { flexDirection: 'row', alignItems: 'center', minHeight: 58, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: palette.line },
  checkTarget: { width: 54, minHeight: 58, alignItems: 'center', justifyContent: 'center' }, check: { width: 22, height: 22, borderRadius: 6, borderWidth: 1, borderColor: '#BFC5CE', alignItems: 'center', justifyContent: 'center' }, checked: { backgroundColor: palette.blue, borderColor: palette.blue }, tick: { color: '#FFF', fontSize: 16 },
  detail: { flex: 1, flexDirection: 'row', alignItems: 'center', minHeight: 58, paddingRight: 16, gap: 12 }, name: { flex: 1, color: palette.text, fontSize: 16 }, chevron: { color: '#9AA2AF', fontSize: 24 },
  add: { paddingVertical: 18, minHeight: 54 }, addText: { color: palette.blue, fontSize: 16 }, empty: { color: palette.muted, fontSize: 13, paddingVertical: 12 }, error: { color: palette.red, fontSize: 13, lineHeight: 20 },
});

import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Screen, ScreenHeader } from '@/components/ui/calendar-ui';
import { palette } from '@/constants/calendar';
import { useCalendar } from '@/hooks/use-calendar';

export default function SettingsScreen() {
  const { templates } = useCalendar();
  return <Screen><ScreenHeader title="설정" back /><ScrollView contentContainerStyle={styles.content}>
    <Text style={styles.label}>나의 계획</Text>
    <Pressable accessibilityRole="button" onPress={() => router.push('/default-timetable')} style={styles.row}>
      <View style={{ flex: 1 }}><Text style={styles.title}>기본 시간표 관리</Text><Text style={styles.description}>반복할 일정 {templates.length}개 · 새 주에 자동으로 추가</Text></View><Text style={styles.chevron}>›</Text>
    </Pressable>
    <View style={styles.note}><Text style={styles.noteTitle}>일정은 자동으로 저장돼요</Text><Text style={styles.description}>이 기기에 저장되어 앱을 다시 열어도 그대로 이어집니다. 기본 시간표를 수정해도 이미 만든 주간 계획은 바뀌지 않아요.</Text></View>
    <Text style={styles.brand}>QuickTimeTable</Text><Text style={styles.version}>나의 시간을 간결하게 · 1.0.0</Text>
  </ScrollView></Screen>;
}

const styles = StyleSheet.create({
  content: { padding: 24 }, label: { color: palette.muted, fontSize: 11, marginBottom: 14 }, row: { paddingVertical: 22, borderBottomWidth: 1, borderColor: palette.line, flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { color: palette.text, fontSize: 16, fontWeight: '600' }, description: { color: palette.muted, fontSize: 12, lineHeight: 21, marginTop: 7 }, chevron: { color: palette.muted, fontSize: 22 },
  note: { backgroundColor: palette.surface, padding: 20, borderRadius: 10, marginTop: 28 }, noteTitle: { color: palette.text, fontSize: 13, fontWeight: '600' }, brand: { color: palette.text, fontSize: 15, fontWeight: '700', marginTop: 56 }, version: { color: palette.muted, fontSize: 11, marginTop: 8 },
});

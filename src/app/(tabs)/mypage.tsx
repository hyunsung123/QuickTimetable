import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Screen, ScreenHeader } from '@/components/ui/calendar-ui';
import { palette } from '@/constants/calendar';

export default function MyPageScreen() {
  return <Screen>
    <ScreenHeader title="마이페이지" />
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.center}><Text style={styles.title}>개발 중</Text></View>
      <Text style={styles.description}>마이페이지 기능을 준비하고 있어요.</Text>
    </ScrollView>
  </Screen>;
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, paddingHorizontal: 28, paddingBottom: 28 }, center: { flex: 1, minHeight: 120, alignItems: 'center', justifyContent: 'center' },
  title: { color: palette.text, fontSize: 24, fontWeight: '600' }, description: { color: palette.muted, fontSize: 14, lineHeight: 23, textAlign: 'center', paddingVertical: 20 },
});

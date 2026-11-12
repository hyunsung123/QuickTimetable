import { Tabs, TabList, TabSlot, TabTrigger, type TabTriggerSlotProps } from 'expo-router/ui';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { palette } from '@/constants/calendar';

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  return <Tabs style={{ flex: 1 }}><TabSlot style={{ flex: 1 }} />
    <TabList style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
      <TabTrigger name="calendar" href="./" asChild><TabButton kind="calendar">달력</TabButton></TabTrigger>
      <TabTrigger name="weekly" href="/weekly" asChild><TabButton kind="weekly">주간 계획</TabButton></TabTrigger>
      <TabTrigger name="sharing" href="/sharing" asChild><TabButton kind="sharing">캘린더 공유</TabButton></TabTrigger>
      <TabTrigger name="mypage" href="/mypage" asChild><TabButton kind="mypage">마이페이지</TabButton></TabTrigger>
    </TabList>
  </Tabs>;
}

function TabButton({ isFocused, children, kind, ...props }: Omit<TabTriggerSlotProps, 'ref'> & { kind: 'calendar' | 'weekly' | 'sharing' | 'mypage' }) {
  const color = isFocused ? palette.blue : '#949CAA';
  return <Pressable {...props} accessibilityRole="tab" accessibilityState={{ selected: isFocused }} style={styles.button}>
    {kind === 'mypage' ? <View style={styles.peopleIcon} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={[styles.head, { left: 9, borderColor: color }]} /><View style={[styles.shoulders, { left: 7, borderColor: color }]} />
    </View> : kind === 'sharing' ? <View style={styles.peopleIcon} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={[styles.head, { left: 2, borderColor: color }]} /><View style={[styles.head, { right: 2, borderColor: color }]} />
      <View style={[styles.shoulders, { left: 0, borderColor: color }]} /><View style={[styles.shoulders, { right: 0, borderColor: color }]} />
    </View> : <View style={[styles.icon, { borderColor: color }]}>
      {kind === 'calendar' ? <><View style={[styles.iconTop, { backgroundColor: color }]} /><View style={styles.iconDots}>{[0, 1, 2, 3].map(i => <View key={i} style={{ width: 3, height: 3, backgroundColor: color }} />)}</View></> : <View style={styles.iconColumns}>{[0, 1, 2].map(i => <View key={i} style={{ width: 3, height: 10 + i % 2 * 4, backgroundColor: color, borderRadius: 1 }} />)}</View>}
    </View>}
    <Text style={[styles.label, { color }]}>{children}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', borderTopWidth: 1, borderColor: palette.line, paddingTop: 12, backgroundColor: '#FFF' },
  button: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44 }, label: { fontSize: 11, fontWeight: '600' },
  icon: { width: 22, height: 22, borderWidth: 1.5, borderRadius: 4, overflow: 'hidden' }, iconTop: { height: 3, marginTop: 3 },
  iconDots: { flexDirection: 'row', flexWrap: 'wrap', gap: 3, width: 10, margin: 4 }, iconColumns: { flexDirection: 'row', gap: 2, alignItems: 'flex-start', padding: 3 },
  peopleIcon: { width: 26, height: 22 }, head: { position: 'absolute', top: 1, width: 8, height: 8, borderWidth: 1.5, borderRadius: 4 },
  shoulders: { position: 'absolute', bottom: 1, width: 12, height: 10, borderWidth: 1.5, borderTopLeftRadius: 7, borderTopRightRadius: 7, borderBottomLeftRadius: 2, borderBottomRightRadius: 2 },
});

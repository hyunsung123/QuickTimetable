import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { palette } from '@/constants/calendar';
import { useCalendar } from '@/hooks/use-calendar';

export function Action({ label, onPress, primary = false, disabled = false, accessibilityLabel }: {
  label: string; onPress: () => void; primary?: boolean; disabled?: boolean; accessibilityLabel?: string;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.action, primary && styles.primary, (pressed || disabled) && { opacity: 0.5 }]}>
    <Text style={[styles.actionText, primary && { color: '#FFFFFF' }]}>{label}</Text>
  </Pressable>;
}

export function Screen({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <SafeAreaView edges={['top', 'left', 'right']} style={[styles.screen, style]}>{children}</SafeAreaView>;
}

export function ScreenHeader({ title, subtitle, back = false, children }: {
  title: string; subtitle?: string; back?: boolean; children?: ReactNode;
}) {
  return <View style={styles.header}>
    <View style={styles.titleRow}>
      {back && <Action label="‹" accessibilityLabel="뒤로" onPress={() => router.back()} />}
      <View style={{ flex: 1 }}><Text style={styles.title}>{title}</Text>{subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}</View>
      {children}
    </View>
  </View>;
}

export function StorageGate({ children }: { children: ReactNode }) {
  const { loading, initialized, error, retry, clearError } = useCalendar();
  // Initial failure must never expose an editable empty calendar.
  if (loading) return <Screen style={styles.center}><ActivityIndicator color={palette.blue} /><Text style={styles.subtitle}>일정을 불러오는 중</Text></Screen>;
  if (!initialized) return <Screen style={styles.center}><Text style={styles.subtitle}>{error}</Text><Action label="다시 시도" onPress={retry} primary /></Screen>;
  return <View style={styles.screen}>
    {error && <View accessibilityRole="alert" style={styles.error}>
      <Text style={{ flex: 1, color: '#943E44', fontSize: 12 }}>{error}</Text>
      <Action label="다시 시도" onPress={retry} />
      <Action label="닫기" onPress={clearError} />
    </View>}
    {children}
  </View>;
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.background },
  center: { alignItems: 'center', justifyContent: 'center', gap: 16 },
  header: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 18 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 25, fontWeight: '700', letterSpacing: -0.8, color: palette.text },
  subtitle: { fontSize: 12, color: palette.muted, marginTop: 6, lineHeight: 18 },
  action: { minWidth: 42, minHeight: 42, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', borderRadius: 9 },
  actionText: { color: palette.blue, fontSize: 14, fontWeight: '600' },
  primary: { backgroundColor: palette.blue, paddingHorizontal: 18 },
  error: { backgroundColor: '#FFF0F0', padding: 12, paddingTop: 40, flexDirection: 'row', alignItems: 'center' },
});

import { useRef, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { palette } from '@/constants/calendar';

export function ChoiceSheet({ choices, onClose }: { choices: { label: string; onPress: () => void }[]; onClose: () => void }) {
  const [visible, setVisible] = useState(true);
  const selected = useRef<(() => void) | undefined>(undefined);
  const insets = useSafeAreaInsets();
  const dismissed = () => { const action = selected.current; selected.current = undefined; onClose(); action?.(); };
  const close = (action?: () => void) => {
    selected.current = action;
    setVisible(false);
    if (Platform.OS !== 'ios') dismissed();
  };
  return <Modal transparent visible={visible} animationType="slide" onDismiss={dismissed} onRequestClose={() => close()}>
    <View style={[styles.overlay, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      <Pressable accessibilityLabel="닫기" style={StyleSheet.absoluteFill} onPress={() => close()} />
      <View style={styles.group}>{choices.map(choice => <Pressable accessibilityRole="button" key={choice.label} onPress={() => close(choice.onPress)} style={styles.row}><Text style={styles.label}>{choice.label}</Text></Pressable>)}</View>
      <Pressable accessibilityRole="button" onPress={() => close()} style={[styles.group, styles.row]}><Text style={[styles.label, { fontWeight: '600' }]}>취소</Text></Pressable>
    </View>
  </Modal>;
}
const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#00000045', paddingHorizontal: 10, gap: 8 },
  group: { backgroundColor: '#F8F8FA', borderRadius: 14, overflow: 'hidden' }, row: { minHeight: 56, padding: 16, alignItems: 'center', justifyContent: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#D1D1D6' },
  label: { color: palette.blue, fontSize: 18 },
});

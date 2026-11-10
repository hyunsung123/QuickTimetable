import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { palette } from '@/constants/calendar';

interface ConfirmationProps {
  title: string;
  message?: string;
  confirmLabel: string;
  destructive?: boolean;
  busy?: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmationCard({ title, message, confirmLabel, destructive, busy, error, onCancel, onConfirm }: ConfirmationProps) {
  return <View style={styles.center} pointerEvents="box-none">
    <View accessibilityViewIsModal style={styles.card}>
      <Text accessibilityRole="header" style={styles.title}>{title}</Text>
      {!!message && <Text style={styles.message}>{message}</Text>}
      {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      <View style={styles.buttons}>
        <Pressable accessibilityRole="button" disabled={busy} onPress={onCancel} style={styles.button}><Text style={styles.cancel}>취소</Text></Pressable>
        <Pressable accessibilityRole="button" disabled={busy} onPress={onConfirm} style={[styles.button, styles.lastButton]}><Text style={[styles.confirm, destructive && { color: palette.red }, busy && { opacity: 0.5 }]}>{busy ? '처리 중…' : confirmLabel}</Text></Pressable>
      </View>
    </View>
  </View>;
}

export function ConfirmationDialog(props: ConfirmationProps) {
  return <Modal transparent visible animationType="fade" presentationStyle="overFullScreen" onRequestClose={() => { if (!props.busy) props.onCancel(); }}>
    <View style={styles.backdrop}><ConfirmationCard {...props} /></View>
  </Modal>;
}

export const confirmationBackdrop = { backgroundColor: '#00000045' };
const styles = StyleSheet.create({
  backdrop: { flex: 1, ...confirmationBackdrop }, center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  card: { width: 280, maxWidth: '100%', backgroundColor: '#F5F5F7', borderRadius: 14, overflow: 'hidden' },
  title: { color: palette.text, fontSize: 17, fontWeight: '600', textAlign: 'center', paddingTop: 22, paddingHorizontal: 18, paddingBottom: 16 },
  message: { color: palette.text, fontSize: 13, lineHeight: 19, textAlign: 'center', paddingHorizontal: 20, paddingBottom: 20 },
  error: { color: palette.red, fontSize: 12, paddingHorizontal: 18, paddingBottom: 12 },
  buttons: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderColor: '#C6C6C8' },
  button: { flex: 1, minHeight: 46, alignItems: 'center', justifyContent: 'center', padding: 10 }, lastButton: { borderLeftWidth: StyleSheet.hairlineWidth, borderColor: '#C6C6C8' },
  cancel: { fontSize: 17, color: palette.blue }, confirm: { fontSize: 17, fontWeight: '600', color: palette.blue },
});

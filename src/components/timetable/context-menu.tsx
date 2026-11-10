import { Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { contextMenuPosition } from '@/lib/context-menu';
import type { MenuAnchor } from '@/types/calendar';

export function TimetableContextMenu({ label, anchor, onPress, onClose }: {
  label: string; anchor: MenuAnchor; onPress: () => void; onClose: () => void;
}) {
  const viewport = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const position = contextMenuPosition(anchor, viewport, insets);
  return <Modal transparent visible animationType="fade" presentationStyle="overFullScreen" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
    <View style={styles.overlay} onAccessibilityEscape={onClose}>
      <Pressable accessibilityRole="button" accessibilityLabel="메뉴 닫기" style={StyleSheet.absoluteFill} onPress={onClose} />
      <View accessibilityViewIsModal style={[styles.menu, { left: position.left, top: position.top }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.button, pressed && { backgroundColor: '#44464B' }]}><Text style={styles.text}>{label}</Text></Pressable>
        <View pointerEvents="none" style={[styles.tail, { left: position.tailLeft }, position.placement === 'above' ? styles.tailDown : styles.tailUp]} />
      </View>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  overlay: { flex: 1 }, menu: { position: 'absolute', width: 112, height: 44, borderRadius: 10, backgroundColor: '#2C2D32' },
  button: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 10 }, text: { color: '#FFFFFF', fontSize: 15, fontWeight: '500' },
  tail: { position: 'absolute', width: 0, height: 0, borderLeftWidth: 6, borderRightWidth: 6, borderLeftColor: 'transparent', borderRightColor: 'transparent' },
  tailDown: { bottom: -7, borderTopWidth: 8, borderTopColor: '#2C2D32' },
  tailUp: { top: -7, borderBottomWidth: 8, borderBottomColor: '#2C2D32' },
});

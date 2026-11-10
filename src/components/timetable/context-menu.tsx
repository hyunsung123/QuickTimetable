import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { contextMenuPosition, contextMenuSize } from '@/lib/context-menu';
import { ConfirmationCard, confirmationBackdrop } from '@/components/ui/confirmation-dialog';
import type { MenuAnchor } from '@/types/calendar';

export function TimetableContextMenu({ kind, anchor, onCopy, onPaste, onDelete, onClose }: {
  kind: 'copy' | 'paste'; anchor: MenuAnchor; onCopy: () => void; onPaste: () => void;
  onDelete: () => Promise<void>; onClose: () => void;
}) {
  const viewport = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const progress = useSharedValue(0);
  useEffect(() => { progress.value = withTiming(1, { duration: 120 }); }, [progress]);
  const appearance = useAnimatedStyle(() => ({ opacity: progress.value, transform: [{ scale: 0.96 + 0.04 * progress.value }] }));
  const labels = kind === 'copy' ? ['복사', '삭제'] : ['붙여넣기'];
  const size = contextMenuSize(labels, viewport.fontScale);
  const position = contextMenuPosition(anchor, viewport, insets, size.width, size.height);
  const remove = async () => {
    if (busy) return;
    setBusy(true);
    try { await onDelete(); } finally { setBusy(false); }
  };
  return <Modal transparent visible animationType="none" presentationStyle="overFullScreen" statusBarTranslucent navigationBarTranslucent onRequestClose={() => { if (!busy) onClose(); }}>
    <View style={[styles.overlay, confirming && confirmationBackdrop]} onAccessibilityEscape={() => { if (!busy) onClose(); }}>
      {confirming ? <ConfirmationCard title="일정을 삭제할까요?" confirmLabel="삭제" destructive busy={busy} onCancel={onClose} onConfirm={() => { void remove(); }} /> : <>
      <Pressable accessibilityRole="button" accessibilityLabel="메뉴 닫기" style={StyleSheet.absoluteFill} onPress={onClose} />
      <Animated.View accessibilityViewIsModal style={[styles.menu, { width: size.width, height: size.height, left: position.left, top: position.top }, appearance]}>
        <View style={styles.items}>{labels.map((label, index) => <View key={label} style={[styles.item, index > 0 && styles.divider]}>
          <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={kind === 'paste' ? onPaste : index === 0 ? onCopy : () => setConfirming(true)} style={({ pressed }) => [styles.button, pressed && { backgroundColor: '#515155' }]}><Text maxFontSizeMultiplier={1.4} style={styles.text}>{label}</Text></Pressable>
        </View>)}</View>
        <View pointerEvents="none" style={[styles.tail, { left: position.tailLeft }, position.placement === 'above' ? styles.tailDown : styles.tailUp]} />
      </Animated.View></>}
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  overlay: { flex: 1 }, menu: { position: 'absolute', borderRadius: 8, backgroundColor: '#303034', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowRadius: 5, shadowOpacity: 0.14 },
  items: { flex: 1, flexDirection: 'row', borderRadius: 8, overflow: 'hidden' }, item: { flex: 1 }, divider: { borderLeftWidth: StyleSheet.hairlineWidth, borderColor: '#FFFFFF40' },
  button: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 }, text: { color: '#FFFFFF', fontSize: 15, fontWeight: '400' },
  tail: { position: 'absolute', width: 0, height: 0, borderLeftWidth: 6, borderRightWidth: 6, borderLeftColor: 'transparent', borderRightColor: 'transparent' },
  tailDown: { bottom: -6, borderTopWidth: 7, borderTopColor: '#303034' },
  tailUp: { top: -6, borderBottomWidth: 7, borderBottomColor: '#303034' },
});

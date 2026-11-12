import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

export function selectionHaptic() {
  if (Platform.OS !== 'web') void Haptics.selectionAsync().catch(() => undefined);
}

export function rejectionHaptic() {
  if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
}

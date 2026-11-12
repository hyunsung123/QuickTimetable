import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StorageGate } from '@/components/ui/calendar-ui';
import { CalendarProvider } from '@/hooks/use-calendar';

export default function RootLayout() {
  return <GestureHandlerRootView style={{ flex: 1 }}><SafeAreaProvider><CalendarProvider>
    <StatusBar style="dark" />
    <StorageGate><Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#FFF' } }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="settings" />
      <Stack.Screen name="default-timetable" />
      <Stack.Screen name="preset-editor" />
      <Stack.Screen name="import-timetable" />
      <Stack.Screen name="select-timetable" />
    </Stack></StorageGate>
  </CalendarProvider></SafeAreaProvider></GestureHandlerRootView>;
}

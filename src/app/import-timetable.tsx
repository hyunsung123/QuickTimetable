import { useLocalSearchParams } from 'expo-router';
import { ImportTimetable } from '@/components/timetable/import-timetable';

export default function ImportTimetableScreen() {
  const { presetId } = useLocalSearchParams<{ presetId?: string }>();
  return <ImportTimetable presetId={presetId} />;
}

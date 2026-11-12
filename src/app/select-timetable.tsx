import { useLocalSearchParams } from 'expo-router';
import { TimetablePicker } from '@/components/timetable/timetable-picker';
import { Screen, ScreenHeader } from '@/components/ui/calendar-ui';
import { mondayOf } from '@/lib/dates';

export default function SelectTimetableScreen() {
  const { weekStart } = useLocalSearchParams<{ weekStart?: string | string[] }>();
  let week: string;
  try {
    if (typeof weekStart !== 'string') throw new Error('Missing week');
    week = mondayOf(weekStart);
  } catch { return <Screen><ScreenHeader title="주간 계획을 선택해 주세요" back /></Screen>; }
  return <TimetablePicker key={week} weekStart={week} />;
}

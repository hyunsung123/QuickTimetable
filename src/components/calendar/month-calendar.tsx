import { Pressable, StyleSheet, Text, View } from 'react-native';
import { palette } from '@/constants/calendar';
import { dateKey, monthDays, parseDate } from '@/lib/dates';
import type { CalendarEvent } from '@/types/calendar';

export function MonthCalendar({ selected, month = selected, events = [], onSelect, compact = false }: {
  selected: string; month?: string; events?: CalendarEvent[]; onSelect: (value: string) => void; compact?: boolean;
}) {
  const today = dateKey();
  const dates = monthDays(month);
  const byDate = new Map<string, CalendarEvent[]>();
  for (const event of events) byDate.set(event.date, [...(byDate.get(event.date) ?? []), event]);
  return <View style={styles.calendar}>
    <View style={styles.week}>
      {['일', '월', '화', '수', '목', '금', '토'].map((day, i) => <Text key={day} style={[styles.weekday, i === 0 && { color: palette.red }, i === 6 && { color: palette.blue }]}>{day}</Text>)}
    </View>
    <View style={styles.days}>
      {dates.map(date => {
        const active = date === selected;
        const isToday = date === today;
        const outside = date.slice(0, 7) !== month.slice(0, 7);
        const items = [...(byDate.get(date) ?? [])].sort((a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute || a.id.localeCompare(b.id));
        return <Pressable key={date} onPress={() => onSelect(date)} accessibilityRole="button"
          accessibilityLabel={`${date}${isToday ? ', 오늘' : ''}, 일정 ${items.length}개`} accessibilityState={{ selected: active }}
          style={[styles.cell, { minHeight: compact ? 42 : 64 }, active && styles.selected]}>
          <View style={[styles.numberCircle, isToday && styles.today, active && styles.activeNumber]}>
            <Text style={[styles.number, outside && { color: '#B9BFC8' }, isToday && { color: palette.blue, fontWeight: '700' }, active && { color: '#FFFFFF', fontWeight: '700' }]}>{parseDate(date).getDate()}</Text>
          </View>
          {!compact && <View style={styles.indicators}>{[items.slice(0, 4), items.slice(4, 8)].filter(row => row.length).map((row, index) =>
            <View key={index} style={styles.dotRow}>{row.map(event => <View key={event.id} style={[styles.dot, { backgroundColor: event.color }]} />)}</View>)}</View>}
        </Pressable>;
      })}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  calendar: { paddingHorizontal: 12 },
  week: { flexDirection: 'row', paddingBottom: 12 },
  weekday: { width: `${100 / 7}%`, textAlign: 'center', color: palette.muted, fontSize: 12, fontWeight: '500' },
  days: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, alignItems: 'center', paddingTop: 5, borderRadius: 8 },
  selected: { backgroundColor: palette.blueLight },
  numberCircle: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: 15 },
  activeNumber: { backgroundColor: palette.blue },
  today: { borderWidth: 1, borderColor: palette.blue },
  number: { fontSize: 15, color: palette.text, fontVariant: ['tabular-nums'] },
  indicators: { height: 16, gap: 3, alignItems: 'center', justifyContent: 'center' },
  dotRow: { flexDirection: 'row', gap: 3 },
  dot: { width: 4, height: 4, borderRadius: 2 },
});

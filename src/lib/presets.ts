import type { CalendarEvent, TimetablePreset } from '../types/calendar';
import { mondayOf } from './dates';

export function nextPresetName(presets: Pick<TimetablePreset, 'name'>[]) {
  const names = new Set(presets.map(preset => preset.name));
  let index = 1;
  while (names.has(`기본 시간표 ${index}`)) index++;
  return `기본 시간표 ${index}`;
}

export function availableWeeks(events: Pick<CalendarEvent, 'date'>[]) {
  return [...new Set(events.map(event => mondayOf(event.date)))].sort().reverse();
}

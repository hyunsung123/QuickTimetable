import type { GridEvent } from '../types/calendar';

export type DragMode = 'move' | 'start' | 'end';
export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function dragEvent(event: GridEvent, mode: DragMode, deltaX: number, deltaY: number, dayWidth: number, slotHeight: number): GridEvent {
  const delta = Math.round(deltaY / slotHeight) * 30;
  if (mode === 'start') return { ...event, startMinute: clamp(event.startMinute + delta, 0, event.endMinute - 30) };
  if (mode === 'end') return { ...event, endMinute: clamp(event.endMinute + delta, event.startMinute + 30, 1440) };
  const duration = event.endMinute - event.startMinute;
  const startMinute = clamp(event.startMinute + delta, 0, 1440 - duration);
  return { ...event, day: clamp(event.day + Math.round(deltaX / dayWidth), 0, 6), startMinute, endMinute: startMinute + duration };
}

// Give every overlapping event its own lane so it remains tappable.
export function eventLanes(events: GridEvent[]): Map<string, { lane: number; lanes: number }> {
  const result = new Map<string, { lane: number; lanes: number }>();
  for (let day = 0; day < 7; day++) {
    const sorted = events.filter(event => event.day === day).sort((a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute || a.id.localeCompare(b.id));
    let group: GridEvent[] = [];
    let groupEnd = -1;
    const flush = () => {
      const ends: number[] = [];
      for (const event of group) {
        let lane = ends.findIndex(end => end <= event.startMinute);
        if (lane < 0) lane = ends.length;
        ends[lane] = event.endMinute;
        result.set(event.id, { lane, lanes: 1 });
      }
      for (const event of group) result.get(event.id)!.lanes = ends.length;
    };
    for (const event of sorted) {
      if (event.startMinute >= groupEnd && group.length) { flush(); group = []; groupEnd = -1; }
      group.push(event);
      groupEnd = Math.max(groupEnd, event.endMinute);
    }
    flush();
  }
  return result;
}

import type { EventClipboard, EventTimeChange, GridEvent } from '../types/calendar';

export type DragMode = 'move' | 'start' | 'end';
export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export class TimetableActionError extends Error {}

export const overlaps = (a: { startMinute: number; endMinute: number }, b: { startMinute: number; endMinute: number }) =>
  a.startMinute < b.endMinute && a.endMinute > b.startMinute;

export function copyEvent(event: Pick<GridEvent, 'title' | 'color' | 'startMinute' | 'endMinute'>): EventClipboard {
  return { title: event.title, color: event.color, durationMinute: event.endMinute - event.startMinute };
}

export function pastedEvent(clipboard: EventClipboard, startMinute: number) {
  const endMinute = startMinute + clipboard.durationMinute;
  if (!Number.isInteger(startMinute) || startMinute < 0 || startMinute % 30 ||
      !Number.isInteger(clipboard.durationMinute) || clipboard.durationMinute < 30 || clipboard.durationMinute % 30 || endMinute > 1440) {
    throw new TimetableActionError('일정 길이를 유지하며 붙여넣을 수 없습니다. 자정 이전의 다른 시간을 선택해 주세요.');
  }
  return { title: clipboard.title, color: clipboard.color, startMinute, endMinute };
}

export interface BoundaryResizeResult {
  changes: EventTimeChange[];
  linkedId?: string;
  blocked: boolean;
}

/** The source snapshot stays fixed for the whole drag. linkedId latches contact
 * across updates, including reversing direction after dragging through a gap. */
export function resizeBoundary(events: GridEvent[], id: string, edge: 'start' | 'end', deltaMinute: number, linkedId?: string): BoundaryResizeResult {
  const active = events.find(event => event.id === id);
  if (!active || !Number.isFinite(deltaMinute)) return { changes: [], blocked: true };
  const others = events.filter(event => event.day === active.day && event.id !== id);
  if (others.some(event => overlaps(active, event))) return { changes: [], blocked: true };
  const target = active[edge === 'end' ? 'endMinute' : 'startMinute'] + Math.round(deltaMinute / 30) * 30;
  const candidates = others.filter(event => edge === 'end' ? event.startMinute >= active.endMinute : event.endMinute <= active.startMinute);
  const nearestTime = edge === 'end'
    ? Math.min(1440, ...candidates.map(event => event.startMinute))
    : Math.max(0, ...candidates.map(event => event.endMinute));
  const nearest = candidates.filter(event => (edge === 'end' ? event.startMinute : event.endMinute) === nearestTime);
  const partner = linkedId ? candidates.find(event => event.id === linkedId) : nearest[0];
  const contact = !!partner && (!!linkedId || (edge === 'end'
    ? partner.startMinute === active.endMinute || target >= partner.startMinute
    : partner.endMinute === active.startMinute || target <= partner.endMinute));
  const ambiguous = !!partner && (nearest.length !== 1 || others.some(event => event.id !== partner.id && overlaps(partner, event)));
  if (linkedId && (!partner || ambiguous)) return { changes: [], linkedId, blocked: true };
  if (ambiguous && partner && (edge === 'end' ? partner.startMinute === active.endMinute : partner.endMinute === active.startMinute)) {
    return { changes: [], blocked: true };
  }
  const next = new Map<string, GridEvent>();
  let boundary: number;
  if (contact && !ambiguous) {
    boundary = edge === 'end'
      ? clamp(target, active.startMinute + 30, partner.endMinute - 30)
      : clamp(target, partner.startMinute + 30, active.endMinute - 30);
    next.set(active.id, { ...active, [edge === 'end' ? 'endMinute' : 'startMinute']: boundary });
    next.set(partner.id, { ...partner, [edge === 'end' ? 'startMinute' : 'endMinute']: boundary });
    linkedId = partner.id;
  } else {
    boundary = edge === 'end'
      ? clamp(target, active.startMinute + 30, nearestTime)
      : clamp(target, nearestTime, active.endMinute - 30);
    next.set(active.id, { ...active, [edge === 'end' ? 'endMinute' : 'startMinute']: boundary });
  }
  return {
    changes: events.flatMap(event => {
      const value = next.get(event.id);
      return value && (event.startMinute !== value.startMinute || event.endMinute !== value.endMinute)
        ? [{ id: event.id, startMinute: value.startMinute, endMinute: value.endMinute, previousStartMinute: event.startMinute, previousEndMinute: event.endMinute }]
        : [];
    }),
    linkedId,
    blocked: contact && ambiguous,
  };
}

export interface TimetableDragSession {
  original: GridEvent[];
  id: string;
  mode: DragMode;
  changes: EventTimeChange[];
  movedEvent?: GridEvent;
  linkedId?: string;
  blocked: boolean;
}

export function beginTimetableDrag(events: GridEvent[], id: string, mode: DragMode): TimetableDragSession {
  return { original: events.map(event => ({ ...event })), id, mode, changes: [], blocked: false };
}

export function updateTimetableDrag(session: TimetableDragSession, deltaX: number, deltaY: number, dayWidth: number, slotHeight: number): TimetableDragSession {
  const event = session.original.find(value => value.id === session.id);
  if (!event) return session;
  if (session.mode === 'move') return { ...session, movedEvent: dragEvent(event, 'move', deltaX, deltaY, dayWidth, slotHeight) };
  const result = resizeBoundary(session.original, session.id, session.mode, deltaY / slotHeight * 30, session.linkedId);
  return { ...session, ...result };
}

export function finishTimetableDrag(session: TimetableDragSession, success: boolean) {
  const changes = success ? session.changes : [];
  const movedEvent = success ? session.movedEvent : undefined;
  const byId = new Map(changes.map(change => [change.id, change]));
  const events = session.original.map(event => {
    if (movedEvent?.id === event.id) return movedEvent;
    const change = byId.get(event.id);
    return change ? { ...event, startMinute: change.startMinute, endMinute: change.endMinute } : event;
  });
  return { events, changes, movedEvent };
}

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

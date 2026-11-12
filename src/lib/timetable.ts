import type { EventClipboard, EventTimeChange, GridEvent } from '../types/calendar';

export type DragMode = 'move' | 'start' | 'end';
export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export class TimetableActionError extends Error {}
export class WeekReplacementRequiredError extends TimetableActionError {}

export const overlaps = (a: { startMinute: number; endMinute: number }, b: { startMinute: number; endMinute: number }) =>
  a.startMinute < b.endMinute && a.endMinute > b.startMinute;

type TimeRange = { startMinute: number; endMinute: number };

/** Only move/paste may shorten a duration. An occupied start never fits.
 * Callers scope the rows to one date or one preset/weekday and exclude self. */
export function fitInFreeSpace(others: TimeRange[], startMinute: number, durationMinute: number) {
  const proposed = { startMinute, endMinute: Math.min(1440, startMinute + durationMinute) };
  if (!Number.isInteger(startMinute) || startMinute < 0 || startMinute > 1410 || startMinute % 30 ||
      !Number.isInteger(durationMinute) || durationMinute < 30 || durationMinute % 30 ||
      others.some(event => event.startMinute <= startMinute && startMinute < event.endMinute)) {
    return { ...proposed, blocked: true, shortened: false };
  }
  const nextStart = Math.min(1440, ...others.filter(event => event.startMinute > startMinute).map(event => event.startMinute));
  const duration = Math.min(durationMinute, Math.floor((nextStart - startMinute) / 30) * 30);
  return { startMinute, endMinute: startMinute + duration, blocked: duration < 30, shortened: duration < durationMinute };
}

export function conflictingEventIds(events: GridEvent[]): Set<string> {
  const result = new Set<string>();
  for (let i = 0; i < events.length; i++) for (let j = i + 1; j < events.length; j++) {
    if (events[i].day === events[j].day && overlaps(events[i], events[j])) {
      result.add(events[i].id); result.add(events[j].id);
    }
  }
  return result;
}

export function copyEvent(event: Pick<GridEvent, 'title' | 'color' | 'startMinute' | 'endMinute'>): EventClipboard {
  return { title: event.title, color: event.color, durationMinute: event.endMinute - event.startMinute };
}

export function pastedEvent(clipboard: EventClipboard, startMinute: number, others: TimeRange[] = []) {
  const result = fitInFreeSpace(others, startMinute, clipboard.durationMinute);
  if (result.blocked) throw new TimetableActionError('해당 시간에 다른 일정이 있거나 빈 공간이 30분보다 짧아 붙여넣을 수 없습니다.');
  return { title: clipboard.title, color: clipboard.color, startMinute, endMinute: result.endMinute };
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
  shortened?: boolean;
}

export function beginTimetableDrag(events: GridEvent[], id: string, mode: DragMode): TimetableDragSession {
  return { original: events.map(event => ({ ...event })), id, mode, changes: [], blocked: false };
}

export function updateTimetableDrag(session: TimetableDragSession, deltaX: number, deltaY: number, dayWidth: number, slotHeight: number): TimetableDragSession {
  const event = session.original.find(value => value.id === session.id);
  if (!event) return session;
  if (session.mode === 'move') {
    const candidate = dragEvent(event, 'move', deltaX, deltaY, dayWidth, slotHeight);
    const others = session.original.filter(value => value.id !== event.id && value.day === candidate.day);
    const result = fitInFreeSpace(others, candidate.startMinute, event.endMinute - event.startMinute);
    return { ...session, movedEvent: { ...candidate, endMinute: result.endMinute }, blocked: result.blocked, shortened: result.shortened };
  }
  const result = resizeBoundary(session.original, session.id, session.mode, deltaY / slotHeight * 30, session.linkedId);
  return { ...session, ...result };
}

export function finishTimetableDrag(session: TimetableDragSession, success: boolean) {
  if (session.mode === 'move' && session.blocked) success = false;
  const changes = success ? session.changes : [];
  const movedEvent = success ? session.movedEvent : undefined;
  return { events: previewTimetableDrag({ ...session, changes, movedEvent }), changes, movedEvent };
}

/** Invalid destinations remain visible as red ghosts, but cannot be committed. */
export function previewTimetableDrag(session: TimetableDragSession): GridEvent[] {
  const { changes, movedEvent } = session;
  const byId = new Map(changes.map(change => [change.id, change]));
  return session.original.map(event => {
    if (movedEvent?.id === event.id) return movedEvent;
    const change = byId.get(event.id);
    return change ? { ...event, startMinute: change.startMinute, endMinute: change.endMinute } : event;
  });
}

export function dragEvent(event: GridEvent, mode: DragMode, deltaX: number, deltaY: number, dayWidth: number, slotHeight: number): GridEvent {
  const delta = Math.round(deltaY / slotHeight) * 30;
  if (mode === 'start') return { ...event, startMinute: clamp(event.startMinute + delta, 0, event.endMinute - 30) };
  if (mode === 'end') return { ...event, endMinute: clamp(event.endMinute + delta, event.startMinute + 30, 1440) };
  const duration = event.endMinute - event.startMinute;
  const startMinute = clamp(event.startMinute + delta, 0, 1410);
  return { ...event, day: clamp(event.day + Math.round(deltaX / dayWidth), 0, 6), startMinute, endMinute: Math.min(1440, startMinute + duration) };
}

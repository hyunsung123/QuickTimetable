import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { beginTimetableDrag, finishTimetableDrag, overlaps, previewTimetableDrag, TimetableActionError, updateTimetableDrag, type DragMode, type TimetableDragSession } from '@/lib/timetable';
import { rejectionHaptic, selectionHaptic } from '@/lib/haptics';
import type { EventTimeChange, GridEvent } from '@/types/calendar';

export function useTimetableDrag(events: GridEvent[], dayWidth: number, slotHeight: number, onMove: (event: GridEvent) => Promise<void>, onResize: (changes: EventTimeChange[]) => Promise<void>, onError: (error: unknown) => void) {
  const current = useRef<TimetableDragSession | null>(null);
  const latestEvents = useRef(events);
  const pending = useRef(false);
  const [preview, setPreview] = useState<TimetableDragSession | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { latestEvents.current = events; }, [events]);

  useFocusEffect(useCallback(() => () => {
    current.current = null;
    setPreview(null);
  }, []));

  const begin = (id: string, mode: DragMode) => {
    if (current.current || pending.current) return false;
    const session = beginTimetableDrag(events, id, mode);
    current.current = session;
    setPreview(session);
    selectionHaptic();
    return true;
  };
  const update = (id: string, x: number, y: number) => {
    const previous = current.current;
    if (!previous || previous.id !== id) return;
    const next = updateTimetableDrag(previous, x, y, dayWidth, slotHeight);
    current.current = next;
    const timeChanged = JSON.stringify(next.changes) !== JSON.stringify(previous.changes) || JSON.stringify(next.movedEvent) !== JSON.stringify(previous.movedEvent);
    if (timeChanged) selectionHaptic();
    if (timeChanged || next.linkedId !== previous.linkedId || next.blocked !== previous.blocked) setPreview(next);
  };
  const end = async (id: string, success: boolean) => {
    const session = current.current;
    if (!session || session.id !== id) return false;
    current.current = null;
    if (success && session.mode === 'move' && session.blocked) {
      setPreview(null);
      rejectionHaptic();
      onError(new TimetableActionError('해당 시간에는 배치할 수 없습니다. 원래 위치로 돌아갑니다.'));
      return false;
    }
    const result = finishTimetableDrag(session, success);
    const original = session.original.find(event => event.id === session.id);
    const moved = result.movedEvent;
    const hasMove = moved && original && (moved.day !== original.day || moved.startMinute !== original.startMinute || moved.endMinute !== original.endMinute);
    if (!success || (!result.changes.length && !hasMove)) { setPreview(null); return false; }
    // Recheck the current rendered snapshot as well as the frozen drag source.
    // SQLite repeats the check inside its transaction for changes arriving later.
    if (hasMove && (!latestEvents.current.some(event => event.id === moved.id && event.day === original.day && event.startMinute === original.startMinute && event.endMinute === original.endMinute) ||
        latestEvents.current.some(event => event.id !== moved.id && event.day === moved.day && overlaps(moved, event)))) {
      setPreview(null);
      rejectionHaptic();
      onError(new TimetableActionError('일정이 변경되었습니다. 다시 이동해 주세요.'));
      return false;
    }
    pending.current = true;
    setSaving(true);
    try {
      if (hasMove) await onMove(moved);
      else await onResize(result.changes);
      return true;
    } catch (error) { rejectionHaptic(); onError(error); return false; }
    finally { pending.current = false; setSaving(false); setPreview(null); }
  };

  return {
    begin, update, end, saving,
    activeId: preview?.id,
    activeMode: preview?.mode,
    blocked: preview?.blocked ?? false,
    shortened: preview?.shortened ?? false,
    visibleEvents: preview ? previewTimetableDrag(preview) : events,
    dragging: !!preview,
  };
}

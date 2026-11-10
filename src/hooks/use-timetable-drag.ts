import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { beginTimetableDrag, finishTimetableDrag, updateTimetableDrag, type DragMode, type TimetableDragSession } from '@/lib/timetable';
import { selectionHaptic } from '@/lib/haptics';
import type { EventTimeChange, GridEvent } from '@/types/calendar';

export function useTimetableDrag(events: GridEvent[], dayWidth: number, slotHeight: number, onMove: (event: GridEvent) => Promise<void>, onResize: (changes: EventTimeChange[]) => Promise<void>, onError: (error: unknown) => void) {
  const current = useRef<TimetableDragSession | null>(null);
  const pending = useRef(false);
  const [preview, setPreview] = useState<TimetableDragSession | null>(null);
  const [saving, setSaving] = useState(false);

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
    if (!session || session.id !== id) return;
    current.current = null;
    const result = finishTimetableDrag(session, success);
    const original = session.original.find(event => event.id === session.id);
    const moved = result.movedEvent;
    const hasMove = moved && original && (moved.day !== original.day || moved.startMinute !== original.startMinute || moved.endMinute !== original.endMinute);
    if (!success || (!result.changes.length && !hasMove)) { setPreview(null); return; }
    pending.current = true;
    setSaving(true);
    try {
      if (hasMove) await onMove(moved);
      else await onResize(result.changes);
    } catch (error) { onError(error); }
    finally { pending.current = false; setSaving(false); setPreview(null); }
  };

  return {
    begin, update, end, saving,
    activeId: preview?.id,
    activeMode: preview?.mode,
    blocked: preview?.blocked ?? false,
    visibleEvents: preview ? finishTimetableDrag(preview, true).events : events,
    dragging: !!preview,
  };
}

import { createContext, Fragment, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { getRepository } from '@/lib/database';
import { dateKey } from '@/lib/dates';
import { TimetableActionError } from '@/lib/timetable';
import type { CalendarRepository } from '@/lib/repository';
import type { EventClipboard, EventInput, EventTimeChange, Snapshot, TemplateInput, TimetableImportSource } from '@/types/calendar';

interface CalendarContextValue extends Snapshot {
  loading: boolean;
  initialized: boolean;
  error: string | null;
  selectedDate: string;
  setSelectedDate: (date: string) => void;
  retry: () => void;
  clearError: () => void;
  saveEvent: (input: EventInput, id?: string) => Promise<void>;
  deleteEvent: (id: string) => Promise<void>;
  saveTemplate: (input: TemplateInput, id?: string, presetId?: string) => Promise<void>;
  deleteTemplate: (id: string, presetId?: string) => Promise<void>;
  ensureWeek: (date: string) => Promise<void>;
  clipboard: EventClipboard | null;
  setClipboard: (clipboard: EventClipboard) => void;
  updateEventTimes: (changes: EventTimeChange[]) => Promise<void>;
  updateTemplateTimes: (changes: EventTimeChange[], presetId?: string) => Promise<void>;
  pasteEvent: (clipboard: EventClipboard, date: string, startMinute: number) => Promise<void>;
  pasteTemplate: (clipboard: EventClipboard, weekday: number, startMinute: number, presetId?: string) => Promise<void>;
  createPreset: (source?: TimetableImportSource) => Promise<string>;
  renamePreset: (id: string, name: string) => Promise<void>;
  setDefaultPreset: (id: string | null) => Promise<void>;
  deletePreset: (id: string) => Promise<void>;
  replacePreset: (id: string, source: TimetableImportSource) => Promise<void>;
  resetData: () => Promise<void>;
}

const CalendarContext = createContext<CalendarContextValue | null>(null);

export function CalendarProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<Snapshot>({ events: [], templates: [], presets: [] });
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [selectedDate, setSelectedDate] = useState(dateKey());
  const [clipboard, setClipboard] = useState<EventClipboard | null>(null);
  const resetting = useRef(false);
  const [resetVersion, setResetVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getRepository().then(repo => repo.initialize()).then(data => {
      if (!cancelled) { setSnapshot(data); setInitialized(true); setError(null); }
    }).catch(() => {
      if (!cancelled) setError('일정을 불러오지 못했습니다. 다시 시도해 주세요.');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [attempt]);

  const perform = useCallback(async (operation: (repo: CalendarRepository) => Promise<Snapshot>) => {
    try {
      const repo = await getRepository();
      if (resetting.current) throw new TimetableActionError('초기화 중입니다. 잠시만 기다려 주세요.');
      const next = await operation(repo);
      setSnapshot(next);
      setError(null);
      return next;
    } catch (cause) {
      if (!(cause instanceof TimetableActionError)) setError('변경 사항을 저장하지 못했습니다. 다시 시도해 주세요.');
      throw cause;
    }
  }, []);
  const saveEvent = useCallback(async (input: EventInput, id?: string) => { await perform(repo => repo.saveEvent(input, id)); }, [perform]);
  const deleteEvent = useCallback(async (id: string) => { await perform(repo => repo.deleteEvent(id)); }, [perform]);
  const saveTemplate = useCallback(async (input: TemplateInput, id?: string, presetId?: string) => { await perform(repo => repo.saveTemplate(input, id, presetId)); }, [perform]);
  const deleteTemplate = useCallback(async (id: string, presetId?: string) => { await perform(repo => repo.deleteTemplate(id, presetId)); }, [perform]);
  const ensureWeek = useCallback(async (date: string) => { await perform(repo => repo.ensureWeek(date)); }, [perform]);
  const updateEventTimes = useCallback(async (changes: EventTimeChange[]) => { await perform(repo => repo.updateEventTimes(changes)); }, [perform]);
  const updateTemplateTimes = useCallback(async (changes: EventTimeChange[], presetId?: string) => { await perform(repo => repo.updateTemplateTimes(changes, presetId)); }, [perform]);
  const pasteEvent = useCallback(async (value: EventClipboard, date: string, start: number) => { await perform(repo => repo.pasteEvent(value, date, start)); }, [perform]);
  const pasteTemplate = useCallback(async (value: EventClipboard, day: number, start: number, presetId?: string) => { await perform(repo => repo.pasteTemplate(value, day, start, presetId)); }, [perform]);
  const createPreset = useCallback(async (source?: TimetableImportSource) => {
    const next = await perform(repo => repo.createPreset(source));
    return next.presets[next.presets.length - 1].id;
  }, [perform]);
  const renamePreset = useCallback(async (id: string, name: string) => { await perform(repo => repo.renamePreset(id, name)); }, [perform]);
  const setDefaultPreset = useCallback(async (id: string | null) => { await perform(repo => repo.setDefaultPreset(id)); }, [perform]);
  const deletePreset = useCallback(async (id: string) => { await perform(repo => repo.deletePreset(id)); }, [perform]);
  const replacePreset = useCallback(async (id: string, source: TimetableImportSource) => { await perform(repo => repo.replacePreset(id, source)); }, [perform]);
  const resetData = useCallback(async () => {
    if (resetting.current) throw new TimetableActionError('초기화 중입니다. 잠시만 기다려 주세요.');
    resetting.current = true;
    try {
      const repo = await getRepository();
      const next = await repo.resetData();
      setSnapshot(next);
      setClipboard(null);
      setSelectedDate(dateKey());
      setError(null);
      // Drop screen-local drafts, drag previews and navigation history only
      // after commit. The Provider stays mounted with the committed empty data.
      setResetVersion(value => value + 1);
    } catch (cause) {
      setError('초기화하지 못했습니다. 기존 데이터는 유지됩니다. 다시 시도해 주세요.');
      throw cause;
    } finally { resetting.current = false; }
  }, []);

  return <CalendarContext.Provider value={{ ...snapshot, loading, initialized, error, selectedDate, setSelectedDate,
    retry: () => { setLoading(true); setAttempt(value => value + 1); }, clearError: () => setError(null),
    saveEvent, deleteEvent, saveTemplate, deleteTemplate, ensureWeek, clipboard, setClipboard,
    updateEventTimes, updateTemplateTimes, pasteEvent, pasteTemplate,
    createPreset, renamePreset, setDefaultPreset, deletePreset, replacePreset, resetData }}><Fragment key={resetVersion}>{children}</Fragment></CalendarContext.Provider>;
}

export function useCalendar() {
  const context = useContext(CalendarContext);
  if (!context) throw new Error('CalendarProvider is required');
  return context;
}

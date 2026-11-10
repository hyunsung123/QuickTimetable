import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { getRepository } from '@/lib/database';
import { dateKey } from '@/lib/dates';
import type { CalendarRepository } from '@/lib/repository';
import type { EventInput, Snapshot, TemplateInput } from '@/types/calendar';

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
  saveTemplate: (input: TemplateInput, id?: string) => Promise<void>;
  deleteTemplate: (id: string) => Promise<void>;
  ensureWeek: (date: string) => Promise<void>;
}

const CalendarContext = createContext<CalendarContextValue | null>(null);

export function CalendarProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<Snapshot>({ events: [], templates: [] });
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [selectedDate, setSelectedDate] = useState(dateKey());

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
      const next = await operation(repo);
      setSnapshot(next);
      setError(null);
    } catch (cause) {
      setError('변경 사항을 저장하지 못했습니다. 다시 시도해 주세요.');
      throw cause;
    }
  }, []);
  const saveEvent = useCallback((input: EventInput, id?: string) => perform(repo => repo.saveEvent(input, id)), [perform]);
  const deleteEvent = useCallback((id: string) => perform(repo => repo.deleteEvent(id)), [perform]);
  const saveTemplate = useCallback((input: TemplateInput, id?: string) => perform(repo => repo.saveTemplate(input, id)), [perform]);
  const deleteTemplate = useCallback((id: string) => perform(repo => repo.deleteTemplate(id)), [perform]);
  const ensureWeek = useCallback((date: string) => perform(repo => repo.ensureWeek(date)), [perform]);

  return <CalendarContext.Provider value={{ ...snapshot, loading, initialized, error, selectedDate, setSelectedDate,
    retry: () => { setLoading(true); setAttempt(value => value + 1); }, clearError: () => setError(null),
    saveEvent, deleteEvent, saveTemplate, deleteTemplate, ensureWeek }}>{children}</CalendarContext.Provider>;
}

export function useCalendar() {
  const context = useContext(CalendarContext);
  if (!context) throw new Error('CalendarProvider is required');
  return context;
}

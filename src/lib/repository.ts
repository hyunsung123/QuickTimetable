import type { CalendarEvent, EventInput, Snapshot, TemplateInput, TimetableTemplate } from '../types/calendar';
import { addDays, mondayOf, parseDate } from './dates';

type SqlValue = string | number | null;
export interface DatabaseDriver {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, ...values: SqlValue[]): Promise<unknown>;
  getAllAsync<T>(sql: string, ...values: SqlValue[]): Promise<T[]>;
}

export const schema = `
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS calendars (id TEXT PRIMARY KEY, title TEXT NOT NULL);
  INSERT OR IGNORE INTO calendars VALUES ('personal', '내 캘린더');
  CREATE TABLE IF NOT EXISTS templates (
    id TEXT PRIMARY KEY, calendarId TEXT NOT NULL REFERENCES calendars(id),
    title TEXT NOT NULL, weekday INTEGER NOT NULL CHECK(weekday BETWEEN 0 AND 6),
    startMinute INTEGER NOT NULL CHECK(startMinute >= 0 AND startMinute % 30 = 0),
    endMinute INTEGER NOT NULL CHECK(endMinute <= 1440 AND endMinute % 30 = 0 AND endMinute - startMinute >= 30),
    color TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY, calendarId TEXT NOT NULL REFERENCES calendars(id),
    title TEXT NOT NULL, date TEXT NOT NULL,
    startMinute INTEGER NOT NULL CHECK(startMinute >= 0 AND startMinute % 30 = 0),
    endMinute INTEGER NOT NULL CHECK(endMinute <= 1440 AND endMinute % 30 = 0 AND endMinute - startMinute >= 30),
    color TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
    templateId TEXT
  );
  CREATE INDEX IF NOT EXISTS events_date ON events(date, startMinute);
  CREATE TABLE IF NOT EXISTS initialized_weeks (weekStart TEXT PRIMARY KEY, initializedAt TEXT NOT NULL);
  PRAGMA user_version = 1;
`;

export function validateTime(input: { title: string; startMinute: number; endMinute: number; color: string }) {
  if (!input.title.trim()) throw new Error('일정 제목을 입력해 주세요.');
  if (input.title.trim().length > 100) throw new Error('제목은 100자 이내로 입력해 주세요.');
  const { startMinute: start, endMinute: end } = input;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > 1440 || end - start < 30 || start % 30 || end % 30) {
    throw new Error('시간은 30분 단위이며, 종료는 시작보다 30분 이상 늦어야 합니다.');
  }
  if (!/^#[0-9A-Fa-f]{6}$/.test(input.color)) throw new Error('올바른 일정 색상을 선택해 주세요.');
}

function newId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

export class CalendarRepository {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private db: DatabaseDriver) {}

  // Serialize complete transactions and reads; Expo's async transactions otherwise
  // allow unrelated queries to accidentally join the same transaction.
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.pending.then(work);
    this.pending = result.catch(() => undefined);
    return result;
  }

  private async snapshot(): Promise<Snapshot> {
    return {
      events: await this.db.getAllAsync<CalendarEvent>('SELECT * FROM events ORDER BY date, startMinute, id'),
      templates: await this.db.getAllAsync<TimetableTemplate>('SELECT * FROM templates ORDER BY weekday, startMinute, id'),
    };
  }

  initialize(): Promise<Snapshot> {
    return this.serial(async () => { await this.db.execAsync(schema); return this.snapshot(); });
  }

  saveEvent(input: EventInput, id?: string): Promise<Snapshot> {
    return this.serial(async () => {
      validateTime(input);
      parseDate(input.date);
      const now = new Date().toISOString();
      await this.db.runAsync(`INSERT INTO events (id, calendarId, title, date, startMinute, endMinute, color, createdAt, updatedAt, templateId)
        VALUES (?, 'personal', ?, ?, ?, ?, ?, ?, ?, NULL)
        ON CONFLICT(id) DO UPDATE SET title=excluded.title, date=excluded.date, startMinute=excluded.startMinute,
          endMinute=excluded.endMinute, color=excluded.color, updatedAt=excluded.updatedAt`,
      id ?? newId(), input.title.trim(), input.date, input.startMinute, input.endMinute, input.color, now, now);
      return this.snapshot();
    });
  }

  deleteEvent(id: string): Promise<Snapshot> {
    return this.serial(async () => { await this.db.runAsync('DELETE FROM events WHERE id = ?', id); return this.snapshot(); });
  }

  saveTemplate(input: TemplateInput, id?: string): Promise<Snapshot> {
    return this.serial(async () => {
      validateTime(input);
      if (!Number.isInteger(input.weekday) || input.weekday < 0 || input.weekday > 6) throw new Error('요일을 선택해 주세요.');
      const now = new Date().toISOString();
      await this.db.runAsync(`INSERT INTO templates (id, calendarId, title, weekday, startMinute, endMinute, color, createdAt, updatedAt)
        VALUES (?, 'personal', ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET title=excluded.title, weekday=excluded.weekday, startMinute=excluded.startMinute,
          endMinute=excluded.endMinute, color=excluded.color, updatedAt=excluded.updatedAt`,
      id ?? newId(), input.title.trim(), input.weekday, input.startMinute, input.endMinute, input.color, now, now);
      return this.snapshot();
    });
  }

  deleteTemplate(id: string): Promise<Snapshot> {
    return this.serial(async () => { await this.db.runAsync('DELETE FROM templates WHERE id = ?', id); return this.snapshot(); });
  }

  ensureWeek(date: string): Promise<Snapshot> {
    return this.serial(async () => {
      const week = mondayOf(date);
      await this.db.execAsync('BEGIN IMMEDIATE');
      try {
        const existing = await this.db.getAllAsync('SELECT weekStart FROM initialized_weeks WHERE weekStart = ?', week);
        if (!existing.length) {
          const templates = await this.db.getAllAsync<TimetableTemplate>('SELECT * FROM templates');
          const now = new Date().toISOString();
          for (const template of templates) {
            await this.db.runAsync(`INSERT INTO events (id, calendarId, title, date, startMinute, endMinute, color, createdAt, updatedAt, templateId)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            newId(), template.calendarId, template.title, addDays(week, template.weekday), template.startMinute, template.endMinute, template.color, now, now, template.id);
          }
          // Keep this marker even after all generated events have been deleted.
          await this.db.runAsync('INSERT INTO initialized_weeks VALUES (?, ?)', week, now);
        }
        await this.db.execAsync('COMMIT');
      } catch (error) {
        await this.db.execAsync('ROLLBACK');
        throw error;
      }
      return this.snapshot();
    });
  }
}

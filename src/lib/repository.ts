import type { CalendarEvent, EventClipboard, EventInput, EventTimeChange, Snapshot, TemplateInput, TimetableTemplate, TimetablePreset, TimetableImportSource } from '../types/calendar';
import { addDays, mondayOf, parseDate, weekdayOf } from './dates';
import { overlaps, pastedEvent, TimetableActionError } from './timetable';
import { nextApplyWeek, nextPresetName } from './presets';

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
`;

const presetSchema = `
  CREATE TABLE timetable_presets (
    id TEXT PRIMARY KEY, name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 100),
    isDefault INTEGER NOT NULL DEFAULT 0 CHECK(isDefault IN (0, 1)),
    createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
  );
  CREATE UNIQUE INDEX single_default_preset ON timetable_presets(isDefault) WHERE isDefault = 1;
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
  constructor(private db: DatabaseDriver, private now: () => Date = () => new Date()) {}

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
      presets: await this.db.getAllAsync<TimetablePreset>('SELECT * FROM timetable_presets ORDER BY createdAt, rowid'),
    };
  }

  private async transaction(work: () => Promise<void>): Promise<Snapshot> {
    await this.db.execAsync('BEGIN IMMEDIATE');
    try {
      await work();
      const snapshot = await this.snapshot();
      await this.db.execAsync('COMMIT');
      return snapshot;
    } catch (error) {
      await this.db.execAsync('ROLLBACK');
      throw error;
    }
  }

  /** Only update existing rows. A stale drag must never resurrect deleted data.
   * Both edge changes, their validation, and the returned snapshot are atomic. */
  private updateTimes(table: 'events' | 'templates', changes: EventTimeChange[], presetId?: string): Promise<Snapshot> {
    return this.serial(() => this.transaction(async () => {
      if (changes.length < 1 || changes.length > 2 || new Set(changes.map(change => change.id)).size !== changes.length) {
        throw new TimetableActionError('조절할 일정 경계선을 다시 선택해 주세요.');
      }
      const rows = await this.db.getAllAsync<CalendarEvent & TimetableTemplate>(`SELECT * FROM ${table}`);
      const originals = changes.map(change => {
        const row = rows.find(item => item.id === change.id);
        if (!row || (table === 'templates' && presetId !== undefined && row.presetId !== presetId) || row.startMinute !== change.previousStartMinute || row.endMinute !== change.previousEndMinute) {
          throw new TimetableActionError('일정이 변경되었습니다. 경계선을 다시 조절해 주세요.');
        }
        validateTime({ ...row, startMinute: change.startMinute, endMinute: change.endMinute });
        return row;
      });
      const sameDay = (a: CalendarEvent & TimetableTemplate, b: CalendarEvent & TimetableTemplate) =>
        table === 'events' ? a.date === b.date : a.presetId === b.presetId && a.weekday === b.weekday;
      const byId = new Map(changes.map(change => [change.id, change]));
      if (originals.length === 2) {
        const [upper, lower] = [...originals].sort((a, b) => a.startMinute - b.startMinute);
        const nextUpper = byId.get(upper.id)!;
        const nextLower = byId.get(lower.id)!;
        if (!sameDay(upper, lower) || upper.endMinute > lower.startMinute || nextUpper.startMinute !== upper.startMinute ||
            nextLower.endMinute !== lower.endMinute || nextUpper.endMinute !== nextLower.startMinute) {
          throw new TimetableActionError('서로 마주 보는 경계선만 함께 조절할 수 있습니다.');
        }
      } else {
        const [row] = originals;
        const [change] = changes;
        if (row.startMinute !== change.startMinute && row.endMinute !== change.endMinute) {
          throw new TimetableActionError('한 번에 하나의 경계선만 조절할 수 있습니다.');
        }
      }
      const proposed = rows.map(row => ({ ...row, ...byId.get(row.id) }));
      for (const original of originals) {
        const next = proposed.find(row => row.id === original.id)!;
        if (proposed.some(row => row.id !== next.id && sameDay(next, row) && overlaps(next, row))) {
          throw new TimetableActionError('겹치는 일정이 있어 경계선을 조절할 수 없습니다.');
        }
      }
      const now = new Date().toISOString();
      for (const change of changes) {
        await this.db.runAsync(`UPDATE ${table} SET startMinute = ?, endMinute = ?, updatedAt = ? WHERE id = ?`,
          change.startMinute, change.endMinute, now, change.id);
      }
    }));
  }

  updateEventTimes(changes: EventTimeChange[]) { return this.updateTimes('events', changes); }
  updateTemplateTimes(changes: EventTimeChange[], presetId?: string) { return this.updateTimes('templates', changes, presetId); }

  pasteEvent(clipboard: EventClipboard, date: string, startMinute: number): Promise<Snapshot> {
    return this.serial(() => this.transaction(async () => {
      parseDate(date);
      const others = await this.db.getAllAsync<CalendarEvent>('SELECT * FROM events WHERE date = ?', date);
      const input = pastedEvent(clipboard, startMinute, others);
      validateTime(input);
      const now = new Date().toISOString();
      await this.db.runAsync(`INSERT INTO events (id, calendarId, title, date, startMinute, endMinute, color, createdAt, updatedAt, templateId)
        VALUES (?, 'personal', ?, ?, ?, ?, ?, ?, ?, NULL)`,
        newId(), input.title, date, startMinute, input.endMinute, input.color, now, now);
      await this.markWeek(date, now);
    }));
  }

  pasteTemplate(clipboard: EventClipboard, weekday: number, startMinute: number, presetId?: string): Promise<Snapshot> {
    return this.serial(() => this.transaction(async () => {
      const preset = await this.requirePreset(presetId);
      if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw new TimetableActionError('요일을 다시 선택해 주세요.');
      const others = await this.db.getAllAsync<TimetableTemplate>('SELECT * FROM templates WHERE presetId = ? AND weekday = ?', preset.id, weekday);
      const input = pastedEvent(clipboard, startMinute, others);
      validateTime(input);
      const now = new Date().toISOString();
      await this.db.runAsync(`INSERT INTO templates (id, presetId, calendarId, title, weekday, startMinute, endMinute, color, createdAt, updatedAt)
        VALUES (?, ?, 'personal', ?, ?, ?, ?, ?, ?, ?)`,
        newId(), preset.id, input.title, weekday, startMinute, input.endMinute, input.color, now, now);
    }));
  }

  initialize(): Promise<Snapshot> {
    return this.serial(async () => {
      await this.db.execAsync('PRAGMA foreign_keys = ON;');
      const [{ user_version: version }] = await this.db.getAllAsync<{ user_version: number }>('PRAGMA user_version');
      if (version > 3) throw new Error('이 데이터베이스는 더 최신 앱에서 만들어졌습니다.');
      if (version === 3) return this.snapshot();
      await this.db.execAsync('BEGIN IMMEDIATE');
      try {
        if (version < 2) {
          await this.db.execAsync(schema);
          await this.db.execAsync(presetSchema);
          const id = newId();
          const now = this.now().toISOString();
          await this.db.runAsync('INSERT INTO timetable_presets (id, name, isDefault, createdAt, updatedAt) VALUES (?, ?, 1, ?, ?)', id, '기본 시간표 1', now, now);
          // Only legacy template rows are rebuilt; dated copies and week markers stay intact.
          await this.db.execAsync(`CREATE TABLE templates_v2 (
            id TEXT PRIMARY KEY, presetId TEXT NOT NULL REFERENCES timetable_presets(id) ON DELETE CASCADE,
            calendarId TEXT NOT NULL REFERENCES calendars(id), title TEXT NOT NULL,
            weekday INTEGER NOT NULL CHECK(weekday BETWEEN 0 AND 6),
            startMinute INTEGER NOT NULL CHECK(startMinute >= 0 AND startMinute % 30 = 0),
            endMinute INTEGER NOT NULL CHECK(endMinute <= 1440 AND endMinute % 30 = 0 AND endMinute - startMinute >= 30),
            color TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
          );`);
          await this.db.runAsync(`INSERT INTO templates_v2 SELECT id, ?, calendarId, title, weekday, startMinute, endMinute, color, createdAt, updatedAt FROM templates`, id);
          await this.db.execAsync(`DROP TABLE templates; ALTER TABLE templates_v2 RENAME TO templates;
            CREATE INDEX templates_preset_day ON templates(presetId, weekday, startMinute);`);
        }
        await this.db.execAsync('ALTER TABLE timetable_presets ADD COLUMN applyFromWeek TEXT;');
        // Older versions did not record the activation date. Start conservatively
        // next week at upgrade time, preserving all already materialized data.
        await this.db.runAsync('UPDATE timetable_presets SET applyFromWeek = ? WHERE isDefault = 1', nextApplyWeek(this.now()));
        await this.db.execAsync('PRAGMA user_version = 3;');
        const snapshot = await this.snapshot();
        await this.db.execAsync('COMMIT');
        return snapshot;
      } catch (error) { await this.db.execAsync('ROLLBACK'); throw error; }
    });
  }

  resetData(): Promise<Snapshot> {
    return this.serial(() => this.transaction(async () => {
      await this.db.runAsync('DELETE FROM events');
      await this.db.runAsync('DELETE FROM templates');
      await this.db.runAsync('DELETE FROM timetable_presets');
      await this.db.runAsync('DELETE FROM initialized_weeks');
      // Keep the built-in calendar and every table/index/schema version.
      await this.db.runAsync("DELETE FROM calendars WHERE id <> 'personal'");
    }));
  }

  saveEvent(input: EventInput, id?: string): Promise<Snapshot> {
    return this.serial(() => this.transaction(async () => {
      validateTime(input);
      parseDate(input.date);
      const rows = await this.db.getAllAsync<CalendarEvent>('SELECT * FROM events WHERE date = ?', input.date);
      this.assertFreeTime(input, rows, id);
      const now = new Date().toISOString();
      await this.db.runAsync(`INSERT INTO events (id, calendarId, title, date, startMinute, endMinute, color, createdAt, updatedAt, templateId)
        VALUES (?, 'personal', ?, ?, ?, ?, ?, ?, ?, NULL)
        ON CONFLICT(id) DO UPDATE SET title=excluded.title, date=excluded.date, startMinute=excluded.startMinute,
          endMinute=excluded.endMinute, color=excluded.color, updatedAt=excluded.updatedAt`,
      id ?? newId(), input.title.trim(), input.date, input.startMinute, input.endMinute, input.color, now, now);
      await this.markWeek(input.date, now);
    }));
  }

  deleteEvent(id: string): Promise<Snapshot> {
    return this.serial(() => this.transaction(async () => {
      const rows = await this.db.getAllAsync<CalendarEvent>('SELECT * FROM events WHERE id = ?', id);
      if (rows[0]) await this.markWeek(rows[0].date, new Date().toISOString());
      await this.db.runAsync('DELETE FROM events WHERE id = ?', id);
    }));
  }

  private async markWeek(date: string, now: string) {
    await this.db.runAsync('INSERT OR IGNORE INTO initialized_weeks VALUES (?, ?)', mondayOf(date), now);
  }

  /** Preserve legacy overlaps verbatim; a title/color-only edit is safe. Any
   * new time/date/day must be completely free. Checks run inside the write tx. */
  private assertFreeTime(input: { startMinute: number; endMinute: number }, rows: { id: string; startMinute: number; endMinute: number }[], id?: string) {
    const original = rows.find(row => row.id === id);
    if (original?.startMinute === input.startMinute && original.endMinute === input.endMinute) return;
    if (rows.some(row => row.id !== id && overlaps(input, row))) {
      throw new TimetableActionError('해당 시간에 다른 일정이 있습니다. 겹치지 않는 시간을 선택해 주세요.');
    }
  }

  private async requirePreset(id?: string) {
    const rows = await this.db.getAllAsync<TimetablePreset>(id === undefined
      ? 'SELECT * FROM timetable_presets ORDER BY isDefault DESC, createdAt, rowid LIMIT 1'
      : 'SELECT * FROM timetable_presets WHERE id = ?', ...(id === undefined ? [] : [id]));
    if (!rows[0]) throw new TimetableActionError('시간표를 찾을 수 없습니다. 목록에서 다시 선택해 주세요.');
    return rows[0];
  }

  saveTemplate(input: TemplateInput, id?: string, presetId?: string): Promise<Snapshot> {
    return this.serial(() => this.transaction(async () => {
      const preset = await this.requirePreset(presetId);
      validateTime(input);
      if (!Number.isInteger(input.weekday) || input.weekday < 0 || input.weekday > 6) throw new Error('요일을 선택해 주세요.');
      if (id) {
        const rows = await this.db.getAllAsync<TimetableTemplate>('SELECT * FROM templates WHERE id = ?', id);
        if (rows[0] && rows[0].presetId !== preset.id) throw new TimetableActionError('다른 시간표의 일정은 수정할 수 없습니다.');
      }
      const rows = await this.db.getAllAsync<TimetableTemplate>('SELECT * FROM templates WHERE presetId = ? AND weekday = ?', preset.id, input.weekday);
      this.assertFreeTime(input, rows, id);
      const now = new Date().toISOString();
      await this.db.runAsync(`INSERT INTO templates (id, presetId, calendarId, title, weekday, startMinute, endMinute, color, createdAt, updatedAt)
        VALUES (?, ?, 'personal', ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET title=excluded.title, weekday=excluded.weekday, startMinute=excluded.startMinute,
          endMinute=excluded.endMinute, color=excluded.color, updatedAt=excluded.updatedAt`,
      id ?? newId(), preset.id, input.title.trim(), input.weekday, input.startMinute, input.endMinute, input.color, now, now);
    }));
  }

  deleteTemplate(id: string, presetId?: string): Promise<Snapshot> {
    return this.serial(() => this.transaction(async () => {
      if (presetId !== undefined) {
        await this.requirePreset(presetId);
        await this.db.runAsync('DELETE FROM templates WHERE id = ? AND presetId = ?', id, presetId);
      } else await this.db.runAsync('DELETE FROM templates WHERE id = ?', id);
    }));
  }

  private async importRows(source: TimetableImportSource): Promise<TemplateInput[]> {
    if (source.kind === 'preset') {
      await this.requirePreset(source.presetId);
      return this.db.getAllAsync<TimetableTemplate>('SELECT * FROM templates WHERE presetId = ? ORDER BY weekday, startMinute, id', source.presetId);
    }
    const week = mondayOf(source.weekStart);
    const rows = await this.db.getAllAsync<CalendarEvent>('SELECT * FROM events WHERE date >= ? AND date < ? ORDER BY date, startMinute, id', week, addDays(week, 7));
    if (!rows.length) throw new TimetableActionError('선택한 주에 불러올 일정이 없습니다.');
    return rows.map(row => ({ title: row.title, weekday: weekdayOf(row.date), startMinute: row.startMinute, endMinute: row.endMinute, color: row.color }));
  }

  private async insertImportedRows(presetId: string, rows: TemplateInput[]) {
    this.validateImportedRows(rows);
    const now = new Date().toISOString();
    for (const row of rows) {
      validateTime(row);
      await this.db.runAsync(`INSERT INTO templates (id, presetId, calendarId, title, weekday, startMinute, endMinute, color, createdAt, updatedAt)
        VALUES (?, ?, 'personal', ?, ?, ?, ?, ?, ?, ?)`, newId(), presetId, row.title, row.weekday, row.startMinute, row.endMinute, row.color, now, now);
    }
  }

  private validateImportedRows(rows: TemplateInput[], message = '불러올 시간표에 겹치는 일정이 있습니다. 원본에서 시간을 수정한 뒤 다시 불러와 주세요.') {
    for (let i = 0; i < rows.length; i++) {
      validateTime(rows[i]);
      if (rows.slice(0, i).some(row => row.weekday === rows[i].weekday && overlaps(row, rows[i]))) {
        throw new TimetableActionError(message);
      }
    }
  }

  createPreset(source?: TimetableImportSource): Promise<Snapshot> {
    return this.serial(() => this.transaction(async () => {
      const presets = await this.db.getAllAsync<TimetablePreset>('SELECT * FROM timetable_presets');
      const rows = source ? await this.importRows(source) : [];
      const now = new Date().toISOString();
      const id = newId();
      // Adding a preset never changes the user's current default selection.
      await this.db.runAsync('INSERT INTO timetable_presets (id, name, isDefault, createdAt, updatedAt) VALUES (?, ?, 0, ?, ?)', id, nextPresetName(presets), now, now);
      await this.insertImportedRows(id, rows);
    }));
  }

  renamePreset(id: string, name: string): Promise<Snapshot> {
    return this.serial(() => this.transaction(async () => {
      await this.requirePreset(id);
      if (!name.trim() || name.trim().length > 100) throw new TimetableActionError('시간표 이름은 1~100자로 입력해 주세요.');
      await this.db.runAsync('UPDATE timetable_presets SET name = ?, updatedAt = ? WHERE id = ?', name.trim(), new Date().toISOString(), id);
    }));
  }

  setDefaultPreset(id: string | null): Promise<Snapshot> {
    return this.serial(() => this.transaction(async () => {
      if (id !== null && (await this.requirePreset(id)).isDefault) return;
      const current = this.now();
      const now = current.toISOString();
      await this.db.runAsync('UPDATE timetable_presets SET isDefault = 0, applyFromWeek = NULL, updatedAt = ? WHERE isDefault = 1', now);
      if (id !== null) await this.db.runAsync('UPDATE timetable_presets SET isDefault = 1, applyFromWeek = ?, updatedAt = ? WHERE id = ?', nextApplyWeek(current), now, id);
    }));
  }

  deletePreset(id: string): Promise<Snapshot> {
    return this.serial(() => this.transaction(async () => {
      await this.requirePreset(id);
      // Only preset blocks cascade. Calendar events are independent copies.
      await this.db.runAsync('DELETE FROM timetable_presets WHERE id = ?', id);
    }));
  }

  replacePreset(id: string, source: TimetableImportSource): Promise<Snapshot> {
    return this.serial(() => this.transaction(async () => {
      await this.requirePreset(id);
      const rows = await this.importRows(source);
      this.validateImportedRows(rows);
      await this.db.runAsync('DELETE FROM templates WHERE presetId = ?', id);
      await this.insertImportedRows(id, rows);
      await this.db.runAsync('UPDATE timetable_presets SET updatedAt = ? WHERE id = ?', new Date().toISOString(), id);
    }));
  }

  ensureWeek(date: string): Promise<Snapshot> {
    return this.serial(() => this.transaction(async () => {
      const week = mondayOf(date);
      const existing = await this.db.getAllAsync('SELECT weekStart FROM initialized_weeks WHERE weekStart = ?', week);
      if (!existing.length) {
        const dated = await this.db.getAllAsync('SELECT id FROM events WHERE date >= ? AND date < ? LIMIT 1', week, addDays(week, 7));
        const templates = dated.length ? [] : await this.db.getAllAsync<TimetableTemplate>(`SELECT templates.* FROM templates
          JOIN timetable_presets ON templates.presetId = timetable_presets.id
          WHERE timetable_presets.isDefault = 1 AND timetable_presets.applyFromWeek IS NOT NULL AND timetable_presets.applyFromWeek <= ?`, week);
        const now = new Date().toISOString();
        // Legacy presets may contain overlaps. Refuse the entire copy rather
        // than choosing a winner, altering the preset, or creating new clashes.
        this.validateImportedRows(templates, '기본 시간표에 겹치는 일정이 있습니다. 기본 시간표에서 시간을 수정한 뒤 다시 시도해 주세요.');
        for (const template of templates) {
          await this.db.runAsync(`INSERT INTO events (id, calendarId, title, date, startMinute, endMinute, color, createdAt, updatedAt, templateId)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          newId(), template.calendarId, template.title, addDays(week, template.weekday), template.startMinute, template.endMinute, template.color, now, now, template.id);
        }
        // Even a non-eligible empty week becomes an explicitly opened week.
        // Keep its marker after deletion or later changes to the default.
        await this.db.runAsync('INSERT INTO initialized_weeks VALUES (?, ?)', week, now);
      }
    }));
  }
}

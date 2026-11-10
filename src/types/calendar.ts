export interface EventInput {
  title: string;
  date: string;
  startMinute: number;
  endMinute: number;
  color: string;
}

export interface CalendarEvent extends EventInput {
  id: string;
  calendarId: string;
  createdAt: string;
  updatedAt: string;
  templateId: string | null;
}

export interface TemplateInput {
  title: string;
  weekday: number; // Monday = 0, Sunday = 6
  startMinute: number;
  endMinute: number;
  color: string;
}

export interface TimetableTemplate extends TemplateInput {
  id: string;
  presetId: string;
  calendarId: string;
  createdAt: string;
  updatedAt: string;
}

export interface Snapshot {
  events: CalendarEvent[];
  templates: TimetableTemplate[];
  presets: TimetablePreset[];
}

export interface TimetablePreset {
  id: string;
  name: string;
  isDefault: number;
  createdAt: string;
  updatedAt: string;
}

export type TimetableImportSource = { kind: 'week'; weekStart: string } | { kind: 'preset'; presetId: string };

export interface GridEvent {
  id: string;
  title: string;
  day: number;
  startMinute: number;
  endMinute: number;
  color: string;
}

export interface EventClipboard {
  title: string;
  color: string;
  durationMinute: number;
}

export interface EventTimeChange {
  id: string;
  startMinute: number;
  endMinute: number;
  previousStartMinute: number;
  previousEndMinute: number;
}

export interface MenuAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

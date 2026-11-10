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
  calendarId: string;
  createdAt: string;
  updatedAt: string;
}

export interface Snapshot {
  events: CalendarEvent[];
  templates: TimetableTemplate[];
}

export interface GridEvent {
  id: string;
  title: string;
  day: number;
  startMinute: number;
  endMinute: number;
  color: string;
}

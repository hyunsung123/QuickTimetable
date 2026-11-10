-- Schema shipped before applyFromWeek was introduced. Kept as a migration fixture.
PRAGMA foreign_keys = ON;
CREATE TABLE calendars (id TEXT PRIMARY KEY, title TEXT NOT NULL);
INSERT INTO calendars VALUES ('personal', '내 캘린더');
CREATE TABLE timetable_presets (
  id TEXT PRIMARY KEY, name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 100),
  isDefault INTEGER NOT NULL DEFAULT 0 CHECK(isDefault IN (0, 1)),
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
CREATE UNIQUE INDEX single_default_preset ON timetable_presets(isDefault) WHERE isDefault = 1;
CREATE TABLE templates (
  id TEXT PRIMARY KEY, presetId TEXT NOT NULL REFERENCES timetable_presets(id) ON DELETE CASCADE,
  calendarId TEXT NOT NULL REFERENCES calendars(id), title TEXT NOT NULL,
  weekday INTEGER NOT NULL CHECK(weekday BETWEEN 0 AND 6),
  startMinute INTEGER NOT NULL CHECK(startMinute >= 0 AND startMinute % 30 = 0),
  endMinute INTEGER NOT NULL CHECK(endMinute <= 1440 AND endMinute % 30 = 0 AND endMinute - startMinute >= 30),
  color TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
CREATE INDEX templates_preset_day ON templates(presetId, weekday, startMinute);
CREATE TABLE events (
  id TEXT PRIMARY KEY, calendarId TEXT NOT NULL REFERENCES calendars(id),
  title TEXT NOT NULL, date TEXT NOT NULL,
  startMinute INTEGER NOT NULL CHECK(startMinute >= 0 AND startMinute % 30 = 0),
  endMinute INTEGER NOT NULL CHECK(endMinute <= 1440 AND endMinute % 30 = 0 AND endMinute - startMinute >= 30),
  color TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, templateId TEXT
);
CREATE INDEX events_date ON events(date, startMinute);
CREATE TABLE initialized_weeks (weekStart TEXT PRIMARY KEY, initializedAt TEXT NOT NULL);
PRAGMA user_version = 2;

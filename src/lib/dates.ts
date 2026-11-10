const pad = (value: number) => String(value).padStart(2, '0');

// Calendar dates are local civil dates. Never convert them through UTC ISO strings.
export function dateKey(date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error('날짜를 YYYY-MM-DD 형식으로 입력해 주세요.');
  const [, year, month, day] = match;
  const parsed = new Date(Number(year), Number(month) - 1, Number(day), 12);
  if (Number(year) < 1900 || Number(year) > 9999 || dateKey(parsed) !== value) {
    throw new Error('올바른 날짜를 입력해 주세요.');
  }
  return parsed;
}

export function addDays(value: string, amount: number): string {
  const date = parseDate(value);
  date.setDate(date.getDate() + amount);
  return dateKey(date);
}

export function mondayOf(value: string): string {
  return addDays(value, -((parseDate(value).getDay() + 6) % 7));
}

export function weekdayOf(value: string): number {
  return (parseDate(value).getDay() + 6) % 7;
}

export function shiftMonth(value: string, amount: number): string {
  const date = parseDate(value);
  const target = new Date(date.getFullYear(), date.getMonth() + amount, 1, 12);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0, 12).getDate();
  target.setDate(Math.min(date.getDate(), last));
  return dateKey(target);
}

export function monthDays(value: string): string[] {
  const date = parseDate(value);
  const first = dateKey(new Date(date.getFullYear(), date.getMonth(), 1, 12));
  const offset = parseDate(first).getDay();
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0, 12).getDate();
  const count = Math.ceil((offset + last) / 7) * 7;
  return Array.from({ length: count }, (_, i) => addDays(first, i - offset));
}

export function formatTime(minutes: number): string {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

export function parseTime(value: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return NaN;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 24 || minute > 59 || (hour === 24 && minute !== 0)) return NaN;
  return hour * 60 + minute;
}

export function monthTitle(value: string): string {
  const date = parseDate(value);
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월`;
}

export function dayTitle(value: string): string {
  const date = parseDate(value);
  return `${date.getMonth() + 1}월 ${date.getDate()}일 ${['일', '월', '화', '수', '목', '금', '토'][date.getDay()]}요일`;
}

export function weekTitle(monday: string): string {
  const start = parseDate(monday);
  const end = parseDate(addDays(monday, 6));
  return `${start.getFullYear()}년 ${start.getMonth() + 1}월 ${start.getDate()}일 – ${start.getFullYear() !== end.getFullYear() ? `${end.getFullYear()}년 ` : ''}${end.getMonth() + 1}월 ${end.getDate()}일`;
}

import type { TimeEntry } from './types.ts';

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timezone: string, clock: boolean) {
  const key = `${timezone}:${clock}`; let value = formatters.get(key);
  if (!value) { value = new Intl.DateTimeFormat('sv-SE', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', ...(clock ? {hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'} as const : {}) }); formatters.set(key,value); }
  return value;
}

export function dateKeyInZone(value: string | number | Date, timezone: string): string {
  return formatter(timezone, false).format(new Date(value));
}
export function shiftDateKey(value: string, days: number): string {
  const date = new Date(value + 'T12:00:00Z'); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10);
}
export function toZonedInput(value: string | number | Date, timezone: string): string {
  const parts = formatter(timezone, true).formatToParts(new Date(value));
  const get = (key: string) => parts.find(part => part.type === key)!.value;
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`;
}
/** Preserve an unchanged timestamp during an autumn clock change; reject missing spring hours. */
export function fromZonedInput(value: string, timezone: string, original?: string): string {
  const normalized = value.length === 16 ? value + ':00' : value;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(normalized)) throw new Error('Bitte Datum und Uhrzeit vollständig eingeben.');
  if (original && toZonedInput(original, timezone) === normalized) return original;
  const target = Date.parse(normalized + 'Z'); if (!Number.isFinite(target)) throw new Error('Ungültiges Datum.');
  let instant = target;
  for (let i = 0; i < 5; i++) { const difference = target - Date.parse(toZonedInput(instant, timezone) + 'Z'); if (!difference) break; instant += difference; }
  const candidates = [instant - 3600000, instant, instant + 3600000].filter(candidate => toZonedInput(candidate, timezone) === normalized);
  if (!candidates.length) throw new Error('Diese Uhrzeit existiert wegen der Zeitumstellung nicht. Bitte eine andere Uhrzeit wählen.');
  return new Date(Math.min(...candidates)).toISOString();
}

export interface TimeSegment { entry: TimeEntry; date: string; startedAt: string; endedAt: string; seconds: number }
export function splitTimeEntries(entries: TimeEntry[], timezone: string, from?: string, to?: string): TimeSegment[] {
  const lower = from ? Date.parse(fromZonedInput(from + 'T00:00:00', timezone)) : -Infinity;
  const upper = to ? Date.parse(fromZonedInput(shiftDateKey(to, 1) + 'T00:00:00', timezone)) : Infinity;
  const segments: TimeSegment[] = [];
  for (const entry of entries) {
    let cursor = Math.max(Date.parse(entry.startedAt), lower); const end = Math.min(Date.parse(entry.endedAt), upper);
    while (cursor < end) {
      const date = dateKeyInZone(cursor, timezone);
      const boundary = Date.parse(fromZonedInput(shiftDateKey(date, 1) + 'T00:00:00', timezone));
      const stop = Math.min(end, boundary); if (stop <= cursor) break;
      segments.push({ entry, date, startedAt: new Date(cursor).toISOString(), endedAt: new Date(stop).toISOString(), seconds: (stop - cursor) / 1000 }); cursor = stop;
    }
  }
  return segments;
}
export function coveredSeconds(segments: Pick<TimeSegment, 'startedAt' | 'endedAt'>[]): number {
  const intervals = segments.map(segment => [Date.parse(segment.startedAt), Date.parse(segment.endedAt)]).sort((a,b) => a[0] - b[0]);
  if (!intervals.length) return 0;
  let [start,end] = intervals[0]; let total = 0;
  for (const [a,b] of intervals.slice(1)) { if (a > end) { total += end - start; start = a; end = b; } else end = Math.max(end, b); }
  return (total + end - start) / 1000;
}
export function formatElapsed(seconds: number, withSeconds = false): string {
  const value = Math.max(0, Math.floor(seconds)); const hours = Math.floor(value / 3600), minutes = Math.floor(value % 3600 / 60);
  if (withSeconds) return `${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:${String(value % 60).padStart(2,'0')}`;
  if (!value) return '0 Min.';
  if (value < 60) return `${value} Sek.`;
  return hours ? `${hours} Std.${minutes ? ` ${minutes} Min.` : ''}` : `${minutes} Min.`;
}

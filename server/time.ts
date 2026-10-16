import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db } from './database.ts';
import { timezone } from './config.ts';
import { findTask, getSetting, listTopics, setSetting } from './store.ts';
import { coveredSeconds, splitTimeEntries, toZonedInput } from '../shared/time.ts';
import type { ActiveTimer, TimeEntry, TimeState } from '../shared/types.ts';

export class TimeConflictError extends Error {}
const uuid = z.string().uuid();
const instant = z.string().datetime({ offset: true });
const fields = { taskId: uuid, startedAt: instant, endedAt: instant, notes: z.string().max(2000).default('') };
const createSchema = z.object({ id: uuid.optional(), ...fields }).strict();
const editSchema = z.object({ ...fields, version: z.number().int().positive() }).strict();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => { const parsed = new Date(value + 'T12:00:00Z'); return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0,10) === value; }, 'Ungültiges Datum');

export function listTimeEntries(): TimeEntry[] {
  return db.prepare(`SELECT data FROM time_entries ORDER BY json_extract(data,'$.startedAt') DESC,rowid DESC`).all().map(row => JSON.parse(String(row.data)) as TimeEntry);
}
function entryById(id: string): TimeEntry | null { const row = db.prepare('SELECT data FROM time_entries WHERE id=?').get(id); return row ? JSON.parse(String(row.data)) : null; }
export function activeTimers(): ActiveTimer[] { return getSetting<ActiveTimer[]>('activeTimers', []); }
export function timeState(): TimeState { return { entries: listTimeEntries(), activeTimers: activeTimers(), timezone, serverNow: new Date().toISOString() }; }
function snapshot(taskId: string) {
  const task = findTask(taskId); if (!task) throw new Error('Aufgabe nicht gefunden. Bitte eine vorhandene Aufgabe auswählen.');
  return { taskId, taskTitle: task.title, topicId: task.topicId, topicName: listTopics().find(topic => topic.id === task.topicId)?.name || null, parentTitle: task.parentId ? findTask(task.parentId, true)?.title || null : null };
}
function interval(start: string, end: string) {
  const a = Date.parse(start), b = Date.parse(end);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) throw new Error('Das Ende muss nach dem Beginn liegen.');
  if (b - a > 366 * 86400000) throw new Error('Ein einzelner Eintrag darf höchstens 366 Tage umfassen.');
  return { startedAt: new Date(a).toISOString(), endedAt: new Date(b).toISOString(), durationSeconds: (b-a)/1000 };
}
function persist(entry: TimeEntry) { db.prepare('INSERT INTO time_entries(id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(entry.id, JSON.stringify(entry)); }

export function createTimeEntry(input: unknown) {
  const data = createSchema.parse(input); const timestamps = interval(data.startedAt, data.endedAt); const id = data.id || randomUUID(); const existing = entryById(id);
  if (existing) {
    if (existing.taskId === data.taskId && existing.startedAt === timestamps.startedAt && existing.endedAt === timestamps.endedAt && existing.notes === data.notes) return existing;
    throw new TimeConflictError('Dieser Eintrag wurde bereits gespeichert. Bitte lade die aktuelle Übersicht.');
  }
  if (activeTimers().some(timer => timer.id === id)) throw new TimeConflictError('Diese Kennung gehört zu einem laufenden Timer.');
  const now = new Date().toISOString();
  const entry: TimeEntry = { id, ...snapshot(data.taskId), ...timestamps, notes: data.notes, source: 'manual', version: 1, createdAt: now, updatedAt: now };
  persist(entry); return entry;
}
export function updateTimeEntry(id: string, input: unknown) {
  const data = editSchema.parse(input); const existing = entryById(id); if (!existing) throw new Error('Zeiteintrag nicht gefunden.');
  if (data.version !== existing.version) throw new TimeConflictError('Dieser Zeiteintrag wurde inzwischen geändert. Bitte öffne die aktuelle Version erneut. Deine Eingabe bleibt erhalten.');
  const task = findTask(data.taskId);
  const details = task ? snapshot(data.taskId) : data.taskId === existing.taskId ? { taskId: existing.taskId, taskTitle: existing.taskTitle, topicId: existing.topicId, topicName: existing.topicName, parentTitle: existing.parentTitle } : snapshot(data.taskId);
  const next = { ...existing, ...details, ...interval(data.startedAt, data.endedAt), notes: data.notes, version: existing.version + 1, updatedAt: new Date().toISOString() };
  persist(next); return next;
}
export function deleteTimeEntry(id: string, input: unknown) {
  const { version } = z.object({ version: z.number().int().positive() }).strict().parse(input); const existing = entryById(id); if (!existing) return;
  if (existing.version !== version) throw new TimeConflictError('Dieser Zeiteintrag wurde inzwischen geändert. Bitte prüfe die aktuelle Version vor dem Löschen.');
  db.prepare('DELETE FROM time_entries WHERE id=?').run(id);
}
export function startTimer(input: unknown) {
  const data = z.object({ id: uuid, taskId: uuid }).strict().parse(input); const timers = activeTimers();
  if (entryById(data.id)) return; // A retried start must never restart an already stopped timer.
  const sameId = timers.find(timer => timer.id === data.id);
  if (sameId && sameId.taskId !== data.taskId) throw new TimeConflictError('Dieser Timer gehört bereits zu einer anderen Aufgabe.');
  if (timers.some(timer => timer.taskId === data.taskId)) return;
  if (timers.length >= 20) throw new Error('Es laufen bereits 20 Timer. Bitte stoppe zuerst einen davon.');
  setSetting('activeTimers', [...timers, { id: data.id, ...snapshot(data.taskId), startedAt: new Date().toISOString() }]);
}
function finishTimers(ids: string[]) {
  const timers = activeTimers(); const selected = timers.filter(timer => ids.includes(timer.id)); if (!selected.length) return;
  const now = Date.now();
  for (const timer of selected) {
    if (entryById(timer.id)) continue;
    const end = Math.max(now, Date.parse(timer.startedAt) + 1);
    const entry: TimeEntry = { ...timer, endedAt: new Date(end).toISOString(), durationSeconds: (end-Date.parse(timer.startedAt))/1000, notes: '', source: 'timer', version: 1, createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() };
    persist(entry);
  }
  setSetting('activeTimers', timers.filter(timer => !ids.includes(timer.id)));
}
export function stopTimer(input: unknown) { const {timerId} = z.object({timerId: uuid}).strict().parse(input); finishTimers([timerId]); }
export function stopAllTimers(input: unknown) { const {timerIds} = z.object({timerIds: z.array(uuid).min(1).max(20)}).strict().parse(input); finishTimers(timerIds); }
export function stopTimerForTask(taskId: string) { const timers = activeTimers().filter(timer => timer.taskId === taskId); if (timers.length) finishTimers(timers.map(timer => timer.id)); }

export function timeExport(input: unknown) {
  const query = z.object({ format: z.enum(['csv','xlsx','json']), from: date, to: date, topicId: z.union([uuid,z.literal('none')]).optional(), taskId: uuid.optional() }).strict().parse(input);
  const days = (Date.parse(query.to) - Date.parse(query.from)) / 86400000;
  if (days < 0 || days > 3660) throw new Error('Bitte einen Zeitraum von höchstens zehn Jahren auswählen.');
  const entries = listTimeEntries().filter(entry => (!query.taskId || entry.taskId === query.taskId) && (!query.topicId || (query.topicId === 'none' ? !entry.topicId : entry.topicId === query.topicId)));
  const segments = splitTimeEntries(entries, timezone, query.from, query.to);
  const included = new Set(segments.map(segment => segment.entry.id));
  return { query, timezone, entries: entries.filter(entry => included.has(entry.id)), segments, totalSeconds: segments.reduce((sum,segment) => sum + segment.seconds,0), coveredSeconds: coveredSeconds(segments) };
}
export const exportColumns = ['Datum','Thema','Aufgabe','Unteraufgabe von','Beginn','Ende','Dauer (Sekunden)','Dauer (Stunden)','Notiz','Quelle','Zeitzone'];
export function exportRows(result: ReturnType<typeof timeExport>): (string | number)[][] {
  return result.segments.map(segment => [segment.date, segment.entry.topicName || 'Ohne Thema', segment.entry.taskTitle, segment.entry.parentTitle || '', toZonedInput(segment.startedAt, result.timezone).replace('T',' '), toZonedInput(segment.endedAt, result.timezone).replace('T',' '), segment.seconds, Number((segment.seconds/3600).toFixed(6)), segment.entry.notes, segment.entry.source === 'timer' ? 'Timer' : 'Manuell', result.timezone]);
}
export function csvCell(value: string | number) {
  let text = typeof value === 'number' ? String(value).replace('.',',') : value;
  if (typeof value === 'string' && /^[\s]*[=+@\-\t\r]/.test(value)) text = "'" + value;
  return '"' + text.replace(/"/g,'""') + '"';
}

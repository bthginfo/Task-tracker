import { db } from './database.ts';
export { db } from './database.ts';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Task, TaskInput, Topic } from '../shared/types.ts';

export function transaction<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try { const value = fn(); db.exec('COMMIT'); return value; } catch (error) { db.exec('ROLLBACK'); throw error; }
}
export function getSetting<T>(key: string, fallback: T): T {
  const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
  return row ? JSON.parse(String(row.value)) as T : fallback;
}
export function setSetting(key: string, value: unknown) {
  db.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value));
}
export const listTasks = (): Task[] => db.prepare('SELECT data FROM tasks WHERE deleted=0 ORDER BY rowid').all().map(r => JSON.parse(String(r.data)) as Task);
export const listTopics = (): Topic[] => db.prepare('SELECT data FROM topics ORDER BY rowid').all().map(r => JSON.parse(String(r.data)) as Topic);
export function findTask(id: string, includeDeleted = false): Task | null {
  const row = db.prepare(`SELECT data FROM tasks WHERE id=?${includeDeleted ? '' : ' AND deleted=0'}`).get(id);
  return row ? JSON.parse(String(row.data)) : null;
}
function persistTask(task: Task) { db.prepare('INSERT INTO tasks(id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(task.id, JSON.stringify(task)); }
export function setSyncStatus(id: string, status: Task['calendarSyncStatus'], error: string | null = null) {
  const task = findTask(id, true); if (task) persistTask({ ...task, calendarSyncStatus: status, calendarError: error });
}
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => { const d = new Date(v + 'T12:00:00Z'); return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v; }, 'Ungültiges Datum');
const identifier = z.string().uuid();
export const taskSchema = z.object({
  title: z.string().trim().min(1, 'Bitte gib einen Titel ein.').max(300), notes: z.string().max(20000),
  status: z.enum(['todo', 'in_progress', 'done']), priority: z.enum(['low', 'medium', 'high']),
  topicId: identifier.nullable(), parentId: identifier.nullable(), dueDate: date.nullable(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(), duration: z.number().int().min(5).max(1440), calendarEnabled: z.boolean()
}).partial().strict();
export const topicSchema = z.object({ name: z.string().trim().min(1).max(80), color: z.string().regex(/^#[0-9a-fA-F]{6}$/) }).strict();

export function enqueue(taskId: string, calendarId: string) {
  db.prepare(`INSERT INTO sync_jobs(id,task_id,calendar_id) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET version=version+1,attempts=0,next_at=0,error=NULL`).run(`${calendarId}|${taskId}`, taskId, calendarId);
}
export function scheduleTask(task: Task) {
  const connection = getSetting<{ calendarId: string } | null>('google', null);
  const links = db.prepare('SELECT calendar_id FROM event_links WHERE task_id=?').all(task.id);
  for (const link of links) enqueue(task.id, String(link.calendar_id));
  if (connection) enqueue(task.id, connection.calendarId);
}
export function createTask(input: TaskInput): Task {
  const data = taskSchema.parse(input);
  if (!data.title) throw new Error('Bitte gib einen Titel ein.');
  if (data.topicId && !listTopics().some(t => t.id === data.topicId)) throw new Error('Dieses Thema existiert nicht.');
  const parent = data.parentId ? findTask(data.parentId) : null;
  if (data.parentId && !parent) throw new Error('Die übergeordnete Aufgabe existiert nicht.');
  const now = new Date().toISOString();
  const task: Task = {
    id: randomUUID(), title: data.title, notes: '', status: 'todo', priority: 'medium', topicId: null, parentId: null,
    dueDate: null, time: null, duration: 30, calendarEnabled: true,
    ...data, calendarSyncStatus: 'waiting', calendarError: null, createdAt: now, updatedAt: now
  };
  if (parent) task.topicId = parent.topicId;
  if (task.time && !task.dueDate) throw new Error('Bitte wähle zur Uhrzeit ein Datum.');
  task.calendarSyncStatus = !task.calendarEnabled ? 'off' : task.dueDate ? 'pending' : 'waiting';
  persistTask(task); scheduleTask(task);
  if (parent?.status === 'done' && task.status !== 'done') updateTask(parent.id, { status: 'todo' });
  return task;
}
export function updateTask(id: string, input: TaskInput): Task {
  const task = findTask(id); if (!task) throw new Error('Aufgabe nicht gefunden.');
  const patch = taskSchema.parse(input);
  const next = { ...task, ...patch, updatedAt: new Date().toISOString() };
  if (next.topicId && !listTopics().some(t => t.id === next.topicId)) throw new Error('Dieses Thema existiert nicht.');
  if (next.parentId) {
    let parent = findTask(next.parentId);
    if (!parent) throw new Error('Die übergeordnete Aufgabe existiert nicht.');
    next.topicId = parent.topicId;
    const seen = new Set([id]);
    while (parent) { if (seen.has(parent.id)) throw new Error('Aufgaben dürfen keine zirkulären Unteraufgaben enthalten.'); seen.add(parent.id); parent = parent.parentId ? findTask(parent.parentId) : null; }
  }
  if (!next.dueDate) next.time = null;
  next.calendarSyncStatus = !next.calendarEnabled ? 'off' : next.dueDate ? 'pending' : 'waiting';
  next.calendarError = null;
  persistTask(next); scheduleTask(next);
  const children = listTasks().filter(t => t.parentId === id);
  for (const child of children) {
    if (child.topicId !== next.topicId || (patch.status === 'done' && child.status !== 'done')) {
      updateTask(child.id, { topicId: next.topicId, ...(patch.status === 'done' ? { status: 'done' } : {}) });
    }
  }
  // Reopening a child also reopens completed ancestors.
  if (next.status !== 'done' && next.parentId) {
    const parent = findTask(next.parentId); if (parent?.status === 'done') updateTask(parent.id, { status: 'todo' });
  }
  return next;
}
export function deleteTask(id: string) {
  const task = findTask(id); if (!task) throw new Error('Aufgabe nicht gefunden.');
  for (const child of listTasks().filter(t => t.parentId === id)) deleteTask(child.id);
  persistTask({ ...task, updatedAt: new Date().toISOString() });
  db.prepare('UPDATE tasks SET deleted=1 WHERE id=?').run(id); scheduleTask(task);
}
export function pruneDeleted() {
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
  const old = db.prepare(`SELECT id FROM tasks WHERE deleted=1 AND json_extract(data,'$.updatedAt')<? AND NOT EXISTS(SELECT 1 FROM event_links WHERE task_id=tasks.id) AND NOT EXISTS(SELECT 1 FROM sync_jobs WHERE task_id=tasks.id)`).all(cutoff);
  for (const row of old) db.prepare('DELETE FROM tasks WHERE id=?').run(row.id);
  if (old.length) { const keys = getSetting<Record<string, string>>('importKeys', {}); for (const [key,id] of Object.entries(keys)) if (!findTask(id, true)) delete keys[key]; setSetting('importKeys', keys); }
}
export function createTopic(input: unknown) {
  const data = topicSchema.parse(input);
  if (listTopics().some(t => t.name.toLocaleLowerCase('de') === data.name.toLocaleLowerCase('de'))) throw new Error('Dieses Thema gibt es schon.');
  const topic = { ...data, id: randomUUID(), createdAt: new Date().toISOString() };
  db.prepare('INSERT INTO topics(id,data) VALUES (?,?)').run(topic.id, JSON.stringify(topic)); return topic;
}
export function updateTopic(id: string, input: unknown) {
  const topic = listTopics().find(t => t.id === id); if (!topic) throw new Error('Thema nicht gefunden.');
  const data = topicSchema.partial().parse(input);
  if (data.name && listTopics().some(t => t.id !== id && t.name.toLocaleLowerCase('de') === data.name!.toLocaleLowerCase('de'))) throw new Error('Dieses Thema gibt es schon.');
  const next = { ...topic, ...data }; db.prepare('UPDATE topics SET data=? WHERE id=?').run(JSON.stringify(next), id);
  listTasks().filter(t => t.topicId === id).forEach(scheduleTask); return next;
}
export function deleteTopic(id: string) {
  if (!listTopics().some(t => t.id === id)) throw new Error('Thema nicht gefunden.');
  db.prepare('DELETE FROM topics WHERE id=?').run(id);
  for (const task of listTasks().filter(t => t.topicId === id && !t.parentId)) updateTask(task.id, { topicId: null });
}

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { appUrl, encryptionKey, googleConfigured, googleRedirect, timezone } from './config.ts';
import { db, enqueue, findTask, getSetting, listTasks, listTopics, setSetting, setSyncStatus, transaction } from './store.ts';
import { currentDatabase } from './database.ts';
import type { CalendarInfo, CalendarOption, Task } from '../shared/types.ts';
import type { ImportRow } from '../shared/types.ts';

interface Connection { tokens: string; email: string; calendarId: string; lastSyncedAt: string | null; error: string | null }
interface Tokens { access_token: string; refresh_token: string; expires_at: number }
interface Job { id: string; task_id: string; calendar_id: string; version: number; attempts: number }
const base = 'https://www.googleapis.com/calendar/v3';
const encode = encodeURIComponent;
export function encrypt(value: unknown) { const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv); const bytes = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString('base64'); }
export function decrypt<T>(value: string): T { const bytes = Buffer.from(value, 'base64'); const cipher = createDecipheriv('aes-256-gcm', encryptionKey, bytes.subarray(0, 12)); cipher.setAuthTag(bytes.subarray(12, 28)); return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString()); }
const connection = () => getSetting<Connection | null>('google', null);
export function calendarInfo(): CalendarInfo { const c = connection(); return { configured: googleConfigured, connected: Boolean(c), email: c?.email || null, calendarId: c?.calendarId || 'primary', lastSyncedAt: c?.lastSyncedAt || null, error: c?.error || null }; }
export function oauthUrl(state: string, verifier: string) {
  const params = new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, redirect_uri: googleRedirect, response_type: 'code',
    scope: 'openid email https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events.owned',
    access_type: 'offline', prompt: 'consent', state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}
async function tokenRequest(params: Record<string, string>) {
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, ...params }), signal: AbortSignal.timeout(20000) });
  const data = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(data.error === 'invalid_grant' ? 'Google-Verbindung abgelaufen. Bitte erneut verbinden.' : 'Google-Anmeldung ist fehlgeschlagen. Bitte erneut versuchen.');
  return data;
}
export async function connectGoogle(code: string, verifier: string) {
  const data = await tokenRequest({ code, code_verifier: verifier, redirect_uri: googleRedirect, grant_type: 'authorization_code' });
  const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${data.access_token}` }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('Google-Konto konnte nicht geprüft werden.');
  const user = await response.json() as { email: string; email_verified: boolean };
  if (!user.email_verified || !user.email || !data.refresh_token) throw new Error('Google hat keinen dauerhaften Zugriff gewährt. Bitte erneut verbinden.');
  const prior = connection();
  if (prior && prior.email !== user.email) throw new Error('Bitte trenne zuerst die bestehende Kalenderverbindung.');
  const previousAccount = getSetting<string | null>('googleAccount', null);
  if (!prior && previousAccount && previousAccount !== user.email) db.exec('DELETE FROM event_links; DELETE FROM sync_jobs;');
  const tokens: Tokens = { access_token: String(data.access_token), refresh_token: String(data.refresh_token), expires_at: Date.now() + Number(data.expires_in) * 1000 };
  setSetting('google', { tokens: encrypt(tokens), email: user.email, calendarId: prior?.calendarId || 'primary', lastSyncedAt: prior?.lastSyncedAt || null, error: null });
  setSetting('googleAccount', user.email);
  queueAll();
}
async function accessToken(): Promise<string> {
  const c = connection(); if (!c) throw new Error('Google-Kalender ist nicht verbunden.');
  let tokens = decrypt<Tokens>(c.tokens);
  if (tokens.expires_at < Date.now() + 60000) {
    const data = await tokenRequest({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token });
    tokens = { ...tokens, access_token: String(data.access_token), expires_at: Date.now() + Number(data.expires_in) * 1000 };
    const latest = connection(); if (!latest) throw new Error('Google-Kalender wurde getrennt.');
    setSetting('google', { ...latest, tokens: encrypt(tokens) });
  }
  return tokens.access_token;
}
async function google(path: string, init: RequestInit = {}) {
  const token = await accessToken();
  const response = await fetch(`${base}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers }, signal: AbortSignal.timeout(20000) });
  if (!response.ok && ![404, 410, 409].includes(response.status)) {
    if (response.status === 401) throw new Error('Google-Zugriff abgelaufen. Bitte erneut verbinden.');
    if (response.status === 403) throw new Error('Keine Schreibberechtigung. Bitte einen eigenen Kalender auswählen.');
    throw new Error(response.status === 429 ? 'Google ist gerade ausgelastet. Synchronisation wird automatisch wiederholt.' : `Google-Kalender nicht erreichbar (${response.status}). Neuer Versuch folgt.`);
  }
  return response;
}
export async function calendars(): Promise<CalendarOption[]> {
  const items: CalendarOption[] = []; let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ minAccessRole: 'owner', maxResults: '250', ...(pageToken ? { pageToken } : {}) });
    const response = await google(`/users/me/calendarList?${params}`);
    if (!response.ok) throw new Error('Kalender konnten nicht geladen werden.');
    const data = await response.json() as { items?: CalendarOption[]; nextPageToken?: string };
    items.push(...(data.items || []).map(c => ({ id: c.id, summary: c.summary, primary: c.primary }))); pageToken = data.nextPageToken;
  } while (pageToken);
  return items;
}
export async function calendarImport(from: string, to: string) {
  const { dateAndTime, markDuplicates } = await import('./imports.ts');
  const c = connection(); if (!c) throw new Error('Bitte zuerst den Google-Kalender verbinden.');
  const first = new Date(`${from}T00:00:00Z`); first.setUTCDate(first.getUTCDate() - 1);
  const last = new Date(`${to}T00:00:00Z`); last.setUTCDate(last.getUTCDate() + 2);
  let pageToken: string | undefined; let fetched = 0; let excluded = 0;
  const rows: ImportRow[] = [];
  do {
    const params = new URLSearchParams({ timeMin: first.toISOString(), timeMax: last.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '250', ...(pageToken ? { pageToken } : {}), fields: 'nextPageToken,items(id,summary,description,status,start,end,extendedProperties)' });
    const response = await google(`/calendars/${encode(c.calendarId)}/events?${params}`);
    if (!response.ok) throw new Error('Die Kalendereinträge konnten nicht geladen werden.');
    const data = await response.json() as { nextPageToken?: string; items?: Array<{ id: string; summary?: string; description?: string; status?: string; start: { date?: string; dateTime?: string }; end: { date?: string; dateTime?: string }; extendedProperties?: { private?: { fokusTaskId?: string } } }> };
    for (const event of data.items || []) {
      fetched++;
      if (event.status === 'cancelled' || !event.summary) continue;
      if (event.extendedProperties?.private?.fokusTaskId) { excluded++; continue; }
      const date = event.start.date ? { dueDate: event.start.date, time: null } : event.start.dateTime ? dateAndTime(new Date(event.start.dateTime)) : null;
      if (!date || date.dueDate < from || date.dueDate > to) continue;
      const duration = event.start.dateTime && event.end.dateTime ? Math.max(5, Math.min(1440, Math.round((Date.parse(event.end.dateTime) - Date.parse(event.start.dateTime)) / 60000))) : 30;
      rows.push({ key: `google:${createHash('sha256').update(c.email + '|' + c.calendarId + '|' + event.id).digest('hex')}`, title: event.summary.slice(0, 300), notes: (event.description || '').slice(0, 20000), ...date, duration, status: 'todo', priority: 'medium', topicName: null, duplicate: false });
    }
    if (rows.length > 500 || fetched > 2000) throw new Error('Zu viele Termine in diesem Zeitraum. Bitte einen kürzeren Zeitraum wählen.');
    pageToken = data.nextPageToken;
  } while (pageToken);
  return { source: 'Google Kalender', rows: markDuplicates(rows), warnings: excluded ? [`${excluded} bereits von Fokus verwaltete Termine wurden ausgelassen.`] : [] };
}
export function queueAll() { const c = connection(); if (!c) return; transaction(() => { for (const task of listTasks()) enqueue(task.id, c.calendarId); for (const row of db.prepare('SELECT task_id,calendar_id FROM event_links').all()) enqueue(String(row.task_id), String(row.calendar_id)); }); }
export async function selectCalendar(calendarId: string) {
  const c = connection(); if (!c) throw new Error('Bitte zuerst Google verbinden.');
  if (!(await calendars()).some(k => k.id === calendarId)) throw new Error('Bitte wähle einen eigenen Kalender aus.');
  setSetting('google', { ...c, calendarId }); queueAll();
}
export function eventBody(task: Task) {
  const date = task.dueDate!;
  const topic = listTopics().find(t => t.id === task.topicId);
  const description = [task.notes, topic ? `Thema: ${topic.name}` : '', `Verwaltet mit Fokus: ${appUrl}`].filter(Boolean).join('\n\n');
  const common = { summary: `${task.status === 'done' ? '✓ ' : ''}${task.title}`, description, transparency: task.status === 'done' ? 'transparent' : 'opaque', extendedProperties: { private: { fokusTaskId: task.id } } };
  if (task.time) {
    // Floating local date/time with explicit IANA timezone lets Google handle DST.
    const [hours, minutes] = task.time.split(':').map(Number);
    const end = new Date(`${date}T00:00:00Z`); end.setUTCMinutes(hours * 60 + minutes + task.duration);
    return { ...common, start: { dateTime: `${date}T${task.time}:00`, timeZone: timezone }, end: { dateTime: end.toISOString().slice(0, 19), timeZone: timezone } };
  }
  const end = new Date(`${date}T12:00:00Z`); end.setUTCDate(end.getUTCDate() + 1);
  return { ...common, start: { date }, end: { date: end.toISOString().slice(0, 10) } };
}
const workers = new WeakSet<object>();
export async function processQueue() {
  const scope = currentDatabase();
  if (workers.has(scope) || !connection()) return;
  workers.add(scope);
  try {
    const deadline = Date.now() + 40000;
    const jobs = db.prepare('SELECT * FROM sync_jobs WHERE next_at<=? ORDER BY next_at LIMIT 20').all(Date.now()) as unknown as Job[];
    for (const job of jobs) {
      if (!connection() || Date.now() > deadline) break;
      try {
        const task = findTask(job.task_id);
        const desired = task && task.calendarEnabled && task.dueDate && connection()?.calendarId === job.calendar_id;
        const link = db.prepare('SELECT event_id FROM event_links WHERE task_id=? AND calendar_id=?').get(job.task_id, job.calendar_id);
        const versions = getSetting<Record<string, number>>('eventVersions', {});
        const generatedId = () => `fokus${createHash('sha256').update(job.task_id + '|' + (versions[job.id] || 0)).digest('hex')}`;
        let eventId = link ? String(link.event_id) : generatedId();
        const path = `/calendars/${encode(job.calendar_id)}/events`;
        if (!desired) {
          if (link) { await google(`${path}/${encode(eventId)}`, { method: 'DELETE' }); versions[job.id] = (versions[job.id] || 0) + 1; setSetting('eventVersions', versions); }
          db.prepare('DELETE FROM event_links WHERE task_id=? AND calendar_id=?').run(job.task_id, job.calendar_id);
        } else {
          const body = eventBody(task);
          let response = link ? await google(`${path}/${encode(eventId)}`, { method: 'PUT', body: JSON.stringify(body) }) : await google(path, { method: 'POST', body: JSON.stringify({ ...body, id: eventId }) });
          for (let attempt = 0; attempt < 3; attempt++) {
            if (response.status === 409) response = await google(`${path}/${encode(eventId)}`, { method: 'PUT', body: JSON.stringify(body) });
            if (![404, 410].includes(response.status)) break;
            versions[job.id] = (versions[job.id] || 0) + 1; setSetting('eventVersions', versions); eventId = generatedId();
            response = await google(path, { method: 'POST', body: JSON.stringify({ ...body, id: eventId }) });
          }
          if (!response.ok) throw new Error('Der Google-Termin konnte nicht gespeichert werden. Bitte erneut synchronisieren.');
          db.prepare('INSERT INTO event_links(task_id,calendar_id,event_id) VALUES (?,?,?) ON CONFLICT(task_id,calendar_id) DO UPDATE SET event_id=excluded.event_id').run(job.task_id, job.calendar_id, eventId);
        }
        db.prepare('DELETE FROM sync_jobs WHERE id=? AND version=?').run(job.id, job.version);
        const latest = findTask(job.task_id);
        const pending = db.prepare('SELECT id FROM sync_jobs WHERE task_id=?').get(job.task_id);
        if (latest && !pending) setSyncStatus(latest.id, !latest.calendarEnabled ? 'off' : !latest.dueDate ? 'waiting' : 'synced');
        const c = connection(); if (c) setSetting('google', { ...c, lastSyncedAt: new Date().toISOString(), error: null });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Synchronisation fehlgeschlagen.';
        db.prepare('UPDATE sync_jobs SET attempts=attempts+1,next_at=?,error=? WHERE id=? AND version=?').run(Date.now() + Math.min(3600000, 10000 * 2 ** Math.min(job.attempts, 9)), message, job.id, job.version);
        setSyncStatus(job.task_id, 'error', message);
        const c = connection(); if (c) setSetting('google', { ...c, error: message });
      }
    }
  } finally { workers.delete(scope); }
}
export async function disconnectGoogle() {
  if (workers.has(currentDatabase())) throw new Error('Synchronisation läuft. Bitte gleich noch einmal versuchen.');
  const c = connection();
  if (c) {
    const tokens = decrypt<Tokens>(c.tokens);
    const response = await fetch('https://oauth2.googleapis.com/revoke', { method: 'POST', body: new URLSearchParams({ token: tokens.refresh_token }), signal: AbortSignal.timeout(15000) });
    if (!response.ok && response.status !== 400) throw new Error('Google-Verbindung konnte nicht getrennt werden. Bitte erneut versuchen.');
  }
  setSetting('google', null); db.exec('DELETE FROM sync_jobs');
  for (const task of listTasks()) setSyncStatus(task.id, task.calendarEnabled ? 'waiting' : 'off');
  // Existing event links are retained so reconnecting updates the same events.
}

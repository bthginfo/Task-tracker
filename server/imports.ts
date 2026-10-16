import { createHash } from 'node:crypto';
import { extname } from 'node:path';
import { parse as parseCsv } from 'csv-parse/sync';
import { z } from 'zod';
import { createTask, findTask, getSetting, listTasks, listTopics, setSetting, taskSchema, transaction, updateTask } from './store.ts';
import { timezone } from './config.ts';
import type { ImportRow, Priority, Status } from '../shared/types.ts';

export interface ImportPreview { source: string; rows: ImportRow[]; warnings: string[] }
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const normalized = (v: string) => v.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
function plain(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const item = value as Record<string, unknown>;
    if ('formula' in item) return plain(item.result); // Read cached result only; never execute a formula.
    if (Array.isArray(item.richText)) return item.richText.map(x => plain((x as Record<string, unknown>).text)).join('');
    if ('text' in item) return plain(item.text);
    return '';
  }
  return String(value).trim();
}
export function importDate(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date && !isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === 'number' && value > 1 && value < 100000) return new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000).toISOString().slice(0, 10);
  const text = plain(value); let date = '';
  if (/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(text)) date = text.slice(0, 10);
  else { const match = text.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/); if (match) date = `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`; }
  if (!date) return null;
  try { taskSchema.parse({ dueDate: date }); return date; } catch { return null; }
}
function clock(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString().slice(11, 16);
  if (typeof value === 'number' && value >= 0 && value < 1) { const total = Math.round(value * 1440) % 1440; return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`; }
  const text = plain(value); const match = text.match(/(?:^|T)([01]?\d|2[0-3]):([0-5]\d)(?:$|:)/);
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : null;
}
function fingerprint(row: Pick<ImportRow, 'title' | 'dueDate' | 'time'>) { return digest(`${row.title.trim().toLocaleLowerCase('de')}|${row.dueDate || ''}|${row.time || ''}`); }
export function markDuplicates(rows: ImportRow[]): ImportRow[] {
  const known = getSetting<Record<string, string>>('importKeys', {});
  const fingerprints = new Set(listTasks().map(fingerprint));
  const seen = new Set<string>();
  return rows.map(row => {
    const duplicate = Boolean(known[row.key] && findTask(known[row.key])) || fingerprints.has(fingerprint(row)) || seen.has(row.key);
    seen.add(row.key); return { ...row, duplicate };
  });
}
export function rowsFromRecords(records: Record<string, unknown>[], source: string, topicNames: Record<string, string> = {}): ImportPreview {
  if (records.length > 500) throw new Error('Bitte höchstens 500 Einträge pro Import verwenden. Teile größere Dateien auf.');
  const rows: ImportRow[] = []; const warnings: string[] = [];
  const ids = new Map<string, string>();
  const parents = new Map<string, string>();
  for (let index = 0; index < records.length; index++) {
    const original = records[index];
    if (!original || typeof original !== 'object' || Array.isArray(original)) { warnings.push(`Eintrag ${index + 1}: Kein gültiges Aufgabenobjekt.`); continue; }
    const data = Object.fromEntries(Object.entries(original).map(([k, v]) => [normalized(k), v]));
    const field = (...names: string[]) => names.map(n => data[normalized(n)]).find(v => v !== null && v !== undefined && v !== '');
    const title = plain(field('title', 'titel', 'task', 'aufgabe', 'name', 'summary', 'betreff', 'subject', 'task name', 'task title', 'content'));
    if (!title) { warnings.push(`Zeile ${index + 2}: Kein Aufgabentitel gefunden; übersprungen.`); continue; }
    const dueValue = field('dueDate', 'due date', 'fällig am', 'fälligkeit', 'fällig', 'datum', 'date', 'deadline', 'start', 'start date', 'beginn');
    const dueDate = importDate(dueValue);
    if (dueValue && !dueDate) warnings.push(`„${title.slice(0, 60)}“: Datum nicht erkannt; wird ohne Datum importiert. Nutze TT.MM.JJJJ oder JJJJ-MM-TT.`);
    const statusText = normalized(plain(field('status', 'state', 'zustand', 'erledigt', 'completed')));
    const status: Status = ['done', 'completed', 'complete', 'erledigt', 'abgeschlossen', 'true', '1', 'closed'].includes(statusText) ? 'done' : ['inprogress', 'inbearbeitung', 'doing', 'gestartet'].includes(statusText) ? 'in_progress' : 'todo';
    const prioText = normalized(plain(field('priority', 'priorität', 'prio')));
    const priority: Priority = ['high', 'hoch', 'urgent', 'dringend', '1'].includes(prioText) ? 'high' : ['low', 'niedrig', 'gering', '3', '4'].includes(prioText) ? 'low' : 'medium';
    const notes = plain(field('notes', 'notizen', 'description', 'beschreibung', 'details', 'note'));
    const time = dueDate ? clock(field('time', 'uhrzeit', 'zeit', 'start time') || (plain(dueValue).includes('T') ? dueValue : null)) : null;
    const durationValue = Number(field('duration', 'dauer', 'minutes', 'minuten'));
    const topicName = plain(field('topicName', 'thema', 'topic', 'projekt', 'project', 'kunde', 'client', 'list')) || topicNames[plain(field('topicId'))] || null;
    const id = plain(field('id', 'uid'));
    const key = id ? `record:${digest(source + '|' + id)}` : `task:${fingerprint({ title, dueDate, time })}`;
    const parentId = plain(field('parentId', 'parent id', 'parent'));
    if (id) ids.set(id, key); if (parentId) parents.set(key, parentId);
    const row: ImportRow = { key, title: title.slice(0, 300), notes: notes.slice(0, 20000), dueDate, time, duration: Number.isFinite(durationValue) && durationValue >= 5 ? Math.min(1440, Math.round(durationValue)) : 30, status, priority, topicName: topicName?.slice(0, 80) || null, duplicate: false };
    rows.push(row);
  }
  for (const row of rows) { const parent = parents.get(row.key); if (parent && ids.has(parent)) row.parentKey = ids.get(parent)!; }
  if (!rows.length) throw new Error('Keine Aufgaben gefunden. Die erste Zeile muss Spaltennamen wie „Titel“, „Datum“ und „Thema“ enthalten.');
  return { source, rows: markDuplicates(rows), warnings: warnings.slice(0, 30) };
}

export async function previewFile(buffer: Buffer, filename: string): Promise<ImportPreview> {
  const extension = extname(filename).toLowerCase();
  const source = filename.slice(0, 200);
  if (extension === '.json') {
    const json = JSON.parse(buffer.toString('utf8').replace(/^\uFEFF/, '')) as unknown;
    const obj = json as { tasks?: Record<string, unknown>[]; topics?: { id: string; name: string }[]; time?: { entries?: unknown[]; activeTimers?: unknown[] } };
    const records = Array.isArray(json) ? json : obj?.tasks;
    if (!Array.isArray(records)) throw new Error('JSON muss eine Aufgabenliste oder einen Fokus-Export mit „tasks“ enthalten.');
    const names = Object.fromEntries((Array.isArray(obj?.topics) ? obj.topics : []).map(t => [t.id, t.name]));
    const result = rowsFromRecords(records, source, names);
    if ((Array.isArray(obj?.time?.entries) && obj.time.entries.length) || (Array.isArray(obj?.time?.activeTimers) && obj.time.activeTimers.length)) result.warnings.push('Dieser Export enthält Zeiterfassung. Der Aufgabenimport übernimmt nur Aufgaben und Themen; Zeiteinträge und laufende Timer werden nicht importiert.');
    return result;
  }
  if (['.csv', '.tsv'].includes(extension)) {
    const text = buffer.toString('utf8');
    const line = text.replace(/^\uFEFF/, '').split(/\r?\n/)[0];
    const delimiter = extension === '.tsv' || line.includes('\t') ? '\t' : (line.match(/;/g)?.length || 0) > (line.match(/,/g)?.length || 0) ? ';' : ',';
    const records = parseCsv(text, { columns: true, delimiter, bom: true, skip_empty_lines: true, trim: true, relax_column_count: false, max_record_size: 100000 }) as Record<string, unknown>[];
    return rowsFromRecords(records, source);
  }
  if (extension === '.xlsx') {
    checkWorkbookZip(buffer);
    const { default: ExcelJS } = await import('exceljs');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(new Uint8Array(buffer).buffer);
    const worksheet = workbook.worksheets.find(sheet => sheet.actualRowCount > 0);
    if (!worksheet) throw new Error('Die Excel-Datei enthält keine Daten.');
    if (worksheet.rowCount > 501 || worksheet.columnCount > 100) throw new Error('Excel-Import: maximal 500 Aufgaben und 100 Spalten. Bitte die Datei verkleinern.');
    const headers = worksheet.getRow(1).values as unknown[];
    const records: Record<string, unknown>[] = [];
    worksheet.eachRow((row, number) => { if (number === 1) return; const record: Record<string, unknown> = {}; row.eachCell((cell, column) => { const header = plain(headers[column]); if (header) record[header] = cell.value; }); records.push(record); });
    const result = rowsFromRecords(records, source);
    if (workbook.worksheets.length > 1) result.warnings.push(`Nur das erste gefüllte Blatt „${worksheet.name}“ wurde eingelesen.`);
    return result;
  }
  if (extension === '.ics') return previewIcs(buffer.toString('utf8'), source);
  throw new Error('Unterstützt werden .xlsx, .csv, .tsv, .json und .ics. Alte .xls-Dateien bitte zuerst als .xlsx speichern.');
}
function checkWorkbookZip(buffer: Buffer) {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0 || end + 22 > buffer.length) throw new Error('Die Excel-Datei ist beschädigt oder kein gültiges .xlsx-Format.');
  const count = buffer.readUInt16LE(end + 10); let offset = buffer.readUInt32LE(end + 16); let expanded = 0;
  if (count > 1024 || offset >= buffer.length) throw new Error('Diese Excel-Datei ist zu umfangreich. Bitte nur das benötigte Aufgabenblatt exportieren.');
  for (let index = 0; index < count; index++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('Die Excel-Datei ist beschädigt.');
    expanded += buffer.readUInt32LE(offset + 24);
    if (expanded > 32 * 1024 * 1024) throw new Error('Die entpackte Excel-Datei ist zu groß. Bitte die Datei verkleinern.');
    offset += 46 + buffer.readUInt16LE(offset + 28) + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);
  }
}
async function previewIcs(text: string, source: string): Promise<ImportPreview> {
  const { default: ICAL } = await import('ical.js');
  const root = new ICAL.Component(ICAL.parse(text));
  for (const zone of root.getAllSubcomponents('vtimezone').slice(0, 64)) { const id = String(zone.getFirstPropertyValue('tzid')); ICAL.TimezoneService.register(new ICAL.Timezone(zone), id); }
  const rows: ImportRow[] = []; const warnings: string[] = [];
  const components = [...root.getAllSubcomponents('vevent'), ...root.getAllSubcomponents('vtodo')];
  if (components.length > 500) throw new Error('Bitte höchstens 500 Kalendereinträge pro Datei importieren.');
  for (const component of components) {
    if (component.getFirstPropertyValue('status') === 'CANCELLED') continue;
    const title = plain(component.getFirstPropertyValue('summary')); if (!title) continue;
    const start = component.getFirstPropertyValue(component.name === 'vtodo' ? 'due' : 'dtstart') as import('ical.js').default.Time | null;
    let dueDate: string | null = null; let time: string | null = null;
    if (start) {
      if (start.isDate) dueDate = start.toString().slice(0, 10);
      else { const zoned = dateAndTime(start.toJSDate()); dueDate = zoned.dueDate; time = zoned.time; }
    }
    if (component.hasProperty('rrule')) warnings.push(`„${title.slice(0, 50)}“: Wiederholung wird als einzelne Aufgabe am Serienstart importiert.`);
    const uid = plain(component.getFirstPropertyValue('uid')) || `${title}|${dueDate}|${time}`;
    const recurrence = plain(component.getFirstPropertyValue('recurrence-id'));
    rows.push({ key: `ics:${digest(uid + recurrence)}`, title: title.slice(0, 300), notes: plain(component.getFirstPropertyValue('description')).slice(0, 20000), dueDate, time, duration: 30, status: component.getFirstPropertyValue('status') === 'COMPLETED' ? 'done' : 'todo', priority: 'medium', topicName: null, duplicate: false });
  }
  if (!rows.length) throw new Error('Die Kalenderdatei enthält keine importierbaren Termine oder Aufgaben.');
  return { source, rows: markDuplicates(rows), warnings: [...new Set(warnings)].slice(0, 30) };
}
export function dateAndTime(value: Date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('sv-SE', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(value).map(p => [p.type, p.value]));
  return { dueDate: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}
export const commitSchema = z.object({ source: z.string().min(1).max(200), rows: z.array(z.object({
  key: z.string().min(1).max(300), title: z.string().trim().min(1).max(300), notes: z.string().max(20000),
  dueDate: z.string().nullable(), time: z.string().nullable(), duration: z.number().int().min(5).max(1440),
  status: z.enum(['todo', 'in_progress', 'done']), priority: z.enum(['low', 'medium', 'high']),
  topicName: z.string().max(80).nullable(), duplicate: z.boolean(), parentKey: z.string().max(300).nullable().optional()
})).min(1).max(500), topicId: z.string().uuid().nullable().optional() }).strict();
export function commitImport(input: unknown) {
  const data = commitSchema.parse(input);
  const rows = markDuplicates(data.rows);
  const known = getSetting<Record<string, string>>('importKeys', {});
  const created = new Map<string, string>(); let skipped = 0;
  transaction(() => {
    for (const row of rows) {
      if (row.duplicate) { const existing = listTasks().find(t => fingerprint(t) === fingerprint(row)); if (existing) known[row.key] = existing.id; skipped++; continue; }
      const topic = data.topicId !== undefined ? data.topicId : listTopics().find(t => t.name.toLocaleLowerCase('de') === row.topicName?.toLocaleLowerCase('de'))?.id || null;
      const task = createTask({ title: row.title, notes: row.notes, dueDate: row.dueDate, time: row.time, duration: row.duration, status: row.status, priority: row.priority, topicId: topic, calendarEnabled: false });
      known[row.key] = task.id; created.set(row.key, task.id);
    }
    for (const row of rows) {
      const id = created.get(row.key); const parent = row.parentKey ? created.get(row.parentKey) || known[row.parentKey] : null;
      if (id && parent && findTask(parent)) updateTask(id, { parentId: parent });
    }
    setSetting('importKeys', known);
  });
  return { imported: created.size, skipped };
}

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_PATH = ':memory:';
const { db, findTask, listTasks } = await import('../server/store.ts');
const { commitImport, importDate, previewFile } = await import('../server/imports.ts');
after(() => db.close());
test('CSV handles quoted delimiters, German dates and duplicate import', async () => {
  const csv = Buffer.from('Titel;Notizen;Fällig;Priorität\n"Angebot, Version 2";"Erste Zeile; zweite Zeile";21.10.2026;hoch\n');
  const preview = await previewFile(csv, 'kunden.csv');
  assert.equal(preview.rows[0].title, 'Angebot, Version 2'); assert.equal(preview.rows[0].dueDate, '2026-10-21'); assert.equal(preview.rows[0].priority, 'high');
  assert.equal(commitImport({ source: preview.source, rows: preview.rows }).imported, 1);
  assert.equal(commitImport({ source: preview.source, rows: preview.rows }).skipped, 1);
  assert.equal(listTasks()[0].calendarEnabled, false);
});
test('Excel serial and ISO dates validate without inventing invalid calendar days', () => {
  assert.equal(importDate('31.02.2026'), null); assert.equal(importDate('2026-10-16'), '2026-10-16'); assert.equal(importDate(46311), '2026-10-16');
});
test('Fokus JSON restores parent-child links without trusting arbitrary internal IDs', async () => {
  const preview = await previewFile(Buffer.from(JSON.stringify({ tasks: [{ id: 'p', title: 'Importiertes Projekt' }, { id: 'c', title: 'Importierte Unteraufgabe', parentId: 'p' }] })), 'fokus.json');
  assert.equal(commitImport({ source: preview.source, rows: preview.rows }).imported, 2);
  const parent = listTasks().find(t => t.title === 'Importiertes Projekt')!;
  const child = listTasks().find(t => t.title === 'Importierte Unteraufgabe')!;
  assert.equal(child.parentId, parent.id); assert.ok(findTask(parent.id));
});
test('ICS imports all-day events and preserves escaped content', async () => {
  const ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:example-1\r\nDTSTART;VALUE=DATE:20261022\r\nDTEND;VALUE=DATE:20261023\r\nSUMMARY:Kunde\\, Feedback\r\nDESCRIPTION:Zeile eins\\nZeile zwei\r\nEND:VEVENT\r\nEND:VCALENDAR';
  const preview = await previewFile(Buffer.from(ics), 'calendar.ics');
  assert.equal(preview.rows[0].dueDate, '2026-10-22'); assert.equal(preview.rows[0].time, null); assert.equal(preview.rows[0].title, 'Kunde, Feedback'); assert.match(preview.rows[0].notes, /Zeile eins\nZeile zwei/);
});
test('XLSX reads dates and cached formula results but never evaluates formulas', async () => {
  const { default: ExcelJS } = await import('exceljs'); const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet('Aufgaben');
  sheet.addRow(['Titel', 'Datum', 'Notizen']); sheet.addRow(['Excel Aufgabe', new Date('2026-10-23T00:00:00Z'), { formula: '1+1', result: 2 }]);
  const preview = await previewFile(Buffer.from(await workbook.xlsx.writeBuffer()), 'aufgaben.xlsx');
  assert.equal(preview.rows[0].dueDate, '2026-10-23'); assert.equal(preview.rows[0].notes, '2');
});

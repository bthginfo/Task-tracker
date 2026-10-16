import { after, test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_PATH = ':memory:';
const store = await import('../server/store.ts');
const { cleanDictation, parseDictation } = await import('../server/voice.ts');
const { eventBody, encrypt, decrypt } = await import('../server/calendar.ts');
const { db, createTask, createTopic, deleteTask, deleteTopic, findTask, listTasks, transaction, updateTask } = store;
after(() => db.close());

test('tasks can be unassigned; calendar is on by default and waits without date', () => {
  const task = createTask({ title: 'Mario anrufen' });
  assert.equal(task.topicId, null); assert.equal(task.calendarEnabled, true); assert.equal(task.calendarSyncStatus, 'waiting');
});
test('subtasks inherit topic; completing and reopening preserve hierarchy', () => {
  const topic = createTopic({ name: 'Kunde Test', color: '#aabbcc' });
  const parent = createTask({ title: 'Konzept', topicId: topic.id });
  const child = createTask({ title: 'Entwurf', parentId: parent.id });
  const grandchild = createTask({ title: 'Skizze', parentId: child.id });
  assert.equal(child.topicId, topic.id);
  transaction(() => updateTask(parent.id, { status: 'done' }));
  assert.equal(findTask(grandchild.id)?.status, 'done');
  transaction(() => updateTask(grandchild.id, { status: 'todo' }));
  assert.equal(findTask(parent.id)?.status, 'todo');
  assert.throws(() => transaction(() => updateTask(parent.id, { parentId: grandchild.id })), /zirkulär/);
  assert.equal(findTask(parent.id)?.parentId, null);
  transaction(() => deleteTopic(topic.id)); assert.equal(findTask(grandchild.id)?.topicId, null);
  transaction(() => deleteTask(parent.id)); assert.equal(findTask(grandchild.id), null);
});
test('validation rejects invalid dates, clock times and empty titles', () => {
  assert.throws(() => createTask({ title: ' ' }));
  assert.throws(() => createTask({ title: 'Datum', dueDate: '2026-02-31' }));
  assert.throws(() => createTask({ title: 'Zeit', time: '29:00', dueDate: '2026-10-16' }));
  assert.throws(() => createTask({ title: 'Zeit', time: '12:00' }));
});

test('adding or moving an open subtask reopens a completed parent', () => {
  const parent = createTask({ title: 'Completed parent', status: 'done' });
  createTask({ title: 'New child', parentId: parent.id });
  assert.equal(findTask(parent.id)?.status, 'todo');
  updateTask(parent.id, { status: 'done' });
  const other = createTask({ title: 'Move this task' });
  updateTask(other.id, { parentId: parent.id });
  assert.equal(findTask(parent.id)?.status, 'todo');
});

test('relative dictation dates follow the workspace time zone near midnight', () => {
  const result = parseDictation('Morgen Angebot senden', [], new Date('2026-10-16T23:30:00Z'));
  assert.equal(result.suggested.dueDate, '2026-10-18');
});
test('dictation removes fillers without deleting negations or meaningful words', () => {
  assert.equal(cleanDictation('Also, ähm bitte den Termin nicht absagen'), 'Bitte den Termin nicht absagen');
  assert.equal(cleanDictation('Den Termin halt nächste Woche machen'), 'Den Termin halt nächste Woche machen');
  const result = parseDictation('Ähm ich muss morgen um 14:30 Uhr Angebot schicken mit hoher Priorität', [], new Date(2026, 9, 16, 12));
  assert.equal(result.suggested.dueDate, '2026-10-17'); assert.equal(result.suggested.time, '14:30'); assert.equal(result.suggested.priority, 'high'); assert.equal(result.suggested.title, 'Angebot schicken');
});
test('dictation recognizes named topics and preserves the original', () => {
  const original = 'Übermorgen für Studio Nord Entwürfe senden';
  const parsed = parseDictation(original, [{ id: 'studio', name: 'Studio Nord', color: '#123456', createdAt: '' }], new Date(2026, 9, 16, 12));
  assert.equal(parsed.original, original); assert.equal(parsed.suggested.topicId, 'studio'); assert.equal(parsed.suggested.title, 'Entwürfe senden');
});
test('all-day events use exclusive next day, timed events cross midnight in local zone', () => {
  const task = createTask({ title: 'Jahresabschluss', dueDate: '2026-12-31' });
  assert.deepEqual(eventBody(task).end, { date: '2027-01-01' });
  const timed = updateTask(task.id, { time: '23:45', duration: 30 });
  assert.deepEqual(eventBody(timed).end, { dateTime: '2027-01-01T00:15:00', timeZone: 'Europe/Paris' });
});
test('encrypted OAuth tokens are authenticated and cannot be read as plaintext', () => {
  const encrypted = encrypt({ token: 'sensitive-value' });
  assert.ok(!encrypted.includes('sensitive-value')); assert.deepEqual(decrypt(encrypted), { token: 'sensitive-value' });
  const modified = Buffer.from(encrypted, 'base64'); modified[30] ^= 1;
  assert.throws(() => decrypt(modified.toString('base64')));
});
test('failed transaction rolls back all changes', () => {
  const before = listTasks().length;
  assert.throws(() => transaction(() => { createTask({ title: 'Rollback task' }); throw new Error('failure'); }));
  assert.equal(listTasks().length, before);
});

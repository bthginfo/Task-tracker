import { after, test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_PATH = ':memory:';
const { db, createTask, updateTask, deleteTask, findTask, setSetting } = await import('../server/store.ts');
const { encrypt, processQueue } = await import('../server/calendar.ts');
after(() => db.close());
test('calendar queue creates, updates, removes, retries and avoids duplicate events', async () => {
  setSetting('google', { tokens: encrypt({ access_token: 'fake-local-token', refresh_token: 'fake-refresh', expires_at: Date.now() + 3600000 }), email: 'test@example.invalid', calendarId: 'primary', lastSyncedAt: null, error: null });
  const original = globalThis.fetch;
  const calls: { method: string; url: string; body: Record<string, unknown> | null }[] = [];
  let fail = false; let conflict = false; let missing = false;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input); assert.ok(url.startsWith('https://www.googleapis.com/calendar/v3/calendars/primary/events'));
    const method = init?.method || 'GET'; const body = init?.body ? JSON.parse(String(init.body)) : null; calls.push({ method, url, body });
    if (fail) return new Response('{}', { status: 503 });
    if (missing && method === 'PUT') { missing = false; return new Response('{}', { status: 410 }); }
    if (conflict && method === 'POST') { conflict = false; return new Response('{}', { status: 409 }); }
    return method === 'DELETE' ? new Response(null, { status: 204 }) : new Response('{}', { status: 200 });
  }) as typeof fetch;
  try {
    const task = createTask({ title: 'Sync-Test', dueDate: '2026-10-24' }); await processQueue();
    assert.equal(calls.at(-1)?.method, 'POST'); assert.equal(findTask(task.id)?.calendarSyncStatus, 'synced');
    const id = calls[0].body?.id;
    updateTask(task.id, { status: 'done' }); await processQueue();
    assert.equal(calls.at(-1)?.method, 'PUT'); assert.equal(calls.at(-1)?.body?.summary, '✓ Sync-Test'); assert.ok(calls.at(-1)?.url.endsWith(String(id)));
    updateTask(task.id, { calendarEnabled: false }); await processQueue(); assert.equal(calls.at(-1)?.method, 'DELETE'); assert.equal(findTask(task.id)?.calendarSyncStatus, 'off');
    conflict = true; updateTask(task.id, { calendarEnabled: true }); await processQueue(); assert.equal(calls.at(-1)?.method, 'PUT'); assert.equal(findTask(task.id)?.calendarSyncStatus, 'synced');
    const reusedId = calls.at(-1)?.url.split('/').at(-1);
    assert.notEqual(reusedId, id, 'reenabling uses a fresh ID after Google tombstones a deleted event');
    missing = true; updateTask(task.id, { notes: 'Remote event was deleted' }); await processQueue();
    assert.equal(calls.at(-1)?.method, 'POST'); assert.notEqual(calls.at(-1)?.body?.id, reusedId);
    fail = true; updateTask(task.id, { title: 'Geänderter Termin' }); await processQueue();
    assert.equal(findTask(task.id)?.calendarSyncStatus, 'error'); assert.ok(db.prepare('SELECT id FROM sync_jobs WHERE task_id=?').get(task.id));
    const count = calls.length; await processQueue(); assert.equal(calls.length, count, 'backoff prevents immediate repeated calls');
    db.prepare('UPDATE sync_jobs SET next_at=0 WHERE task_id=?').run(task.id); fail = false; await processQueue(); assert.equal(findTask(task.id)?.calendarSyncStatus, 'synced');
    deleteTask(task.id); await processQueue(); assert.equal(calls.at(-1)?.method, 'DELETE'); assert.equal(findTask(task.id), null); assert.equal(db.prepare('SELECT id FROM sync_jobs WHERE task_id=?').get(task.id), undefined);
  } finally { globalThis.fetch = original; }
});

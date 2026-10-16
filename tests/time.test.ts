import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
process.env.DATABASE_PATH = ':memory:';
const store = await import('../server/store.ts');
const time = await import('../server/time.ts');
const { coveredSeconds, dateKeyInZone, fromZonedInput, splitTimeEntries, toZonedInput } = await import('../shared/time.ts');
const {db,createTask,createTopic,deleteTask,findTask,setSetting,transaction,updateTask} = store;
after(() => db.close());
function reset() { db.exec('DELETE FROM time_entries; DELETE FROM tasks; DELETE FROM topics; DELETE FROM settings; DELETE FROM sync_jobs; DELETE FROM event_links'); }
function task(title = 'Zeitaufgabe') { return createTask({title,calendarEnabled:false}); }
function manual(taskId: string, startedAt='2026-10-15T20:00:00Z', endedAt='2026-10-15T22:00:00Z', notes='') { return time.createTimeEntry({id:randomUUID(),taskId,startedAt,endedAt,notes}); }

test('several task timers run independently; duplicate starts and stops are idempotent', () => {
  reset(); const a=task('A'), b=task('B'); const first=randomUUID(), second=randomUUID();
  transaction(() => time.startTimer({id:first,taskId:a.id})); transaction(() => time.startTimer({id:second,taskId:b.id}));
  time.startTimer({id:randomUUID(),taskId:a.id}); assert.equal(time.activeTimers().length,2);
  time.stopTimer({timerId:first}); assert.equal(time.activeTimers()[0].id,second); assert.equal(time.listTimeEntries().length,1);
  time.stopTimer({timerId:first}); time.startTimer({id:first,taskId:a.id}); assert.equal(time.listTimeEntries().length,1); assert.equal(time.activeTimers().length,1);
  time.stopAllTimers({timerIds:[second]}); assert.equal(time.activeTimers().length,0); assert.equal(time.listTimeEntries().length,2);
  assert.ok(time.listTimeEntries().every(entry=>entry.durationSeconds>0 && entry.source==='timer'));
});
test('stop-all only stops requested timers and keeps a newly started timer running', () => {
  reset(); const tasks=[task('One'),task('Two'),task('New')]; const ids=tasks.map(()=>randomUUID());
  tasks.forEach((value,index)=>time.startTimer({id:ids[index],taskId:value.id}));
  time.stopAllTimers({timerIds:ids.slice(0,2)}); assert.deepEqual(time.activeTimers().map(t=>t.id),[ids[2]]);
});
test('manual entries preserve exact duration, task snapshots and retry identity', () => {
  reset(); const topic=createTopic({name:'Kunde',color:'#123456'}); const parent=createTask({title:'Projekt',topicId:topic.id}); const child=createTask({title:'Entwurf',parentId:parent.id});
  const input={id:randomUUID(),taskId:child.id,startedAt:'2026-10-15T10:00:00+02:00',endedAt:'2026-10-15T11:30:00+02:00',notes:'Konzept'};
  const entry=time.createTimeEntry(input); time.createTimeEntry(input);
  assert.equal(time.listTimeEntries().length,1); assert.equal(entry.startedAt,'2026-10-15T08:00:00.000Z'); assert.equal(entry.durationSeconds,5400);
  assert.equal(entry.topicName,'Kunde'); assert.equal(entry.parentTitle,'Projekt'); assert.equal(entry.taskTitle,'Entwurf');
  assert.throws(()=>time.createTimeEntry({...input,notes:'Different'}),time.TimeConflictError);
});
test('editing and deleting time uses versions and preserves data on stale changes', () => {
  reset(); const value=task(); const entry=manual(value.id); const input={taskId:value.id,startedAt:entry.startedAt,endedAt:'2026-10-15T23:00:00Z',notes:'Überarbeitet',version:1};
  const changed=time.updateTimeEntry(entry.id,input); assert.equal(changed.durationSeconds,10800); assert.equal(changed.version,2);
  assert.throws(()=>time.updateTimeEntry(entry.id,input),time.TimeConflictError);
  assert.throws(()=>time.deleteTimeEntry(entry.id,{version:1}),time.TimeConflictError); assert.equal(time.listTimeEntries()[0].notes,'Überarbeitet');
  time.deleteTimeEntry(entry.id,{version:2}); time.deleteTimeEntry(entry.id,{version:2}); assert.equal(time.listTimeEntries().length,0);
});
test('invalid intervals and unrelated or excessive manual records are rejected', () => {
  reset(); const value=task();
  assert.throws(()=>manual(value.id,'2026-10-15T10:00:00Z','2026-10-15T09:00:00Z'),/Ende/);
  assert.throws(()=>manual(value.id,'2026-01-01T00:00:00Z','2028-01-01T00:00:00Z'),/366/);
  assert.throws(()=>manual(randomUUID()),/nicht gefunden/);
  assert.throws(()=>manual(value.id,undefined,undefined,'x'.repeat(2001)));
  assert.equal(time.listTimeEntries().length,0);
});
test('task completion stops its timers and descendant timers but leaves others running', () => {
  reset(); const parent=task('Parent'), child=createTask({title:'Child',parentId:parent.id}), other=task('Other');
  [parent,child,other].forEach(value=>time.startTimer({id:randomUUID(),taskId:value.id}));
  transaction(()=>updateTask(parent.id,{status:'done'}));
  assert.equal(findTask(child.id)?.status,'done'); assert.deepEqual(time.activeTimers().map(t=>t.taskId),[other.id]); assert.equal(time.listTimeEntries().length,2);
});
test('deleting tasks stops timers and retains editable historical time snapshots', () => {
  reset(); const value=task('Gelöschte Aufgabe'); time.startTimer({id:randomUUID(),taskId:value.id}); transaction(()=>deleteTask(value.id));
  const entry=time.listTimeEntries()[0]; assert.equal(entry.taskTitle,'Gelöschte Aufgabe'); assert.equal(time.activeTimers().length,0);
  const changed=time.updateTimeEntry(entry.id,{taskId:value.id,startedAt:'2026-10-15T10:00:00Z',endedAt:'2026-10-15T11:00:00Z',notes:'Nachgetragen',version:1}); assert.equal(changed.durationSeconds,3600);
});
test('midnight splitting and clipping use workspace dates, not UTC dates', () => {
  reset(); const value=task(); const entry=manual(value.id,'2026-10-15T21:30:00Z','2026-10-15T23:30:00Z');
  const segments=splitTimeEntries([entry],'Europe/Paris'); assert.deepEqual(segments.map(s=>[s.date,s.seconds]),[['2026-10-15',1800],['2026-10-16',5400]]);
  assert.equal(splitTimeEntries([entry],'Europe/Paris','2026-10-16','2026-10-16')[0].seconds,5400);
});
test('spring and autumn days have their actual 23 and 25 elapsed hours', () => {
  reset(); const value=task(); const spring=manual(value.id,'2026-03-28T23:00:00Z','2026-03-29T22:00:00Z'); const autumn=manual(value.id,'2026-10-24T22:00:00Z','2026-10-25T23:00:00Z');
  assert.equal(splitTimeEntries([spring],'Europe/Paris')[0].seconds,23*3600); assert.equal(splitTimeEntries([autumn],'Europe/Paris')[0].seconds,25*3600);
  assert.throws(()=>fromZonedInput('2026-03-29T02:30:00','Europe/Paris'),/Zeitumstellung/);
  const second='2026-10-25T01:30:00.000Z'; assert.equal(fromZonedInput(toZonedInput(second,'Europe/Paris'),'Europe/Paris',second),second);
  assert.equal(dateKeyInZone('2026-10-15T23:30:00Z','Europe/Paris'),'2026-10-16');
});
test('overlap-free totals merge parallel work while keeping the tracked sum', () => {
  reset(); const value=task(); const a=manual(value.id,'2026-10-15T20:00:00Z','2026-10-15T22:00:00Z'); const b=manual(value.id,'2026-10-15T21:00:00Z','2026-10-15T23:00:00Z');
  const segments=splitTimeEntries([a,b],'Europe/Paris'); assert.equal(segments.reduce((sum,s)=>sum+s.seconds,0),4*3600); assert.equal(coveredSeconds(segments),3*3600); assert.equal(coveredSeconds([]),0);
});
test('exports match date/topic/task filters and protect CSV cells from formulas', () => {
  reset(); const value=task('=SUM(1,2)'); manual(value.id,'2026-10-15T21:00:00Z','2026-10-15T23:00:00Z','line;one\nline"two'); time.startTimer({id:randomUUID(),taskId:value.id});
  const exported=time.timeExport({format:'csv',from:'2026-10-16',to:'2026-10-16',topicId:'none',taskId:value.id});
  assert.equal(exported.totalSeconds,3600); assert.equal(exported.entries.length,1); assert.equal(exported.segments.length,1); assert.equal(time.exportRows(exported)[0][6],3600);
  assert.equal(time.csvCell('=SUM(1,2)'), '"\'=SUM(1,2)"'); assert.equal(time.csvCell('hello;"world'), '"hello;""world"'); assert.equal(time.csvCell(1.25),'"1,25"');
  assert.throws(()=>time.timeExport({format:'csv',from:'2026-02-31',to:'2026-03-10'})); assert.throws(()=>time.timeExport({format:'csv',from:'2026-10-17',to:'2026-10-16'}));
});

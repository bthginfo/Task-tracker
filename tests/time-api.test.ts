import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
process.env.DATABASE_PATH=':memory:';
process.env.APP_PASSWORD='local-test-password-1234';
process.env.APP_URL='http://localhost:3000';
const {default:app}=await import('../server/app.ts');
const {db}=await import('../server/database.ts');
const server=app.listen(0,'127.0.0.1'); await new Promise<void>(resolve=>server.once('listening',resolve));
const address=server.address(); if(!address || typeof address==='string')throw new Error('Missing test listener');
const base=`http://127.0.0.1:${address.port}`; let cookie='';
async function request(path:string,method='GET',body?:unknown){return fetch(base+path,{method,headers:{Cookie:cookie,Origin:'http://localhost:3000',...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});}
after(async()=>{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));db.close();});

test('authenticated API persists parallel timers, editable time and all export formats',async()=>{
  assert.equal((await request('/api/state')).status,401);
  const login=await request('/api/auth/login','POST',{password:process.env.APP_PASSWORD}); assert.equal(login.status,200); cookie=login.headers.get('set-cookie')!.split(';')[0];
  const a=await(await request('/api/tasks','POST',{title:'=SUM(1,2)',calendarEnabled:false})).json();
  const b=await(await request('/api/tasks','POST',{title:'Parallel',calendarEnabled:false})).json();
  const timerIds=[randomUUID(),randomUUID()];
  for(const[index,task]of[a,b].entries())assert.equal((await request('/api/time/start','POST',{id:timerIds[index],taskId:task.id})).status,200);
  let state=await(await request('/api/state')).json(); assert.equal(state.time.activeTimers.length,2);
  assert.equal((await request('/api/time/stop-all','POST',{timerIds})).status,200);
  const input={id:randomUUID(),taskId:a.id,startedAt:'2026-10-15T21:30:00Z',endedAt:'2026-10-15T23:30:00Z',notes:'Vorschlag; mit Details'};
  const created=await request('/api/time/entries','POST',input);assert.equal(created.status,201); const entry=(await created.json()).entries.find((value:{id:string})=>value.id===input.id);
  const patch={taskId:a.id,startedAt:input.startedAt,endedAt:'2026-10-16T00:00:00Z',notes:'Korrigiert',version:entry.version};
  assert.equal((await request('/api/time/entries/'+entry.id,'PATCH',patch)).status,200);
  assert.equal((await request('/api/time/entries/'+entry.id,'PATCH',patch)).status,409);
  const range='/api/time/export?path=time%2Fexport&from=2026-10-16&to=2026-10-16&taskId='+a.id+'&format=';
  const csv=await request(range+'csv'); assert.equal(csv.status,200); assert.match(csv.headers.get('content-disposition')!,/attachment/);const text=await csv.text();assert.ok(text.includes("'=SUM(1,2)"));assert.ok(text.includes('7200'));
  const json=await(await request(range+'json')).json(); assert.ok(json.totalSeconds>=7200);assert.ok(json.segments.some((value:{entry:{id:string}})=>value.entry.id===entry.id));
  const spreadsheet=await request(range+'xlsx');assert.equal(spreadsheet.status,200);const bytes=Buffer.from(await spreadsheet.arrayBuffer());assert.equal(bytes.readUInt16LE(0),0x4b50);
  const{default:ExcelJS}=await import('exceljs');const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(bytes as never);const rows=workbook.getWorksheet('Zeiten')!;assert.equal(rows.getRow(1).getCell(3).value,'Aufgabe');assert.ok(rows.rowCount>=2);
  const backup=await(await request('/api/export')).json();assert.equal(backup.version,2);assert.ok(backup.time.entries.some((value:{id:string})=>value.id===entry.id));
  assert.equal((await request('/api/time/entries/'+entry.id,'DELETE',{version:2})).status,200);
  state=await(await request('/api/state')).json();assert.ok(!state.time.entries.some((value:{id:string})=>value.id===entry.id));assert.equal(state.time.activeTimers.length,0);
  const foreign=await fetch(base+'/api/time/start',{method:'POST',headers:{Cookie:cookie,Origin:'https://other.invalid','Content-Type':'application/json'},body:JSON.stringify({id:randomUUID(),taskId:a.id})});assert.equal(foreign.status,403);
});

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, Clock3, Info, RefreshCw, Timer } from 'lucide-react';
import { formatElapsed, fromZonedInput, toZonedInput } from '../shared/time';
import type { TimeEntry } from '../shared/types';
import { ApiError } from './api';
import { Overlay, Spinner } from './ui';
import { useTimeTracking, type TimeEditorRequest } from './TimeTracking';

export function TimeEntryEditor({request,onClose,onSaved,onDirty}:{request:TimeEditorRequest;onClose:()=>void;onSaved:()=>void;onDirty:(value:boolean)=>void}){
  const {time,tasks,now,mutate,busy}=useTimeTracking();
  const zone=useRef(time.timezone).current;
  const [original,setOriginal]=useState<TimeEntry|undefined>(request.entry);
  const [version,setVersion]=useState(request.entry?.version);
  const id=useRef(request.entry?.id||crypto.randomUUID());
  const [taskId,setTaskId]=useState(request.entry?.taskId||request.taskId||tasks[0]?.id||'');
  const [startedAt,setStartedAt]=useState(()=>toZonedInput(request.entry?.startedAt||now-3600000,zone));
  const [endedAt,setEndedAt]=useState(()=>toZonedInput(request.entry?.endedAt||now,zone));
  const [notes,setNotes]=useState(request.entry?.notes||'');
  const [manualMinutes,setManualMinutes]=useState<string|null>(null);
  const [error,setError]=useState('');
  const [conflict,setConflict]=useState(false);
  const initial=useRef(JSON.stringify({taskId,startedAt,endedAt,notes,manualMinutes:null}));
  const form=useRef<HTMLFormElement>(null);
  const dirty=initial.current!==JSON.stringify({taskId,startedAt,endedAt,notes,manualMinutes});
  useEffect(()=>{onDirty(dirty);return()=>onDirty(false);},[dirty,onDirty]);
  useEffect(()=>{function keyboard(event:KeyboardEvent){if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();event.stopImmediatePropagation();form.current?.requestSubmit();}}document.addEventListener('keydown',keyboard);return()=>document.removeEventListener('keydown',keyboard);},[]);
  function close(){if(busy)return;if(dirty&&!window.confirm('Ungespeicherte Änderungen an diesem Zeiteintrag verwerfen?'))return;onClose();}
  let duration=0;try{duration=(Date.parse(fromZonedInput(endedAt,zone,original?.endedAt))-Date.parse(fromZonedInput(startedAt,zone,original?.startedAt)))/1000;}catch{/* validation on submit */}
  function preset(minutes:number){try{const end=fromZonedInput(endedAt,zone,original?.endedAt);setStartedAt(toZonedInput(Date.parse(end)-minutes*60000,zone));}catch{setError('Ergänze zuerst eine gültige Endzeit.');}}
  async function save(event:FormEvent){
    event.preventDefault();if(busy)return;setError('');
    try{
      if(!taskId)throw new Error('Wähle eine Aufgabe aus.');
      if(manualMinutes!==null&&(!manualMinutes.trim()||!Number.isFinite(Number(manualMinutes))||Number(manualMinutes)<=0))throw new Error('Gib eine Dauer von mehr als null Minuten ein.');
      const start=fromZonedInput(startedAt,zone,original?.startedAt),end=fromZonedInput(endedAt,zone,original?.endedAt);
      const seconds=(Date.parse(end)-Date.parse(start))/1000;
      if(seconds<=0)throw new Error('Das Ende muss nach dem Beginn liegen.');
      if(seconds>366*86400)throw new Error('Ein einzelner Zeiteintrag darf höchstens 366 Tage umfassen.');
      const body={taskId,startedAt:start,endedAt:end,notes,...(original?{version}:{id:id.current})};
      await mutate(original?`/time/entries/${original.id}`:'/time/entries',original?'PATCH':'POST',body);
      onDirty(false);onSaved();
    }catch(cause){setError(cause instanceof Error?cause.message:'Die Zeit konnte nicht gespeichert werden.');if(cause instanceof ApiError&&cause.status===409)setConflict(true);}
  }
  const latest=original?time.entries.find(entry=>entry.id===original.id):undefined;
  const archived=original&&!tasks.some(task=>task.id===original.taskId);
  function recover(){if(latest){setVersion(latest.version);setOriginal(latest);}else{setOriginal(undefined);setVersion(undefined);id.current=crypto.randomUUID();}setConflict(false);setError('Deine Eingabe ist erhalten. Prüfe sie und speichere erneut.');}
  return <Overlay title={original?'Zeiteintrag bearbeiten':'Zeit manuell nachtragen'} onClose={close} className="time-editor-dialog"><form ref={form} onSubmit={save}><fieldset disabled={busy} className="time-editor-fields"><div className="time-editor-intro"><div className="integration-icon"><Timer size={24}/></div><div><h3>Geleistete Arbeit festhalten.</h3><p>Die tatsächliche Zeit bleibt getrennt von deiner Planung.</p></div></div><label className="field-label"><span>Aufgabe</span><select data-autofocus value={taskId} onChange={event=>setTaskId(event.target.value)} required><option value="" disabled>Aufgabe auswählen</option>{archived&&<option value={original.taskId}>{original.taskTitle} (archivierte Aufgabe)</option>}{tasks.map(task=><option value={task.id} key={task.id}>{task.parentId?`${tasks.find(parent=>parent.id===task.parentId)?.title||'Unteraufgabe'} → `:''}{task.title}{task.status==='done'?' (erledigt)':''}</option>)}</select></label>{!tasks.length&&!original&&<p className="time-editor-no-tasks">Lege zuerst eine Aufgabe an. Danach kannst du Zeit für sie erfassen.</p>}<div className="time-editor-dates"><label className="field-label"><span>Beginn</span><input type="datetime-local" step="1" value={startedAt} onChange={event=>{setStartedAt(event.target.value);setManualMinutes(null);}} required/></label><label className="field-label"><span>Ende</span><input type="datetime-local" step="1" value={endedAt} onChange={event=>{setEndedAt(event.target.value);setManualMinutes(null);}} required/></label></div><div className="time-zone-note"><Clock3 size={13}/><span>Zeitzone: {zone}</span></div><div className="time-duration-preview"><label className="manual-duration-field"><span>Dauer in Minuten</span><input type="number" min="0.016666" max={366*1440} step="any" value={manualMinutes ?? (duration>0?Math.round(duration/60*10000)/10000:'')} onChange={event=>{const value=event.target.value;setManualMinutes(value);if(value&&Number(value)>0&&Number.isFinite(Number(value)))preset(Number(value));}} aria-label="Dauer in Minuten"/></label><strong>{duration>0?formatElapsed(duration):'–'}</strong><div aria-label="Dauer rückwärts ab Endzeit setzen">{[15,30,60].map(value=><button type="button" key={value} onClick={()=>{setManualMinutes(null);preset(value);}}>{value} Min.</button>)}</div></div><label className="field-label"><span>Notiz <small>optional</small></span><textarea rows={3} maxLength={2000} value={notes} onChange={event=>setNotes(event.target.value)} placeholder="Woran hast du gearbeitet?"/></label><p className="time-editor-hint"><Info size={14}/>Überlappende Zeiten sind erlaubt. Die Auswertung zeigt sowohl die Summe als auch die Zeit ohne Überschneidungen.</p>{error&&<p className="inline-error" role="alert">{error}</p>}{conflict&&<div className="time-conflict"><p>Der aktuelle Stand wurde geladen. Deine Eingaben wurden beibehalten.</p><button type="button" className="button secondary" onClick={recover}><RefreshCw size={14}/>{latest?'Aktuellen Stand verwenden & erneut prüfen':'Als neuen Eintrag weiterbearbeiten'}</button></div>}</fieldset><footer className="dialog-footer"><button type="button" className="button secondary" disabled={busy} onClick={close}>Abbrechen</button><button type="submit" className="button primary" disabled={busy||!taskId||conflict}>{busy?<Spinner/>:<Check size={16}/>}Zeit speichern</button></footer></form></Overlay>;
}

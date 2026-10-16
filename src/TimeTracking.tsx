import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, Clock3, Pencil, Play, Plus, Square, Timer, Trash2 } from 'lucide-react';
import type { ActiveTimer, AppState, Task, TimeEntry, TimeState } from '../shared/types';
import { formatElapsed, toZonedInput } from '../shared/time';
import { api, ApiError } from './api';
import { Spinner } from './ui';

export interface TimeEditorRequest {entry?:TimeEntry; taskId?:string; key:number}
interface TimeContextValue {
  time:TimeState; tasks:Task[]; now:number; busy:boolean;
  start:(task:Task)=>Promise<void>; stop:(timer:ActiveTimer)=>Promise<void>; stopAll:()=>Promise<void>;
  mutate:(path:string,method:string,body:unknown)=>Promise<TimeState>;
  edit:(entry?:TimeEntry,taskId?:string)=>void; remove:(entry:TimeEntry)=>Promise<void>;
  openTask:(id:string)=>void; newTask:()=>void;
}
const TimeContext = createContext<TimeContextValue|null>(null);
export function useTimeTracking(){const context=useContext(TimeContext);if(!context)throw new Error('Time tracking context missing');return context;}

export function TimeProvider({state,onChange,onRefresh,notify,onEdit,onOpenTask,onNewTask,children}:{state:AppState;onChange:(value:TimeState)=>void;onRefresh:()=>Promise<void>;notify:(text:string,type?:'success'|'error')=>void;onEdit:(entry?:TimeEntry,taskId?:string)=>void;onOpenTask:(id:string)=>void;onNewTask:()=>void;children:ReactNode}){
  const time=state.time;
  const [tick,setTick]=useState(Date.now);
  const [busy,setBusy]=useState(false);
  const lock=useRef(false);
  const starts=useRef(new Map<string,string>());
  const offset=useMemo(()=>Date.parse(time.serverNow)-Date.now(),[time.serverNow]);
  useEffect(()=>{setTick(Date.now());if(!time.activeTimers.length)return;const timer=setInterval(()=>{if(!document.hidden)setTick(Date.now());},1000);function wake(){setTick(Date.now());}document.addEventListener('visibilitychange',wake);return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',wake);};},[time.serverNow,time.activeTimers.length]);
  async function mutate(path:string,method:string,body:unknown){
    if(lock.current)throw new Error('Eine Zeitänderung wird gerade gespeichert. Bitte einen Moment warten.');
    lock.current=true;setBusy(true);
    try{const next=await api<TimeState>(path,method,body);onChange(next);return next;}
    catch(cause){if(cause instanceof ApiError&&cause.status===409){try{await onRefresh();}catch{/* retain original conflict for recovery */}}throw cause;}
    finally{lock.current=false;setBusy(false);}
  }
  async function start(task:Task){
    const id=starts.current.get(task.id)||crypto.randomUUID();starts.current.set(task.id,id);
    try{await mutate('/time/start','POST',{id,taskId:task.id});starts.current.delete(task.id);}catch(cause){notify(cause instanceof Error?cause.message:'Der Timer konnte nicht gestartet werden.','error');}
  }
  async function stop(timer:ActiveTimer){try{await mutate('/time/stop','POST',{timerId:timer.id});}catch(cause){notify(cause instanceof Error?cause.message:'Die Zeit konnte nicht gespeichert werden. Der Timer läuft weiter.','error');}}
  async function stopAll(){const ids=time.activeTimers.map(timer=>timer.id);if(!ids.length)return;try{await mutate('/time/stop-all','POST',{timerIds:ids});notify(`${ids.length} ${ids.length===1?'Timer gestoppt.':'Timer gestoppt.'}`);}catch(cause){notify(cause instanceof Error?cause.message:'Die Timer konnten nicht gestoppt werden.','error');}}
  async function remove(entry:TimeEntry){if(!window.confirm(`Zeiteintrag für „${entry.taskTitle}“ löschen? Diese Zeit wird aus der Auswertung entfernt.`))return;try{await mutate(`/time/entries/${entry.id}`,'DELETE',{version:entry.version});notify('Zeiteintrag gelöscht.');}catch(cause){notify(cause instanceof Error?cause.message:'Der Zeiteintrag konnte nicht gelöscht werden.','error');}}
  return <TimeContext.Provider value={{time,tasks:state.tasks,now:tick+offset,busy,start,stop,stopAll,mutate,edit:onEdit,remove,openTask:onOpenTask,newTask:onNewTask}}>{children}</TimeContext.Provider>;
}

export function TaskTimer({task,compact=false}:{task:Task;compact?:boolean}){
  const {time,now,busy,start,stop}=useTimeTracking();
  const active=time.activeTimers.find(timer=>timer.taskId===task.id);
  const saved=time.entries.reduce((sum,entry)=>entry.taskId===task.id?sum+entry.durationSeconds:sum,0);
  const running=active?Math.max(0,(now-Date.parse(active.startedAt))/1000):0;
  return <button type="button" className={`task-timer ${active?'is-running':''} ${compact?'compact':''}`} disabled={busy||(!active&&task.status==='done')} onClick={()=>void(active?stop(active):start(task))} aria-label={active?`Timer für ${task.title} stoppen`:`Timer für ${task.title} starten`} title={active?`${formatElapsed(saved)} gespeichert. Timer stoppen.`:task.status==='done'?'Erledigte Aufgabe zuerst wieder öffnen oder Zeit manuell nachtragen.':`${formatElapsed(saved)} erfasst. Timer starten.`}>{active?<Square size={12} fill="currentColor"/>:<Play size={13}/>}<span>{active?formatElapsed(running,true):saved?formatElapsed(saved):'Timer'}</span></button>;
}

export function RunningTimers(){
  const {time,now,busy,stop,stopAll,openTask}=useTimeTracking();
  const [expanded,setExpanded]=useState(true);
  if(!time.activeTimers.length)return null;
  return <section className="running-timers" aria-label="Laufende Timer"><header><span className="running-timers-label"><span className="timer-live-dot"/><strong>{time.activeTimers.length} {time.activeTimers.length===1?'Timer läuft':'Timer laufen parallel'}</strong><span>Auch wenn du Fokus schließt.</span></span><div><button type="button" className="text-button" disabled={busy} onClick={()=>void stopAll()}><Square size={11} fill="currentColor"/>{busy?'Wird gespeichert …':'Alle stoppen'}</button><button type="button" className="icon-button" aria-expanded={expanded} aria-label={expanded?'Laufende Timer einklappen':'Laufende Timer anzeigen'} onClick={()=>setExpanded(value=>!value)}><ChevronDown size={15} className={expanded?'rotate':''}/></button></div></header>{expanded&&<div className="running-timer-items">{time.activeTimers.map(timer=><div className="running-timer-item" key={timer.id}><button className="running-timer-name" onClick={()=>openTask(timer.taskId)} title={timer.taskTitle}>{timer.taskTitle}</button><time>{formatElapsed((now-Date.parse(timer.startedAt))/1000,true)}</time><button type="button" className="icon-button" aria-label={`Laufenden Timer für ${timer.taskTitle} stoppen`} disabled={busy} onClick={()=>void stop(timer)}><Square size={12} fill="currentColor"/></button></div>)}</div>}</section>;
}

export function TaskTimePanel({task}:{task?:Task}){
  const {time,edit}=useTimeTracking();
  const [all,setAll]=useState(false);
  if(!task)return <section className="task-time-panel"><h3 className="form-section-title"><Timer size={16}/>Erfasste Zeit</h3><p className="time-panel-help">Speichere die Aufgabe, um einen Timer zu starten oder Zeit nachzutragen.</p></section>;
  const entries=time.entries.filter(entry=>entry.taskId===task.id).sort((a,b)=>b.startedAt.localeCompare(a.startedAt));
  const saved=entries.reduce((sum,entry)=>sum+entry.durationSeconds,0);
  return <section className="task-time-panel"><header><h3 className="form-section-title"><Timer size={16}/>Erfasste Zeit</h3><TaskTimer task={task}/></header><div className="task-time-total"><strong>{formatElapsed(saved)}</strong><span>gespeichert · geplant: {formatElapsed(task.duration*60)}</span></div><button type="button" className="text-button time-add-manual" onClick={()=>edit(undefined,task.id)}><Plus size={14}/>Zeit manuell nachtragen</button>{entries.length>0?<><TimeEntryList entries={all?entries:entries.slice(0,4)} compact/>{entries.length>4&&<button type="button" className="text-button" onClick={()=>setAll(value=>!value)}>{all?'Weniger anzeigen':`Alle ${entries.length} Einträge anzeigen`}<ChevronDown size={13} className={all?'rotate':''}/></button>}</>:<p className="time-panel-help">Timer starten oder eine bereits geleistete Zeit eintragen. Parallel laufende Timer bleiben unabhängig.</p>}</section>;
}

export function TimeEntryList({entries,compact=false,range}:{entries:TimeEntry[];compact?:boolean;range?:{from:string;to:string}}){
  const {time,tasks,busy,edit,remove}=useTimeTracking();
  function stamp(value:string,short=false){return new Intl.DateTimeFormat('de-DE',{timeZone:time.timezone,...(short?{}:{day:'2-digit',month:'2-digit',year:'numeric'}),hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date(value));}
  return <div className={`time-entry-list ${compact?'compact':''}`}>{entries.map(entry=>{
    const available=tasks.some(task=>task.id===entry.taskId);
    const crosses=toZonedInput(entry.startedAt,time.timezone).slice(0,10)!==toZonedInput(entry.endedAt,time.timezone).slice(0,10);
    const boundary=range&&(toZonedInput(entry.startedAt,time.timezone).slice(0,10)<range.from||toZonedInput(entry.endedAt,time.timezone).slice(0,10)>range.to);
    return <article className="time-entry-row" key={entry.id}><div className="time-entry-main">{!compact&&<strong>{entry.taskTitle}{!available&&<span className="archived-label">Archivierte Aufgabe</span>}</strong>}<span className="time-entry-when">{stamp(entry.startedAt)} – {stamp(entry.endedAt,!crosses)}</span>{!compact&&<span className="time-entry-topic">{entry.topicName||'Ohne Thema'}{entry.parentTitle?` · Unteraufgabe von ${entry.parentTitle}`:''}</span>}{entry.notes&&<p>{entry.notes}</p>}{boundary&&<small className="time-boundary-note">In der Auswertung wird nur der Zeitraumanteil gezählt.</small>}</div><div className="time-entry-duration"><strong>{formatElapsed(entry.durationSeconds)}</strong><span>{entry.source==='timer'?'Timer':'Manuell'}</span></div><div className="time-entry-actions"><button type="button" className="icon-button" aria-label={`Zeiteintrag für ${entry.taskTitle} bearbeiten`} disabled={busy} onClick={()=>edit(entry)}><Pencil size={14}/></button><button type="button" className="icon-button" aria-label={`Zeiteintrag für ${entry.taskTitle} löschen`} disabled={busy} onClick={()=>void remove(entry)}><Trash2 size={14}/></button></div></article>;
  })}</div>;
}

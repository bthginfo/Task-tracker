import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CalendarDays, CalendarCheck2, Check, ChevronDown, Circle, CornerDownRight, Flag, ListTree, Plus, Trash2, X } from 'lucide-react';
import type { AppState, Priority, Status, Task, TaskInput, VoiceResult } from '../shared/types';
import { api } from './api';
import { Overlay, Spinner, Toggle } from './ui';

type ChildDraft = {id?:string; title:string; status:Status};
export interface DraftRequest {task?:Task; initial?:TaskInput; voice?:VoiceResult; key:number}
export const statusLabels:Record<Status,string> = {todo:'Offen', in_progress:'In Arbeit', done:'Erledigt'};
export const priorityLabels:Record<Priority,string> = {low:'Niedrig',medium:'Normal',high:'Hoch'};

export function TaskDrawer({request, state, onClose, onSaved, onDeleted, onDirty}:{request:DraftRequest; state:AppState; onClose:()=>void; onSaved:(id:string)=>void; onDeleted:()=>void; onDirty:(value:boolean)=>void}) {
  const task = request.task;
  const [draft, setDraft] = useState<TaskInput>(() => ({title:'', notes:'', status:'todo', priority:'medium', topicId:null, parentId:null, dueDate:null, time:null, duration:30, calendarEnabled:true, ...(task || {}), ...request.initial}));
  const [children, setChildren] = useState<ChildDraft[]>(() => state.tasks.filter(item => task && item.parentId === task.id).map(item => ({id:item.id,title:item.title,status:item.status})));
  const initial = useRef(JSON.stringify({draft, children, newChild:''}));
  const savedId = useRef(task?.id);
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const [newChild, setNewChild] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showOriginal, setShowOriginal] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const dirty = initial.current !== JSON.stringify({draft, children, newChild}) || (!task && !!draft.title?.trim());
  useEffect(() => { onDirty(dirty); return () => onDirty(false); }, [dirty, onDirty]);
  useEffect(() => { function handler(event:KeyboardEvent) { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); form.current?.requestSubmit(); } } document.addEventListener('keydown', handler); return () => document.removeEventListener('keydown', handler); }, []);
  const update = <K extends keyof TaskInput>(key:K, value:TaskInput[K]) => setDraft(previous => ({...previous,[key]:value}));
  function addChild() { if (!newChild.trim()) return; setChildren(previous => [...previous, {title:newChild.trim(),status:'todo'}]); if (draft.status === 'done') update('status','todo'); setNewChild(''); }
  function toggleChild(index:number) { const nextStatus = children[index].status === 'done' ? 'todo' : 'done'; setChildren(previous => previous.map((item,i) => i === index ? {...item,status:nextStatus} : item)); if (nextStatus === 'todo' && draft.status === 'done') update('status','todo'); }
  function removeChild(index:number) { const child = children[index]; if (child.id) setRemovedIds(previous => [...previous,child.id!]); setChildren(previous => previous.filter((_, i) => i !== index)); }
  async function save(event:FormEvent) {
    event.preventDefault(); if (busy) return; if (!draft.title?.trim()) { setError('Gib deiner Aufgabe einen Titel.'); return; }
    setBusy(true); setError('');
    try {
      const input:TaskInput = {title:draft.title.trim(),notes:draft.notes || '',status:draft.status,priority:draft.priority,topicId:draft.topicId || null,parentId:draft.parentId || null,dueDate:draft.dueDate || null,time:draft.dueDate ? draft.time || null : null,duration:Number(draft.duration) || 30,calendarEnabled:draft.calendarEnabled};
      const saved = savedId.current ? await api<Task>(`/tasks/${savedId.current}`, 'PATCH', input) : await api<Task>('/tasks','POST',input);
      savedId.current = saved.id;
      const pendingChildren = children.map(child => ({...child}));
      if (newChild.trim()) pendingChildren.push({title:newChild.trim(),status:'todo'});
      setChildren(pendingChildren); setNewChild('');
      for (let i = 0; i < pendingChildren.length; i++) {
        const child = pendingChildren[i];
        const original = state.tasks.find(item => item.id === child.id);
        if (child.id && original?.title === child.title && (draft.status === 'done' || original?.status === child.status)) continue;
        const result = child.id ? await api<Task>(`/tasks/${child.id}`, 'PATCH', {title:child.title,status:draft.status === 'done' ? 'done' : child.status}) : await api<Task>('/tasks','POST',{title:child.title,status:draft.status === 'done' ? 'done' : child.status,parentId:saved.id,topicId:draft.topicId,calendarEnabled:true});
        child.id = result.id;
        setChildren(pendingChildren.map(item => ({...item})));
      }
      setChildren(pendingChildren); setNewChild('');
      for (const id of removedIds) { await api(`/tasks/${id}`,'DELETE'); setRemovedIds(previous => previous.filter(value => value !== id)); }
      onDirty(false); onSaved(saved.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Die Aufgabe konnte nicht gespeichert werden. Bitte versuche es erneut.'); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!savedId.current || !window.confirm('Diese Aufgabe mit allen Unteraufgaben löschen?')) return;
    setBusy(true); setError('');
    try { await api(`/tasks/${savedId.current}`,'DELETE'); onDirty(false); onDeleted(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Löschen fehlgeschlagen.'); setBusy(false); }
  }
  const parent = state.tasks.find(item => item.id === draft.parentId);
  const doneChildren = children.filter(item => item.status === 'done').length;
  return <Overlay title={task ? 'Aufgabendetails' : 'Neue Aufgabe'} drawer onClose={() => { if (!busy) onClose(); }}>
    <form ref={form} onSubmit={save} className="task-form">
      <fieldset className="drawer-scroll" disabled={busy}>
        {parent && <p className="parent-label"><CornerDownRight size={15}/>Unteraufgabe von <strong>{parent.title}</strong></p>}
        {request.voice && <div className="voice-success"><Check size={16}/><span>Diktat bereinigt. Prüfe die Angaben vor dem Speichern.</span></div>}
        <label className="sr-only" htmlFor="task-title">Aufgabentitel</label>
        <textarea id="task-title" data-autofocus className="task-title-input" rows={2} placeholder="Was möchtest du erledigen?" value={draft.title} maxLength={500} required onChange={event => update('title',event.target.value)}/>
        <div className="field-grid">
          <label className="field-label"><span><Circle size={15}/>Status</span><select value={draft.status} onChange={event => update('status',event.target.value as Status)}>{Object.entries(statusLabels).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="field-label"><span><Flag size={15}/>Priorität</span><select value={draft.priority} onChange={event => update('priority',event.target.value as Priority)}>{Object.entries(priorityLabels).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="field-label span-two"><span><span className="topic-indicator"/>Thema</span><select value={draft.topicId || ''} onChange={event => update('topicId',event.target.value || null)}><option value="">Ohne Thema · Eingang</option>{state.topics.map(topic => <option key={topic.id} value={topic.id}>{topic.name}</option>)}</select></label>
        </div>
        <div className="form-separator"/>
        <section aria-labelledby="schedule-heading"><h3 className="form-section-title" id="schedule-heading"><CalendarDays size={16}/>Planung</h3><div className="field-grid">
          <label className="field-label span-two"><span>Datum</span><input type="date" value={draft.dueDate || ''} onChange={event => update('dueDate',event.target.value || null)}/></label>
          <label className="field-label"><span>Uhrzeit</span><input type="time" disabled={!draft.dueDate} value={draft.time || ''} onChange={event => update('time',event.target.value || null)}/></label>
          <label className="field-label"><span>Dauer</span><select value={draft.duration} onChange={event => update('duration',Number(event.target.value))}>{[5,10,15,20,30,45,60,90,120,180,240,480].map(value => <option key={value} value={value}>{value < 60 ? `${value} Minuten` : `${(value / 60).toLocaleString('de-DE')} ${value === 60 ? 'Stunde' : 'Stunden'}`}</option>)}</select></label>
        </div>
        <div className="calendar-option"><CalendarCheck2 size={19}/><div><strong>Mit Google Kalender synchronisieren</strong><p>{!draft.calendarEnabled ? 'Diese Aufgabe bleibt nur in Fokus.' : !draft.dueDate ? 'Wird synchronisiert, sobald ein Datum feststeht.' : !state.calendar.connected ? 'Bereit, sobald du deinen Kalender verbindest.' : draft.time ? 'Als Termin zur gewählten Uhrzeit.' : 'Als ganztägiger Termin am gewählten Datum.'}</p></div><Toggle checked={!!draft.calendarEnabled} onChange={value => update('calendarEnabled',value)} label="Google Kalender für diese Aufgabe"/></div>
        {task?.calendarError && <p className="inline-error">Kalender: {task.calendarError}</p>}
        </section>
        <div className="form-separator"/>
        <section><label className="form-section-title" htmlFor="task-notes">Notizen</label><textarea id="task-notes" className="notes-input" rows={4} placeholder="Gedanken, Links und alles, was dazugehört …" value={draft.notes} onChange={event => update('notes',event.target.value)} maxLength={20000}/></section>
        {!draft.parentId && <><div className="form-separator"/><section><h3 className="form-section-title"><ListTree size={16}/>Unteraufgaben <span className="muted-count">{children.length ? `${doneChildren}/${children.length}` : ''}</span></h3><div className="child-list">{children.map((child,index) => <div className="child-row" key={child.id || `new-${index}`}><button type="button" className={`task-check ${child.status === 'done' ? 'checked' : ''}`} aria-label={`${child.title} ${child.status === 'done' ? 'wieder öffnen' : 'erledigen'}`} onClick={() => toggleChild(index)}>{child.status === 'done' && <Check size={12}/>}</button><input aria-label={`Unteraufgabe ${index+1}`} value={child.title} maxLength={500} onChange={event => setChildren(previous => previous.map((item,i) => i === index ? {...item,title:event.target.value} : item))} required/><button type="button" className="icon-button" aria-label={`Unteraufgabe ${child.title} entfernen`} onClick={() => removeChild(index)}><XIcon/></button></div>)}</div><div className="add-child"><Plus size={16}/><input aria-label="Neue Unteraufgabe" placeholder="Eine Unteraufgabe hinzufügen" value={newChild} maxLength={500} onChange={event => { setNewChild(event.target.value); if (event.target.value.trim() && draft.status === 'done') update('status','todo'); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addChild(); } }}/>{newChild.trim() && <button type="button" className="text-button" onClick={addChild}>Hinzufügen</button>}</div></section></>}
        {request.voice && <div className="original-transcript"><button type="button" onClick={() => setShowOriginal(value => !value)}><ChevronDown size={14} className={showOriginal ? 'rotate' : ''}/>Originaldiktat {showOriginal ? 'ausblenden' : 'anzeigen'}</button>{showOriginal && <p>{request.voice.original}</p>}</div>}
        {error && <p className="inline-error" role="alert">{error}</p>}
      </fieldset>
      <footer className="drawer-footer">{task && <button type="button" className="icon-button danger" aria-label="Aufgabe löschen" onClick={remove} disabled={busy}><Trash2 size={18}/></button>}<span className="save-hint">Strg / ⌘ + Enter</span><button type="button" className="button secondary" onClick={onClose} disabled={busy}>Abbrechen</button><button type="submit" className="button primary" disabled={busy}>{busy ? <Spinner label="Wird gespeichert"/> : <Check size={16}/>}Speichern</button></footer>
    </form>
  </Overlay>;
}

function XIcon() { return <X size={15}/>; }

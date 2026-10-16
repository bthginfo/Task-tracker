import { useState, type CSSProperties } from 'react';
import { ArrowRight, CalendarDays, Check, CheckCheck, ChevronLeft, ChevronRight, Cloud, CloudOff, Flag, GripVertical, ListTree, MoreHorizontal, Plus } from 'lucide-react';
import type { Priority, Status, Task, Topic } from '../shared/types';
import { dateFromKey, dateLabel, localDate } from './api';
import { priorityLabels, statusLabels } from './TaskDrawer';

export function TaskMeta({task, topics, showDate = true}:{task:Task; topics:Topic[]; showDate?:boolean}) {
  const topic = topics.find(item => item.id === task.topicId);
  const overdue = !!task.dueDate && task.dueDate < localDate() && task.status !== 'done';
  return <div className="task-meta">{topic && <span className="task-topic" style={{'--topic-color':topic.color} as CSSProperties}><i/>{topic.name}</span>}{showDate && task.dueDate && <span className={overdue ? 'overdue' : ''}><CalendarDays size={12}/>{dateLabel(task.dueDate)}{task.time ? ` · ${task.time}` : ''}</span>}{task.priority === 'high' && <span className="priority-high" title="Hohe Priorität"><Flag size={12}/>Hoch</span>}</div>;
}

export function TaskList({tasks, allTasks, topics, today, onOpen, onToggle, busyId}:{tasks:Task[]; allTasks:Task[]; topics:Topic[]; today:boolean; onOpen:(task:Task)=>void; onToggle:(task:Task)=>void; busyId:string|null}) {
  const key = localDate();
  const sections = today ? [
    {label:'Überfällig',color:'overdue',tasks:tasks.filter(task => task.status !== 'done' && task.dueDate && task.dueDate < key)},
    {label:'Für heute',color:'',tasks:tasks.filter(task => task.status !== 'done' && (!task.dueDate || task.dueDate >= key))},
    {label:'Geschafft',color:'',tasks:tasks.filter(task => task.status === 'done')},
  ] : [{label:'Aufgaben',color:'',tasks:tasks.filter(task => task.status !== 'done')},{label:'Erledigt',color:'',tasks:tasks.filter(task => task.status === 'done')}];
  return <div className="task-list">{sections.filter(section => section.tasks.length).map(section => <section className="task-section" key={section.label}><div className={`task-section-heading ${section.color}`}><h3>{section.label}</h3><span>{section.tasks.length}</span>{section.label === 'Geschafft' && <CheckCheck size={14}/>}</div>{section.tasks.map(task => {
    const children = allTasks.filter(item => item.parentId === task.id);
    const parent = allTasks.find(item => item.id === task.parentId);
    return <article className={`task-row ${task.status === 'done' ? 'is-done' : ''}`} key={task.id}>
      <button className={`task-check ${task.status === 'done' ? 'checked' : task.status === 'in_progress' ? 'in-progress' : ''}`} onClick={() => onToggle(task)} disabled={busyId === task.id} aria-label={`${task.title} ${task.status === 'done' ? 'wieder öffnen' : 'erledigen'}`}>{task.status === 'done' && <Check size={12}/>}</button>
      <button className="task-row-body" onClick={() => onOpen(task)}><span className="task-row-title">{task.title}</span><TaskMeta task={task} topics={topics}/>{parent && <span className="parent-task-meta">Unteraufgabe von {parent.title}</span>}</button>
      {children.length > 0 && <button className="child-count" onClick={() => onOpen(task)} aria-label={`${children.filter(item => item.status === 'done').length} von ${children.length} Unteraufgaben erledigt`}><ListTree size={14}/>{children.filter(item => item.status === 'done').length}/{children.length}</button>}
      <span className={`row-status status-${task.status}`}><i/>{statusLabels[task.status]}</span>
      <span className={`sync-icon sync-${task.calendarSyncStatus}`} title={syncLabel(task)}>{task.calendarEnabled ? <Cloud size={14}/> : <CloudOff size={14}/>}</span>
      <button className="icon-button row-menu" onClick={() => onOpen(task)} aria-label={`Details zu ${task.title}`}><MoreHorizontal size={18}/></button>
    </article>;
  })}</section>)}</div>;
}

export function BoardView({tasks, allTasks, topics, onOpen, onMove, onAdd}:{tasks:Task[]; allTasks:Task[]; topics:Topic[]; onOpen:(task:Task)=>void; onMove:(id:string,status:Status)=>void; onAdd:(status:Status)=>void}) {
  const [dragOver, setDragOver] = useState<Status|null>(null);
  return <div className="kanban-board">{(['todo','in_progress','done'] as Status[]).map(status => {
    const items = tasks.filter(task => task.status === status);
    return <section className={`kanban-column ${dragOver === status ? 'drag-over' : ''}`} key={status} aria-label={statusLabels[status]} onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDragOver(status); }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragOver(null); }} onDrop={event => { event.preventDefault(); const id = event.dataTransfer.getData('text/plain'); if (tasks.some(task => task.id === id)) onMove(id,status); setDragOver(null); }}>
      <header className="kanban-heading"><span className={`column-dot status-${status}`}/><h3>{statusLabels[status]}</h3><span className="muted-count">{items.length}</span><button className="icon-button" aria-label={`Aufgabe in ${statusLabels[status]} hinzufügen`} onClick={() => onAdd(status)}><Plus size={16}/></button></header>
      <div className="kanban-cards">{items.map(task => {
        const children = allTasks.filter(item => item.parentId === task.id);
        return <article draggable onDragStart={event => { event.dataTransfer.setData('text/plain',task.id); event.dataTransfer.effectAllowed = 'move'; }} className={`kanban-card ${task.status === 'done' ? 'is-done' : ''}`} key={task.id}>
          <button className="kanban-card-body" onClick={() => onOpen(task)}><span className="kanban-title">{task.title}</span>{task.notes && <p>{task.notes}</p>}<TaskMeta task={task} topics={topics}/></button>
          <div className="kanban-card-footer"><span>{children.length > 0 && <><ListTree size={13}/>{children.filter(child => child.status === 'done').length}/{children.length}</>}</span><GripVertical size={14} aria-hidden="true"/></div>
        </article>;
      })}{!items.length && <div className="kanban-empty"><span>{status === 'done' ? 'Hier sammeln sich deine Erfolge.' : 'Platz für deinen nächsten Schritt.'}</span></div>}</div>
      <button className="board-add" onClick={() => onAdd(status)}><Plus size={15}/>Aufgabe hinzufügen</button>
    </section>;
  })}</div>;
}

export function CalendarView({tasks, topics, onOpen, onAdd, onList}:{tasks:Task[]; topics:Topic[]; onOpen:(task:Task)=>void; onAdd:(date:string)=>void; onList:()=>void}) {
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(),new Date().getMonth(),1));
  const [selectedDate,setSelectedDate] = useState(localDate());
  const firstDay = (month.getDay() + 6) % 7;
  const count = Math.ceil((firstDay + new Date(month.getFullYear(),month.getMonth()+1,0).getDate()) / 7) * 7;
  const cells = Array.from({length:count},(_,index) => new Date(month.getFullYear(),month.getMonth(),index - firstDay + 1));
  const noDate = tasks.filter(task => !task.dueDate && task.status !== 'done').length;
  const selectedTasks = tasks.filter(task => task.dueDate === selectedDate).sort((a,b) => (a.time || '').localeCompare(b.time || ''));
  function changeMonth(offset:number) { const next = new Date(month.getFullYear(),month.getMonth()+offset,1); setMonth(next); setSelectedDate(localDate(next)); }
  return <div className="calendar-view"><div className="calendar-toolbar"><h3>{month.toLocaleDateString('de-DE',{month:'long',year:'numeric'})}</h3><div><button className="button secondary compact" onClick={() => { setMonth(new Date(new Date().getFullYear(),new Date().getMonth(),1)); setSelectedDate(localDate()); }}>Heute</button><button className="icon-button" aria-label="Vorheriger Monat" onClick={() => changeMonth(-1)}><ChevronLeft size={18}/></button><button className="icon-button" aria-label="Nächster Monat" onClick={() => changeMonth(1)}><ChevronRight size={18}/></button></div></div><div className="calendar-weekdays">{['Mo','Di','Mi','Do','Fr','Sa','So'].map(day => <span key={day}>{day}</span>)}</div><div className="calendar-grid">{cells.map(date => {
    const key = localDate(date); const items = tasks.filter(task => task.dueDate === key).sort((a,b) => (a.time || '').localeCompare(b.time || ''));
    return <div className={`calendar-cell ${date.getMonth() !== month.getMonth() ? 'outside-month' : ''} ${key === localDate() ? 'today-cell' : ''} ${key === selectedDate ? 'selected-date' : ''}`} key={key} onClick={event => { if (!(event.target as HTMLElement).closest('button')) setSelectedDate(key); }}><button className="calendar-day" onClick={() => setSelectedDate(key)} aria-pressed={key === selectedDate} aria-label={`${date.toLocaleDateString('de-DE')}: ${items.length} ${items.length === 1 ? 'Aufgabe' : 'Aufgaben'} anzeigen`}>{date.getDate()}</button><div className="calendar-cell-tasks">{items.map(task => { const topic = topics.find(item => item.id === task.topicId); return <button className={`calendar-task ${task.status === 'done' ? 'is-done' : ''}`} style={{'--topic-color':topic?.color || 'var(--accent)'} as CSSProperties} key={task.id} onClick={() => onOpen(task)}><i/>{task.time && <time>{task.time}</time>}<span>{task.title}</span></button>; })}</div>{items.length > 0 && <span className="calendar-mobile-count" aria-hidden="true"><span/>{items.length}</span>}</div>;
  })}</div><section className="calendar-day-agenda" aria-label="Aufgaben am ausgewählten Tag"><header><h3>{dateLabel(selectedDate,true)}</h3><button className="text-button" onClick={() => onAdd(selectedDate)}><Plus size={14}/>Aufgabe anlegen</button></header>{selectedTasks.length ? selectedTasks.map(task => <button className="day-agenda-task" key={task.id} onClick={() => onOpen(task)}><time>{task.time || 'Ganztägig'}</time><span><strong className={task.status === 'done' ? 'completed-title' : ''}>{task.title}</strong><TaskMeta task={task} topics={topics} showDate={false}/></span><ChevronRight size={15}/></button>) : <p>Ein bisschen Freiraum. Noch keine Aufgaben für diesen Tag.</p>}</section>{noDate > 0 && <button className="calendar-undated" onClick={onList}><CalendarDays size={15}/>{noDate} {noDate === 1 ? 'Aufgabe hat' : 'Aufgaben haben'} noch kein Datum<span>In der Liste ansehen<ArrowRight size={14}/></span></button>}</div>;
}

function syncLabel(task:Task) { const labels = {off:'Kalendersynchronisierung deaktiviert',waiting:'Wartet auf ein Datum',pending:'Kalendersynchronisierung ausstehend',synced:'Mit Google Kalender synchronisiert',error:'Kalendersynchronisierung fehlgeschlagen'}; return task.calendarError || labels[task.calendarSyncStatus]; }

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { ArrowRight, AudioLines, CalendarCheck2, CalendarDays, Check, CheckCheck, ChevronDown, ChevronRight, Circle, CircleHelp, Clock3, Command, Folder, FolderInput, Inbox, LayoutGrid, List, ListTodo, LogIn, Menu, Mic, Moon, MoreHorizontal, Plus, Search, Settings, SlidersHorizontal, Sparkles, Sun, Trash2, X } from 'lucide-react';
import type { AppState, Priority, Status, Task, TaskInput, Topic, VoiceResult } from '../shared/types';
import { api, ApiError, dateLabel, localDate } from './api';
import { TaskDrawer, priorityLabels, statusLabels, type DraftRequest } from './TaskDrawer';
import { BoardView, CalendarView, TaskList } from './TaskViews';
import { SettingsDialog } from './SettingsDialog';
import { VoiceDialog } from './VoiceDialog';
import { ImportDialog } from './ImportDialog';
import { Overlay, Spinner } from './ui';

type Page = 'today' | 'all' | 'inbox' | 'planned' | 'done' | `topic:${string}`;
type View = 'list' | 'board' | 'calendar';
type Toast = {text:string; type:'success'|'error'};
const navigation = [{id:'today',label:'Heute',icon:Sun},{id:'all',label:'Alle Aufgaben',icon:ListTodo},{id:'inbox',label:'Eingang',icon:Inbox},{id:'planned',label:'Geplant',icon:CalendarDays},{id:'done',label:'Erledigt',icon:CheckCheck}] as const;
const topicColors = ['#a9c99a','#8ab8d9','#c2a2d9','#dfa18d','#d5bd79','#79c3b0','#dc9dbb','#a5adbd'];

export default function App() {
  const [state, setState] = useState<AppState|null>(null);
  const [loading, setLoading] = useState(true);
  const [authRequired, setAuthRequired] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [page, setPage] = useState<Page>('today');
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem('fokus-theme') === 'light' ? 'light' : 'dark'; } catch { return 'dark'; } });
  const [view, setView] = useState<View>(() => { try { const stored = localStorage.getItem('fokus-view'); return stored === 'board' || stored === 'calendar' ? stored : 'list'; } catch { return 'list'; } });
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [showFilters, setShowFilters] = useState(false);
  const [drawer, setDrawer] = useState<DraftRequest|null>(null);
  const [drawerDirty, setDrawerDirty] = useState(false);
  const [settings, setSettings] = useState(false);
  const [voice, setVoice] = useState(false);
  const [topicDialog, setTopicDialog] = useState<Topic|'new'|null>(null);
  const [shortcuts, setShortcuts] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [isMobile,setIsMobile] = useState(() => window.matchMedia('(max-width: 760px)').matches);
  const [importOpen,setImportOpen] = useState(false);
  const [toast, setToast] = useState<Toast|null>(null);
  const [busyId, setBusyId] = useState<string|null>(null);
  const [demoBusy, setDemoBusy] = useState(false);
  const [quickText, setQuickText] = useState('');
  const [quickBusy, setQuickBusy] = useState(false);
  const [showCompleted, setShowCompleted] = useState(true);
  const searchInput = useRef<HTMLInputElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const drawerKey = useRef(0);
  const dirtyRef = useRef(false); dirtyRef.current = drawerDirty;
  const lastRefresh = useRef(0);
  const refresh = useCallback(async () => {
    try { const next = await api<AppState>('/state'); lastRefresh.current = Date.now(); setState(next); setLoadError(''); setAuthRequired(false); }
    catch (cause) { if (cause instanceof ApiError && cause.status === 401) { setAuthRequired(true); setState(null); } else throw cause; }
  }, []);
  useEffect(() => { refresh().catch(cause => setLoadError(cause instanceof Error ? cause.message : 'Der Workspace konnte nicht geladen werden.')).finally(() => setLoading(false)); }, [refresh]);
  useEffect(() => { const query=window.matchMedia('(max-width: 760px)');const change=()=>setIsMobile(query.matches);query.addEventListener('change',change);return()=>query.removeEventListener('change',change); },[]);
  useEffect(() => { if(!isMobile||!mobileNav)return;const previous=document.activeElement as HTMLElement|null;const element=sidebar.current;const timer=setTimeout(()=>element?.querySelector<HTMLElement>('button,input,a')?.focus(),30);function trap(event:KeyboardEvent){if(event.key==='Escape'){event.preventDefault();setMobileNav(false);}if(event.key!=='Tab')return;const items=Array.from(element?.querySelectorAll<HTMLElement>('button,input,a[href]')||[]).filter(item=>!item.hasAttribute('disabled')&&item.getClientRects().length);const first=items[0],last=items[items.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}document.addEventListener('keydown',trap);return()=>{clearTimeout(timer);document.removeEventListener('keydown',trap);previous?.focus();}; },[isMobile,mobileNav]);
  useEffect(() => { document.documentElement.dataset.theme = theme; document.documentElement.style.colorScheme = theme; try { localStorage.setItem('fokus-theme',theme); } catch { /* preferences unavailable */ } }, [theme]);
  useEffect(() => { try { localStorage.setItem('fokus-view',view); } catch { /* preferences unavailable */ } }, [view]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(null),toast.type === 'error' ? 8000 : 3500); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => { function onFocus() { if (!dirtyRef.current && !document.hidden && navigator.onLine && Date.now() - lastRefresh.current >= 60000) void refresh().catch(cause => setToast({text:cause instanceof Error ? cause.message : 'Der Workspace konnte nicht aktualisiert werden.',type:'error'})); } window.addEventListener('focus',onFocus); document.addEventListener('visibilitychange',onFocus); window.addEventListener('online',onFocus); return () => { window.removeEventListener('focus',onFocus); document.removeEventListener('visibilitychange',onFocus); window.removeEventListener('online',onFocus); }; }, [refresh]);
  useEffect(() => { function beforeUnload(event:BeforeUnloadEvent) { if (dirtyRef.current) { event.preventDefault(); event.returnValue = ''; } } window.addEventListener('beforeunload',beforeUnload); return () => window.removeEventListener('beforeunload',beforeUnload); }, []);
  useEffect(() => { const params = new URLSearchParams(window.location.search); const calendar = params.get('calendar'); const error = params.get('error'); if (calendar === 'connected' || calendar === 'success' || calendar === 'error' || error) { const failed = calendar === 'error' || !!error; setSettings(true); setToast({text:failed ? 'Die Kalenderverbindung wurde nicht abgeschlossen. Bitte versuche es erneut.' : 'Google Kalender ist verbunden.',type:failed ? 'error':'success'}); window.history.replaceState({},'',window.location.pathname); } }, []);

  function notify(text:string,type:Toast['type'] = 'success') { setToast({text,type}); }
  function closeDrawer() { if (drawerDirty && !window.confirm('Du hast ungespeicherte Änderungen. Möchtest du sie verwerfen?')) return; setDrawer(null); setDrawerDirty(false); }
  function openTask(task:Task) { if (drawerDirty && !window.confirm('Ungespeicherte Änderungen verwerfen und diese Aufgabe öffnen?')) return; setDrawerDirty(false); setDrawer({task,key:++drawerKey.current}); }
  function newTask(initial:TaskInput = {}) {
    if (drawerDirty && !window.confirm('Ungespeicherte Änderungen verwerfen und eine neue Aufgabe anlegen?')) return;
    const topicId = page.startsWith('topic:') ? page.slice(6) : null;
    setDrawerDirty(false); setDrawer({initial:{topicId,...(page === 'today' ? {dueDate:localDate()} : {}),...initial},key:++drawerKey.current}); setMobileNav(false);
  }
  function navigate(next:Page) { setPage(next); setSearch(''); setStatusFilter('all'); setPriorityFilter('all'); setShowCompleted(true); setMobileNav(false); }
  function toggleTheme() { setTheme(value => value === 'dark' ? 'light' : 'dark'); }
  useEffect(() => {
    function keyboard(event:KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable="true"]') || event.ctrlKey || event.metaKey || event.altKey) return;
      if (drawer || settings || voice || topicDialog || shortcuts || importOpen || authRequired) return;
      if (event.key.toLowerCase() === 'n') { event.preventDefault(); newTask(); }
      if (event.key === '/') { event.preventDefault(); if (window.innerWidth <= 760) setMobileNav(true); setTimeout(() => searchInput.current?.focus(),0); }
      if (event.key === '?') { event.preventDefault(); setShortcuts(true); }
      if (event.key === 'Escape') { setSearch(''); setMobileNav(false); }
    }
    window.addEventListener('keydown',keyboard); return () => window.removeEventListener('keydown',keyboard);
  });

  async function mutateTask(id:string,input:TaskInput) {
    setBusyId(id);
    try { await api<Task>(`/tasks/${id}`,'PATCH',input); await refresh(); } catch (cause) { notify(cause instanceof Error ? cause.message : 'Die Aufgabe konnte nicht aktualisiert werden.','error'); } finally { setBusyId(null); }
  }
  async function loadDemo() { setDemoBusy(true); try { await api('/demo','POST'); await refresh(); notify('Beispielaufgaben sind da. Mach sie zu deinen.'); } catch (cause) { notify(cause instanceof Error ? cause.message : 'Die Beispiele konnten nicht geladen werden.','error'); } finally { setDemoBusy(false); } }
  async function quickCreate(event:FormEvent) {
    event.preventDefault(); if (!quickText.trim() || quickBusy) return;
    setQuickBusy(true);
    try { const result = await api<VoiceResult>('/voice/parse','POST',{text:quickText}); newTask({title:result.suggested.title,dueDate:result.suggested.dueDate || (page === 'today' ? localDate() : null),time:result.suggested.time,priority:result.suggested.priority,topicId:result.suggested.topicId || (page.startsWith('topic:') ? page.slice(6) : null)}); setQuickText(''); }
    catch (cause) { notify(cause instanceof Error ? cause.message : 'Deine Eingabe konnte nicht verarbeitet werden.','error'); } finally { setQuickBusy(false); }
  }
  async function logout() { if (drawerDirty && !window.confirm('Ungespeicherte Änderungen verwerfen und abmelden?')) return; try { await api('/auth/logout','POST'); setSettings(false); setDrawer(null); setDrawerDirty(false); setState(null); setAuthRequired(true); } catch (cause) { notify(cause instanceof Error ? cause.message : 'Abmelden fehlgeschlagen.','error'); } }

  const baseTasks = useMemo(() => state?.tasks.filter(task => !task.parentId) || [],[state]);
  const topic = state?.topics.find(item => `topic:${item.id}` === page);
  const today = localDate();
  const visibleTasks = useMemo(() => {
    if (!state) return [];
    let tasks = search.trim() ? state.tasks : baseTasks;
    if (search.trim()) { const query = search.toLocaleLowerCase('de-DE'); tasks = tasks.filter(task => `${task.title} ${task.notes} ${state.topics.find(topic => topic.id === task.topicId)?.name || ''}`.toLocaleLowerCase('de-DE').includes(query)); }
    else if (page === 'today') tasks = tasks.filter(task => !!task.dueDate && task.dueDate <= today && (task.status !== 'done' || task.dueDate === today));
    else if (page === 'inbox') tasks = tasks.filter(task => !task.topicId);
    else if (page === 'planned') tasks = tasks.filter(task => !!task.dueDate);
    else if (page === 'done') tasks = tasks.filter(task => task.status === 'done');
    else if (page.startsWith('topic:')) tasks = tasks.filter(task => task.topicId === page.slice(6));
    if (statusFilter !== 'all') tasks = tasks.filter(task => task.status === statusFilter);
    if (priorityFilter !== 'all') tasks = tasks.filter(task => task.priority === priorityFilter);
    if (!showCompleted && page !== 'done') tasks = tasks.filter(task => task.status !== 'done');
    return [...tasks].sort((a,b) => (a.status === 'done' ? 1 : 0) - (b.status === 'done' ? 1 : 0) || (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || (a.time || '99:99').localeCompare(b.time || '99:99') || ({high:0,medium:1,low:2}[a.priority] - {high:0,medium:1,low:2}[b.priority]) || b.createdAt.localeCompare(a.createdAt));
  },[state,baseTasks,page,search,statusFilter,priorityFilter,showCompleted,today]);
  const navCounts:Record<string,number> = {
    today:baseTasks.filter(task => task.status !== 'done' && task.dueDate && task.dueDate <= today).length,
    all:baseTasks.filter(task => task.status !== 'done').length,
    inbox:baseTasks.filter(task => task.status !== 'done' && !task.topicId).length,
    planned:baseTasks.filter(task => task.status !== 'done' && !!task.dueDate).length,
    done:baseTasks.filter(task => task.status === 'done').length,
  };
  const pageLabel = search ? 'Suchergebnisse' : topic?.name || navigation.find(item => item.id === page)?.label || 'Aufgaben';
  const greeting = new Date().getHours() < 11 ? 'Guten Morgen' : new Date().getHours() < 18 ? 'Guten Tag' : 'Guten Abend';
  const initialEmpty = state && !state.tasks.length && !state.topics.length && !search;
  const title = search ? `Ergebnisse für „${search}“` : page === 'today' ? `${greeting}, Mario.` : pageLabel;
  const descriptions:Record<string,string> = {today:'Ein klarer Plan. Mehr Raum für das Wesentliche.',all:'Alles, was ansteht. Genau da, wo du es brauchst.',inbox:'Deine Gedanken brauchen nicht immer eine Schublade.',planned:'Gut geplant ist halb aus dem Kopf.',done:'Jeder Haken ein Schritt nach vorn.'};
  const progressTasks = baseTasks.filter(task => task.dueDate === today);
  const completedToday = progressTasks.filter(task => task.status === 'done').length;
  const activeFilters = statusFilter !== 'all' || priorityFilter !== 'all' || !showCompleted;
  const dialogOpen = !!(drawer||settings||voice||topicDialog||shortcuts||importOpen);
  function openImport(){setSettings(false);setMobileNav(false);setImportOpen(true);}

  if (authRequired) return <LoginScreen onLogin={async () => { setLoading(true); try { await refresh(); } finally { setLoading(false); } }} theme={theme} onTheme={toggleTheme}/>;
  if (loading || !state) return <div className="loading-screen"><div className="brand-symbol"><Check size={26}/></div><h1>Fokus</h1>{loadError ? <><p className="inline-error" role="alert">{loadError}</p><button className="button primary" onClick={() => { setLoading(true); refresh().catch(cause => setLoadError(cause.message)).finally(() => setLoading(false)); }}>Erneut laden</button></> : <><Spinner/><p>Ein Moment für deinen Workspace …</p></>}</div>;

  return <div className="app-shell">
    {mobileNav && <button className="mobile-nav-backdrop" onClick={() => setMobileNav(false)} aria-label="Navigation schließen"/>}
    <aside ref={sidebar} className={`sidebar ${mobileNav ? 'is-open' : ''}`} aria-label="Hauptnavigation" role={isMobile&&mobileNav?'dialog':undefined} aria-modal={isMobile&&mobileNav?true:undefined} inert={(isMobile&&!mobileNav)||dialogOpen}>
      <a className="brand" href="#" onClick={event => { event.preventDefault(); navigate('today'); }}><span className="brand-symbol"><Check size={23}/></span><span>Fokus<span className="brand-dot">.</span></span></a>
      <button className="workspace-switch" onClick={() => { setSettings(true); setMobileNav(false); }}><span className="avatar">M</span><span><strong>Marios Workspace</strong><small>Persönlicher Bereich</small></span><ChevronDown size={14}/></button>
      <div className="sidebar-search"><Search size={15}/><input ref={searchInput} type="search" aria-label="Alle Aufgaben durchsuchen" placeholder="Suchen …" value={search} onChange={event => setSearch(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') setMobileNav(false); }}/>{search?<button className="icon-button" aria-label="Suche löschen" onClick={()=>{setSearch('');searchInput.current?.focus();}}><X size={13}/></button>:<kbd>/</kbd>}</div>
      <nav className="main-nav">{navigation.map(item => <button key={item.id} className={`nav-item ${page === item.id && !search ? 'active' : ''}`} onClick={() => navigate(item.id)} aria-current={page === item.id && !search ? 'page' : undefined}><item.icon size={18}/><span>{item.label}</span>{navCounts[item.id] > 0 && <span className="nav-count">{navCounts[item.id]}</span>}</button>)}</nav>
      <section className="topic-nav"><header><h2>Meine Themen</h2><button className="icon-button" aria-label="Thema anlegen" onClick={() => setTopicDialog('new')}><Plus size={15}/></button></header><div className="topic-nav-items">{state.topics.map(item => <div className={`topic-nav-item ${page === `topic:${item.id}` && !search ? 'active' : ''}`} key={item.id}><button onClick={() => navigate(`topic:${item.id}`)} aria-current={page === `topic:${item.id}` && !search ? 'page' : undefined}><span className="topic-dot" style={{background:item.color}}/><span>{item.name}</span><span className="nav-count">{baseTasks.filter(task => task.topicId === item.id && task.status !== 'done').length || ''}</span></button><button className="topic-options icon-button" aria-label={`Thema ${item.name} bearbeiten`} onClick={() => setTopicDialog(item)}><MoreHorizontal size={15}/></button></div>)}{!state.topics.length && <p className="topics-empty">Kunden, Projekte oder einfach<br/>das, was dir wichtig ist.</p>}<button className="add-topic-button" onClick={() => setTopicDialog('new')}><Plus size={15}/>Neues Thema</button></div></section>
      <div className="sidebar-bottom"><button className="nav-item" onClick={openImport}><FolderInput size={17}/><span>Importieren</span></button><button className="nav-item" onClick={() => setSettings(true)}><Settings size={17}/><span>Einstellungen</span></button><button className="nav-item" onClick={() => setShortcuts(true)}><CircleHelp size={17}/><span>Kleine Helfer</span><kbd>?</kbd></button><div className="sidebar-signature"><span className="tiny-dot"/>Weniger im Kopf. Mehr im Moment.</div></div>
    </aside>
    <div className="workspace-shell" inert={dialogOpen||(isMobile&&mobileNav)}>
      <header className="topbar"><div className="breadcrumbs"><button className="icon-button mobile-menu" aria-label="Navigation öffnen" onClick={() => setMobileNav(true)}><Menu size={20}/></button><span className="breadcrumb-home">Mein Workspace</span><ChevronRight size={13}/><span>{pageLabel}</span></div><div className="topbar-actions"><span className="live-date">{new Date().toLocaleDateString('de-DE',{weekday:'short',day:'numeric',month:'short'})}</span><button className="icon-button theme-button" onClick={toggleTheme} aria-label={`Zum ${theme === 'dark' ? 'hellen' : 'dunklen'} Design wechseln`} title={`Zum ${theme === 'dark' ? 'hellen' : 'dunklen'} Design wechseln`}>{theme === 'dark' ? <Sun size={18}/> : <Moon size={18}/>}</button><span className="avatar small" aria-label="Mario">M</span></div></header>
      <div className="workspace-content"><main className="main-workspace" id="main-content">
        <header className="page-header"><div><h1>{title}</h1><p>{search ? `${visibleTasks.length} ${visibleTasks.length === 1 ? 'Aufgabe gefunden' : 'Aufgaben gefunden'}.` : topic ? 'Ein Thema. Alle nächsten Schritte im Blick.' : descriptions[page]}</p></div><button className="button primary new-task-button" aria-label="Neue Aufgabe" onClick={() => newTask()}><Plus size={17}/><span>Neue Aufgabe</span><kbd>N</kbd></button></header>
        {page === 'today' && !search && <div className="daily-overview"><div className="daily-date"><CalendarDays size={16}/><span>{new Date().toLocaleDateString('de-DE',{weekday:'long',day:'numeric',month:'long'})}</span></div>{progressTasks.length > 0 ? <div className="daily-progress"><span><strong>{completedToday}</strong> von {progressTasks.length} erledigt</span><div className="progress-track"><span style={{width:`${completedToday / progressTasks.length * 100}%`}}/></div></div> : <span className="daily-note">Dein Tag, in deinem Tempo.</span>}</div>}
        <form className="quick-capture" onSubmit={quickCreate}><Plus size={19}/><input placeholder="Eine Aufgabe, ein Gedanke …" aria-label="Aufgabe in natürlicher Sprache erfassen" value={quickText} onChange={event => setQuickText(event.target.value)} maxLength={2000}/><span className="quick-hint">z. B. morgen um 10</span><button type="button" className="icon-button capture-mic" aria-label="Aufgabe diktieren" title="Aufgabe diktieren" onClick={() => setVoice(true)}><Mic size={18}/></button>{quickText.trim() && <button className="quick-submit icon-button" type="submit" disabled={quickBusy} aria-label="Aufgabe prüfen">{quickBusy ? <Spinner/> : <ArrowRight size={18}/>}</button>}</form>
        <div className="view-toolbar"><div className="view-switch" role="group" aria-label="Aufgabenansicht">{[{id:'list',label:'Liste',icon:List},{id:'board',label:'Board',icon:LayoutGrid},{id:'calendar',label:'Kalender',icon:CalendarDays}].map(item => <button className={view === item.id ? 'selected' : ''} key={item.id} onClick={() => setView(item.id as View)} aria-pressed={view === item.id}><item.icon size={15}/><span>{item.label}</span></button>)}</div><div className="toolbar-right"><span className="result-count">{visibleTasks.length} {visibleTasks.length === 1 ? 'Aufgabe' : 'Aufgaben'}</span><button className={`filter-button ${activeFilters ? 'has-filter' : ''} ${showFilters ? 'selected' : ''}`} aria-expanded={showFilters} onClick={() => setShowFilters(value => !value)}><SlidersHorizontal size={15}/><span>Filter</span>{activeFilters && <i/>}</button></div></div>
        {showFilters && <div className="filters-row"><label>Status<select value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option value="all">Alle Status</option>{Object.entries(statusLabels).map(([key,value]) => <option key={key} value={key}>{value}</option>)}</select></label><label>Priorität<select value={priorityFilter} onChange={event => setPriorityFilter(event.target.value)}><option value="all">Alle Prioritäten</option>{Object.entries(priorityLabels).map(([key,value]) => <option key={key} value={key}>{value}</option>)}</select></label>{page !== 'done' && <label className="completed-filter"><input type="checkbox" checked={showCompleted} onChange={event => setShowCompleted(event.target.checked)}/>Erledigte zeigen</label>}{activeFilters && <button className="text-button" onClick={() => { setStatusFilter('all'); setPriorityFilter('all'); setShowCompleted(true); }}>Zurücksetzen</button>}</div>}
        {initialEmpty ? <WelcomeEmpty onAdd={() => newTask()} onDemo={() => void loadDemo()} demoBusy={demoBusy}/> : !visibleTasks.length && view !== 'calendar' && view !== 'board' ? <div className="empty-results"><div className="empty-result-icon">{page === 'done' ? <CheckCheck size={29}/> : search || activeFilters ? <Search size={28}/> : <Check size={28}/>}</div><h2>{search || activeFilters ? 'Hier ist gerade nichts zu finden.' : page === 'done' ? 'Dein erster Haken wartet schon.' : page === 'today' ? 'Heute ist noch Platz.' : 'Platz für deinen nächsten Schritt.'}</h2><p>{search || activeFilters ? 'Versuche einen anderen Suchbegriff oder passe deine Filter an.' : page === 'done' ? 'Sobald du eine Aufgabe erledigst, findest du sie hier.' : page === 'today' ? 'Gib deinem Tag einen Fokus und plane deine erste Aufgabe.' : 'Halte fest, was du erledigen möchtest.'}</p>{search || activeFilters ? <button className="button secondary" onClick={() => { setSearch(''); setStatusFilter('all'); setPriorityFilter('all'); setShowCompleted(true); }}>Suche & Filter zurücksetzen</button> : page !== 'done' && <button className="button secondary" onClick={() => newTask()}><Plus size={16}/>Aufgabe anlegen</button>}</div> : view === 'list' ? <TaskList tasks={visibleTasks} allTasks={state.tasks} topics={state.topics} today={page === 'today' && !search} onOpen={openTask} onToggle={task => void mutateTask(task.id,{status:task.status === 'done' ? 'todo' : 'done'})} busyId={busyId}/> : view === 'board' ? <BoardView tasks={visibleTasks} allTasks={state.tasks} topics={state.topics} onOpen={openTask} onMove={(id,status) => void mutateTask(id,{status})} onAdd={status => newTask({status})}/> : <CalendarView tasks={visibleTasks} topics={state.topics} onOpen={openTask} onAdd={date => newTask({dueDate:date})} onList={() => setView('list')}/>}
        {!initialEmpty && visibleTasks.length > 0 && view === 'list' && <button className="list-add-task" onClick={() => newTask()}><Plus size={16}/>Aufgabe hinzufügen<span>N</span></button>}
        <div className="workspace-footnote"><span>Alles Wichtige hat seinen Platz.</span><button onClick={() => setShortcuts(true)}><Command size={12}/>Tastenkürzel</button></div>
      </main>
      <Agenda state={state} onOpen={openTask} onSettings={() => setSettings(true)} onAdd={() => newTask({dueDate:today})}/></div>
    </div>
    {drawer && <TaskDrawer key={drawer.key} request={drawer} state={state} onClose={closeDrawer} onDirty={setDrawerDirty} onSaved={() => { setDrawer(null); setDrawerDirty(false); void refresh().catch(cause => notify(cause.message,'error')); notify(drawer.task ? 'Änderungen gespeichert.' : 'Aufgabe angelegt. Ein Gedanke weniger im Kopf.'); }} onDeleted={() => { setDrawer(null); setDrawerDirty(false); void refresh().catch(cause => notify(cause.message,'error')); notify('Aufgabe gelöscht.'); }}/>}
    {settings && <SettingsDialog state={state} theme={theme} onTheme={toggleTheme} onClose={() => setSettings(false)} onRefresh={refresh} onLogout={() => void logout()} onImport={openImport}/>}
    {importOpen && <ImportDialog state={state} onClose={()=>setImportOpen(false)} onCalendarSettings={()=>{setImportOpen(false);setSettings(true);}} onImported={async(count,skipped)=>{setImportOpen(false);navigate('all');try{await refresh();notify(`${count} ${count===1?'Aufgabe übernommen':'Aufgaben übernommen'}.${skipped?` ${skipped} bereits vorhandene übersprungen.`:''}`);}catch(cause){notify(`Import gespeichert. ${cause instanceof Error?cause.message:'Bitte lade den Workspace erneut.'}`,'error');}}}/>}
    {voice && <VoiceDialog enhanced={state.voice.enhanced} onClose={() => setVoice(false)} onWrite={() => { setVoice(false); newTask(); }} onResult={result => { setVoice(false); setDrawerDirty(false); setDrawer({initial:{...result.suggested,dueDate:result.suggested.dueDate || (page === 'today' ? today : null)},voice:result,key:++drawerKey.current}); }}/>} 
    {topicDialog && <TopicDialog topic={topicDialog === 'new' ? undefined : topicDialog} onClose={() => setTopicDialog(null)} onSaved={async (deleted) => { if (deleted && topic && topicDialog !== 'new' && topicDialog.id === topic.id) navigate('inbox'); setTopicDialog(null); await refresh(); notify(deleted ? 'Thema gelöscht. Die Aufgaben bleiben im Eingang.' : 'Thema gespeichert.'); }}/>} 
    {shortcuts && <Overlay title="Kleine Helfer für deinen Fokus" onClose={() => setShortcuts(false)} className="shortcuts-dialog"><div className="shortcuts-content"><p>Ein paar Tasten. Ein bisschen weniger Klicken.</p><dl><div><dt>Neue Aufgabe</dt><dd><kbd>N</kbd></dd></div><div><dt>Aufgaben durchsuchen</dt><dd><kbd>/</kbd></dd></div><div><dt>Aufgabe speichern</dt><dd><kbd>Strg / ⌘</kbd><kbd>Enter</kbd></dd></div><div><dt>Ansicht schließen</dt><dd><kbd>Esc</kbd></dd></div><div><dt>Diese Hilfe öffnen</dt><dd><kbd>?</kbd></dd></div></dl><div className="shortcut-tip"><AudioLines size={19}/><p>Du kannst Aufgaben auch diktieren. Klicke dafür auf das Mikrofon in der Eingabezeile. Vor dem Speichern kannst du alles prüfen.</p></div></div></Overlay>}
    {toast && <div className={`toast ${toast.type}`} role={toast.type === 'error' ? 'alert' : 'status'}>{toast.type === 'success' ? <Check size={17}/> : <CircleHelp size={17}/>}<span>{toast.text}</span><button className="icon-button" aria-label="Hinweis schließen" onClick={() => setToast(null)}><X size={15}/></button></div>}
  </div>;
}

function WelcomeEmpty({onAdd,onDemo,demoBusy}:{onAdd:()=>void; onDemo:()=>void; demoBusy:boolean}) {
  return <section className="welcome-empty"><div className="welcome-symbol" aria-hidden="true"><div className="welcome-symbol-back"/><div className="welcome-symbol-front"><Check size={35}/></div><span className="welcome-spark"><Plus size={13}/></span></div><h2>Ein klarer Kopf.<br/><span>Ein guter Anfang.</span></h2><p>Dein Platz für große Projekte und kleine Erledigungen.<br/>Halte den ersten Gedanken fest. Der Rest wird leichter.</p><div className="welcome-actions"><button className="button primary" onClick={onAdd}><Plus size={17}/>Erste Aufgabe anlegen</button><button className="text-button" onClick={onDemo} disabled={demoBusy}>{demoBusy ? <Spinner/> : <Sparkles size={15}/>}Mit Beispielen starten<ArrowRight size={14}/></button></div><div className="welcome-features"><span><Mic size={17}/>Schreiben oder sprechen</span><span><Folder size={17}/>In Themen ordnen</span><span><CalendarCheck2 size={17}/>Mit Google verbinden</span></div></section>;
}

function Agenda({state,onOpen,onSettings,onAdd}:{state:AppState; onOpen:(task:Task)=>void; onSettings:()=>void; onAdd:()=>void}) {
  const tasks = state.tasks.filter(task => !task.parentId && task.dueDate === localDate() && task.status !== 'done').sort((a,b) => (a.time || '99').localeCompare(b.time || '99')).slice(0,5);
  const upcoming = state.tasks.filter(task => !task.parentId && task.dueDate && task.dueDate > localDate() && task.status !== 'done').sort((a,b) => a.dueDate!.localeCompare(b.dueDate!) || (a.time || '99').localeCompare(b.time || '99')).slice(0,2);
  return <aside className="agenda-rail" aria-label="Tagesplan"><div className="agenda-date"><span>{new Date().toLocaleDateString('de-DE',{month:'long',year:'numeric'})}</span><div><strong>{new Date().getDate()}</strong><span>{new Date().toLocaleDateString('de-DE',{weekday:'long'})}<i>Ein neuer Tag. Dein nächster Schritt.</i></span></div></div><section className="agenda-section"><header><h2>Dein Tagesplan</h2><button className="icon-button" aria-label="Aufgabe für heute anlegen" onClick={onAdd}><Plus size={16}/></button></header>{tasks.length ? <div className="agenda-items">{tasks.map(task => <button key={task.id} className="agenda-item" onClick={() => onOpen(task)}><time>{task.time || 'Flexibel'}</time><i/><span>{task.title}<small>{state.topics.find(topic => topic.id === task.topicId)?.name || 'Ohne Thema'}</small></span></button>)}</div> : <div className="agenda-empty"><Clock3 size={23}/><p>Ein bisschen Freiraum.</p><span>Noch nichts für heute geplant.</span><button className="text-button" onClick={onAdd}>Deinen Tag planen<ArrowRight size={13}/></button></div>}</section>{upcoming.length > 0 && <section className="agenda-upcoming"><h2>Danach steht an</h2>{upcoming.map(task => <button key={task.id} onClick={() => onOpen(task)}><span>{dateLabel(task.dueDate)}</span><strong>{task.title}</strong></button>)}</section>}<section className="calendar-connect-card"><div className="connect-card-icon"><CalendarCheck2 size={21}/>{state.calendar.connected && <span/>}</div><h2>{state.calendar.connected ? 'Alles in Verbindung.' : 'Ein Kalender. Alles im Blick.'}</h2><p>{state.calendar.connected ? 'Deine ausgewählten Aufgaben finden ihren Platz in Google Kalender.' : 'Bring deine Aufgaben dorthin, wo du deinen Tag planst.'}</p><button onClick={onSettings}>{state.calendar.connected ? 'Verbindung verwalten' : 'Google Kalender verbinden'}<ArrowRight size={14}/></button></section><div className="agenda-bottom"><span className="mini-brand"><Check size={13}/></span><p>Mach Platz für das,<br/>was wirklich zählt.</p></div></aside>;
}

function TopicDialog({topic,onClose,onSaved}:{topic?:Topic; onClose:()=>void; onSaved:(deleted?:boolean)=>Promise<void>}) {
  const [name,setName] = useState(topic?.name || ''); const [color,setColor] = useState(topic?.color || topicColors[0]); const [busy,setBusy] = useState(false); const [error,setError] = useState('');
  const dirty = name !== (topic?.name || '') || color !== (topic?.color || topicColors[0]);
  function close() { if (busy || (dirty && !window.confirm('Ungespeicherte Änderungen am Thema verwerfen?'))) return; onClose(); }
  async function save(event:FormEvent) { event.preventDefault(); setBusy(true); setError(''); try { await api(topic ? `/topics/${topic.id}` : '/topics',topic ? 'PATCH':'POST',{name:name.trim(),color}); await onSaved(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Das Thema konnte nicht gespeichert werden.'); setBusy(false); } }
  async function remove() { if (!topic || !window.confirm(`„${topic.name}“ löschen? Die Aufgaben bleiben erhalten und erscheinen im Eingang.`)) return; setBusy(true); try { await api(`/topics/${topic.id}`,'DELETE'); await onSaved(true); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Das Thema konnte nicht gelöscht werden.'); setBusy(false); } }
  return <Overlay title={topic ? 'Thema bearbeiten' : 'Ein neues Thema'} onClose={close} className="topic-dialog"><form onSubmit={save}><div className="topic-dialog-body"><p>Gib Kunden, Projekten und Ideen einen gemeinsamen Platz.</p><label className="field-label"><span>Name</span><input data-autofocus placeholder="z. B. Kunde Müller" value={name} maxLength={100} required onChange={event => setName(event.target.value)}/></label><fieldset className="color-fieldset"><legend>Farbe</legend><div>{topicColors.map((value,index) => <button type="button" className={`color-swatch ${color === value ? 'selected' : ''}`} style={{background:value}} key={value} aria-label={`Farbe ${['Salbei','Blau','Lavendel','Pfirsich','Sand','Mint','Rosé','Grau'][index]}`} aria-pressed={color === value} onClick={() => setColor(value)}>{color === value && <Check size={16}/>}</button>)}</div></fieldset>{error && <p className="inline-error" role="alert">{error}</p>}</div><footer className="dialog-footer">{topic && <button type="button" className="icon-button danger" aria-label="Thema löschen" onClick={remove} disabled={busy}><Trash2 size={17}/></button>}<button type="button" className="button secondary" onClick={close} disabled={busy}>Abbrechen</button><button className="button primary" type="submit" disabled={busy || !name.trim()}>{busy ? <Spinner/> : <Check size={16}/>}Speichern</button></footer></form></Overlay>;
}

function LoginScreen({onLogin,theme,onTheme}:{onLogin:()=>Promise<void>; theme:string; onTheme:()=>void}) {
  const [password,setPassword] = useState(''); const [busy,setBusy] = useState(false); const [error,setError] = useState('');
  async function login(event:FormEvent) { event.preventDefault(); setBusy(true); setError(''); try { await api('/auth/login','POST',{password}); await onLogin(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Die Anmeldung ist fehlgeschlagen.'); } finally { setBusy(false); } }
  return <main className="login-screen"><button className="icon-button login-theme" aria-label="Design wechseln" onClick={onTheme}>{theme === 'dark' ? <Sun size={20}/> : <Moon size={20}/>}</button><div className="login-content"><div className="brand"><span className="brand-symbol"><Check size={24}/></span><span>Fokus<span className="brand-dot">.</span></span></div><h1>Willkommen zurück, Mario.</h1><p>Dein Kopf darf hier ein bisschen leichter werden.</p><form onSubmit={login}><label className="field-label"><span>Workspace-Passwort</span><input type="password" autoComplete="current-password" autoFocus required value={password} onChange={event => setPassword(event.target.value)} placeholder="Dein Passwort"/></label>{error && <p className="inline-error" role="alert">{error}</p>}<button className="button primary" disabled={busy}>{busy ? <Spinner/> : <LogIn size={17}/>}Workspace öffnen<ArrowRight size={16}/></button></form><div className="login-footnote"><span className="tiny-dot"/>Dein persönlicher Raum für das Wesentliche.</div><a className="privacy-link" href="/privacy.html" target="_blank" rel="noreferrer">Datenschutz<ArrowRight size={11}/></a></div></main>;
}

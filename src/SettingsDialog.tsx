import { useEffect, useState } from 'react';
import { ArrowDownToLine, ArrowUpRight, CalendarCheck2, Check, CloudOff, ExternalLink, FolderInput, LogOut, Moon, RefreshCw, ShieldCheck, Sun, Unplug } from 'lucide-react';
import type { AppState, CalendarOption } from '../shared/types';
import { api } from './api';
import { Overlay, Spinner } from './ui';

export function SettingsDialog({state, theme, onTheme, onClose, onRefresh, onLogout,onImport}:{state:AppState; theme:string; onTheme:()=>void; onClose:()=>void; onRefresh:()=>Promise<void>; onLogout:()=>void;onImport:()=>void}) {
  const [tab, setTab] = useState('calendar');
  const [calendars, setCalendars] = useState<CalendarOption[]>([]);
  const [calendarId, setCalendarId] = useState(state.calendar.calendarId);
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(state.calendar.connected);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!state.calendar.connected) { setLoading(false); return; }
    let active = true; setLoading(true);
    api<CalendarOption[]>('/calendar/calendars').then(options => { if (active) setCalendars(options); }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Die Kalender konnten nicht geladen werden.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [state.calendar.connected, retry]);
  async function action(name:string, fn:()=>Promise<unknown>, success:string) {
    setBusy(name); setError(''); setMessage('');
    try { await fn(); await onRefresh(); setMessage(success); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Die Aktion konnte nicht abgeschlossen werden.'); } finally { setBusy(''); }
  }
  const calendar = state.calendar;
  return <Overlay title="Dein Workspace" onClose={() => { if (!busy) onClose(); }} className="settings-dialog">
    <div className="settings-tabs" role="tablist" aria-label="Einstellungen"><button role="tab" aria-selected={tab === 'calendar'} onClick={() => setTab('calendar')}>Google Kalender</button><button role="tab" aria-selected={tab === 'workspace'} onClick={() => setTab('workspace')}>Allgemein</button></div>
    <div className="settings-content" role="tabpanel">
      {tab === 'calendar' ? <>
        <div className="settings-intro"><div className="integration-icon"><CalendarCheck2 size={26}/></div><div><h3>Deine Aufgaben. In deinem Kalender.</h3><p>Ausgewählte Aufgaben werden als Google-Termine angelegt und bei Änderungen aktualisiert.</p></div></div>
        <div className={`connection-status ${calendar.connected ? 'connected' : ''}`}><span className="status-dot"/>{calendar.connected ? `Verbunden${calendar.email ? ` mit ${calendar.email}` : ''}` : calendar.configured ? 'Bereit zum Verbinden' : 'Noch nicht eingerichtet'}</div>
        {calendar.connected ? <>
          <label className="field-label"><span>Zielkalender</span><div className="calendar-select">{loading ? <p className="loading-inline"><Spinner/>Kalender werden geladen …</p> : <select value={calendarId} onChange={event => setCalendarId(event.target.value)} disabled={!!busy} aria-label="Google Zielkalender"><option value="" disabled>Kalender auswählen</option>{!calendars.some(item => item.id === calendarId) && calendarId && <option value={calendarId}>{calendarId}</option>}{calendars.map(item => <option value={item.id} key={item.id}>{item.summary}{item.primary ? ' (Hauptkalender)' : ''}</option>)}</select>}<button className="icon-button" aria-label="Kalender neu laden" onClick={() => { setError(''); setRetry(value => value + 1); }} disabled={loading || !!busy}><RefreshCw size={16}/></button></div></label>
          {calendarId !== calendar.calendarId && <button className="button primary compact" disabled={!!busy} onClick={() => void action('calendar',() => api('/calendar','PATCH',{calendarId}), 'Zielkalender gespeichert.')}>{busy === 'calendar' ? <Spinner/> : <Check size={15}/>}Kalender speichern</button>}
          <div className="settings-row"><div><strong>Synchronisierung</strong><p>{calendar.lastSyncedAt ? `Zuletzt ${new Date(calendar.lastSyncedAt).toLocaleString('de-DE',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}` : 'Noch keine Synchronisierung abgeschlossen.'}</p></div><button className="button secondary compact" disabled={!!busy} onClick={() => void action('sync',() => api('/calendar/sync','POST'),'Synchronisierung angestoßen.')}>{busy === 'sync' ? <Spinner/> : <RefreshCw size={15}/>}Jetzt synchronisieren</button></div>
          {calendar.error && <p className="inline-error">{calendar.error}</p>}
          <div className="sync-explainer"><ShieldCheck size={17}/><p>Neue Aufgaben sind standardmäßig für den Kalender aktiviert. Du kannst die Synchronisierung für jede Aufgabe ausschalten. Eine Aufgabe benötigt ein Datum; ohne Uhrzeit wird sie ganztägig angezeigt.</p></div>
          <button className="text-button danger" disabled={!!busy} onClick={() => { if (window.confirm('Google Kalender trennen? Bereits angelegte Termine bleiben im Kalender.')) void action('disconnect',() => api('/calendar','DELETE'),'Google Kalender getrennt.'); }}><Unplug size={15}/>Google Kalender trennen</button>
        </> : calendar.configured ? <>
          <p className="settings-body-copy">Verbinde Marios Google-Konto und wähle anschließend einen Kalender. Fokus fragt nur die für die Verbindung nötigen Berechtigungen an.</p>
          <a className="button primary connect-google" href="/api/calendar/connect"><GoogleIcon/>Mit Google verbinden<ArrowUpRight size={16}/></a>
          <p className="muted small">Die Verbindung öffnet die sichere Anmeldung bei Google.</p>
        </> : <>
          <p className="settings-body-copy">Für die Verbindung braucht diese Installation eigene Google-OAuth-Zugangsdaten. Sobald sie hinterlegt sind, kannst du deinen Kalender hier verbinden.</p>
          <ol className="setup-steps"><li><span>1</span><p>OAuth-Webanwendung in der Google Cloud Console anlegen und die Calendar API aktivieren.</p></li><li><span>2</span><p><code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code>, <code>APP_URL</code> und <code>APP_SECRET</code> auf dem Server hinterlegen.</p></li><li><span>3</span><p>Die Weiterleitungsadresse <code>/api/calendar/callback</code> zur öffentlichen App-URL hinzufügen.</p></li></ol>
          <a className="button secondary compact" href="https://github.com/bthginfo/Task-tracker#google-kalender-einrichten" target="_blank" rel="noreferrer">Einrichtungsanleitung<ExternalLink size={14}/></a>
        </>}
        <div className="direction-note"><CloudOff size={16}/><p>Fokus → Google Kalender. Änderungen an Aufgaben steuerst du in Fokus; Änderungen an Terminen in Google werden nicht zurückübernommen.</p></div>
      </> : <>
        <h3 className="settings-section-heading">So, wie du am liebsten arbeitest.</h3>
        <div className="settings-row"><div><strong>Erscheinungsbild</strong><p>{theme === 'dark' ? 'Dunkel, ruhig und fokussiert.' : 'Hell, klar und aufgeräumt.'}</p></div><button className="button secondary compact" onClick={onTheme}>{theme === 'dark' ? <Sun size={16}/> : <Moon size={16}/>}Zu {theme === 'dark' ? 'Hell' : 'Dunkel'} wechseln</button></div>
        <div className="settings-row"><div><strong>Deine Daten</strong><p>Alle Aufgaben und Themen als JSON exportieren.</p></div><a href="/api/export" className="button secondary compact" download><ArrowDownToLine size={16}/>Exportieren</a></div>
        <div className="settings-row"><div><strong>Aufgaben mitbringen</strong><p>Excel, CSV, Kalenderexporte oder bestehende Google-Termine prüfen und übernehmen.</p></div><button className="button secondary compact" onClick={onImport}><FolderInput size={16}/>Importieren</button></div>
        <div className="settings-row"><div><strong>Spracherfassung</strong><p>{state.voice.enhanced ? 'Erweiterte Transkription über den eingerichteten OpenAI-Zugang.' : 'Spracherkennung über deinen Browser, ohne kostenpflichtige API. Erweiterte OpenAI-Transkription ist optional und kann Kosten verursachen.'}</p></div><span className="subtle-badge">{state.voice.enhanced ? 'Erweitert' : 'Browser'}</span></div>
        <div className="settings-row"><div><strong>Workspace-Zugang</strong><p>{state.auth.protected ? 'Dein Workspace ist mit einem Passwort geschützt.' : 'Für diese Installation ist kein Passwort eingerichtet. Der Betreiber kann APP_PASSWORD hinterlegen.'}</p></div>{state.auth.protected && <button className="button secondary compact" onClick={onLogout}><LogOut size={15}/>Abmelden</button>}</div>
        <div className="settings-about"><div className="brand-symbol small"><Check size={17}/></div><span>Fokus</span><p>Weniger im Kopf. Mehr im Moment.</p></div><a className="privacy-link" href="/privacy.html" target="_blank" rel="noreferrer">Datenschutz<ArrowUpRight size={12}/></a>
      </>}
      {error && <p className="inline-error" role="alert">{error}</p>}{message && <p className="inline-success" role="status"><Check size={15}/>{message}</p>}
    </div>
  </Overlay>;
}

function GoogleIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-1.99 3.02v2.51h3.23c1.89-1.74 2.98-4.3 2.98-7.36ZM12 22c2.7 0 4.96-.9 6.62-2.41l-3.23-2.51c-.89.6-2.03.96-3.39.96-2.61 0-4.83-1.76-5.62-4.12H3.04v2.59A10 10 0 0 0 12 22ZM6.38 13.92a6 6 0 0 1 0-3.84V7.49H3.04a10 10 0 0 0 0 9.02l3.34-2.59ZM12 5.96c1.47 0 2.79.51 3.83 1.51l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.96 5.49l3.34 2.59C7.17 7.72 9.39 5.96 12 5.96Z"/></svg>; }

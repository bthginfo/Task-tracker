import { useState } from 'react';
import { ArrowRight, AudioLines, Mic, RotateCcw, Square, Type } from 'lucide-react';
import type { VoiceResult } from '../shared/types';
import { Overlay, Spinner } from './ui';
import { useVoiceCapture } from './useVoiceCapture';

export function VoiceDialog({enhanced, onClose, onResult, onWrite}:{enhanced:boolean; onClose:()=>void; onResult:(result:VoiceResult)=>void; onWrite:()=>void}) {
  const voice = useVoiceCapture(enhanced,onResult);
  const [consent, setConsent] = useState(false);
  function close() { voice.cancel(); onClose(); }
  return <Overlay title="Ein Gedanke wird eine Aufgabe" onClose={close} className="voice-dialog">
    <div className="voice-content">
      <div className={`voice-orb ${voice.phase === 'recording' ? 'listening' : ''}`}><AudioLines size={36}/></div>
      <h3>{voice.phase === 'recording' ? 'Ich höre dir zu.' : voice.phase === 'processing' ? 'Deine Aufgabe nimmt Form an.' : voice.phase === 'captured' ? 'Dein Gedanke ist festgehalten.' : 'Sag einfach, was ansteht.'}</h3>
      <p className="voice-description">„Morgen um zehn das Angebot für Müller vorbereiten.“<br/>Füllwörter werden bereinigt, Datum und Uhrzeit erkannt.</p>
      {(voice.phase === 'recording' || voice.phase === 'captured') && <div className="transcript-preview" aria-live="polite">{voice.transcript || (enhanced ? 'Deine Aufnahme wird nach dem Stoppen transkribiert.' : 'Deine gesprochenen Worte erscheinen hier …')}</div>}
      {voice.phase === 'recording' && <p className="recording-time"><span/>Aufnahme · {Math.floor(voice.seconds / 60)}:{String(voice.seconds % 60).padStart(2,'0')} <span className="muted">/ 1:30</span></p>}
      {voice.error && <p className="inline-error" role="alert">{voice.error}</p>}
      {(voice.phase === 'ready' || voice.phase === 'error') && <label className="consent-check"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)}/><span>{enhanced ? 'Audio wird zur Transkription an OpenAI übertragen. Ich bin damit einverstanden.' : 'Der Sprachdienst meines Browsers kann Audio verarbeiten. Ich bin damit einverstanden.'}</span></label>}
      <div className="voice-actions">
        {voice.phase === 'ready' && <button className="button primary" disabled={!consent || !voice.supported} onClick={() => void voice.start()}><Mic size={17}/>Diktat starten</button>}
        {voice.phase === 'recording' && <button className="button primary" onClick={voice.stop}><Square size={15} fill="currentColor"/>Stoppen & prüfen</button>}
        {voice.phase === 'captured' && <><button className="button secondary" onClick={() => void voice.start()}><RotateCcw size={15}/>Neu aufnehmen</button><button className="button primary" onClick={voice.stop}>Diktat auswerten<ArrowRight size={16}/></button></>}
        {voice.phase === 'processing' && <span className="processing-label"><Spinner/>Diktat wird verarbeitet …</span>}
        {voice.phase === 'error' && voice.supported && <button className="button primary" disabled={!consent} onClick={() => void voice.start()}><RotateCcw size={16}/>Erneut versuchen</button>}
      </div>
      {!voice.supported && <p className="muted">Diktieren ist in diesem Browser nicht verfügbar. Verwende Chrome oder Edge oder erfasse deine Aufgabe schriftlich.</p>}
      <button className="text-button write-instead" onClick={() => { voice.cancel(); onWrite(); }}><Type size={16}/>Lieber schreiben</button>
      <p className="voice-footnote">{enhanced ? 'Erweiterte Transkription über den eingerichteten OpenAI-Zugang.' : 'Browser-Diktat ohne kostenpflichtige API.'}<br/>Maximal 90 Sekunden. Du prüfst und speicherst die Aufgabe selbst.</p>
    </div>
  </Overlay>;
}

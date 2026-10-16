import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import type { VoiceResult } from '../shared/types';

type RecognitionEvent = { results: {length:number; [index:number]: {isFinal:boolean; [index:number]: {transcript:string}}} };
type Recognition = { lang:string; continuous:boolean; interimResults:boolean; onresult:((event:RecognitionEvent)=>void)|null; onerror:((event:{error:string})=>void)|null; onend:(()=>void)|null; start:()=>void; stop:()=>void; abort:()=>void };
type RecognitionClass = new()=>Recognition;
type Phase = 'ready' | 'recording' | 'captured' | 'processing' | 'error';

export function useVoiceCapture(enhanced: boolean, onResult: (result: VoiceResult) => void) {
  const [phase, setPhase] = useState<Phase>('ready');
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState('');
  const [seconds, setSeconds] = useState(0);
  const recognition = useRef<Recognition | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const blob = useRef<Blob | null>(null);
  const text = useRef('');
  const cancelled = useRef(false);
  const requested = useRef(false);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const limit = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const session = useRef(0);
  const callback = useRef(onResult); callback.current = onResult;
  const Ctor = typeof window !== 'undefined' ? ((window as unknown as { SpeechRecognition?:RecognitionClass; webkitSpeechRecognition?:RecognitionClass }).SpeechRecognition || (window as unknown as { webkitSpeechRecognition?:RecognitionClass }).webkitSpeechRecognition) : undefined;
  const supported = enhanced ? typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia : !!Ctor;

  function stopTimers() { clearInterval(timer.current); clearTimeout(limit.current); }
  function stopTracks() { stream.current?.getTracks().forEach(track => track.stop()); stream.current = null; }
  function cleanup() {
    stopTimers();
    if (recognition.current) { recognition.current.onend = null; recognition.current.onresult = null; recognition.current.onerror = null; try { recognition.current.abort(); } catch { /* already ended */ } recognition.current = null; }
    if (recorder.current) { recorder.current.onstop = null; recorder.current.ondataavailable = null; if (recorder.current.state !== 'inactive') recorder.current.stop(); recorder.current = null; }
    stopTracks();
  }
  useEffect(() => () => { cancelled.current = true; session.current++; cleanup(); }, []);

  async function process(value?: Blob) {
    stopTimers(); const current = session.current;
    if (cancelled.current) return;
    if (!value && !text.current.trim()) { setError('Es wurde keine Sprache erkannt. Versuche es erneut oder schreibe deine Aufgabe.'); setPhase('error'); return; }
    setPhase('processing');
    try {
      let result: VoiceResult;
      if (value) { const form = new FormData(); form.append('audio', value, value.type.includes('mp4') ? 'aufnahme.mp4' : 'aufnahme.webm'); result = await api<VoiceResult>('/voice/transcribe', 'POST', form); }
      else result = await api<VoiceResult>('/voice/parse', 'POST', {text: text.current});
      if (!cancelled.current && current === session.current) callback.current(result);
    } catch (cause) { if (current === session.current && !cancelled.current) { setError(cause instanceof Error ? cause.message : 'Das Diktat konnte nicht verarbeitet werden.'); setPhase('error'); } }
  }

  function endCapture(send = true) {
    stopTimers(); requested.current = send;
    if (send) setPhase('processing');
    if (recorder.current && recorder.current.state !== 'inactive') recorder.current.stop();
    else if (recognition.current) { const current = recognition.current; recognition.current = null; try { current.stop(); } catch { if (send) void process(); else setPhase('captured'); } }
    else if (send) void process(blob.current || undefined);
    else { stopTracks(); setPhase('captured'); }
  }

  async function start() {
    cleanup(); cancelled.current = false; requested.current = false; const current = ++session.current;
    blob.current = null; text.current = ''; setTranscript(''); setError(''); setSeconds(0);
    if (!supported) { setError('Dein Browser unterstützt das Diktieren hier nicht. Nutze Chrome oder Edge oder schreibe deine Aufgabe.'); setPhase('error'); return; }
    try {
      if (enhanced) {
        const mediaStream = await navigator.mediaDevices.getUserMedia({audio: true});
        if (cancelled.current || current !== session.current) { mediaStream.getTracks().forEach(track => track.stop()); return; }
        stream.current = mediaStream;
        const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(type => MediaRecorder.isTypeSupported(type));
        const mediaRecorder = new MediaRecorder(mediaStream, mimeType ? {mimeType} : undefined); recorder.current = mediaRecorder;
        const chunks: BlobPart[] = [];
        mediaRecorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
        mediaRecorder.onerror = () => { stopTracks(); stopTimers(); setError('Die Aufnahme wurde unterbrochen. Bitte versuche es erneut.'); setPhase('error'); };
        mediaRecorder.onstop = () => { stopTracks(); stopTimers(); if (current !== session.current || cancelled.current) return; const audio = new Blob(chunks, {type: mediaRecorder.mimeType}); blob.current = audio; recorder.current = null; if (requested.current) void process(audio); else setPhase('captured'); };
        mediaRecorder.start();
      } else {
        const rec = new Ctor!(); recognition.current = rec; rec.lang = 'de-DE'; rec.continuous = true; rec.interimResults = true;
        rec.onresult = event => { let result = ''; for (let i = 0; i < event.results.length; i++) result += `${event.results[i][0].transcript} `; text.current = result.trim(); setTranscript(text.current); };
        rec.onerror = event => { stopTimers(); recognition.current = null; if (cancelled.current || current !== session.current || event.error === 'aborted') return; const errors:Record<string,string> = {'not-allowed':'Der Mikrofonzugriff wurde abgelehnt. Erlaube ihn in den Browser-Einstellungen oder schreibe deine Aufgabe.', 'audio-capture':'Es wurde kein Mikrofon gefunden. Prüfe dein Mikrofon oder schreibe deine Aufgabe.', 'no-speech':'Es wurde keine Sprache erkannt. Versuche es erneut oder schreibe deine Aufgabe.', 'network':'Der Sprachdienst ist gerade nicht erreichbar. Prüfe deine Verbindung oder schreibe deine Aufgabe.'}; setError(errors[event.error] || 'Das Diktieren wurde unterbrochen. Versuche es erneut.'); setPhase('error'); };
        rec.onend = () => { recognition.current = null; stopTimers(); if (cancelled.current || current !== session.current) return; if (requested.current) void process(); else setPhase(previous => previous === 'error' ? previous : 'captured'); };
        rec.start();
      }
      setPhase('recording'); timer.current = setInterval(() => setSeconds(value => value + 1), 1000); limit.current = setTimeout(() => endCapture(false), 90000);
    } catch (cause) { stopTracks(); const denied = cause instanceof DOMException && cause.name === 'NotAllowedError'; setError(denied ? 'Der Mikrofonzugriff wurde abgelehnt. Erlaube ihn im Browser oder schreibe deine Aufgabe.' : 'Die Aufnahme konnte nicht starten. Prüfe dein Mikrofon und versuche es erneut.'); setPhase('error'); }
  }

  function cancel() { cancelled.current = true; session.current++; cleanup(); setPhase('ready'); setTranscript(''); setError(''); }
  return {phase, transcript, error, seconds, supported, start, stop: () => endCapture(true), cancel};
}

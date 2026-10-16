import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mobileSpeechService, speechTranscript, type RecognitionResults } from '../src/speechTranscript.ts';

const results = (...parts: Array<string | [string, boolean]>): RecognitionResults => parts.map(part => {
  const [transcript, isFinal] = typeof part === 'string' ? [part, true] : part;
  return { isFinal, 0: { transcript } };
});

test('mobile cumulative hypotheses at new indices do not duplicate the task', () => {
  assert.equal(speechTranscript(results('Morgen', 'Morgen um zehn', 'Morgen um zehn das Angebot', 'Morgen um zehn das Angebot vorbereiten')), 'Morgen um zehn das Angebot vorbereiten');
});

test('replayed final results and overlapping phrase boundaries are merged', () => {
  assert.equal(speechTranscript(results('Kunde Müller anrufen', 'Kunde Müller anrufen')), 'Kunde Müller anrufen');
  assert.equal(speechTranscript(results('Morgen den Kunden anrufen', 'Kunden anrufen und Angebot besprechen')), 'Morgen den Kunden anrufen und Angebot besprechen');
});

test('a full session snapshot replaces interim corrections and removals', () => {
  assert.equal(speechTranscript(results('Morgen anrufen.', ['Das alte Angebot', false])), 'Morgen anrufen. Das alte Angebot');
  assert.equal(speechTranscript(results('Morgen anrufen.', ['Den neuen Vertrag prüfen', false])), 'Morgen anrufen. Den neuen Vertrag prüfen');
  assert.equal(speechTranscript(results('Morgen anrufen.')), 'Morgen anrufen.');
});

test('final and overlapping interim text is not counted twice', () => {
  assert.equal(speechTranscript(results('Das Angebot vorbereiten', ['das Angebot vorbereiten und senden', false])), 'Das Angebot vorbereiten und senden');
});

test('meaningful repetitions within speech and independent phrases survive', () => {
  assert.equal(speechTranscript(results('Das ist sehr, sehr wichtig, die die Unterlagen haben, anrufen.')), 'Das ist sehr, sehr wichtig, die die Unterlagen haben, anrufen.');
  assert.equal(speechTranscript(results('Kunden anrufen.', 'Danach Rechnung schreiben.')), 'Kunden anrufen. Danach Rechnung schreiben.');
  assert.equal(speechTranscript(results('Bitte prüfen', 'prüfen lassen')), 'Bitte prüfen prüfen lassen');
});

test('word matching handles accents, punctuation, spacing and whole words', () => {
  assert.equal(speechTranscript(results('Für Müller das Angebot', 'DAS ANGEBOT, versenden')), 'Für Müller das Angebot versenden');
  assert.equal(speechTranscript(results('  Für   Mu\u0308ller  ', 'Müllerstraße prüfen')), 'Für Müller Müllerstraße prüfen');
  assert.equal(speechTranscript(results('', '   ')), '');
});

test('mobile speech settings cover Android, iPhone and desktop-mode iPad only', () => {
  assert.equal(mobileSpeechService({ userAgent: 'Mozilla/5.0 (Linux; Android 16)', platform: 'Linux armv8l', maxTouchPoints: 5 }), true);
  assert.equal(mobileSpeechService({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7)', platform: 'iPhone', maxTouchPoints: 5 }), true);
  assert.equal(mobileSpeechService({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)', platform: 'MacIntel', maxTouchPoints: 5 }), true);
  assert.equal(mobileSpeechService({ userAgent: 'Mozilla/5.0 (Windows NT 10.0)', platform: 'Win32', maxTouchPoints: 10 }), false);
});

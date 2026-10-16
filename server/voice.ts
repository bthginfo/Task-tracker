import type { Priority, Topic, VoiceResult } from '../shared/types.ts';
import { timezone } from './config.ts';

export function localDate(d = new Date()) { return new Intl.DateTimeFormat('sv-SE', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); }
export function cleanDictation(text: string): string {
  const cleaned = text.normalize('NFC').replace(/(?<![\p{L}\p{N}])(?:ähm+|äh+|öhm+|mhm+)(?![\p{L}\p{N}])[,\s]*/giu, '')
    .replace(/^(?:also[,\s]+|okay[,\s]+|ok[,\s]+)+/iu, '')
    .replace(/\s+([,.!?;:])/g, '$1').replace(/\s{2,}/g, ' ').trim();
  return cleaned ? cleaned[0].toLocaleUpperCase('de') + cleaned.slice(1) : '';
}
export function parseDictation(original: string, topics: Topic[] = [], now = new Date()): VoiceResult {
  now = new Date(`${localDate(now)}T12:00:00Z`);
  const text = cleanDictation(original);
  let title = text.replace(/^(?:ich muss|ich möchte|ich sollte|erinnere mich (?:bitte )?(?:daran|an)|neue aufgabe:?|aufgabe erstellen:?)\s+/iu, '').replace(/^bitte\s+/iu, '');
  let dueDate: string | null = null;
  let time: string | null = null;
  let priority: Priority = 'medium';
  let topicId: string | null = null;
  const relative = title.match(/(?<!\p{L})(übermorgen|morgen|heute)(?!\p{L})/iu);
  if (relative) {
    const date = new Date(now); date.setDate(date.getDate() + ({ heute: 0, morgen: 1, übermorgen: 2 }[relative[1].toLocaleLowerCase('de')] ?? 0));
    dueDate = localDate(date); title = title.replace(relative[0], '');
  } else {
    const explicit = title.match(/\b(?:am\s+)?(\d{1,2})\.(\d{1,2})\.(?:(\d{4})\b)?/u);
    const iso = title.match(/\b\d{4}-\d{2}-\d{2}\b/u);
    if (iso && !isNaN(Date.parse(iso[0])) && new Date(iso[0]).toISOString().slice(0, 10) === iso[0]) { dueDate = iso[0]; title = title.replace(iso[0], ''); }
    else if (explicit) {
      const year = explicit[3] ? +explicit[3] : now.getFullYear();
      const d = new Date(year, +explicit[2] - 1, +explicit[1], 12);
      if (d.getMonth() === +explicit[2] - 1 && d.getDate() === +explicit[1]) { dueDate = localDate(d); title = title.replace(explicit[0], ''); }
    } else {
      const days = ['sonntag', 'montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag'];
      const weekday = title.match(/\b(?:(?:am|nächsten|nächste|kommenden)\s+)?(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\b/iu);
      if (weekday) { const d = new Date(now); d.setDate(d.getDate() + ((days.indexOf(weekday[1].toLowerCase()) - d.getDay() + 7) % 7 || 7)); dueDate = localDate(d); title = title.replace(weekday[0], ''); }
    }
  }
  const clock = title.match(/\bum\s+([01]?\d|2[0-3])(?:(?::|\s+Uhr\s+)([0-5]\d))?(?:\s*Uhr)?\b/iu);
  if (clock) { time = `${clock[1].padStart(2, '0')}:${(clock[2] || '00').padStart(2, '0')}`; if (!dueDate) dueDate = localDate(now); title = title.replace(clock[0], ''); }
  const prio = title.match(/\b(?:mit\s+)?(hohe|hoher|niedrige|niedriger)\s+Priorität\b/iu);
  if (prio) { priority = prio[1].toLowerCase().startsWith('ho') ? 'high' : 'low'; title = title.replace(prio[0], ''); }
  for (const topic of [...topics].sort((a, b) => b.name.length - a.name.length)) {
    const escaped = topic.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const matcher = new RegExp(`(?:für|im Thema|Thema|Kunde|Kunden)\\s+${escaped}(?=$|[\\s,.!?])`, 'iu');
    if (matcher.test(title)) { topicId = topic.id; title = title.replace(matcher, ''); break; }
  }
  title = cleanDictation(title.replace(/\s{2,}/g, ' ').replace(/^[,\s]+|[,\s]+$/g, '')) || text;
  return { original, text, suggested: { title, dueDate, time, priority, topicId } };
}

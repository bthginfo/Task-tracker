export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const form = body instanceof FormData;
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method, credentials: 'same-origin',
      headers: body && !form ? { 'Content-Type': 'application/json' } : undefined,
      body: body === undefined ? undefined : form ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Die Verbindung zum Server ist unterbrochen. Deine Eingabe bleibt erhalten. Bitte prüfe deine Verbindung und versuche es erneut.');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, data.error || 'Die Anfrage konnte nicht verarbeitet werden. Bitte versuche es erneut.');
  return data as T;
}

export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function dateFromKey(value: string): Date { const [y,m,d] = value.split('-').map(Number); return new Date(y, m - 1, d); }
export function dateLabel(value: string | null, long = false): string {
  if (!value) return 'Ohne Datum';
  const today = localDate(); const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  if (value === today) return 'Heute';
  if (value === localDate(tomorrow)) return 'Morgen';
  return dateFromKey(value).toLocaleDateString('de-DE', {day: 'numeric', month: long ? 'long' : 'short', ...(dateFromKey(value).getFullYear() !== new Date().getFullYear() ? {year: 'numeric'} : {}) });
}

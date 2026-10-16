import './config.ts';
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { z, ZodError } from 'zod';
import { appUrl, encryptionKey, googleConfigured, password, production } from './config.ts';
import { workspaceMiddleware } from './database.ts';
import { createTask, createTopic, db, deleteTask, deleteTopic, listTasks, listTopics, pruneDeleted, transaction, updateTask, updateTopic } from './store.ts';
import { calendarImport, calendarInfo, calendars, connectGoogle, decrypt, disconnectGoogle, encrypt, oauthUrl, processQueue, queueAll, selectCalendar } from './calendar.ts';
import { commitImport, previewFile } from './imports.ts';
import { localDate, parseDictation } from './voice.ts';
import { createTimeEntry, csvCell, deleteTimeEntry, exportColumns, exportRows, startTimer, stopAllTimers, stopTimer, timeExport, timeState, TimeConflictError, updateTimeEntry } from './time.ts';

const app = express();
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: production ? { directives: {
  defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"],
  imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"], fontSrc: ["'self'"], objectSrc: ["'none'"], frameAncestors: ["'none'"]
} } : false, crossOriginEmbedderPolicy: false, strictTransportSecurity: production ? undefined : false }));
app.use(express.json({ limit: '4mb' }));
app.use(cookieParser());
app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
app.get('/api/health', (_req, res) => { res.json({ ok: true }); });
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if ((origin && origin !== new URL(appUrl).origin) || req.get('sec-fetch-site') === 'cross-site') return res.status(403).json({ error: 'Diese Anfrage stammt von einer anderen Website.' });
  next();
});
const cookieOptions = { httpOnly: true, secure: production, sameSite: 'lax' as const, path: '/' };
function signSession(value: string) { return createHmac('sha256', encryptionKey).update(value + password).digest('base64url'); }
function authenticated(req: express.Request) {
  if (!password) return true;
  const cookie = req.cookies.fokus_session; if (typeof cookie !== 'string') return false;
  const [expires, nonce, signature] = cookie.split('.');
  if (!expires || !nonce || !signature || Number(expires) <= Date.now()) return false;
  const expected = signSession(`${expires}.${nonce}`);
  return signature.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
app.get('/api/auth', (req, res) => res.json({ authenticated: authenticated(req), protected: Boolean(password) }));
app.post('/api/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Zu viele Anmeldeversuche. Bitte in 15 Minuten erneut versuchen.' } }), (req, res) => {
  const input = z.object({ password: z.string().max(1000) }).parse(req.body);
  if (password && !timingSafeEqual(createHash('sha256').update(input.password).digest(), createHash('sha256').update(password).digest())) return res.status(401).json({ error: 'Das Passwort stimmt nicht.' });
  const data = `${Date.now() + 7 * 86400000}.${randomBytes(32).toString('base64url')}`;
  const token = `${data}.${signSession(data)}`;
  res.cookie('fokus_session', token, { ...cookieOptions, maxAge: 7 * 86400000 }); res.json({ ok: true });
});
app.post('/api/auth/logout', (_req, res) => { res.clearCookie('fokus_session', cookieOptions); res.json({ ok: true }); });
app.use('/api', (req, res, next) => { if (!authenticated(req)) return res.status(401).json({ error: 'Bitte melde dich an.' }); next(); });
app.use('/api', rateLimit({ windowMs: 60000, limit: 300, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Zu viele Anfragen. Bitte kurz warten.' } }));
app.use('/api', workspaceMiddleware);
app.use('/api', (req, _res, next) => { if (!['GET','HEAD','OPTIONS'].includes(req.method)) transaction(pruneDeleted); next(); });
app.get('/api/state', async (_req, res) => { await processQueue(); res.json({ tasks: listTasks(), topics: listTopics(), calendar: calendarInfo(), voice: { enhanced: Boolean(process.env.OPENAI_API_KEY) }, auth: { protected: Boolean(password) }, time: timeState() }); });
app.post('/api/time/start', (req,res) => { transaction(() => startTimer(req.body)); res.json(timeState()); });
app.post('/api/time/stop', (req,res) => { transaction(() => stopTimer(req.body)); res.json(timeState()); });
app.post('/api/time/stop-all', (req,res) => { transaction(() => stopAllTimers(req.body)); res.json(timeState()); });
app.post('/api/time/entries', (req,res) => { transaction(() => createTimeEntry(req.body)); res.status(201).json(timeState()); });
app.patch('/api/time/entries/:id', (req,res) => { transaction(() => updateTimeEntry(String(req.params.id),req.body)); res.json(timeState()); });
app.delete('/api/time/entries/:id', (req,res) => { transaction(() => deleteTimeEntry(String(req.params.id),req.body)); res.json(timeState()); });
app.get('/api/time/export', async (req,res) => {
  const result = timeExport(req.query); const filename = `fokus-zeiten-${result.query.from}-${result.query.to}`;
  if (result.query.format === 'json') return res.attachment(filename + '.json').json({version:1,...result});
  const rows = exportRows(result);
  if (result.query.format === 'csv') return res.attachment(filename + '.csv').type('text/csv; charset=utf-8').send('\uFEFF' + [exportColumns,...rows].map(row => row.map(csvCell).join(';')).join('\r\n'));
  const {default: ExcelJS} = await import('exceljs'); const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Zeiten'); sheet.addRow(exportColumns); rows.forEach(row => sheet.addRow(row));
  sheet.getRow(1).font = {bold:true}; sheet.views = [{state:'frozen',ySplit:1}];
  sheet.columns.forEach((column,index) => { column.width = [14,24,40,30,23,23,21,20,45,14,20][index]; });
  sheet.getColumn(7).numFmt = '0.000'; sheet.getColumn(8).numFmt = '0.000000';
  res.attachment(filename + '.xlsx').type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(Buffer.from(await workbook.xlsx.writeBuffer()));
});
app.post('/api/tasks', async (req, res) => { const task = transaction(() => createTask(req.body)); await processQueue(); res.status(201).json(task); });
app.patch('/api/tasks/:id', async (req, res) => { const task = transaction(() => updateTask(String(req.params.id), req.body)); await processQueue(); res.json(task); });
app.delete('/api/tasks/:id', async (req, res) => { transaction(() => deleteTask(String(req.params.id))); await processQueue(); res.json({ ok: true }); });
app.post('/api/topics', (req, res) => res.status(201).json(transaction(() => createTopic(req.body))));
app.patch('/api/topics/:id', async (req, res) => { const topic = transaction(() => updateTopic(String(req.params.id), req.body)); await processQueue(); res.json(topic); });
app.delete('/api/topics/:id', async (req, res) => { transaction(() => deleteTopic(String(req.params.id))); await processQueue(); res.json({ ok: true }); });
app.post('/api/demo', (_req, res) => {
  if (listTasks().length || listTopics().length) return res.status(409).json({ error: 'Beispiele sind nur in einem leeren Workspace verfügbar.' });
  transaction(() => {
    const studio = createTopic({ name: 'Studio Nord', color: '#a9c4ef' });
    const atelier = createTopic({ name: 'Atelier Weber', color: '#c7a7e5' });
    const personal = createTopic({ name: 'Persönlich', color: '#d9b884' });
    const day = (offset: number) => { const date = new Date(); date.setDate(date.getDate() + offset); return localDate(date); };
    const brand = createTask({ title: 'Brand-Konzept finalisieren', notes: 'Die letzte Feedbackrunde einarbeiten und das Konzept für die Präsentation vorbereiten.', topicId: studio.id, dueDate: day(0), time: '10:00', duration: 60, priority: 'high', status: 'in_progress', calendarEnabled: false });
    createTask({ title: 'Feedback von Lisa einarbeiten', topicId: studio.id, parentId: brand.id, status: 'done', calendarEnabled: false });
    createTask({ title: 'Präsentation exportieren', topicId: studio.id, parentId: brand.id, calendarEnabled: false });
    createTask({ title: 'Angebot für Website-Relaunch senden', topicId: atelier.id, dueDate: day(0), time: '14:30', duration: 30, priority: 'high', calendarEnabled: false });
    createTask({ title: 'Feedback zur Startseite besprechen', topicId: studio.id, dueDate: day(0), time: '16:00', duration: 30, calendarEnabled: false });
    createTask({ title: 'Endlich wieder eine Runde laufen', topicId: personal.id, dueDate: day(0), priority: 'low', calendarEnabled: false });
    createTask({ title: 'Ideen für das nächste Projekt sammeln', notes: 'Einfach erst einmal alles festhalten. Sortieren kommt später.', calendarEnabled: false });
    createTask({ title: 'Rechnung für September prüfen', topicId: atelier.id, dueDate: day(-1), calendarEnabled: false });
    createTask({ title: 'Neue Typografie recherchieren', topicId: studio.id, dueDate: day(2), calendarEnabled: false });
    createTask({ title: 'Projektordner aufräumen', topicId: atelier.id, dueDate: day(0), status: 'done', priority: 'low', calendarEnabled: false });
  }); res.json({ ok: true });
});
app.get('/api/export', (_req, res) => { res.attachment(`fokus-export-${localDate()}.json`).json({ version: 2, exportedAt: new Date().toISOString(), tasks: listTasks(), topics: listTopics(), time: timeState() }); });
const importUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024, files: 1, fields: 0 } });
app.post('/api/import/preview', importUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Bitte eine Datei auswählen.' });
  res.json(await previewFile(req.file.buffer, req.file.originalname));
});
app.get('/api/import/calendar', async (req, res) => {
  const input = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(req.query);
  const days = (Date.parse(input.to) - Date.parse(input.from)) / 86400000;
  if (!Number.isFinite(days) || days < 0 || days > 93) return res.status(400).json({ error: 'Bitte einen Zeitraum von höchstens 93 Tagen auswählen.' });
  res.json(await calendarImport(input.from, input.to));
});
app.post('/api/import/commit', (req, res) => res.json(commitImport(req.body)));
app.get('/api/calendar/connect', (_req, res) => {
  if (!googleConfigured) return res.status(503).json({ error: 'Google OAuth ist noch nicht konfiguriert. Bitte die Einrichtung im README befolgen.' });
  const state = randomBytes(32).toString('base64url'); const verifier = randomBytes(48).toString('base64url');
  res.cookie('fokus_oauth', encrypt({ state, verifier, expiresAt: Date.now() + 600000 }), { ...cookieOptions, maxAge: 600000 }); res.redirect(oauthUrl(state, verifier));
});
app.get('/api/calendar/callback', async (req, res) => {
  const cookie = req.cookies.fokus_oauth; res.clearCookie('fokus_oauth', cookieOptions);
  try {
    if (req.query.error) throw new Error('Google-Anmeldung wurde abgebrochen.');
    if (typeof cookie !== 'string') throw new Error('Anmeldung abgelaufen. Bitte erneut verbinden.');
    const data = decrypt<{ state: string; verifier: string; expiresAt: number }>(cookie);
    if (data.expiresAt < Date.now() || typeof req.query.state !== 'string' || data.state !== req.query.state || typeof req.query.code !== 'string') throw new Error('Anmeldung konnte nicht geprüft werden. Bitte erneut verbinden.');
    await connectGoogle(req.query.code, data.verifier); await processQueue(); res.redirect('/?calendar=connected');
  } catch { res.redirect('/?calendar=error'); }
});
app.get('/api/calendar/calendars', async (_req, res) => res.json(await calendars()));
app.patch('/api/calendar', async (req, res) => { const input = z.object({ calendarId: z.string().min(1).max(500) }).parse(req.body); await selectCalendar(input.calendarId); await processQueue(); res.json({ ok: true }); });
app.post('/api/calendar/sync', async (_req, res) => { if (!calendarInfo().connected) return res.status(409).json({ error: 'Bitte zuerst den Google-Kalender verbinden.' }); queueAll(); await processQueue(); res.json({ ok: true }); });
app.delete('/api/calendar', async (_req, res) => { await disconnectGoogle(); res.json({ ok: true }); });
app.post('/api/voice/parse', (req, res) => { const input = z.object({ text: z.string().trim().min(1).max(10000) }).parse(req.body); res.json(parseDictation(input.text, listTopics())); });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024, files: 1, fields: 0 }, fileFilter: (_req, file, cb) => cb(null, /^(audio\/(webm|mp4|mpeg|ogg|wav|x-wav)|video\/webm)(;.*)?$/.test(file.mimetype)) });
app.post('/api/voice/transcribe', rateLimit({ windowMs: 60000, limit: 8, message: { error: 'Bitte warte kurz vor der nächsten Aufnahme.' } }), upload.single('audio'), async (req, res) => {
  if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: 'Erweiterte Transkription ist nicht konfiguriert. Nutze die Browser-Spracherkennung oder tippe deine Aufgabe.' });
  if (!req.file || req.file.size < 100) return res.status(400).json({ error: 'Keine auswertbare Aufnahme. Bitte erneut aufnehmen.' });
  const body = new FormData();
  const extension = req.file.mimetype.includes('mp4') ? 'mp4' : req.file.mimetype.includes('ogg') ? 'ogg' : req.file.mimetype.includes('wav') ? 'wav' : 'webm';
  body.append('file', new Blob([new Uint8Array(req.file.buffer)], { type: req.file.mimetype }), `aufnahme.${extension}`);
  body.append('model', process.env.TRANSCRIPTION_MODEL || 'gpt-4o-mini-transcribe'); body.append('language', 'de');
  body.append('prompt', 'Transkribiere die deutsche Aufgabenbeschreibung präzise. Korrekte Rechtschreibung und Interpunktion. Keine Fülllaute wie äh und ähm. Namen, Zahlen, Termine, Verneinungen und alle inhaltlichen Aussagen unverändert erhalten. Keine Ergänzungen.');
  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body, signal: AbortSignal.timeout(60000) });
  if (!response.ok) return res.status(502).json({ error: 'Die Transkription ist gerade nicht verfügbar. Bitte erneut versuchen oder die Aufgabe schriftlich anlegen.' });
  const result = await response.json() as { text?: string };
  if (!result.text?.trim()) return res.status(422).json({ error: 'Keine Sprache erkannt. Bitte erneut aufnehmen.' });
  res.json(parseDictation(result.text, listTopics()));
});
if (production && !process.env.VERCEL) {
  app.use(express.static(resolve('dist'), { index: false, maxAge: '1h' }));
  app.get('/{*path}', (req, res, next) => { if (req.path.startsWith('/api/')) return next(); res.setHeader('Cache-Control', 'no-cache'); res.sendFile(resolve('dist/index.html')); });
}
app.use('/api', (_req, res) => res.status(404).json({ error: 'Diese API-Adresse existiert nicht.' }));
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof TimeConflictError) return res.status(409).json({error:error.message});
  if (error instanceof ZodError) return res.status(400).json({ error: error.issues.map(i => i.message).join(' ') });
  if (error instanceof multer.MulterError) return res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'Die Datei ist zu groß. Bitte höchstens 4 MB hochladen.' : 'Die Datei konnte nicht hochgeladen werden.' });
  if (error instanceof SyntaxError && 'body' in error) return res.status(400).json({ error: 'Die Anfrage enthält ungültige Daten.' });
  const message = error instanceof Error ? error.message : 'Ein Fehler ist aufgetreten.';
  const safe = !/SQLITE|SQL|database|ENOENT|TypeError|fetch failed|aborted|decrypt|authenticate data/i.test(message);
  res.status(message.includes('nicht gefunden') ? 404 : safe ? 400 : 500).json({ error: safe ? message : 'Die Aktion konnte nicht abgeschlossen werden. Bitte erneut versuchen.' });
});
export default app;

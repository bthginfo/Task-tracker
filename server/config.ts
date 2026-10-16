import 'dotenv/config';
import { createHash, randomBytes } from 'node:crypto';

export const production = process.env.NODE_ENV === 'production';
export const port = Number(process.env.PORT || 3000);
export const appUrl = (process.env.APP_URL || `http://localhost:${port}`).replace(/\/$/, '');
export const password = process.env.APP_PASSWORD || '';
const secret = process.env.APP_SECRET || (production ? '' : randomBytes(32).toString('hex'));
if (production && (password.length < 16 || secret.length < 32 || !appUrl.startsWith('https://'))) {
  throw new Error('Production requires APP_PASSWORD (16+ characters), APP_SECRET (32+ characters), and an HTTPS APP_URL.');
}
export const encryptionKey = createHash('sha256').update(secret).digest();
export const googleConfigured = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.APP_SECRET);
export const googleRedirect = `${appUrl}/api/calendar/callback`;
export const timezone = process.env.APP_TIMEZONE || process.env.TZ || 'Europe/Paris';

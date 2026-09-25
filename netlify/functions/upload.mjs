import { getStore } from '@netlify/blobs';
import { anonymize, json, verifyToken } from '../lib/auth.mjs';

const MAX_BYTES = 4 * 1024 * 1024;
const QUOTA_PER_IP = Number(process.env.QUOTA_PER_IP) || 60;
const QUOTA_GLOBAL = Number(process.env.QUOTA_GLOBAL) || 500;

function detectMime(buf) {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 12 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

// Compteurs journaliers. Si le stockage est indisponible, l'envoi reste possible (les limites de débit restent actives).
async function takeQuota(ip) {
  try {
    const store = getStore('quota');
    const day = new Date().toISOString().slice(0, 10);
    const keyIp = `${day}/${anonymize(ip || 'unknown')}`;
    const keyAll = `${day}/all`;
    const [nIp, nAll] = await Promise.all([store.get(keyIp), store.get(keyAll)]);
    const usedIp = Number(nIp) || 0;
    const usedAll = Number(nAll) || 0;
    if (usedIp >= QUOTA_PER_IP || usedAll >= QUOTA_GLOBAL) return false;
    await Promise.all([store.set(keyIp, String(usedIp + 1)), store.set(keyAll, String(usedAll + 1))]);
    return true;
  } catch {
    return true;
  }
}

export default async (req, context) => {
  if (req.method !== 'POST') return json(405, { error: 'method' });

  let body;
  try { body = await req.json(); } catch { return json(400, { error: 'json' }); }

  let valid = false;
  try { valid = verifyToken(body.token); } catch { return json(500, { error: 'config' }); }
  if (!valid) return json(401, { error: 'session' });

  const bytes = Buffer.from(String(body.data || ''), 'base64');
  if (!bytes.length || bytes.length > MAX_BYTES) return json(413, { error: 'size' });

  const mime = detectMime(bytes);
  if (!mime) return json(415, { error: 'type' });

  if (!(await takeQuota(context && context.ip))) return json(429, { error: 'quota' });

  const safe = String(body.name || 'photo.jpg').replace(/[^\w.\- ]/g, '_').slice(0, 80);
  const name = `${new Date().toISOString().replace(/[:.]/g, '-')}_${safe}`;

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
        grant_type: 'refresh_token',
      }),
    });
    if (!tokenRes.ok) return json(502, { error: 'auth' });
    const { access_token } = await tokenRes.json();

    const boundary = 'cd' + Math.random().toString(16).slice(2);
    const meta = JSON.stringify({ name, parents: [process.env.DRIVE_FOLDER_ID] });
    const multipart = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`),
      bytes,
      Buffer.from(`\r\n--${boundary}--`),
    ]);

    const up = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${access_token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: multipart,
    });
    if (!up.ok) return json(502, { error: 'drive' });
  } catch {
    return json(502, { error: 'network' });
  }

  return json(200, { ok: true });
};

export const config = {
  rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};

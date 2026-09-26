// CoursDrop - Cloudflare Worker (remplace les fonctions Netlify check et upload)

const SESSION_SECONDS = 6 * 60 * 60;
const MAX_BYTES = 4 * 1024 * 1024;

const CODE_RE = /^\d{6}$/;
const ID_RE = /^[a-z0-9-]{1,30}$/;
const FOLDER_RE = /^[\w-]{10,}$/;
const VIEW_RE = /^https:\/\/drive\.google\.com\//;

const enc = new TextEncoder();

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

// ---------- classes ----------
function loadClasses(env) {
  let list = [];
  if (env.CLASSES) {
    try { list = JSON.parse(env.CLASSES); } catch { return []; }
  } else if (env.UPLOAD_CODE && env.DRIVE_FOLDER_ID) {
    list = [{ id: 'classe', name: '', code: env.UPLOAD_CODE, inbox: env.DRIVE_FOLDER_ID, view: env.LYCEE_URL || '' }];
  }
  if (!Array.isArray(list)) return [];

  const ids = new Set();
  const codes = new Set();
  const out = [];
  for (const c of list) {
    if (!c || !CODE_RE.test(String(c.code)) || !ID_RE.test(String(c.id)) || !FOLDER_RE.test(String(c.inbox))) continue;
    if (ids.has(c.id) || codes.has(String(c.code))) continue;
    ids.add(c.id);
    codes.add(String(c.code));
    out.push({
      id: String(c.id),
      name: String(c.name || '').slice(0, 40),
      code: String(c.code),
      inbox: String(c.inbox),
      view: VIEW_RE.test(String(c.view || '')) ? String(c.view) : '',
    });
  }
  return out;
}

// ---------- crypto ----------
async function sha256(data) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', typeof data === 'string' ? enc.encode(data) : data));
}

function equalBytes(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function sameSecret(a, b) {
  return equalBytes(await sha256(String(a)), await sha256(String(b)));
}

function toBase64Url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmacKey(env) {
  const secret = env.GOOGLE_CLIENT_SECRET;
  if (!secret) throw new Error('missing secret');
  const raw = await sha256(`coursdrop:${secret}`);
  return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

async function sign(env, body) {
  const key = await hmacKey(env);
  return toBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(body))));
}

async function signToken(env, ttlSeconds, classId) {
  const exp = String(Math.floor(Date.now() / 1000) + ttlSeconds);
  const body = `${exp}.${classId}`;
  return `${body}.${await sign(env, body)}`;
}

// Renvoie l'id de classe si le jeton est valable, sinon null.
async function verifyToken(env, token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const [exp, classId, sig] = parts;
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now() / 1000 || !ID_RE.test(classId)) return null;
  const good = await sign(env, `${exp}.${classId}`);
  return equalBytes(enc.encode(sig), enc.encode(good)) ? classId : null;
}

// ---------- images ----------
function detectMime(b) {
  if (b.length > 12 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length > 12 && png.every((v, i) => b[i] === v)) return 'image/png';
  const str = (from, to) => String.fromCharCode(...b.subarray(from, to));
  if (b.length > 12 && str(0, 4) === 'RIFF' && str(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

function decodeBase64(s) {
  try {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return new Uint8Array(0);
  }
}

// ---------- limites de debit (optionnelles : liaisons CHECK_RL / UPLOAD_RL) ----------
async function limited(limiter, key) {
  if (!limiter) return false;
  try {
    const { success } = await limiter.limit({ key });
    return !success;
  } catch {
    return false;
  }
}

// ---------- routes ----------
async function handleCheck(request, env) {
  if (request.method !== 'POST') return json(405, { error: 'method' });
  if (await limited(env.CHECK_RL, request.headers.get('CF-Connecting-IP') || 'unknown')) return json(429, { error: 'rate' });

  let body;
  try { body = await request.json(); } catch { return json(400, { error: 'json' }); }

  const classes = loadClasses(env);
  if (!classes.length) return json(500, { error: 'config' });

  let match = null;
  for (const c of classes) {
    if ((await sameSecret(body.code, c.code)) && !match) match = c;
  }

  if (!match) {
    await new Promise((r) => setTimeout(r, 600));
    return json(403, { error: 'code' });
  }

  try {
    return json(200, {
      token: await signToken(env, SESSION_SECONDS, match.id),
      expiresIn: SESSION_SECONDS,
      name: match.name,
      driveUrl: match.view,
    });
  } catch {
    return json(500, { error: 'config' });
  }
}

async function handleUpload(request, env) {
  if (request.method !== 'POST') return json(405, { error: 'method' });
  if (await limited(env.UPLOAD_RL, request.headers.get('CF-Connecting-IP') || 'unknown')) return json(429, { error: 'rate' });

  let body;
  try { body = await request.json(); } catch { return json(400, { error: 'json' }); }

  let classId = null;
  try { classId = await verifyToken(env, body.token); } catch { return json(500, { error: 'config' }); }
  const target = classId && loadClasses(env).find((c) => c.id === classId);
  if (!target) return json(401, { error: 'session' });

  const bytes = decodeBase64(String(body.data || ''));
  if (!bytes.length || bytes.length > MAX_BYTES) return json(413, { error: 'size' });

  const mime = detectMime(bytes);
  if (!mime) return json(415, { error: 'type' });

  const safe = String(body.name || 'photo.jpg').replace(/[^\w.\- ]/g, '_').slice(0, 80);
  const name = `${new Date().toISOString().replace(/[:.]/g, '-')}_${safe}`;

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        refresh_token: env.GOOGLE_REFRESH_TOKEN,
        grant_type: 'refresh_token',
      }),
    });
    if (!tokenRes.ok) return json(502, { error: 'auth' });
    const { access_token } = await tokenRes.json();

    const boundary = 'cd' + Math.random().toString(16).slice(2);
    const meta = JSON.stringify({ name, parents: [target.inbox] });
    const multipart = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`,
      `--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`,
      bytes,
      `\r\n--${boundary}--`,
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
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (/\/check\/?$/.test(pathname)) return handleCheck(request, env);
    if (/\/upload\/?$/.test(pathname)) return handleUpload(request, env);
    return env.ASSETS.fetch(request);
  },
};

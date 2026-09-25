import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const signingKey = () => {
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!secret) throw new Error('missing secret');
  return createHash('sha256').update(`coursdrop:${secret}`).digest();
};

export const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export function sameSecret(a, b) {
  const ha = createHash('sha256').update(String(a)).digest();
  const hb = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}

// Jeton : "<expiration>.<id de classe>.<signature>"
export function signToken(ttlSeconds, classId) {
  const exp = String(Math.floor(Date.now() / 1000) + ttlSeconds);
  const body = `${exp}.${classId}`;
  const sig = createHmac('sha256', signingKey()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

// Renvoie l'id de classe si le jeton est valable, sinon null.
export function verifyToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const [exp, classId, sig] = parts;
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now() / 1000 || !/^[a-z0-9-]{1,30}$/.test(classId)) return null;
  const good = createHmac('sha256', signingKey()).update(`${exp}.${classId}`).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(good);
  return a.length === b.length && timingSafeEqual(a, b) ? classId : null;
}

export function anonymize(value) {
  return createHash('sha256').update(`${value}:${process.env.GOOGLE_CLIENT_SECRET || ''}`).digest('hex').slice(0, 16);
}

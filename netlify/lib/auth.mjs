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

export function signToken(ttlSeconds) {
  const exp = String(Math.floor(Date.now() / 1000) + ttlSeconds);
  const sig = createHmac('sha256', signingKey()).update(exp).digest('base64url');
  return `${exp}.${sig}`;
}

export function verifyToken(token) {
  const [exp, sig] = String(token || '').split('.');
  if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) < Date.now() / 1000) return false;
  const good = createHmac('sha256', signingKey()).update(exp).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(good);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function anonymize(value) {
  return createHash('sha256').update(`${value}:${process.env.GOOGLE_CLIENT_SECRET || ''}`).digest('hex').slice(0, 16);
}

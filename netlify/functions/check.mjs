import { json, sameSecret, signToken } from '../lib/auth.mjs';

const SESSION_SECONDS = 6 * 60 * 60;

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method' });

  let body;
  try { body = await req.json(); } catch { return json(400, { error: 'json' }); }

  const expected = process.env.UPLOAD_CODE;
  if (!expected) return json(500, { error: 'config' });

  if (!sameSecret(body.code, expected)) {
    await new Promise((r) => setTimeout(r, 600));
    return json(403, { error: 'code' });
  }

  const link = process.env.LYCEE_URL || '';
  const driveUrl = /^https:\/\/drive\.google\.com\//.test(link) ? link : '';

  try {
    return json(200, { token: signToken(SESSION_SECONDS), expiresIn: SESSION_SECONDS, driveUrl });
  } catch {
    return json(500, { error: 'config' });
  }
};

export const config = {
  rateLimit: { windowLimit: 6, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};

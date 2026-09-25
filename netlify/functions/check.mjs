import { json, sameSecret, signToken } from '../lib/auth.mjs';
import { loadClasses } from '../lib/classes.mjs';

const SESSION_SECONDS = 6 * 60 * 60;

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method' });

  let body;
  try { body = await req.json(); } catch { return json(400, { error: 'json' }); }

  const classes = loadClasses();
  if (!classes.length) return json(500, { error: 'config' });

  let match = null;
  for (const c of classes) {
    if (sameSecret(body.code, c.code) && !match) match = c;
  }

  if (!match) {
    await new Promise((r) => setTimeout(r, 600));
    return json(403, { error: 'code' });
  }

  try {
    return json(200, {
      token: signToken(SESSION_SECONDS, match.id),
      expiresIn: SESSION_SECONDS,
      name: match.name,
      driveUrl: match.view,
    });
  } catch {
    return json(500, { error: 'config' });
  }
};

export const config = {
  rateLimit: { windowLimit: 6, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};

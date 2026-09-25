// Netlify Function : reçoit une photo et la dépose dans le dossier Drive "📥 Photos à trier".
// Variables d'environnement à définir dans Netlify :
//   UPLOAD_CODE, DRIVE_FOLDER_ID, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'method' });

  let b;
  try { b = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'json' }); }

  if (!process.env.UPLOAD_CODE || b.code !== process.env.UPLOAD_CODE) return json(403, { error: 'code' });
  if (!/^image\/(jpeg|png|webp)$/.test(b.mime)) return json(415, { error: 'type' });

  const bytes = Buffer.from(String(b.data || ''), 'base64');
  if (!bytes.length || bytes.length > 4 * 1024 * 1024) return json(413, { error: 'size' });

  const safe = String(b.name || 'photo.jpg').replace(/[^\w.\- ]/g, '_').slice(0, 80);
  const name = `${new Date().toISOString().replace(/[:.]/g, '-')}_${safe}`;

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
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: ${b.mime}\r\n\r\n`),
    bytes,
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  const up = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${access_token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  if (!up.ok) return json(502, { error: 'drive' });

  return json(200, { ok: true });
};

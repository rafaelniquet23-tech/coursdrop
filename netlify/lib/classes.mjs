const CODE_RE = /^\d{6}$/;
const ID_RE = /^[a-z0-9-]{1,30}$/;
const FOLDER_RE = /^[\w-]{10,}$/;
const VIEW_RE = /^https:\/\/drive\.google\.com\//;

// CLASSES = [{"id":"2nde-a","name":"2nde A","code":"482913","inbox":"<ID dossier de réception>","view":"<lien de partage>"}, ...]
// Sans CLASSES, on retombe sur UPLOAD_CODE / DRIVE_FOLDER_ID / LYCEE_URL (une seule classe).
export function loadClasses() {
  let list = [];
  const raw = process.env.CLASSES;
  if (raw) {
    try { list = JSON.parse(raw); } catch { return []; }
  } else if (process.env.UPLOAD_CODE && process.env.DRIVE_FOLDER_ID) {
    list = [{
      id: 'classe',
      name: '',
      code: process.env.UPLOAD_CODE,
      inbox: process.env.DRIVE_FOLDER_ID,
      view: process.env.LYCEE_URL || '',
    }];
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

// Vercel lo llama una vez al día (ver vercel.json) para que Supabase no pause el proyecto.
import { CONFIG } from '../config.js';

export default async function handler(req, res) {
  const headers = { 'Content-Type': 'application/json', apikey: CONFIG.supabaseKey };
  if (!CONFIG.supabaseKey.startsWith('sb_')) headers.Authorization = 'Bearer ' + CONFIG.supabaseKey;
  try {
    const r = await fetch(CONFIG.supabaseUrl + '/rest/v1/rpc/ping', { method: 'POST', headers, body: '{}' });
    res.status(r.ok ? 200 : 502).json({ ok: r.ok });
  } catch {
    res.status(502).json({ ok: false });
  }
}

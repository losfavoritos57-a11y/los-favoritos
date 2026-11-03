// GitHub lo corre una vez al día (ver .github/workflows/keepalive.yml) para que Supabase no pause el proyecto.
import { CONFIG } from '../config.js';

const headers = { 'Content-Type': 'application/json', apikey: CONFIG.supabaseKey };
if (!CONFIG.supabaseKey.startsWith('sb_')) headers.Authorization = 'Bearer ' + CONFIG.supabaseKey;
const r = await fetch(CONFIG.supabaseUrl + '/rest/v1/rpc/ping', { method: 'POST', headers, body: '{}' });
console.log('ping', r.status);
if (!r.ok) process.exit(1);

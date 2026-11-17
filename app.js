import { CONFIG } from './config.js';

const VERSION = 'v14'; // subirla junto con CACHE en sw.js y version.json en cada publicación
const POS = { POR: 'Arquero', DEF: 'Defensa', MED: 'Volante', DEL: 'Delantero' };
const POS_ICO = { POR: '🧤', DEF: '🛡️', MED: '⚙️', DEL: '⚽' };
const POS_CORTO = { POR: 'Arq', DEF: 'Def', MED: 'Vol', DEL: 'Del' };
const NOSOTROS = 'Los Favoritos';
const rivalDe = m => m.rival || 'Rival';
const resultado = (a, b) => a > b ? 'Ganamos' : a < b ? 'Perdimos' : 'Empatamos';
const VISTAS = ['ranking', 'partidos', 'plantel', 'proxima'];
const S = { players: [], matches: [], notasRes: [], figuraRes: [], votantes: {}, misVotos: [], minVotos: 3, registroAbierto: true, anotados: [], proxima: null, cargado: false, sinRed: false,
  view: 'ranking', sort: 'pts', rankPos: '', posSort: 'nota', periodo: '', pantalla: 'cargando' };

/* ---------- sesión (queda guardada solo en este celular) ---------- */
const KEY = 'favoritos-sesion';
let SES = {};
try { SES = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { SES = {}; }
function guardarSes() { try { localStorage.setItem(KEY, JSON.stringify(SES)); } catch {} }
const auth = () => ({ grupo: SES.grupo || '', jugador: SES.jugador || '', pin: SES.pin || '', admin: SES.admin || '' });
const esAdmin = () => !!SES.admin;

/* ---------- conexión con Supabase ---------- */
async function rpc(fn, args = {}) {
  const headers = { 'Content-Type': 'application/json', apikey: CONFIG.supabaseKey };
  if (!CONFIG.supabaseKey.startsWith('sb_')) headers.Authorization = 'Bearer ' + CONFIG.supabaseKey;
  const r = await fetch(CONFIG.supabaseUrl + '/rest/v1/rpc/' + fn, { method: 'POST', headers, body: JSON.stringify(args) });
  if (!r.ok) throw new Error('http ' + r.status);
  return r.json();
}
const ERRORES = {
  grupo: 'La clave del grupo no es correcta.',
  clave_cambiada: 'La clave del grupo cambió. Pídele la nueva al administrador.',
  registro_cerrado: 'El registro está cerrado. Pídele al administrador que te agregue.',
  grupo_corto: 'La clave del grupo debe tener al menos 6 caracteres.',
  admin_corto: 'La clave de administrador debe tener al menos 6 caracteres.',
  iguales: 'Las dos claves tienen que ser distintas.',
  pin: 'Ese PIN no corresponde a ese jugador.',
  admin: 'La clave de administrador no es correcta.',
  bloqueado: 'Demasiados intentos fallidos. Espera unos minutos y vuelve a probar.',
  sin_jugador: 'Primero dinos quién eres.',
  pin_formato: 'El PIN tiene que ser de 4 números.',
  datos: 'Algún dato no es válido. Revísalo.',
  equipos: 'Marca a los que jugaron.',
  goles: 'Hay más goles de jugadores que goles nuestros en el marcador.',
  tiene_partidos: 'No se puede borrar: ya jugó partidos.',
  en_papelera: 'No se puede borrar: aparece en un partido de la papelera.',
  solo_admin: 'Eso lo puede hacer solo el administrador.',
  no_es_tuyo: 'Solo puedes editar tu propia ficha.',
  lleno: 'Ya hay 60 jugadores. No caben más.',
  partido: 'Ese partido ya no existe.',
  no_jugaste: 'Solo votan los que jugaron ese partido.',
  jugador: 'Ese jugador ya no existe.',
  sin_configurar: 'La app todavía no está configurada.',
};
function manejarError(code) {
  toast(ERRORES[code] || 'Algo falló. Inténtalo de nuevo.');
  if (code === 'grupo' || code === 'clave_cambiada') { SES = {}; guardarSes(); S.pantalla = 'grupo'; closeSheet(); render(); }
  else if (code === 'sin_configurar') { SES = {}; guardarSes(); S.pantalla = 'setup'; closeSheet(); render(); }
  else if (code === 'bloqueado') { if (S.pantalla !== 'app') { S.pantalla = 'bloqueado'; render(); } }
  else if (code === 'pin' || code === 'jugador') { if (SES.jugador) { olvidarJugador(); render(); } }
  else if (code === 'admin') { delete SES.admin; guardarSes(); render(); }
  else if (code === 'sin_jugador') { quienEres(); }
}
function olvidarJugador() { delete SES.jugador; delete SES.pin; guardarSes(); S.misVotos = []; S.errorJugador = null; }
// Ejecuta una acción que cambia datos. Devuelve la respuesta si salió bien, o null.
async function accion(fn, args, okMsg) {
  let r;
  try { r = await rpc(fn, { a: auth(), ...args }); }
  catch { toast('Sin conexión. Revisa tu señal e inténtalo de nuevo.'); return null; }
  if (!r || !r.ok) { manejarError(r?.error); return null; }
  if (okMsg) toast(okMsg);
  await refrescar();
  return r;
}
async function refrescar() {
  if (!SES.grupo || alinGuardando) return;
  let r;
  try { r = await rpc('estado', { a: { grupo: SES.grupo, jugador: SES.jugador || '', pin: SES.pin || '' } }); }
  catch { S.sinRed = true; render(); return; }
  S.sinRed = false;
  if (!r.ok) { manejarError(r.error); return; }
  S.players = r.players || []; S.matches = r.matches || [];
  S.notasRes = r.notasRes || []; S.figuraRes = r.figuraRes || []; S.votantes = r.votantes || {}; S.misVotos = r.misVotos || [];
  S.minVotos = r.minVotos || 3; S.registroAbierto = r.registroAbierto !== false;
  S.anotados = r.anotados || []; S.proxima = r.proxima || null; S.cargado = true;
  if (SES.jugador && (!pById(SES.jugador) || r.errorJugador === 'pin' || r.errorJugador === 'jugador')) {
    if (r.errorJugador === 'pin') toast(ERRORES.pin + ' Vuelve a elegir tu jugador.');
    olvidarJugador();
  }
  S.errorJugador = r.errorJugador || null;
  S.pantalla = 'app';
  render();
}

/* ---------- utilidades ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pById = id => S.players.find(p => p.id === id);
const pName = id => { const p = pById(id); return p ? (p.apodo || p.nombre) : '(eliminado)'; };
const myPlayer = () => SES.jugador ? pById(SES.jugador) : null;
const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const fmtFecha = (f, opt = { weekday: 'short', day: 'numeric', month: 'short' }) => { if (!f) return ''; const d = new Date(f + 'T12:00:00'); return isNaN(d) ? f : d.toLocaleDateString('es-CL', opt); };
const fmt1 = n => n == null ? '–' : n.toFixed(1).replace('.', ',');
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 3600); }

/* ---------- estadísticas ---------- */
const byFecha = (a, b) => (a.fecha || '').localeCompare(b.fecha || '') || (a.creado || 0) - (b.creado || 0);
function jugo(mid, id) { const m = S.matches.find(x => x.id === mid); return !!m && ((m.equipoA || []).includes(id) || (m.equipoB || []).includes(id)); }
// Gato del partido: el de mejor nota promedio en ese partido (aparece cuando lo califican al menos 3).
// Si empatan en nota, gana quien sumó más goles + asistencias; si siguen empatados, son gatos todos.
// Los partidos sin notas usan el elegido al cargarlos (versiones viejas).
function figuras(m) {
  const np = notasPartido(m.id), ids = Object.keys(np).filter(pById);
  if (!ids.length) return { ids: m.mvp ? [m.mvp] : [] };
  const k = id => [Math.round(np[id].avg * 100), (+m.goles?.[id] || 0) + (+m.asist?.[id] || 0)];
  const mejor = (x, y) => x[0] - y[0] || x[1] - y[1];
  const top = ids.map(k).reduce((a, b) => mejor(a, b) >= 0 ? a : b);
  return { ids: ids.filter(id => mejor(k(id), top) === 0) };
}
function respaldoViejo() {
  let t = 0; try { t = +localStorage.getItem('favoritos-ultimo-respaldo') || 0; } catch {}
  return Date.now() - t > 7 * 864e5;
}
const nombresFigura = ids => new Intl.ListFormat('es-CL').format(ids.map(pName));
function stats(ms = S.matches) {
  const st = {};
  const P = id => st[id] ??= { pj: 0, pg: 0, pe: 0, pp: 0, g: 0, a: 0, mvp: 0, ns: 0, nc: 0, pn: 0, gf: 0, gc: 0, forma: [] };
  S.players.forEach(p => P(p.id));
  for (const m of [...ms].sort(byFecha)) {
    const ga = +m.golesA || 0, gb = +m.golesB || 0;
    for (const [team, gf, gc] of [[m.equipoA || [], ga, gb], [m.equipoB || [], gb, ga]])
      for (const id of team) { const s = P(id), r = gf > gc ? 'G' : gf < gc ? 'P' : 'E'; s.pj++; s.gf += gf; s.gc += gc; s[{ G: 'pg', E: 'pe', P: 'pp' }[r]]++; s.forma.push(r); }
    for (const [id, n] of Object.entries(m.goles || {})) P(id).g += +n || 0;
    for (const [id, n] of Object.entries(m.asist || {})) P(id).a += +n || 0;
    for (const id of figuras(m).ids) P(id).mvp++;
  }
  const ids = ms === S.matches ? null : new Set(ms.map(m => m.id));
  for (const n of S.notasRes) if (pById(n.id) && (!ids || ids.has(n.matchId))) { const s = P(n.id); s.ns += +n.suma || 0; s.nc += +n.n || 0; s.pn++; }
  for (const s of Object.values(st)) { s.pts = 3 * s.pg + s.pe; s.rend = s.pj ? s.pts / (3 * s.pj) : 0; s.nota = s.nc ? s.ns / s.nc : null; s.forma = s.forma.slice(-5); }
  return st;
}
// Puesto de alguien en un partido: el anotado ese día o, si falta, el de su ficha.
const posDe = (m, id) => m.posiciones?.[id] || pById(id)?.posicion || '';
function statsPos(pos, ms = S.matches) {
  const st = {}, P = id => st[id] ??= { pj: 0, pg: 0, pe: 0, pp: 0, g: 0, a: 0, gc: 0, vallas: 0, ns: 0, nc: 0 };
  const notas = {}; for (const n of S.notasRes) (notas[n.matchId] ??= {})[n.id] = n;
  for (const m of ms) {
    const ga = +m.golesA || 0, gb = +m.golesB || 0;
    for (const [team, gf, gc] of [[m.equipoA || [], ga, gb], [m.equipoB || [], gb, ga]]) for (const id of team) {
      if (!pById(id) || posDe(m, id) !== pos) continue;
      const s = P(id); s.pj++; s[gf > gc ? 'pg' : gf < gc ? 'pp' : 'pe']++; s.gc += gc; if (!gc) s.vallas++;
      s.g += +m.goles?.[id] || 0; s.a += +m.asist?.[id] || 0;
      const n = notas[m.id]?.[id]; if (n) { s.ns += +n.suma || 0; s.nc += +n.n || 0; }
    }
  }
  for (const s of Object.values(st)) { s.nota = s.nc ? s.ns / s.nc : null; s.rend = (3 * s.pg + s.pe) / (3 * s.pj); }
  return st;
}
function notasPartido(mid) {
  const out = {};
  for (const n of S.notasRes) if (n.matchId === mid && +n.n > 0) out[n.id] = { avg: n.suma / n.n, n: +n.n };
  return out;
}
const SORTS = {
  pts: { l: 'Puntos', f: s => [s.pts, s.rend, s.g] },
  rend: { l: 'Rendimiento', f: s => [s.pj ? s.rend : -1, s.pj, s.pts] },
  g: { l: 'Goleadores', f: s => [s.g, -s.pj] },
  a: { l: 'Asistencias', f: s => [s.a, -s.pj] },
  nota: { l: 'Mejor nota', f: s => [s.nota ?? -1, s.nc] },
  mvp: { l: 'Gatos', f: s => [s.mvp, s.pts] },
};
function ranked(st, key) {
  const f = SORTS[key].f;
  return S.players.map(p => ({ p, s: st[p.id] })).sort((x, y) => {
    const a = [x.s.pj > 0 ? 1 : 0, ...f(x.s)], b = [y.s.pj > 0 ? 1 : 0, ...f(y.s)];
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return b[i] - a[i];
    return (x.p.apodo || x.p.nombre).localeCompare(y.p.apodo || y.p.nombre);
  });
}

/* ---------- pantallas de entrada ---------- */
function vConfigFalta() {
  return `<div class="puerta"><h2>Falta un paso</h2><p class="muted">La app todavía no está conectada a su base de datos. Hay que completar <strong>config.js</strong> con los datos de Supabase.</p></div>`;
}
function vSetup() {
  return `<form class="puerta" id="f-setup"><h2>Primera vez</h2>
    <p class="muted">Elige dos claves. La del <strong>grupo</strong> se la das a todos los amigos para entrar. La de <strong>administrador</strong> es solo tuya, para corregir cosas y cambiar PIN olvidados.</p>
    <div class="field"><label for="su-grupo">Clave del grupo (mínimo 6 caracteres)</label><input id="su-grupo" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" minlength="6" required></div>
    <div class="field"><label for="su-admin">Clave de administrador (mínimo 6, distinta)</label><input id="su-admin" type="password" autocomplete="new-password" minlength="6" required></div>
    <button class="btn pri full" type="submit">Guardar y entrar</button>
    <p class="hint">Anótalas en un lugar seguro. Si las pierdes, no se pueden recuperar desde la app.</p></form>`;
}
function vGrupo() {
  return `${bannerInstalar(true)}<form class="puerta" id="f-grupo"><h2>Entrar</h2>
    <p class="muted">Escribe la clave del grupo. Te la tiene que pasar alguien de Los Favoritos.</p>
    <div class="field"><label for="g-clave">Clave del grupo</label><input id="g-clave" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" required></div>
    <button class="btn pri full" type="submit">Entrar</button></form>`;
}

/* ---------- render principal ---------- */
function render() {
  if (arrastre?.fantasma && !arrastre.solto) return;
  const enApp = S.pantalla === 'app';
  $('#nav').hidden = !enApp; $('#prox-band').hidden = !enApp; $('#btn-cuenta').hidden = !enApp;
  const main = $('#main');
  if (S.pantalla === 'config') { main.innerHTML = vConfigFalta(); return; }
  if (S.pantalla === 'setup') { main.innerHTML = vSetup(); return; }
  if (S.pantalla === 'grupo') { main.innerHTML = vGrupo(); return; }
  if (S.pantalla === 'bloqueado') { main.innerHTML = `<div class="note empty"><h3>Entrada bloqueada un rato</h3><p>Hubo demasiados intentos con una clave equivocada. Espera unos minutos y vuelve a probar.</p><p><button class="btn pri" data-act="reintentar">Reintentar</button></p></div>`; return; }
  if (S.pantalla === 'error') { main.innerHTML = `<div class="note empty"><h3>No hay conexión</h3><p>No pudimos conectarnos. Revisa tu señal.</p><p><button class="btn pri" data-act="reintentar">Reintentar</button></p></div>`; return; }
  if (!enApp) { main.innerHTML = `<div class="note empty"><h3>Cargando…</h3></div>`; return; }

  document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.v === S.view)));
  const me = myPlayer();
  $('#btn-cuenta').textContent = (me ? (me.apodo || me.nombre) : 'Entrar como jugador') + (esAdmin() ? ' · admin' : '');
  renderBand();
  let html = '';
  if (hayNueva) html += `<div class="note cta nueva"><span><strong>Hay una versión nueva de la app.</strong></span><button class="btn pri" data-act="actualizar">Toca aquí para actualizar</button></div>`;
  if (S.sinRed) html += `<div class="note">Sin conexión. Lo que ves puede no estar al día.</div>`;
  html += bannerInstalar(false);
  if (esAdmin() && respaldoViejo()) html += `<div class="note cta"><span><strong>Haz un respaldo.</strong> Pasó más de una semana desde el último. Guárdalo en un lugar privado (no en el grupo).</span><button class="btn pri" data-act="respaldo">Descargar</button></div>`;
  if (!me && S.players.length) html += `<div class="note cta"><span><strong>¿Quién eres?</strong> Elige tu jugador para anotarte, cargar partidos y poner notas.</span><button class="btn pri" data-act="quien">Elegir</button></div>`;
  html += ({ ranking: vRanking, partidos: vPartidos, plantel: vPlantel, proxima: vProxima }[S.view])();
  const scrollTabla = $('.tbl-wrap')?.scrollLeft || 0; // que la actualización automática no mueva la tabla
  main.innerHTML = html;
  const tw = $('.tbl-wrap'); if (tw) tw.scrollLeft = scrollTabla;
}
function renderBand() {
  const pr = S.proxima, n = S.anotados.length, el = $('#prox-band');
  if (!pr || !pr.fecha) { el.innerHTML = `<div class="lbl">Próxima pichanga</div><div class="val">Sin fecha todavía</div><div class="sub">${n ? `${n} anotados` : 'Pónganla en la pestaña Próxima'}</div>`; return; }
  el.innerHTML = `<div class="lbl">Próxima pichanga</div><div class="val">${esc(fmtFecha(pr.fecha, { weekday: 'long', day: 'numeric', month: 'long' }))}${pr.hora ? ' · ' + esc(pr.hora) : ''}</div><div class="sub">${esc(pr.lugar || 'Cancha por definir')} · <span class="num">${n}${pr.cupos ? '/' + esc(pr.cupos) : ''}</span> anotados</div>`;
}
const posTag = p => p.posicion ? `<span class="ptag">${esc(p.posicion)}</span>` : '';
const meTag = p => p.id === SES.jugador ? `<span class="me-tag">TÚ</span>` : '';
const forma = f => `<span class="forma">${f.map(r => `<i class="${r}" title="${{ G: 'Ganó', E: 'Empató', P: 'Perdió' }[r]}">${r}</i>`).join('')}</span>`;

// Periodo del ranking: '' = todo, 'A2026' = un año, 'M2026-11' = un mes.
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const nombrePeriodo = p => !p ? 'Histórico' : p[0] === 'A' ? 'Año ' + p.slice(1) : MESES[+p.slice(6) - 1] + ' ' + p.slice(1, 5);
const partidosDe = p => !p ? S.matches : S.matches.filter(m => (m.fecha || '').startsWith(p.slice(1)));
function periodos() {
  const meses = [...new Set(S.matches.map(m => (m.fecha || '').slice(0, 7)).filter(Boolean))].sort().reverse();
  const anios = [...new Set(meses.map(x => x.slice(0, 4)))];
  return ['', ...anios.flatMap(a => ['A' + a, ...meses.filter(x => x.startsWith(a)).map(x => 'M' + x)])];
}
// Gato del mes / del año: el de mejor nota promedio en esos partidos. Para competir hay que tener nota
// en al menos 2 partidos del mes (1 si el mes tuvo uno solo) o en un tercio de los partidos del año.
// Si empatan, gana quien fue más veces gato del partido y después quien sumó más goles + asistencias.
function gatoDe(p) {
  const ms = partidosDe(p); if (!ms.length) return null;
  const conNotas = new Set(S.notasRes.map(n => n.matchId)), nn = ms.filter(m => conNotas.has(m.id)).length;
  const min = p[0] === 'M' ? Math.max(1, Math.min(2, nn)) : Math.max(1, Math.ceil(nn / 3));
  const st = stats(ms), c = Object.entries(st).filter(([id, s]) => pById(id) && s.nota != null && s.pn >= min);
  if (!c.length) return { ids: [], min, n: ms.length };
  const k = s => [Math.round(s.nota * 10), s.mvp, s.g + s.a]; // a 1 decimal, como se ve en pantalla
  const mejor = (x, y) => { for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
  const top = c.map(([, s]) => k(s)).reduce((a, b) => mejor(a, b) >= 0 ? a : b);
  const ids = c.filter(([, s]) => mejor(k(s), top) === 0).map(([id]) => id);
  return { ids, nota: st[ids[0]].nota, pn: st[ids[0]].pn, min, n: ms.length };
}
const hoyMes = () => today().slice(0, 7);
function vGatos() {
  const anio = S.periodo ? S.periodo.slice(1, 5) : (S.matches.map(m => (m.fecha || '').slice(0, 4)).sort().pop() || today().slice(0, 4));
  const meses = [...new Set(S.matches.map(m => (m.fecha || '').slice(0, 7)).filter(x => x.startsWith(anio)))].sort().reverse();
  if (!meses.length) return '';
  const fila = (p, enCurso) => { const g = gatoDe(p);
    return `<div class="it"><span><span class="pname">${esc(nombrePeriodo(p))}</span>${enCurso ? ' <span class="muted small">(en curso)</span>' : ''}</span>
      <span class="small">${g?.ids.length ? `🐱 <strong>${esc(nombresFigura(g.ids))}</strong> <span class="muted num">${fmt1(g.nota)}</span>` : '<span class="muted">Sin gato todavía</span>'}</span></div>`; };
  const anual = gatoDe('A' + anio), cerrado = anio < today().slice(0, 4);
  return `<div class="sec-h"><h2>🐱 Gatos ${anio}</h2></div>
    <div class="note cta gato-anio"><span>${cerrado ? 'Gato del año' : 'Gato del año (va ganando)'}: ${anual?.ids.length ? `<strong>${esc(nombresFigura(anual.ids))}</strong> · nota ${fmt1(anual.nota)} en ${anual.pn} partido${anual.pn === 1 ? '' : 's'}` : 'nadie todavía'}</span></div>
    <div class="lista">${meses.map(m => fila('M' + m, m === hoyMes())).join('')}</div>
    <p class="muted small">El gato del mes es el de mejor nota promedio del mes (hay que tener nota en al menos 2 partidos; 1 si el mes tuvo uno solo). El del año, el de mejor promedio del año con nota en al menos un tercio de los partidos. Los promedios se van acumulando con cada partido.</p>`;
}
const selPeriodo = () => `<label class="periodo small">Periodo <select id="periodo">${periodos().map(p => `<option value="${p}" ${S.periodo === p ? 'selected' : ''}>${esc(nombrePeriodo(p))}</option>`).join('')}</select></label>`;
const vistasRank = () => `${selPeriodo()}<div class="row vistas" style="gap:6px"><button class="chip" data-rpos="" aria-pressed="${!S.rankPos}">General</button>${Object.keys(POS).map(p => `<button class="chip" data-rpos="${p}" aria-pressed="${S.rankPos === p}">${POS_ICO[p]} ${POS[p]}s</button>`).join('')}</div>`;
const POS_COLS = {
  POR: [['Vallas', s => s.vallas, 'Partidos sin recibir goles'], ['GC/PJ', s => fmt1(s.gc / s.pj), 'Goles recibidos por partido']],
  DEF: [['Vallas', s => s.vallas, 'Partidos sin recibir goles'], ['GC/PJ', s => fmt1(s.gc / s.pj), 'Goles recibidos por partido'], ['Goles', s => s.g]],
  MED: [['Rend.', s => Math.round(s.rend * 100) + '%', 'Puntos obtenidos sobre los posibles'], ['Goles', s => s.g], ['Asist.', s => s.a]],
  DEL: [['Goles', s => s.g], ['Asist.', s => s.a], ['G/PJ', s => fmt1(s.g / s.pj), 'Goles por partido']],
};
const POS_STAT = { POR: 'Vallas invictas', DEF: 'Vallas invictas', MED: 'Goles + asistencias', DEL: 'Goles' };
const POS_ORDEN = { POR: s => [s.vallas, -s.gc / s.pj], DEF: s => [s.vallas, -s.gc / s.pj, s.g], MED: s => [s.g + s.a, s.rend], DEL: s => [s.g, s.a] };
function vRankingPos(pos) {
  const st = statsPos(pos, partidosDe(S.periodo)), cols = POS_COLS[pos];
  const rk = Object.entries(st).map(([id, s]) => ({ p: pById(id), s })).sort((x, y) => {
    const k = s => S.posSort === 'nota' ? [s.nota ?? -1, ...POS_ORDEN[pos](s), s.pj] : [...POS_ORDEN[pos](s), s.nota ?? -1, s.pj];
    const a = k(x.s), b = k(y.s);
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return b[i] - a[i];
    return (x.p.apodo || x.p.nombre).localeCompare(y.p.apodo || y.p.nombre);
  });
  const tabla = rk.length ? `<div class="tbl-wrap"><table><thead><tr><th>#</th><th class="l">Jugador</th><th title="Partidos jugados de ${POS[pos].toLowerCase()}">PJ</th><th title="Ganados-Empatados-Perdidos">G-E-P</th>${cols.map(c => `<th${c[2] ? ` title="${c[2]}"` : ''}>${c[0]}</th>`).join('')}<th title="Promedio de las notas en esos partidos">Nota</th></tr></thead>
    <tbody>${rk.map(({ p, s }, i) => `<tr data-player="${esc(p.id)}" class="${i === 0 ? 'top1' : ''}"><td class="pos"><span>${i + 1}</span></td><td class="l"><span class="pname">${esc(p.apodo || p.nombre)}</span>${meTag(p)}</td><td class="num">${s.pj}</td><td class="num">${s.pg}-${s.pe}-${s.pp}</td>${cols.map(c => `<td class="num">${c[1](s)}</td>`).join('')}<td class="num${S.posSort === 'nota' ? ' hl' : ''}">${fmt1(s.nota)}</td></tr>`).join('')}</tbody></table></div>`
    : `<div class="note empty"><h3>Nadie ha jugado de ${POS[pos].toLowerCase()} todavía</h3><p>Cuando carguen partidos marcando dónde jugó cada uno, aparece aquí.</p></div>`;
  return `${vistasRank()}<div class="sec-h"><h2>${POS_ICO[pos]} Mejores ${POS[pos].toLowerCase()}s</h2><div class="row"><button class="chip" data-psort="nota" aria-pressed="${S.posSort === 'nota'}">Por nota</button><button class="chip" data-psort="stat" aria-pressed="${S.posSort === 'stat'}">Por ${POS_STAT[pos].toLowerCase()}</button></div></div>${tabla}
    <p class="muted small">Cuenta solo los partidos jugados de ${POS[pos].toLowerCase()}: si alguien rota, cada puesto lleva su propia cuenta. Si en un partido no se anotó el puesto, se usa el de su ficha. La nota es el promedio que le pusieron en esos partidos.</p>`;
}
function vRanking() {
  if (!S.players.length) return emptyPlayers();
  if (S.periodo && !periodos().includes(S.periodo)) S.periodo = '';
  if (S.rankPos) return vRankingPos(S.rankPos);
  const ms = partidosDe(S.periodo), st = stats(ms), rk = ranked(st, S.sort);
  const best = k => ranked(st, k)[0];
  const lider = best('pts'), gol = best('g'), nota = best('nota');
  const gp = S.periodo ? gatoDe(S.periodo) : null;
  const gatoP = gp ? `<div class="note cta gato-anio"><span>🐱 Gato de ${esc(nombrePeriodo(S.periodo).replace('Año ', 'l año '))}${(S.periodo[0] === 'M' ? S.periodo.slice(1) === hoyMes() : S.periodo.slice(1) === today().slice(0, 4)) ? ' (va ganando)' : ''}: ${gp.ids.length ? `<strong>${esc(nombresFigura(gp.ids))}</strong> · nota ${fmt1(gp.nota)} en ${gp.pn} partido${gp.pn === 1 ? '' : 's'}` : 'nadie todavía'}</span></div>` : '';
  const pod = ms.length ? `${gatoP}<div class="podio">
    <div><div class="lbl">Puntero</div><div class="who">${esc(pName(lider.p.id))}</div><div class="stat num">${lider.s.pts} pts en ${lider.s.pj} PJ</div></div>
    <div><div class="lbl">Goleador</div><div class="who">${gol.s.g ? esc(pName(gol.p.id)) : '–'}</div><div class="stat num">${gol.s.g} goles</div></div>
    ${gp ? `<div><div class="lbl">🐱 Gato</div><div class="who">${gp.ids.length ? esc(nombresFigura(gp.ids)) : '–'}</div><div class="stat num">${gp.ids.length ? fmt1(gp.nota) + ' promedio' : 'Todavía nadie'}</div></div>`
    : `<div><div class="lbl">Mejor nota</div><div class="who">${nota.s.nota != null ? esc(pName(nota.p.id)) : '–'}</div><div class="stat num">${nota.s.nota != null ? fmt1(nota.s.nota) + ' promedio · ' + nota.s.nc + ' votos' : 'Nadie ha puesto notas aún'}</div></div>`}
  </div>` : '';
  const sortBtns = Object.entries(SORTS).map(([k, v]) => `<button class="chip" data-sort="${k}" aria-pressed="${S.sort === k}">${v.l}</button>`).join('');
  const hl = k => S.sort === k ? ' hl' : '';
  const lead = s => s.pj > 0 && SORTS[S.sort].f(s)[0] > 0;
  const rows = rk.map(({ p, s }, i) => `<tr data-player="${esc(p.id)}" class="${i === 0 && lead(s) ? 'top1' : ''}">
    <td class="pos"><span>${i + 1}</span></td>
    <td class="l"><span class="pname">${esc(p.apodo || p.nombre)}</span>${posTag(p)}${meTag(p)}</td>
    <td class="num">${s.pj}</td>
    <td class="num">${s.pg}-${s.pe}-${s.pp}</td>
    <td class="num${hl('pts')}">${s.pts}</td>
    <td class="num${hl('rend')}">${s.pj ? Math.round(s.rend * 100) + '%' : '–'}</td>
    <td class="num${hl('g')}">${s.g}</td>
    <td class="num${hl('a')}">${s.a}</td>
    <td class="num${hl('nota')}">${fmt1(s.nota)}</td>
    <td class="num${hl('mvp')}">${s.mvp}</td>
    <td class="l">${forma(s.forma)}</td></tr>`).join('');
  return `${vistasRank()}${pod}
  <div class="sec-h"><h2>Tabla</h2><div class="row">${sortBtns}</div></div>
  <div class="tbl-wrap"><table><thead><tr><th>#</th><th class="l">Jugador</th><th title="Partidos jugados">PJ</th><th title="Ganados-Empatados-Perdidos">G-E-P</th><th>Pts</th><th title="Puntos obtenidos sobre los posibles">Rend.</th><th>Goles</th><th>Asist.</th><th title="Promedio de las notas que le pusieron">Nota</th><th title="Veces que fue el de mejor nota del partido">Gatos</th><th class="l">Últimos 5</th></tr></thead><tbody>${rows}</tbody></table></div>
  <p class="muted small">Ganar vale 3 puntos y empatar 1. Las notas van del 1 al 10, las ponen los demás después de cada partido y nadie se pone nota a sí mismo.</p>
  ${vGatos()}`;
}
function emptyPlayers() {
  return `<div class="note empty"><h3>Todavía no hay nadie en el plantel</h3><p>Parte anotándote tú y después agrega al resto.</p><p><button class="btn pri" data-act="nuevo-yo">Anotarme</button></p></div>`;
}
function scorersLine(m) {
  const g = Object.entries(m.goles || {}).filter(([, n]) => +n > 0).sort((a, b) => b[1] - a[1]).map(([id, n]) => esc(pName(id)) + (n > 1 ? ` (${n})` : ''));
  return g.length ? 'Goles: ' + g.join(', ') : 'Sin goleadores anotados';
}
function vPartidos() {
  const head = `<div class="sec-h"><h2>Partidos</h2>${S.players.length ? `<button class="btn pri" data-act="new-match">Cargar resultado</button>` : ''}</div>`;
  if (!S.players.length) return head + emptyPlayers();
  if (!S.matches.length) return head + `<div class="note empty"><h3>Sin partidos cargados</h3><p>Después de cada partido, carga el marcador contra el rival, quiénes jugaron y quién hizo los goles. La tabla se arma sola.</p></div>`;
  const ms = [...S.matches].sort(byFecha).reverse();
  return head + `<div class="matches">${ms.map(m => { const a = +m.golesA || 0, b = +m.golesB || 0; return `<button class="match" data-match="${esc(m.id)}">
    <div class="row spread small muted"><span>${esc(fmtFecha(m.fecha, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }))}</span><span>${esc(m.lugar || '')}</span></div>
    <div class="score"><span class="t">${NOSOTROS}</span><span class="n num"><span class="${a > b ? 'win' : ''}">${a}</span> – <span class="${b > a ? 'win' : ''}">${b}</span></span><span class="t b">${esc(rivalDe(m))}</span></div>
    <div class="scorers">${scorersLine(m)}${(f => f.length ? ` · 🐱 Gato: ${esc(nombresFigura(f))}` : '')(figuras(m).ids)}</div></button>`; }).join('')}</div>`;
}
function vPlantel() {
  const st = stats();
  const head = `<div class="sec-h"><h2>Plantel <span class="muted num" style="font-size:20px">${S.players.length}</span></h2><button class="btn pri" data-act="${myPlayer() ? 'new-player' : 'nuevo-yo'}">${myPlayer() ? 'Agregar jugador' : 'Anotarme'}</button></div>`;
  if (!S.players.length) return head + emptyPlayers();
  const dn = p => p.numero == null || p.numero === '' ? 99 : +p.numero;
  const ps = [...S.players].sort((a, b) => dn(a) - dn(b) || (a.apodo || a.nombre).localeCompare(b.apodo || b.nombre));
  return head + `<div class="squad">${ps.map(p => { const s = st[p.id]; return `<button class="ficha" data-player="${esc(p.id)}">
    <span class="dorsal num">${esc(p.numero ?? '–')}</span>
    <span class="nm">${esc(p.apodo || p.nombre)}${meTag(p)}</span>
    <span class="ps">${esc(POS[p.posicion] || 'Sin posición')}${p.posicion2 ? ' / ' + esc(POS[p.posicion2]) : ''}</span>
    <span class="nota num"><span>${s.pj} PJ · ${s.g} G</span><span>Nota <b>${fmt1(s.nota)}</b></span></span></button>`; }).join('')}</div>`;
}
function vProxima() {
  const pr = S.proxima || {}, voy = new Set(S.anotados.map(a => a.id)), cup = +pr.cupos || 0, n = voy.size;
  const info = `<div class="sec-h"><h2>Próxima pichanga</h2><button class="btn" data-act="edit-prox">${pr.fecha ? 'Cambiar datos' : 'Poner fecha'}</button></div>
   <div class="row"><div class="cupo" aria-label="Cupos"><i style="width:${cup ? Math.min(100, n / cup * 100) : 0}%"></i></div><span class="num small"><b>${n}</b>${cup ? ' de ' + cup : ''} anotados${cup && n >= cup ? ' · ¡Completo!' : ''}</span></div>`;
  if (!S.players.length) return info + emptyPlayers();
  const me = myPlayer();
  const ps = [...S.players].sort((a, b) => (voy.has(b.id) - voy.has(a.id)) || ((b.id === me?.id) - (a.id === me?.id)) || (a.apodo || a.nombre).localeCompare(b.apodo || b.nombre));
  const lista = `<div class="lista">${ps.map(p => `<div class="it"><span><span class="pname">${esc(p.apodo || p.nombre)}</span>${posTag(p)}${meTag(p)}</span>
    <button class="btn voy" data-voy="${esc(p.id)}" aria-pressed="${voy.has(p.id)}">${voy.has(p.id) ? 'Voy' : 'Anotar'}</button></div>`).join('')}</div>`;
  const al = alin(), eq = al || n ? vAlineacion(al) : ''; // la cancha se ve apenas hay anotados
  return info + (n ? `<div class="row"><button class="btn" data-act="armar">${al ? 'Volver a ubicar por posición' : 'Ubicar a todos por su posición'}</button><button class="btn warn" data-act="limpiar">Vaciar lista</button></div>` : '') + eq + lista;
}
// Alineación de la próxima pichanga (queda guardada para todos), como en el FIFA: una formación
// de fútbol 6 o fútbol 5 con una casilla por titular; los demás anotados son suplentes (la banca).
// x, y: dónde va cada casilla en la cancha, en % (nuestro arco abajo).
const FORMACIONES = {
  '6:2-2-1': [['POR', 50, 87], ['DEF', 28, 66], ['DEF', 72, 66], ['MED', 28, 42], ['MED', 72, 42], ['DEL', 50, 17]],
  '6:2-1-2': [['POR', 50, 87], ['DEF', 28, 66], ['DEF', 72, 66], ['MED', 50, 43], ['DEL', 28, 18], ['DEL', 72, 18]],
  '6:1-2-2': [['POR', 50, 87], ['DEF', 50, 66], ['MED', 24, 44], ['MED', 76, 44], ['DEL', 30, 18], ['DEL', 70, 18]],
  '6:3-1-1': [['POR', 50, 87], ['DEF', 18, 64], ['DEF', 50, 67], ['DEF', 82, 64], ['MED', 50, 42], ['DEL', 50, 17]],
  '5:2-1-1': [['POR', 50, 87], ['DEF', 28, 65], ['DEF', 72, 65], ['MED', 50, 42], ['DEL', 50, 17]],
  '5:1-2-1': [['POR', 50, 87], ['DEF', 50, 66], ['MED', 24, 43], ['MED', 76, 43], ['DEL', 50, 17]],
  '5:2-2': [['POR', 50, 87], ['DEF', 28, 63], ['DEF', 72, 63], ['DEL', 28, 27], ['DEL', 72, 27]],
};
const FORM_DEF = '6:2-2-1';
let formElegida = FORM_DEF; // formación de la cancha vacía, antes de ubicar a nadie
// Reparte jugadores en las casillas de una formación: primero por su puesto, después por el segundo
// puesto y al final al que sobre (el arco queda vacío si no hay arquero). Los que no caben van a la banca.
function ubicar(f, ids, pref = {}) {
  const forma = FORMACIONES[f], slots = forma.map(() => null), libres = [...ids];
  const p1 = id => pref[id] || pById(id)?.posicion || 'MED';
  const llenar = cumple => forma.forEach(([p], i) => { if (slots[i]) return; const j = libres.findIndex(id => cumple(id, p)); if (j >= 0) slots[i] = libres.splice(j, 1)[0]; });
  llenar((id, p) => p1(id) === p);
  llenar((id, p) => pById(id)?.posicion === p);
  llenar((id, p) => pById(id)?.posicion2 === p);
  llenar((id, p) => p !== 'POR' && p1(id) !== 'POR');
  llenar((id, p) => p !== 'POR');
  return slots;
}
function alin() {
  const x = S.proxima?.alineacion; if (!x) return null;
  const f = FORMACIONES[x.formacion] ? x.formacion : FORM_DEF;
  let slots = Array.isArray(x.slots) && x.slots.length === FORMACIONES[f].length ? x.slots.map(id => id && pById(id) ? id : null)
    : Array.isArray(x.A) ? ubicar(f, x.A.filter(pById), x.pos || {}) : null; // alineación guardada antes de las formaciones
  if (!slots) return null;
  const vistos = new Set(); slots = slots.map(id => id && !vistos.has(id) ? (vistos.add(id), id) : null);
  return slots.some(Boolean) ? { formacion: f, slots } : null;
}
const titulares = al => (al?.slots || []).filter(Boolean);
const posAlin = al => Object.fromEntries((al?.slots || []).map((id, i) => [id, FORMACIONES[al.formacion][i][0]]).filter(([id]) => id));
const suplentes = al => S.anotados.map(a => a.id).filter(id => pById(id) && !titulares(al).includes(id));
const paraGuardar = al => al && al.slots.some(Boolean) ? { formacion: al.formacion, slots: al.slots, A: titulares(al), B: [], pos: posAlin(al) } : null;
let selJug = null, arrastre = null; // jugador elegido con un toque / arrastre en curso en la cancha
function guardarAlin(al, msg) {
  selJug = null;
  const d = paraGuardar(al);
  if (al) formElegida = al.formacion;
  S.proxima = { ...(S.proxima || {}), alineacion: d }; render(); // se ve al tiro; después se guarda
  guardarAlinCola(d, msg);
}
// Mueve a un jugador a una casilla ("slot:3") o a la banca. Si la casilla tenía a otro, se cambian de lugar.
function moverJugador(id, zona) {
  if (!necesitaJugador()) return;
  const al = alin() || { formacion: formElegida, slots: FORMACIONES[formElegida].map(() => null) };
  const desde = al.slots.indexOf(id);
  if (zona === 'banca') { if (desde < 0) { selJug = null; render(); return; } al.slots[desde] = null; }
  else {
    const i = +zona.split(':')[1]; if (!(i >= 0 && i < al.slots.length)) return;
    if (i === desde) { selJug = null; render(); return; }
    const otro = al.slots[i]; al.slots[i] = id;
    if (desde >= 0) al.slots[desde] = otro; // si venía de otra casilla, el otro toma su lugar; si venía de la banca, el otro va a la banca
  }
  guardarAlin(al, null);
}
function cambiarFormacion(f) {
  if (!FORMACIONES[f]) return;
  const al = alin();
  if (!al) { formElegida = f; render(); return; }
  if (!necesitaJugador()) return;
  guardarAlin({ formacion: f, slots: ubicar(f, titulares(al), posAlin(al)) }, null);
}
// Guarda los movimientos en orden (si mueves varios rápido, ninguno se pierde) y recién al final refresca.
let alinPend, alinMsg = null, alinGuardando = false;
async function guardarAlinCola(d, msg) {
  alinPend = d; alinMsg = msg || null; if (alinGuardando) return; alinGuardando = true;
  let bien = true;
  try {
    while (alinPend !== undefined) {
      const x = alinPend; alinPend = undefined; let r;
      try { r = await rpc('guardar_alineacion', { a: auth(), d: x }); } catch { toast('Sin conexión. No se guardó el cambio.'); bien = false; break; }
      if (!r.ok) { manejarError(r.error); bien = false; break; }
    }
  } finally { alinGuardando = false; alinPend = undefined; }
  if (bien && alinMsg) toast(alinMsg);
  alinMsg = null; refrescar();
}
function vAlineacion(al) {
  const f = al?.formacion || formElegida, forma = FORMACIONES[f], slots = al?.slots || forma.map(() => null);
  const voy = new Set(S.anotados.map(a => a.id)), tit = slots.filter(Boolean);
  const sobran = tit.filter(id => !voy.has(id)), banca = S.anotados.map(a => a.id).filter(id => pById(id) && !tit.includes(id));
  const st = stats();
  const carta = (id, p) => `<button type="button" class="jug carta${selJug === id ? ' sel' : ''}${sobran.includes(id) ? ' fuera' : ''}${id === SES.jugador ? ' yo' : ''}" data-jug="${esc(id)}">
    <span class="c-nota num">${st[id]?.nota != null ? fmt1(st[id].nota) : '–'}</span><span class="c-pos">${POS_CORTO[p]}</span><span class="c-nom">${esc(pName(id))}</span></button>`;
  const casilla = ([p, x, y], i) => `<div class="slot" data-zona="slot:${i}" style="left:${x}%;top:${y}%">${slots[i] ? carta(slots[i], p) : `<span class="vacio"><b>+</b>${POS_CORTO[p]}</span>`}</div>`;
  const fmt = f[0];
  return `<div class="sec-h"><h2>Alineación</h2>${tit.length ? '<button class="btn pri" data-act="usar-equipos">Usar en el partido</button>' : ''}</div>
    <div class="row" style="gap:6px"><button class="chip" data-fmt="6" aria-pressed="${fmt === '6'}">Fútbol 6</button><button class="chip" data-fmt="5" aria-pressed="${fmt === '5'}">Fútbol 5</button>
      <span class="muted small" style="margin-left:4px">Formación:</span>${Object.keys(FORMACIONES).filter(k => k[0] === fmt).map(k => `<button class="chip" data-form="${k}" aria-pressed="${k === f}">${k.slice(2)}</button>`).join('')}</div>
    ${sobran.length ? `<div class="note small">${esc(sobran.map(pName).join(', '))} ya no está${sobran.length > 1 ? 'n' : ''} anotado${sobran.length > 1 ? 's' : ''}. Llévalo${sobran.length > 1 ? 's' : ''} a la banca.</div>` : ''}
    <div class="cancha2"><span class="ln-circulo"></span><span class="ln-area"></span><span class="ln-chica"></span><span class="ln-media-luna"></span><span class="ln-penal"></span>
      ${forma.map(casilla).join('')}</div>
    <div class="row spread small"><span><strong>${NOSOTROS}</strong> · ${tit.length} de ${forma.length} en cancha${tit.length && !slots[0] ? ' · ⚠️ falta el arquero' : ''}</span><span class="muted">El número es su nota promedio</span></div>
    <div class="zona banca" data-zona="banca"><span class="zl">Suplentes · banca</span>${banca.map(id => `<button type="button" class="jug${selJug === id ? ' sel' : ''}" data-jug="${esc(id)}">${esc(pName(id))}</button>`).join('') || '<span class="muted small">Arrastra aquí a los suplentes</span>'}</div>
    <div class="row spread"><p class="muted small" style="margin:0">${selJug ? `Ahora toca dónde va <strong>${esc(pName(selJug))}</strong> (si hay alguien, se cambian de lugar).` : (tit.length ? 'Arrastra a cada jugador a una casilla, o tócalo y después toca dónde va. Si la casilla tiene a alguien, se cambian. Los suplentes quedan en la banca.' : 'Toca "Ubicar a todos por su posición" o arrastra a cada uno desde la banca a una casilla.')}</p>${tit.length ? '<button class="btn" data-act="alin-borrar">Borrar alineación</button>' : ''}</div>`;
}
// Ubica a los anotados en la formación según la posición de su ficha; los que no caben quedan en la banca.
function armar() {
  if (!necesitaJugador()) return;
  const f = alin()?.formacion || formElegida;
  guardarAlin({ formacion: f, slots: ubicar(f, S.anotados.map(a => a.id).filter(pById)) }, 'Listo: cada uno en su posición. Ajusta con el dedo si hace falta.');
}

/* ---------- hojas ---------- */
let sheetCtx = null;
function openSheet(title, body, ctx) {
  sheetCtx = ctx || null;
  $('#sheet-card').innerHTML = `<div class="sheet-head"><div>${title}</div><button class="x" data-act="close" aria-label="Cerrar">×</button></div><div class="sheet-body" id="sheet-body">${body}</div>`;
  $('#sheet').hidden = false; document.body.style.overflow = 'hidden';
}
function closeSheet() { $('#sheet').hidden = true; document.body.style.overflow = ''; sheetCtx = null; }
// Para acciones que necesitan saber quién eres.
function necesitaJugador() { if (myPlayer() || esAdmin()) return true; quienEres(); return false; }

function quienEres() {
  const ps = [...S.players].sort((a, b) => (a.apodo || a.nombre).localeCompare(b.apodo || b.nombre));
  openSheet(`<h2>¿Quién eres?</h2>`, `
    ${ps.length ? `<div class="lista">${ps.map(p => `<button class="it" data-elegir="${esc(p.id)}"><span><span class="pname">${esc(p.apodo || p.nombre)}</span>${posTag(p)}</span><span class="muted small">${esc(p.nombre !== (p.apodo || p.nombre) ? p.nombre : '')}</span></button>`).join('')}</div>` : '<p class="muted">Todavía no hay jugadores.</p>'}
    <button class="btn pri full" data-act="nuevo-yo">No estoy en la lista: anotarme</button>`, { type: 'quien' });
}
function pedirPin(id) {
  const p = pById(id); if (!p) return;
  openSheet(`<h2>${esc(p.apodo || p.nombre)}</h2>`, `<form id="f-pin" class="stack">
    <div class="field"><label for="pin-in">Tu PIN de 4 números</label><input id="pin-in" class="pin num" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="off" required></div>
    <button class="btn pri full" type="submit">Entrar</button>
    <p class="hint">¿Se te olvidó? El administrador te lo puede cambiar.</p></form>`, { type: 'pin', id });
  $('#pin-in')?.focus(); // sin espera, para que el iPhone abra el teclado
}
async function entrarJugador() {
  const pin = $('#pin-in').value.trim();
  if (!/^\d{4}$/.test(pin)) { toast(ERRORES.pin_formato); return; }
  let r;
  try { r = await rpc('entrar', { a: { grupo: SES.grupo, jugador: sheetCtx.id, pin } }); }
  catch { toast('Sin conexión. Inténtalo de nuevo.'); return; }
  if (!r.ok) { if (r.error === 'grupo' || r.error === 'clave_cambiada') manejarError(r.error); else toast(ERRORES[r.error] || 'No se pudo entrar.'); return; }
  S.misVotos = []; SES.jugador = sheetCtx.id; SES.pin = pin; guardarSes();
  closeSheet(); toast('¡Listo! Entraste como ' + pName(SES.jugador)); await refrescar();
}

function cuentaSheet() {
  const me = myPlayer();
  const ios = esIOS(), instalada = yaInstalada();
  openSheet(`<h2>Tu cuenta</h2>`, `
    <div class="stack">
      <div><div class="lbl2">Jugador</div><p style="margin:4px 0 8px">${me ? `Entraste como <strong>${esc(me.apodo || me.nombre)}</strong>.` : 'Todavía no eliges tu jugador.'}</p>
        <div class="row">${me ? `<button class="btn" data-act="edit-player" data-id="${esc(me.id)}">Editar mi ficha o PIN</button><button class="btn" data-act="salir-jugador">Cambiar de jugador</button>` : `<button class="btn pri" data-act="quien">Elegir mi jugador</button>`}</div></div>
      <div><div class="lbl2">Administrador</div>
        ${esAdmin() ? `<p style="margin:4px 0 8px">Estás en modo administrador: puedes editar cualquier ficha, cambiar PIN y borrar jugadores.</p>
          <div class="row"><button class="btn" data-act="respaldo">Descargar respaldo</button><button class="btn" data-act="papelera">Papelera de partidos</button><button class="btn" data-act="claves">Cambiar claves</button></div>
          <p class="small" style="margin:10px 0 6px">Registro de jugadores nuevos: <strong>${S.registroAbierto ? 'abierto' : 'cerrado'}</strong>. ${S.registroAbierto ? 'Cualquiera con la clave del grupo puede anotarse.' : 'Solo tú puedes agregar jugadores.'}</p>
          <div class="row"><button class="btn" data-act="registro">${S.registroAbierto ? 'Cerrar registro' : 'Abrir registro'}</button><button class="btn" data-act="salir-admin">Salir del modo administrador</button></div>
          <p class="hint">Cuando termines, sal del modo administrador: mientras esté activo, tu clave queda guardada en este celular.</p>`
        : `<form id="f-admin" class="row" style="margin-top:6px"><div class="field"><label for="adm-in">Clave de administrador</label><input id="adm-in" type="password" autocomplete="current-password" required></div><button class="btn" type="submit" style="align-self:flex-end">Activar</button></form>`}</div>
      ${instalada ? '' : `<div><div class="lbl2">Instalar en tu celular</div>
        ${instalarEvt ? `<p style="margin:4px 0 8px">Agrega Los Favoritos a tu pantalla de inicio como una app.</p><button class="btn pri" data-act="instalar">Instalar app</button>`
        : ios ? `<p style="margin:4px 0 0">En <strong>Safari</strong>, toca el botón Compartir (el cuadrado con flecha) y elige <strong>Agregar a inicio</strong>.</p>`
        : `<p style="margin:4px 0 0">En <strong>Chrome</strong>, abre el menú (tres puntos) y elige <strong>Instalar app</strong> o <strong>Agregar a pantalla principal</strong>.</p>`}
        <p class="hint">Si abriste el link desde WhatsApp, primero ábrelo en Safari o Chrome.</p></div>`}
      <div class="row spread"><span class="hint">Las claves quedan guardadas solo en este celular. Versión ${VERSION.slice(1)}.</span><button class="btn warn" data-act="salir-grupo">Cerrar sesión</button></div>
    </div>`, { type: 'cuenta' });
}
function registroOk() {
  if (S.registroAbierto || esAdmin()) return true;
  toast(ERRORES.registro_cerrado); return false;
}
function clavesForm() {
  openSheet(`<h2>Cambiar claves</h2>`, `<form id="f-claves" class="stack">
    <p class="muted small" style="margin:0">Deja en blanco la que no quieras cambiar. Si cambias la del grupo, todos tendrán que escribir la nueva: pásasela por interno.</p>
    <div class="field"><label for="cl-grupo">Nueva clave del grupo (mínimo 6)</label><input id="cl-grupo" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" minlength="6"></div>
    <div class="field"><label for="cl-admin">Nueva clave de administrador (mínimo 6)</label><input id="cl-admin" type="password" autocomplete="new-password" minlength="6"></div>
    <div class="row" style="justify-content:flex-end"><button class="btn pri" type="submit">Guardar claves</button></div></form>`, { type: 'claves' });
}
async function guardarClaves() {
  const g = $('#cl-grupo').value.trim(), ad = $('#cl-admin').value;
  if (!g && !ad) { toast('Escribe al menos una clave nueva.'); return; }
  let r; // sin accion(): refrescaría con la clave vieja antes de guardar la nueva
  try { r = await rpc('cambiar_claves', { a: auth(), p_grupo: g, p_admin: ad }); } catch { toast('Sin conexión. Inténtalo de nuevo.'); return; }
  if (!r.ok) { manejarError(r.error); return; }
  if (g) SES.grupo = g; if (ad) SES.admin = ad; guardarSes();
  closeSheet(); toast('Claves cambiadas'); refrescar();
}
async function descargarRespaldo() {
  let r;
  try { r = await rpc('respaldo', { a: auth() }); } catch { toast('Sin conexión. Inténtalo de nuevo.'); return; }
  if (!r.ok) { manejarError(r.error); return; }
  const nombre = 'los-favoritos-respaldo-' + today() + '.json';
  const archivo = new File([JSON.stringify(r, null, 1)], nombre, { type: 'application/json' });
  const listo = () => { try { localStorage.setItem('favoritos-ultimo-respaldo', String(Date.now())); } catch {} };
  if (navigator.canShare?.({ files: [archivo] })) {
    try { await navigator.share({ files: [archivo], title: nombre }); listo(); toast('Respaldo listo. Guárdalo en un lugar privado.'); render(); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(archivo), a = document.createElement('a');
  a.href = url; a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  listo(); toast('Respaldo descargado. Guárdalo en un lugar privado.'); render();
}
async function verPapelera() {
  let r;
  try { r = await rpc('papelera', { a: auth() }); } catch { toast('Sin conexión. Inténtalo de nuevo.'); return; }
  if (!r.ok) { manejarError(r.error); return; }
  const ps = r.partidos || [];
  openSheet(`<h2>Papelera</h2>`, `<p class="muted small" style="margin:0 0 8px">Los partidos borrados quedan aquí. Si alguien borró uno por error, recupéralo con sus notas y votos.</p>
    ${ps.length ? `<div class="lista">${ps.map(m => `<div class="it"><span><span class="num">${esc(fmtFecha(m.fecha, { day: 'numeric', month: 'short', year: 'numeric' }))} · ${+m.golesA}–${+m.golesB} vs ${esc(rivalDe(m))}</span> <span class="muted small">${esc(m.lugar || '')}</span></span><button class="btn" data-act="restaurar" data-id="${esc(m.id)}">Recuperar</button></div>`).join('')}</div>` : '<p class="muted">No hay partidos borrados.</p>'}`, { type: 'papelera' });
}
async function activarAdmin() {
  const clave = $('#adm-in').value;
  let r;
  try { r = await rpc('entrar', { a: { grupo: SES.grupo, admin: clave } }); }
  catch { toast('Sin conexión. Inténtalo de nuevo.'); return; }
  if (!r.ok) { if (r.error === 'grupo' || r.error === 'clave_cambiada') manejarError(r.error); else toast(ERRORES[r.error] || 'No se pudo activar.'); return; }
  SES.admin = clave; guardarSes(); closeSheet(); toast('Modo administrador activado'); render();
}

function playerForm(p, paraMi) {
  const me = myPlayer();
  const opt = sel => `<option value="">—</option>` + Object.entries(POS).map(([k, l]) => `<option value="${k}" ${sel === k ? 'selected' : ''}>${l}</option>`).join('');
  const nuevo = !p, puedePin = nuevo || esAdmin() || p.id === me?.id;
  const titulo = p ? 'Editar jugador' : paraMi ? 'Anotarme' : 'Nuevo jugador';
  const pinTxt = nuevo ? (paraMi ? 'Elige tu PIN de 4 números' : 'PIN de 4 números para él (díselo)') : 'Nuevo PIN (déjalo vacío para no cambiarlo)';
  openSheet(`<h2>${titulo}</h2>`, `
   <form id="f-player" class="stack">
    <div class="row"><div class="field"><label for="pf-nombre">Nombre</label><input id="pf-nombre" required maxlength="40" value="${esc(p?.nombre || '')}"></div>
      <div class="field"><label for="pf-apodo">Apodo (opcional)</label><input id="pf-apodo" maxlength="24" value="${esc(p?.apodo || '')}" placeholder="Así sale en la tabla"></div></div>
    <div class="row"><div class="field"><label for="pf-pos">Posición</label><select id="pf-pos">${opt(p?.posicion)}</select></div>
      <div class="field"><label for="pf-pos2">También juega de</label><select id="pf-pos2">${opt(p?.posicion2)}</select></div></div>
    <div class="row"><div class="field"><label for="pf-num">Número de camiseta</label><input id="pf-num" type="number" min="0" max="99" inputmode="numeric" value="${esc(p?.numero ?? '')}"></div>
      <div class="field"><label for="pf-pie">Pie hábil</label><select id="pf-pie">${['', 'Derecho', 'Izquierdo', 'Los dos'].map(v => `<option value="${v}" ${p?.pie === v ? 'selected' : ''}>${v || '—'}</option>`).join('')}</select></div></div>
    ${puedePin ? `<div class="field"><label for="pf-pin">${pinTxt}</label><input id="pf-pin" class="pin num" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="off" ${nuevo ? 'required' : ''}></div>` : ''}
    <div class="row spread">${p && esAdmin() ? (stats()[p.id].pj === 0 ? `<button type="button" class="btn warn" data-act="del-player" data-id="${esc(p.id)}">Eliminar</button>` : `<span class="hint">No se puede eliminar: ya jugó partidos.</span>`) : '<span></span>'}<button class="btn pri" type="submit">Guardar</button></div>
   </form>`, { type: 'player', id: p?.id, paraMi: !!paraMi });
}
async function savePlayer() {
  const v = id => $('#' + id)?.value.trim() || '';
  const nombre = v('pf-nombre'); if (!nombre) { toast('Falta el nombre'); return; }
  const d = { nombre, apodo: v('pf-apodo'), posicion: v('pf-pos'), posicion2: v('pf-pos2'), numero: v('pf-num'), pie: v('pf-pie') };
  const pin = v('pf-pin');
  if (pin && !/^\d{4}$/.test(pin)) { toast(ERRORES.pin_formato); return; }
  if (sheetCtx.id) {
    const r = await accion('editar_jugador', { p_id: sheetCtx.id, d, p_pin_nuevo: pin }, 'Jugador actualizado');
    if (r) { if (pin && sheetCtx.id === SES.jugador) { SES.pin = pin; guardarSes(); } closeSheet(); }
  } else {
    if (!pin) { toast(ERRORES.pin_formato); return; }
    const paraMi = sheetCtx.paraMi;
    const r = await accion('crear_jugador', { d, p_pin: pin }, paraMi ? '¡Te anotaste!' : 'Jugador agregado');
    if (r) { if (paraMi) { SES.jugador = r.id; SES.pin = pin; guardarSes(); render(); } closeSheet(); }
  }
}
function playerSheet(id) {
  const p = pById(id); if (!p) return; const s = stats()[id];
  const hist = [...S.matches].filter(m => (m.equipoA || []).includes(id) || (m.equipoB || []).includes(id)).sort(byFecha).reverse().slice(0, 8);
  const rows = hist.map(m => {
    const inA = (m.equipoA || []).includes(id), gf = inA ? +m.golesA || 0 : +m.golesB || 0, gc = inA ? +m.golesB || 0 : +m.golesA || 0, r = gf > gc ? 'G' : gf < gc ? 'P' : 'E', np = notasPartido(m.id)[id];
    return `<div class="prow"><span class="nm">${forma([r])} ${esc(fmtFecha(m.fecha))} <span class="num">${gf}–${gc}</span> <span class="muted small">vs ${esc(rivalDe(m))}</span></span><span class="small muted num">${+m.goles?.[id] ? m.goles[id] + ' G ' : ''}${+m.asist?.[id] ? m.asist[id] + ' A ' : ''}${figuras(m).ids.includes(id) ? '· 🐱 Gato ' : ''}${np ? `· nota ${fmt1(np.avg)}` : ''}</span></div>`;
  }).join('');
  const puedeEditar = esAdmin() || id === SES.jugador;
  openSheet(`<h2>${esc(p.apodo || p.nombre)}</h2><div class="small" style="opacity:.85">${esc(p.nombre)}${p.numero != null ? ' · #' + esc(p.numero) : ''} · ${esc(POS[p.posicion] || 'Sin posición')}${p.posicion2 ? ' / ' + esc(POS[p.posicion2]) : ''}${p.pie ? ' · Pie ' + esc(p.pie.toLowerCase()) : ''}</div>`, `
    <div class="statgrid num">
     <div><div class="v">${fmt1(s.nota)}</div><div class="k">Nota (${s.nc})</div></div>
     <div><div class="v">${s.pj}</div><div class="k">Jugados</div></div>
     <div><div class="v">${s.pg}-${s.pe}-${s.pp}</div><div class="k">G-E-P</div></div>
     <div><div class="v">${s.pts}</div><div class="k">Puntos</div></div>
     <div><div class="v">${s.g}</div><div class="k">Goles</div></div>
     <div><div class="v">${s.a}</div><div class="k">Asist.</div></div>
     <div><div class="v">${s.mvp}</div><div class="k">Gatos</div></div>
     <div><div class="v">${s.pj ? (s.g / s.pj).toFixed(1).replace('.', ',') : '–'}</div><div class="k">Goles/PJ</div></div>
    </div>
    ${(c => Object.keys(c).length ? `<p class="small muted" style="margin:0">Puestos jugados: ${Object.entries(c).sort((x, y) => y[1] - x[1]).map(([k, n]) => `${POS_ICO[k]} ${POS[k]} ${n}`).join(' · ')}</p>` : '')(S.matches.reduce((c, m) => { if ((m.equipoA || []).includes(id) || (m.equipoB || []).includes(id)) { const k = posDe(m, id); if (k) c[k] = (c[k] || 0) + 1; } return c; }, {}))}
    <div><div class="lbl2">Últimos partidos</div>${rows || '<p class="muted">Todavía no juega ningún partido cargado.</p>'}</div>
    ${puedeEditar ? `<div class="row"><button class="btn" data-act="edit-player" data-id="${esc(id)}">Editar datos${esAdmin() ? ' o PIN' : ''}</button></div>` : ''}`, { type: 'pview', id });
}

/* formulario de partido */
let draft = null;
function matchForm(m, pre) {
  draft = m ? { id: m.id, fecha: m.fecha, lugar: m.lugar || '', asign: {}, goles: { ...m.goles }, asist: { ...m.asist }, golesA: +m.golesA || 0, golesB: +m.golesB || 0, mvp: m.mvp || '', pos: { ...(m.posiciones || {}) }, rival: m.rival || '', tocado: false }
    : { fecha: (pre && S.proxima?.fecha) || today(), lugar: S.proxima?.lugar || '', asign: {}, goles: {}, asist: {}, golesA: 0, golesB: 0, mvp: '', pos: {}, rival: '', tocado: false };
  if (m) {
    (m.equipoA || []).forEach(id => draft.asign[id] = 'A');
    const ga = draft.golesA; syncScore();
    if (draft.golesA !== ga) { draft.golesA = ga; draft.tocado = true; }
  }
  if (pre) { pre.A.forEach(id => draft.asign[id] = 'A'); Object.assign(draft.pos, pre.pos || {}); }
  for (const id of Object.keys(draft.asign)) draft.pos[id] ||= pById(id)?.posicion || '';
  const voy = new Set(S.anotados.map(a => a.id));
  draft.orden = [...S.players].sort((a, b) => (!!draft.asign[b.id] - !!draft.asign[a.id]) || (voy.has(b.id) - voy.has(a.id)) || (a.apodo || a.nombre).localeCompare(b.apodo || b.nombre)).map(p => p.id);
  openSheet(`<h2>${m ? 'Editar partido' : 'Cargar resultado'}</h2>`, `<div id="mf"></div>`, { type: 'match' });
  renderMatchForm();
}
function renderMatchForm() {
  const d = draft;
  const ps = d.orden.map(pById).filter(Boolean);
  $('#mf').innerHTML = `<div class="stack">
   <div class="row"><div class="field"><label for="mf-fecha">Fecha</label><input id="mf-fecha" type="date" value="${esc(d.fecha)}"></div>
    <div class="field"><label for="mf-lugar">Cancha</label><input id="mf-lugar" maxlength="50" value="${esc(d.lugar)}" placeholder="Ej: Club Ñuñoa, cancha 3"></div></div>
   <div class="field"><label for="mf-rival">Rival</label><input id="mf-rival" maxlength="40" value="${esc(d.rival)}" placeholder="Nombre del otro equipo (opcional)"></div>
   <div class="bigscore"><div class="side"><span>${NOSOTROS}</span><input id="mf-ga" class="num" type="number" min="0" max="99" inputmode="numeric" value="${d.golesA}" aria-label="Goles nuestros"></div>
    <span class="muted" style="font-family:var(--f-display);font-size:32px">–</span>
    <div class="side"><span>${esc(d.rival || 'Rival')}</span><input id="mf-gb" class="num" type="number" min="0" max="99" inputmode="numeric" value="${d.golesB}" aria-label="Goles del rival"></div></div>
   <div><div class="lbl2">Quiénes jugaron</div><p class="muted small" style="margin:2px 0 4px">Marca a los que jugaron (titulares y los que entraron), dónde jugó más cada uno (Arq, Def, Vol o Del) y súmale sus goles (G) y asistencias (A). Nuestro marcador se va sumando solo; los goles del rival ponlos a mano.</p>
   ${ps.map(p => { const t = d.asign[p.id] || ''; return `<div class="prow"><span class="nm">${esc(p.apodo || p.nombre)}${t ? ` <select class="possel" data-pos="${esc(p.id)}" aria-label="Puesto de ${esc(p.apodo || p.nombre)}"><option value="">Puesto</option>${Object.keys(POS).map(k => `<option value="${k}" ${d.pos[p.id] === k ? 'selected' : ''}>${POS_CORTO[k]}</option>`).join('')}</select>` : posTag(p)}</span>
     <span class="row" style="gap:8px">${t ? `<span class="step">G<button type="button" data-st="goles" data-id="${esc(p.id)}" data-d="-1" aria-label="Quitar gol">−</button><b class="num">${+d.goles[p.id] || 0}</b><button type="button" data-st="goles" data-id="${esc(p.id)}" data-d="1" aria-label="Sumar gol">+</button></span>
       <span class="step">A<button type="button" data-st="asist" data-id="${esc(p.id)}" data-d="-1" aria-label="Quitar asistencia">−</button><b class="num">${+d.asist[p.id] || 0}</b><button type="button" data-st="asist" data-id="${esc(p.id)}" data-d="1" aria-label="Sumar asistencia">+</button></span>` : ''}
     <span class="seg"><button type="button" class="b" data-asig="A" data-id="${esc(p.id)}" aria-pressed="${!!t}">Jugó</button><button type="button" data-asig="" data-id="${esc(p.id)}" aria-pressed="${!t}">No</button></span></span></div>`; }).join('')}</div>
   <div class="row spread">${d.id ? `<button type="button" class="btn warn" data-act="del-match">Borrar partido</button>` : '<span></span>'}<button type="button" class="btn pri" data-act="save-match">Guardar partido</button></div></div>`;
}
function syncScore() {
  if (draft.tocado) return;
  const sum = t => Object.entries(draft.goles).filter(([id]) => draft.asign[id] === t).reduce((s, [, n]) => s + (+n || 0), 0);
  draft.golesA = sum('A'); // los goles del rival se ponen a mano
}
function keepInputs() {
  const g = id => $('#' + id); if (!g('mf-fecha')) return;
  draft.fecha = g('mf-fecha').value; draft.lugar = g('mf-lugar').value; draft.rival = g('mf-rival').value; draft.golesB = +g('mf-gb').value || 0;
  if (draft.tocado) draft.golesA = +g('mf-ga').value || 0;
}
async function saveMatch() {
  const d = draft;
  d.fecha = $('#mf-fecha').value || today(); d.lugar = $('#mf-lugar').value.trim(); d.rival = $('#mf-rival').value.trim();
  d.golesA = Math.max(0, +$('#mf-ga').value || 0); d.golesB = Math.max(0, +$('#mf-gb').value || 0);
  const A = Object.keys(d.asign).filter(id => d.asign[id] === 'A');
  if (!A.length) { toast(ERRORES.equipos); return; }
  if (A.reduce((s, id) => s + (+d.goles[id] || 0), 0) > d.golesA) { toast(ERRORES.goles); return; }
  const limpio = o => Object.fromEntries(Object.entries(o).filter(([id, n]) => +n > 0 && d.asign[id]));
  const datos = { fecha: d.fecha, lugar: d.lugar, rival: d.rival, equipoA: A, equipoB: [], golesA: d.golesA, golesB: d.golesB, goles: limpio(d.goles), asist: limpio(d.asist), mvp: d.asign[d.mvp] ? d.mvp : '',
    posiciones: Object.fromEntries(Object.entries(d.pos).filter(([id, v]) => v && d.asign[id])) };
  const r = await accion('guardar_partido', { p_id: d.id || null, d: datos }, 'Partido guardado. La tabla ya se actualizó.');
  if (r) { closeSheet(); S.view = 'partidos'; render(); }
}

/* detalle de partido + notas */
let myRates = {}, rateCtx = null;
function matchSheet(id) {
  const m = S.matches.find(x => x.id === id); if (!m) return;
  const a = +m.golesA || 0, b = +m.golesB || 0, np = notasPartido(id), me = myPlayer();
  const mine = me ? S.misVotos.find(n => n.matchId === id) : null;
  const nv = +S.votantes[id] || 0;
  const fig = figuras(m);
  const team = ids => `<div class="team"><h3><span>${NOSOTROS}</span><span class="num">${a} – ${b}</span></h3><ul>${ids.map(pid => `<li><span>${esc(pName(pid))}${fig.ids.includes(pid) ? ' <span class="me-tag">🐱 GATO</span>' : ''}</span><span class="small muted num">${+m.goles?.[pid] ? m.goles[pid] + ' G ' : ''}${+m.asist?.[pid] ? m.asist[pid] + ' A ' : ''}${np[pid] ? `<span class="badge-n">${fmt1(np[pid].avg)}</span>` : ''}</span></li>`).join('')}</ul></div>`;
  const votables = [...(m.equipoA || []), ...(m.equipoB || [])].filter(pid => pById(pid) && pid !== me?.id);
  myRates = Object.fromEntries(Object.entries(mine?.notas || {}).filter(([pid]) => votables.includes(pid)));
  rateCtx = { mid: id, votables, existia: !!mine };
  const rateRows = votables.map(pid => `<div class="prow"><span class="nm">${esc(pName(pid))}</span><span class="rate">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => `<button type="button" data-rate="${n}" data-id="${esc(pid)}" aria-pressed="${+myRates[pid] === n}">${n}</button>`).join('')}</span></div>`).join('');
  openSheet(`<h2>${resultado(a, b)} <span class="num">${a} – ${b}</span></h2><div class="small" style="opacity:.85">vs ${esc(rivalDe(m))} · ${esc(fmtFecha(m.fecha, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}${m.lugar ? ' · ' + esc(m.lugar) : ''}</div>`, `
   <div class="teams">${team(m.equipoA || [])}</div>
   <p class="muted small" style="margin:0">Votaron ${nv}. Los votos son secretos: la nota de cada uno (el número amarillo) aparece cuando lo califican al menos ${S.minVotos}, así nadie puede adivinar qué puso otro. 🐱 El gato del partido es el de mejor nota.</p>
   ${me && S.errorJugador === 'bloqueado' ? `<div class="note small">Tu PIN quedó bloqueado unos minutos por intentos fallidos. Vuelve a abrir el partido más rato para votar.</div>`
    : me && !jugo(id, me.id) ? `<div class="note small">Solo ponen notas los que jugaron este partido.</div>`
    : me ? `<div><div class="lbl2">Tus notas${mine ? ' (ya votaste, puedes cambiarlas)' : ''}</div><p class="muted small" style="margin:2px 0 4px">Del 1 al 10. Tu nota es una más en el promedio. A ti no te aparece: nadie se pone nota a sí mismo.</p>${rateRows || '<p class="muted">No hay a quién ponerle nota.</p>'}
     <div class="row" style="justify-content:flex-end;margin-top:8px"><button class="btn pri" data-act="save-rates">Guardar mis notas</button></div></div>`
    : `<div class="note cta small"><span>Para poner notas, primero elige tu jugador.</span><button class="btn pri" data-act="quien">Elegir</button></div>`}
   <div class="row"><button class="btn" data-act="edit-match" data-id="${esc(id)}">Editar partido</button></div>`, { type: 'mview', id });
}
async function saveRates() {
  if (!myPlayer()) { quienEres(); return; }
  const notas = Object.fromEntries(Object.entries(myRates).filter(([pid, n]) => +n >= 1 && +n <= 10 && rateCtx.votables.includes(pid)));
  const vacio = !Object.keys(notas).length;
  if (vacio && !rateCtx.existia) { toast('Pon al menos una nota'); return; }
  const r = await accion('votar', { p_match: rateCtx.mid, p_notas: notas }, vacio ? 'Borraste tus notas de este partido' : 'Notas guardadas');
  if (r) closeSheet();
}

function proxForm() {
  const pr = S.proxima || {};
  openSheet(`<h2>Próxima pichanga</h2>`, `<form id="f-prox" class="stack">
   <div class="row"><div class="field"><label for="px-fecha">Fecha</label><input id="px-fecha" type="date" value="${esc(pr.fecha || '')}"></div>
    <div class="field"><label for="px-hora">Hora</label><input id="px-hora" type="time" value="${esc(pr.hora || '')}"></div></div>
   <div class="row"><div class="field"><label for="px-lugar">Cancha</label><input id="px-lugar" maxlength="50" value="${esc(pr.lugar || '')}"></div>
    <div class="field"><label for="px-cupos">Cupos</label><input id="px-cupos" type="number" min="0" max="40" inputmode="numeric" value="${esc(pr.cupos || '')}" placeholder="Ej: 10"></div></div>
   <div class="row" style="justify-content:flex-end"><button class="btn pri" type="submit">Guardar</button></div></form>`, { type: 'prox' });
}
async function saveProx() {
  const d = { fecha: $('#px-fecha').value, hora: $('#px-hora').value, lugar: $('#px-lugar').value.trim(), cupos: $('#px-cupos').value };
  const r = await accion('guardar_proxima', { d }, 'Datos de la pichanga guardados');
  if (r) closeSheet();
}

/* ---------- eventos ---------- */
let armedDel = null, armedTxt = '', armedT, busy = false;
function disarm() { if (armedDel) { armedDel.classList.remove('on'); armedDel.textContent = armedTxt; armedDel = null; } }
function arm(t, msg) { disarm(); armedDel = t; armedTxt = t.textContent; t.classList.add('on'); t.textContent = msg; clearTimeout(armedT); armedT = setTimeout(disarm, 4000); }
// Evita guardar dos veces si tocan el botón seguido.
async function once(fn) { if (busy) return; busy = true; try { await fn(); } finally { busy = false; } }

document.addEventListener('click', async e => {
  if (arrastre?.solto) { arrastre = null; return; } // el clic que sigue a soltar un arrastre
  const jz = e.target.closest('[data-jug],[data-zona]');
  if (jz?.dataset.jug) {
    const otro = jz.dataset.jug;
    if (!selJug || selJug === otro) { selJug = selJug ? null : otro; render(); return; }
    const slots = alin()?.slots || [], en = id => slots.indexOf(id);
    if (en(selJug) < 0 && en(otro) < 0) { selJug = otro; render(); return; } // los dos en la banca: cambia el elegido
    if (en(otro) >= 0) moverJugador(selJug, 'slot:' + en(otro)); // a la casilla del otro (se cambian)
    else moverJugador(otro, 'slot:' + en(selJug)); // titular elegido + suplente: entra el suplente
    return;
  }
  if (jz && selJug) { moverJugador(selJug, jz.dataset.zona); return; }
  const t = e.target.closest('button,[data-player],[data-match]');
  if (armedDel && t !== armedDel) disarm();
  if (e.target.id === 'sheet') { closeSheet(); return; }
  if (!t) return;
  const ds = t.dataset;
  if (t.classList.contains('tab')) { S.view = ds.v; try { localStorage.setItem('favoritos-vista', S.view); } catch {} render(); window.scrollTo(0, 0); return; }
  if (ds.sort) { S.sort = ds.sort; render(); return; }
  if (ds.rpos !== undefined) { S.rankPos = ds.rpos; render(); return; }
  if (ds.psort) { S.posSort = ds.psort; render(); return; }
  if (ds.fmt) { const f = alin()?.formacion || formElegida; if (f[0] !== ds.fmt) cambiarFormacion(Object.keys(FORMACIONES).find(k => k[0] === ds.fmt)); return; }
  if (ds.form) { if (ds.form !== (alin()?.formacion || formElegida)) cambiarFormacion(ds.form); return; }
  if (ds.elegir) { pedirPin(ds.elegir); return; }
  if (ds.voy) { if (!necesitaJugador()) return; const on = t.getAttribute('aria-pressed') === 'true'; once(() => accion('anotar', { p_player: ds.voy, p_voy: !on })); return; }
  if (ds.asig !== undefined && draft) {
    keepInputs();
    if (ds.asig) { draft.asign[ds.id] = ds.asig; draft.pos[ds.id] ||= pById(ds.id)?.posicion || ''; }
    else { delete draft.asign[ds.id]; delete draft.pos[ds.id]; delete draft.goles[ds.id]; delete draft.asist[ds.id]; if (draft.mvp === ds.id) draft.mvp = ''; }
    syncScore(); renderMatchForm(); return;
  }
  if (ds.st && draft) { keepInputs(); const o = draft[ds.st]; o[ds.id] = Math.max(0, (+o[ds.id] || 0) + (+ds.d)); if (ds.st === 'goles') syncScore(); renderMatchForm(); return; }
  if (ds.rate) { const cur = +myRates[ds.id]; myRates[ds.id] = cur === +ds.rate ? 0 : +ds.rate; t.closest('.rate').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.rate === myRates[ds.id]))); return; }
  if (ds.player && !ds.act) { playerSheet(ds.player); return; }
  if (ds.match) { matchSheet(ds.match); return; }
  switch (ds.act) {
    case 'close': closeSheet(); break;
    case 'reintentar': boot(); break;
    case 'cuenta': cuentaSheet(); break;
    case 'quien': quienEres(); break;
    case 'nuevo-yo': if (registroOk()) playerForm(null, true); break;
    case 'new-player': if (registroOk()) playerForm(null, false); break;
    case 'claves': clavesForm(); break;
    case 'registro': once(async () => { if (await accion('registro', { p_abierto: !S.registroAbierto }, S.registroAbierto ? 'Registro cerrado: solo tú puedes agregar jugadores' : 'Registro abierto')) cuentaSheet(); }); break;
    case 'respaldo': once(descargarRespaldo); break;
    case 'papelera': once(verPapelera); break;
    case 'restaurar': once(async () => { if (await accion('restaurar_partido', { p_id: ds.id }, 'Partido recuperado')) verPapelera(); }); break;
    case 'edit-player': playerForm(pById(ds.id)); break;
    case 'del-player':
      if (armedDel !== t) { arm(t, '¿Seguro? Toca otra vez'); return; }
      disarm(); once(async () => { if (await accion('borrar_jugador', { p_id: ds.id }, 'Jugador eliminado')) closeSheet(); }); break;
    case 'new-match': if (necesitaJugador()) matchForm(null); break;
    case 'edit-match': if (necesitaJugador()) matchForm(S.matches.find(m => m.id === ds.id)); break;
    case 'save-match': once(saveMatch); break;
    case 'del-match':
      if (armedDel !== t) { arm(t, '¿Seguro? Toca otra vez'); return; }
      disarm(); once(async () => { if (await accion('borrar_partido', { p_id: draft.id }, 'Partido borrado. El administrador lo puede recuperar.')) closeSheet(); }); break;
    case 'save-rates': once(saveRates); break;
    case 'edit-prox': if (necesitaJugador()) proxForm(); break;
    case 'armar': armar(); break;
    case 'usar-equipos': { const al = alin(); if (al && necesitaJugador()) matchForm(null, { A: [...titulares(al), ...suplentes(al)], pos: posAlin(al) }); } break;
    case 'alin-borrar': if (necesitaJugador()) { if (armedDel !== t) { arm(t, '¿Borrar? Toca otra vez'); return; } disarm(); guardarAlin(null, 'Alineación borrada'); } break;
    case 'actualizar': location.reload(); break;
    case 'limpiar':
      if (!necesitaJugador()) return;
      if (armedDel !== t) { arm(t, '¿Vaciar? Toca otra vez'); return; }
      disarm(); once(() => accion('vaciar_anotados', {}, 'Lista vaciada')); break;
    case 'salir-jugador': olvidarJugador(); closeSheet(); render(); quienEres(); break;
    case 'salir-admin': delete SES.admin; guardarSes(); closeSheet(); toast('Saliste del modo administrador'); render(); break;
    case 'salir-grupo': SES = {}; guardarSes(); closeSheet(); S.pantalla = 'grupo'; render(); break;
    case 'instalar': if (instalarEvt) {
      const ev = instalarEvt; instalarEvt = null; bannerOculto = true; closeSheet(); refrescarBanner();
      ev.prompt(); ev.userChoice.then(c => { if (c.outcome === 'accepted') recienInstalada = true; }).catch(() => {});
    } break;
    case 'no-instalar': sinBanner = true; try { localStorage.setItem('favoritos-sin-banner', '1'); } catch {} refrescarBanner(); break;
  }
});
document.addEventListener('change', e => { if (e.target.id === 'periodo') { S.periodo = e.target.value; render(); } });
document.addEventListener('input', e => {
  if (!draft) return;
  if (e.target.dataset?.pos) { draft.pos[e.target.dataset.pos] = e.target.value; return; }
  if (e.target.id === 'mf-gb') { draft.golesB = +e.target.value || 0; return; }
  if (e.target.id === 'mf-rival') { draft.rival = e.target.value; const l = e.target.closest('.stack')?.querySelector('.bigscore .side:last-child span'); if (l) l.textContent = e.target.value.trim() || 'Rival'; return; }
  if (e.target.id === 'mf-ga') { draft.tocado = true; draft.golesA = +e.target.value || 0; }
});
document.addEventListener('submit', async e => {
  e.preventDefault();
  const id = e.target.id;
  if (id === 'f-player') once(savePlayer);
  else if (id === 'f-prox') once(saveProx);
  else if (id === 'f-pin') once(entrarJugador);
  else if (id === 'f-admin') once(activarAdmin);
  else if (id === 'f-claves') once(guardarClaves);
  else if (id === 'f-grupo') once(entrarGrupo);
  else if (id === 'f-setup') once(configurar);
});
document.addEventListener('pointerdown', e => {
  if (arrastre?.solto) arrastre = null;
  if (arrastre) return; // otro dedo mientras se arrastra
  const j = e.target.closest('[data-jug]'); if (!j || e.button > 0) return;
  arrastre = { id: j.dataset.jug, x: e.clientX, y: e.clientY, el: j, pid: e.pointerId, fantasma: null };
});
window.addEventListener('pointermove', e => {
  const a = arrastre; if (!a || a.solto || e.pointerId !== a.pid) return;
  if (!a.fantasma) {
    if (Math.hypot(e.clientX - a.x, e.clientY - a.y) < 8) return;
    a.fantasma = a.el.cloneNode(true); a.fantasma.classList.add('fantasma'); document.body.appendChild(a.fantasma); a.el.classList.add('origen');
  }
  e.preventDefault();
  a.fantasma.style.left = e.clientX + 'px'; a.fantasma.style.top = e.clientY + 'px';
  if (e.clientY < 70) window.scrollBy(0, -14); else if (e.clientY > innerHeight - 70) window.scrollBy(0, 14); // la cancha no cabe entera en el celular
  const z = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-zona]');
  document.querySelectorAll('[data-zona].drop').forEach(x => x !== z && x.classList.remove('drop')); z?.classList.add('drop');
}, { passive: false });
function terminarArrastre(e, soltar) {
  const a = arrastre; if (!a || a.solto || e.pointerId !== a.pid) return;
  if (!a.fantasma) { arrastre = null; return; } // fue un toque: lo maneja el clic
  a.fantasma.remove(); a.el.classList.remove('origen'); document.querySelectorAll('[data-zona].drop').forEach(x => x.classList.remove('drop'));
  a.solto = true; setTimeout(() => { if (arrastre === a) arrastre = null; }, 400);
  const z = soltar && document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-zona]');
  if (z) moverJugador(a.id, z.dataset.zona); else render();
}
window.addEventListener('pointerup', e => terminarArrastre(e, true));
document.addEventListener('contextmenu', e => { if (e.target.closest('[data-jug]')) e.preventDefault(); });
window.addEventListener('pointercancel', e => terminarArrastre(e, false));
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet(); });

async function entrarGrupo() {
  const clave = $('#g-clave').value.trim(); if (!clave) return;
  let r;
  try { r = await rpc('entrar', { a: { grupo: clave } }); }
  catch { toast('Sin conexión. Inténtalo de nuevo.'); return; }
  if (!r.ok) { toast(ERRORES[r.error] || 'No se pudo entrar.'); return; }
  SES = { grupo: clave }; guardarSes();
  await refrescar();
  if (!myPlayer()) S.players.length ? quienEres() : playerForm(null, true);
}
async function configurar() {
  const grupo = $('#su-grupo').value.trim(), admin = $('#su-admin').value;
  let r;
  try { r = await rpc('configurar', { p_grupo: grupo, p_admin: admin }); }
  catch { toast('Sin conexión. Inténtalo de nuevo.'); return; }
  if (!r.ok) {
    toast({ grupo_corto: 'La clave del grupo debe tener al menos 6 caracteres.', admin_corto: 'La clave de administrador debe tener al menos 6 caracteres.', iguales: 'Las dos claves tienen que ser distintas.', ya_configurado: 'La app ya estaba configurada. Entra con la clave del grupo.' }[r.error] || 'No se pudo guardar.');
    if (r.error === 'ya_configurado') { S.pantalla = 'grupo'; render(); }
    return;
  }
  SES = { grupo, admin }; guardarSes();
  await refrescar();
  playerForm(null, true);
}

/* ---------- instalación y arranque ---------- */
let instalarEvt = null;
let sinBanner = false, bannerOculto = false, recienInstalada = false; // bannerOculto: solo hasta recargar
try { sinBanner = localStorage.getItem('favoritos-sin-banner') === '1'; } catch {}
const esIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (/macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
const yaInstalada = () => recienInstalada || matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
// Aviso visible para instalar, solo en celulares (en el computador queda en Tu cuenta).
function bannerInstalar(puerta) {
  const movil = esIOS() || /android/i.test(navigator.userAgent);
  if (yaInstalada() || sinBanner || bannerOculto || !movil) return `<div id="instalar-slot"></div>`;
  const como = instalarEvt ? 'Queda con su ícono, como cualquier app.'
    : esIOS() ? 'En <strong>Safari</strong>, toca Compartir (el cuadrado con flecha) y elige <strong>Agregar a inicio</strong>.'
    : 'En <strong>Chrome</strong>, abre el menú (tres puntos) y elige <strong>Instalar app</strong> o <strong>Agregar a pantalla principal</strong>.';
  const ojo = instalarEvt ? '' : `<span class="hint">Si no ves esa opción, abre el link en ${esIOS() ? 'Safari' : 'Chrome'} (no dentro de WhatsApp).</span>`;
  const antes = puerta && esIOS() ? ' Hazlo antes de entrar: la app instalada te pide la clave de nuevo.' : '';
  return `<div id="instalar-slot" class="note cta instalar${puerta ? ' en-puerta' : ''}">
    <span><strong>Instala Los Favoritos en tu celular.</strong> ${como}${antes} ${ojo}</span>
    <span class="row">${instalarEvt ? '<button class="btn pri" data-act="instalar">Instalar app</button>' : ''}<button class="btn" data-act="no-instalar">Ahora no</button></span></div>`;
}
function refrescarBanner() {
  const slot = $('#instalar-slot');
  if (slot) slot.outerHTML = bannerInstalar(S.pantalla === 'grupo');
}
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); instalarEvt = e; refrescarBanner(); });
window.addEventListener('appinstalled', () => { instalarEvt = null; recienInstalada = true; refrescarBanner(); });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
// Avisa cuando hay una versión publicada más nueva que la que está corriendo.
let hayNueva = false;
async function revisarVersion() {
  if (hayNueva) return;
  try {
    const r = await fetch('/version.json', { cache: 'no-store' }); if (!r.ok) return;
    const v = (await r.json()).v;
    if (v && v !== VERSION) { hayNueva = true; if (S.pantalla === 'app') render(); }
  } catch {}
}
setInterval(() => { if (document.visibilityState === 'visible') revisarVersion(); }, 5 * 60000);

async function boot() {
  revisarVersion();
  try { const v = localStorage.getItem('favoritos-vista'); if (VISTAS.includes(v)) S.view = v; } catch {}
  if (CONFIG.supabaseUrl.includes('TU-PROYECTO')) { S.pantalla = 'config'; render(); return; }
  if (SES.grupo) {
    S.pantalla = 'cargando'; render(); await refrescar();
    if (S.pantalla === 'cargando') { S.pantalla = 'error'; render(); }
    return;
  }
  try { S.pantalla = (await rpc('configurado')) ? 'grupo' : 'setup'; }
  catch { S.pantalla = 'error'; }
  render();
}
setInterval(() => { if (document.visibilityState === 'visible' && S.pantalla === 'app') refrescar(); }, 20000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { revisarVersion(); if (S.pantalla === 'app') refrescar(); } });
boot();

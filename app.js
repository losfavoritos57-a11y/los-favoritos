import { CONFIG } from './config.js';

const POS = { POR: 'Arquero', DEF: 'Defensa', MED: 'Volante', DEL: 'Delantero' };
const TEAM = { A: 'Con peto', B: 'Sin peto' };
const VISTAS = ['ranking', 'partidos', 'plantel', 'proxima'];
const S = { players: [], matches: [], notas: [], anotados: [], proxima: null, cargado: false, sinRed: false,
  view: 'ranking', sort: 'pts', equipos: null, pantalla: 'cargando' };

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
  grupo: 'El PIN del grupo no es correcto.',
  pin: 'Ese PIN no corresponde a ese jugador.',
  admin: 'El PIN de administrador no es correcto.',
  bloqueado: 'Demasiados intentos fallidos. Espera 15 minutos y vuelve a probar.',
  sin_jugador: 'Primero dinos quién eres.',
  pin_formato: 'El PIN tiene que ser de 4 números.',
  datos: 'Algún dato no es válido. Revísalo.',
  equipos: 'Marca al menos un jugador en cada equipo, sin repetir.',
  goles: 'Hay más goles de jugadores que goles en el marcador.',
  tiene_partidos: 'No se puede borrar: ya jugó partidos.',
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
  if (code === 'grupo') { SES = {}; guardarSes(); S.pantalla = 'grupo'; closeSheet(); render(); }
  else if (code === 'sin_configurar') { SES = {}; guardarSes(); S.pantalla = 'setup'; closeSheet(); render(); }
  else if (code === 'bloqueado') { if (S.pantalla !== 'app') { S.pantalla = 'bloqueado'; render(); } }
  else if (code === 'pin' || code === 'jugador') { if (SES.jugador) { delete SES.jugador; delete SES.pin; guardarSes(); render(); } }
  else if (code === 'admin') { delete SES.admin; guardarSes(); render(); }
  else if (code === 'sin_jugador') { quienEres(); }
}
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
  if (!SES.grupo) return;
  let r;
  try { r = await rpc('estado', { a: { grupo: SES.grupo } }); }
  catch { S.sinRed = true; render(); return; }
  S.sinRed = false;
  if (!r.ok) { manejarError(r.error); return; }
  S.players = r.players || []; S.matches = r.matches || []; S.notas = r.notas || [];
  S.anotados = r.anotados || []; S.proxima = r.proxima || null; S.cargado = true;
  if (SES.jugador && !pById(SES.jugador)) { delete SES.jugador; delete SES.pin; guardarSes(); }
  if (S.equipos) {
    const ids = new Set(S.anotados.map(a => a.id)), eq = [...S.equipos.A, ...S.equipos.B];
    if (eq.length !== ids.size || eq.some(id => !ids.has(id))) S.equipos = null;
  }
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
const valida = (n, id) => n.rater !== id && jugo(n.matchId, id) && jugo(n.matchId, n.rater);
// Figura del partido: la votan los que jugaron. Gana el más votado (si empatan, todos). Partidos viejos usan la elegida al cargarlos.
function figuras(m) {
  const votos = {};
  for (const n of S.notas) if (n.matchId === m.id && n.figura && valida(n, n.figura)) votos[n.figura] = (votos[n.figura] || 0) + 1;
  const max = Math.max(0, ...Object.values(votos));
  if (!max) return { ids: m.mvp ? [m.mvp] : [], votos };
  return { ids: Object.keys(votos).filter(id => votos[id] === max), votos };
}
const nombresFigura = ids => new Intl.ListFormat('es-CL').format(ids.map(pName));
function stats() {
  const st = {};
  const P = id => st[id] ??= { pj: 0, pg: 0, pe: 0, pp: 0, g: 0, a: 0, mvp: 0, ns: 0, nc: 0, gf: 0, gc: 0, forma: [] };
  S.players.forEach(p => P(p.id));
  for (const m of [...S.matches].sort(byFecha)) {
    const ga = +m.golesA || 0, gb = +m.golesB || 0;
    for (const [team, gf, gc] of [[m.equipoA || [], ga, gb], [m.equipoB || [], gb, ga]])
      for (const id of team) { const s = P(id), r = gf > gc ? 'G' : gf < gc ? 'P' : 'E'; s.pj++; s.gf += gf; s.gc += gc; s[{ G: 'pg', E: 'pe', P: 'pp' }[r]]++; s.forma.push(r); }
    for (const [id, n] of Object.entries(m.goles || {})) P(id).g += +n || 0;
    for (const [id, n] of Object.entries(m.asist || {})) P(id).a += +n || 0;
    for (const id of figuras(m).ids) P(id).mvp++;
  }
  for (const n of S.notas) for (const [id, v] of Object.entries(n.notas || {})) { const x = +v; if (x >= 1 && x <= 10 && valida(n, id)) { P(id).ns += x; P(id).nc++; } }
  for (const s of Object.values(st)) { s.pts = 3 * s.pg + s.pe; s.rend = s.pj ? s.pts / (3 * s.pj) : 0; s.nota = s.nc ? s.ns / s.nc : null; s.forma = s.forma.slice(-5); }
  return st;
}
function notasPartido(mid) {
  const acc = {};
  for (const n of S.notas) if (n.matchId === mid) for (const [id, v] of Object.entries(n.notas || {})) { const x = +v; if (x >= 1 && x <= 10 && valida(n, id)) (acc[id] ??= []).push(x); }
  const out = {}; for (const [id, a] of Object.entries(acc)) out[id] = { avg: a.reduce((s, x) => s + x, 0) / a.length, n: a.length };
  return out;
}
const SORTS = {
  pts: { l: 'Puntos', f: s => [s.pts, s.rend, s.g] },
  rend: { l: 'Rendimiento', f: s => [s.pj ? s.rend : -1, s.pj, s.pts] },
  g: { l: 'Goleadores', f: s => [s.g, -s.pj] },
  a: { l: 'Asistencias', f: s => [s.a, -s.pj] },
  nota: { l: 'Mejor nota', f: s => [s.nota ?? -1, s.nc] },
  mvp: { l: 'Figuras', f: s => [s.mvp, s.pts] },
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
  if (S.sinRed) html += `<div class="note">Sin conexión. Lo que ves puede no estar al día.</div>`;
  html += bannerInstalar(false);
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

function vRanking() {
  if (!S.players.length) return emptyPlayers();
  const st = stats(), rk = ranked(st, S.sort);
  const best = k => ranked(st, k)[0];
  const lider = best('pts'), gol = best('g'), nota = best('nota');
  const pod = S.matches.length ? `<div class="podio">
    <div><div class="lbl">Puntero</div><div class="who">${esc(pName(lider.p.id))}</div><div class="stat num">${lider.s.pts} pts en ${lider.s.pj} PJ</div></div>
    <div><div class="lbl">Goleador</div><div class="who">${gol.s.g ? esc(pName(gol.p.id)) : '–'}</div><div class="stat num">${gol.s.g} goles</div></div>
    <div><div class="lbl">Mejor nota</div><div class="who">${nota.s.nota != null ? esc(pName(nota.p.id)) : '–'}</div><div class="stat num">${nota.s.nota != null ? fmt1(nota.s.nota) + ' promedio · ' + nota.s.nc + ' votos' : 'Nadie ha puesto notas aún'}</div></div>
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
  return `${pod}
  <div class="sec-h"><h2>Tabla</h2><div class="row">${sortBtns}</div></div>
  <div class="tbl-wrap"><table><thead><tr><th>#</th><th class="l">Jugador</th><th title="Partidos jugados">PJ</th><th title="Ganados-Empatados-Perdidos">G-E-P</th><th>Pts</th><th title="Puntos obtenidos sobre los posibles">Rend.</th><th>Goles</th><th>Asist.</th><th title="Promedio de las notas que le pusieron">Nota</th><th title="Veces elegido figura del partido">Figura</th><th class="l">Últimos 5</th></tr></thead><tbody>${rows}</tbody></table></div>
  <p class="muted small">Ganar vale 3 puntos y empatar 1. Las notas van del 1 al 10, las ponen los demás después de cada partido y nadie se pone nota a sí mismo.</p>`;
}
function emptyPlayers() {
  return `<div class="note empty"><h3>Todavía no hay nadie en el plantel</h3><p>Parte anotándote tú y después agrega al resto.</p><p><button class="btn pri" data-act="nuevo-yo">Anotarme</button></p></div>`;
}
function scorersLine(m) {
  const g = Object.entries(m.goles || {}).filter(([, n]) => +n > 0).sort((a, b) => b[1] - a[1]).map(([id, n]) => esc(pName(id)) + (n > 1 ? ` (${n})` : ''));
  return g.length ? 'Goles: ' + g.join(', ') : 'Sin goleadores anotados';
}
function vPartidos() {
  const head = `<div class="sec-h"><h2>Partidos</h2>${S.players.length > 1 ? `<button class="btn pri" data-act="new-match">Cargar resultado</button>` : ''}</div>`;
  if (!S.players.length) return head + emptyPlayers();
  if (!S.matches.length) return head + `<div class="note empty"><h3>Sin partidos cargados</h3><p>Después de cada pichanga, carga el marcador, quién jugó en cada equipo y quién hizo los goles. La tabla se arma sola.</p></div>`;
  const ms = [...S.matches].sort(byFecha).reverse();
  return head + `<div class="matches">${ms.map(m => { const a = +m.golesA || 0, b = +m.golesB || 0; return `<button class="match" data-match="${esc(m.id)}">
    <div class="row spread small muted"><span>${esc(fmtFecha(m.fecha, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }))}</span><span>${esc(m.lugar || '')}</span></div>
    <div class="score"><span class="t">${TEAM.A}</span><span class="n num"><span class="${a > b ? 'win' : ''}">${a}</span> – <span class="${b > a ? 'win' : ''}">${b}</span></span><span class="t b">${TEAM.B}</span></div>
    <div class="scorers">${scorersLine(m)}${(f => f.length ? ` · Figura: ${esc(nombresFigura(f))}` : '')(figuras(m).ids)}</div></button>`; }).join('')}</div>`;
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
  let eq = '';
  if (S.equipos) {
    const st = stats();
    eq = `<div class="sec-h"><h2>Equipos sugeridos</h2><div class="row"><button class="btn" data-act="armar">Mezclar de nuevo</button><button class="btn pri" data-act="usar-equipos">Usar en el partido</button></div></div>
    <div class="teams">${['A', 'B'].map(k => { const ids = S.equipos[k], fz = ids.reduce((t, id) => t + fuerza(st, id), 0); return `<div class="team"><h3><span>${TEAM[k]}</span><span class="num muted">${fmt1(fz / (ids.length || 1))}</span></h3><ul>${ids.map(id => `<li><span>${esc(pName(id))}${posTag(pById(id) || {})}</span><span class="num muted">${fmt1(fuerza(st, id))}</span></li>`).join('')}</ul></div>`; }).join('')}</div>
    <p class="muted small">El número es el promedio de notas de cada uno (6,0 si todavía no tiene). Los arqueros quedan uno por lado.</p>`;
  }
  return info + `<div class="row"><button class="btn" data-act="armar" ${n < 2 ? 'disabled' : ''}>Armar equipos parejos</button>${n ? `<button class="btn warn" data-act="limpiar">Vaciar lista</button>` : ''}</div>` + eq + lista;
}
const fuerza = (st, id) => st[id]?.nota ?? 6;
function armar() {
  const st = stats(), ids = S.anotados.map(a => a.id).filter(pById);
  const j = {}; ids.forEach(id => j[id] = fuerza(st, id) + Math.random() * 0.8);
  const arq = ids.filter(id => pById(id).posicion === 'POR').sort((a, b) => j[b] - j[a]);
  const resto = ids.filter(id => pById(id).posicion !== 'POR').sort((a, b) => j[b] - j[a]);
  const A = [], B = [], sum = t => t.reduce((s, id) => s + fuerza(st, id), 0), cap = Math.ceil(ids.length / 2);
  arq.forEach((id, i) => (i % 2 ? B : A).push(id));
  for (const id of resto) { const tA = B.length >= cap || (A.length < cap && sum(A) <= sum(B)); (tA ? A : B).push(id); }
  S.equipos = { A, B }; render();
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
  if (!r.ok) { toast(ERRORES[r.error] || 'No se pudo entrar.'); if (r.error === 'grupo') manejarError('grupo'); return; }
  SES.jugador = sheetCtx.id; SES.pin = pin; guardarSes();
  closeSheet(); toast('¡Listo! Entraste como ' + pName(SES.jugador)); render();
}

function cuentaSheet() {
  const me = myPlayer();
  const ios = esIOS(), instalada = yaInstalada();
  openSheet(`<h2>Tu cuenta</h2>`, `
    <div class="stack">
      <div><div class="lbl2">Jugador</div><p style="margin:4px 0 8px">${me ? `Entraste como <strong>${esc(me.apodo || me.nombre)}</strong>.` : 'Todavía no eliges tu jugador.'}</p>
        <div class="row">${me ? `<button class="btn" data-act="edit-player" data-id="${esc(me.id)}">Editar mi ficha o PIN</button><button class="btn" data-act="salir-jugador">Cambiar de jugador</button>` : `<button class="btn pri" data-act="quien">Elegir mi jugador</button>`}</div></div>
      <div><div class="lbl2">Administrador</div>
        ${esAdmin() ? `<p style="margin:4px 0 8px">Estás en modo administrador: puedes editar cualquier ficha, cambiar PIN y borrar jugadores.</p><button class="btn" data-act="salir-admin">Salir del modo administrador</button>`
        : `<form id="f-admin" class="row" style="margin-top:6px"><div class="field"><label for="adm-in">Clave de administrador</label><input id="adm-in" type="password" autocomplete="current-password" required></div><button class="btn" type="submit" style="align-self:flex-end">Activar</button></form>`}</div>
      ${instalada ? '' : `<div><div class="lbl2">Instalar en tu celular</div>
        ${instalarEvt ? `<p style="margin:4px 0 8px">Agrega Los Favoritos a tu pantalla de inicio como una app.</p><button class="btn pri" data-act="instalar">Instalar app</button>`
        : ios ? `<p style="margin:4px 0 0">En <strong>Safari</strong>, toca el botón Compartir (el cuadrado con flecha) y elige <strong>Agregar a inicio</strong>.</p>`
        : `<p style="margin:4px 0 0">En <strong>Chrome</strong>, abre el menú (tres puntos) y elige <strong>Instalar app</strong> o <strong>Agregar a pantalla principal</strong>.</p>`}
        <p class="hint">Si abriste el link desde WhatsApp, primero ábrelo en Safari o Chrome.</p></div>`}
      <div class="row spread"><span class="hint">Las claves quedan guardadas solo en este celular.</span><button class="btn warn" data-act="salir-grupo">Cerrar sesión</button></div>
    </div>`, { type: 'cuenta' });
}
async function activarAdmin() {
  const clave = $('#adm-in').value;
  let r;
  try { r = await rpc('entrar', { a: { grupo: SES.grupo, admin: clave } }); }
  catch { toast('Sin conexión. Inténtalo de nuevo.'); return; }
  if (!r.ok) { toast(ERRORES[r.error] || 'No se pudo activar.'); return; }
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
    return `<div class="prow"><span class="nm">${forma([r])} ${esc(fmtFecha(m.fecha))} <span class="num">${gf}–${gc}</span></span><span class="small muted num">${+m.goles?.[id] ? m.goles[id] + ' G ' : ''}${+m.asist?.[id] ? m.asist[id] + ' A ' : ''}${figuras(m).ids.includes(id) ? '· Figura ' : ''}${np ? `· nota ${fmt1(np.avg)}` : ''}</span></div>`;
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
     <div><div class="v">${s.mvp}</div><div class="k">Figura</div></div>
     <div><div class="v">${s.pj ? (s.g / s.pj).toFixed(1).replace('.', ',') : '–'}</div><div class="k">Goles/PJ</div></div>
    </div>
    <div><div class="lbl2">Últimos partidos</div>${rows || '<p class="muted">Todavía no juega ningún partido cargado.</p>'}</div>
    ${puedeEditar ? `<div class="row"><button class="btn" data-act="edit-player" data-id="${esc(id)}">Editar datos${esAdmin() ? ' o PIN' : ''}</button></div>` : ''}`, { type: 'pview', id });
}

/* formulario de partido */
let draft = null;
function matchForm(m, pre) {
  draft = m ? { id: m.id, fecha: m.fecha, lugar: m.lugar || '', asign: {}, goles: { ...m.goles }, asist: { ...m.asist }, golesA: +m.golesA || 0, golesB: +m.golesB || 0, mvp: m.mvp || '', tocado: false }
    : { fecha: (pre && S.proxima?.fecha) || today(), lugar: S.proxima?.lugar || '', asign: {}, goles: {}, asist: {}, golesA: 0, golesB: 0, mvp: '', tocado: false };
  if (m) {
    (m.equipoA || []).forEach(id => draft.asign[id] = 'A'); (m.equipoB || []).forEach(id => draft.asign[id] = 'B');
    const ga = draft.golesA, gb = draft.golesB; syncScore();
    if (draft.golesA !== ga || draft.golesB !== gb) { draft.golesA = ga; draft.golesB = gb; draft.tocado = true; }
  }
  if (pre) { pre.A.forEach(id => draft.asign[id] = 'A'); pre.B.forEach(id => draft.asign[id] = 'B'); }
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
   <div class="bigscore"><div class="side"><span>${TEAM.A}</span><input id="mf-ga" class="num" type="number" min="0" max="99" inputmode="numeric" value="${d.golesA}" aria-label="Goles ${TEAM.A}"></div>
    <span class="muted" style="font-family:var(--f-display);font-size:32px">–</span>
    <div class="side"><span>${TEAM.B}</span><input id="mf-gb" class="num" type="number" min="0" max="99" inputmode="numeric" value="${d.golesB}" aria-label="Goles ${TEAM.B}"></div></div>
   <div><div class="lbl2">Quién jugó y en qué equipo</div><p class="muted small" style="margin:2px 0 4px">Marca el equipo de cada uno y súmale sus goles (G) y asistencias (A). El marcador se va sumando solo.</p>
   ${ps.map(p => { const t = d.asign[p.id] || ''; return `<div class="prow"><span class="nm">${esc(p.apodo || p.nombre)}${posTag(p)}</span>
     <span class="row" style="gap:8px">${t ? `<span class="step">G<button type="button" data-st="goles" data-id="${esc(p.id)}" data-d="-1" aria-label="Quitar gol">−</button><b class="num">${+d.goles[p.id] || 0}</b><button type="button" data-st="goles" data-id="${esc(p.id)}" data-d="1" aria-label="Sumar gol">+</button></span>
       <span class="step">A<button type="button" data-st="asist" data-id="${esc(p.id)}" data-d="-1" aria-label="Quitar asistencia">−</button><b class="num">${+d.asist[p.id] || 0}</b><button type="button" data-st="asist" data-id="${esc(p.id)}" data-d="1" aria-label="Sumar asistencia">+</button></span>` : ''}
     <span class="seg"><button type="button" class="a" data-asig="A" data-id="${esc(p.id)}" aria-pressed="${t === 'A'}">Peto</button><button type="button" data-asig="" data-id="${esc(p.id)}" aria-pressed="${!t}">No</button><button type="button" class="b" data-asig="B" data-id="${esc(p.id)}" aria-pressed="${t === 'B'}">Sin</button></span></span></div>`; }).join('')}</div>
   <div class="row spread">${d.id ? `<button type="button" class="btn warn" data-act="del-match">Borrar partido</button>` : '<span></span>'}<button type="button" class="btn pri" data-act="save-match">Guardar partido</button></div></div>`;
}
function syncScore() {
  if (draft.tocado) return;
  const sum = t => Object.entries(draft.goles).filter(([id]) => draft.asign[id] === t).reduce((s, [, n]) => s + (+n || 0), 0);
  draft.golesA = sum('A'); draft.golesB = sum('B');
}
function keepInputs() {
  const g = id => $('#' + id); if (!g('mf-fecha')) return;
  draft.fecha = g('mf-fecha').value; draft.lugar = g('mf-lugar').value;
  if (draft.tocado) { draft.golesA = +g('mf-ga').value || 0; draft.golesB = +g('mf-gb').value || 0; }
}
async function saveMatch() {
  const d = draft;
  d.fecha = $('#mf-fecha').value || today(); d.lugar = $('#mf-lugar').value.trim();
  d.golesA = Math.max(0, +$('#mf-ga').value || 0); d.golesB = Math.max(0, +$('#mf-gb').value || 0);
  const A = Object.keys(d.asign).filter(id => d.asign[id] === 'A'), B = Object.keys(d.asign).filter(id => d.asign[id] === 'B');
  if (!A.length || !B.length) { toast(ERRORES.equipos); return; }
  const ind = t => t.reduce((s, id) => s + (+d.goles[id] || 0), 0);
  if (ind(A) > d.golesA || ind(B) > d.golesB) { toast(ERRORES.goles); return; }
  const limpio = o => Object.fromEntries(Object.entries(o).filter(([id, n]) => +n > 0 && d.asign[id]));
  const datos = { fecha: d.fecha, lugar: d.lugar, equipoA: A, equipoB: B, golesA: d.golesA, golesB: d.golesB, goles: limpio(d.goles), asist: limpio(d.asist), mvp: d.asign[d.mvp] ? d.mvp : '' };
  const r = await accion('guardar_partido', { p_id: d.id || null, d: datos }, 'Partido guardado. La tabla ya se actualizó.');
  if (r) { closeSheet(); S.view = 'partidos'; render(); }
}

/* detalle de partido + notas */
let myRates = {}, myFigura = '', rateCtx = null;
function matchSheet(id) {
  const m = S.matches.find(x => x.id === id); if (!m) return;
  const a = +m.golesA || 0, b = +m.golesB || 0, np = notasPartido(id), me = myPlayer();
  const mine = me ? S.notas.find(n => n.matchId === id && n.rater === me.id) : null;
  const fig = figuras(m);
  const team = (k, ids) => `<div class="team"><h3><span>${TEAM[k]}</span><span class="num">${k === 'A' ? a : b}</span></h3><ul>${ids.map(pid => `<li><span>${esc(pName(pid))}${fig.ids.includes(pid) ? ' <span class="me-tag">FIGURA</span>' : ''}${fig.votos[pid] ? ` <span class="small muted">(${fig.votos[pid]} ${fig.votos[pid] === 1 ? 'voto' : 'votos'})</span>` : ''}</span><span class="small muted num">${+m.goles?.[pid] ? m.goles[pid] + ' G ' : ''}${+m.asist?.[pid] ? m.asist[pid] + ' A ' : ''}${np[pid] ? `<span class="badge-n">${fmt1(np[pid].avg)}</span>` : ''}</span></li>`).join('')}</ul></div>`;
  const votables = [...(m.equipoA || []), ...(m.equipoB || [])].filter(pid => pById(pid) && pid !== me?.id);
  myRates = Object.fromEntries(Object.entries(mine?.notas || {}).filter(([pid]) => votables.includes(pid)));
  myFigura = votables.includes(mine?.figura) ? mine.figura : '';
  rateCtx = { mid: id, votables, existia: !!mine };
  const rateRows = votables.map(pid => `<div class="prow"><span class="nm">${esc(pName(pid))}</span><span class="rate">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => `<button type="button" data-rate="${n}" data-id="${esc(pid)}" aria-pressed="${+myRates[pid] === n}">${n}</button>`).join('')}</span></div>`).join('');
  openSheet(`<h2 class="num">${a} – ${b}</h2><div class="small" style="opacity:.85">${esc(fmtFecha(m.fecha, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}${m.lugar ? ' · ' + esc(m.lugar) : ''}</div>`, `
   <div class="teams">${team('A', m.equipoA || [])}${team('B', m.equipoB || [])}</div>
   <p class="muted small" style="margin:0">El número amarillo es la nota promedio que le pusieron los demás en este partido.</p>
   ${me && !jugo(id, me.id) ? `<div class="note small">Solo ponen notas y votan la figura los que jugaron este partido.</div>`
    : me ? `<div><div class="lbl2">Tus notas${mine ? ' (ya votaste, puedes cambiar tu voto)' : ''}</div><p class="muted small" style="margin:2px 0 4px">Del 1 al 10. Tu nota es una más en el promedio. A ti no te aparece: nadie se pone nota a sí mismo.</p>${rateRows || '<p class="muted">No hay a quién ponerle nota.</p>'}
     ${votables.length ? `<div class="lbl2" style="margin-top:14px">Tu figura del partido</div><p class="muted small" style="margin:2px 0 6px">Gana el más votado. No puedes votarte a ti mismo.</p>
     <div class="row figs" style="gap:6px">${votables.map(pid => `<button type="button" class="chip" data-fig="${esc(pid)}" aria-pressed="${myFigura === pid}">${esc(pName(pid))}</button>`).join('')}</div>` : ''}
     <div class="row" style="justify-content:flex-end;margin-top:8px"><button class="btn pri" data-act="save-rates">Guardar mi voto</button></div></div>`
    : `<div class="note cta small"><span>Para poner notas y votar la figura, primero elige tu jugador.</span><button class="btn pri" data-act="quien">Elegir</button></div>`}
   <div class="row"><button class="btn" data-act="edit-match" data-id="${esc(id)}">Editar partido</button></div>`, { type: 'mview', id });
}
async function saveRates() {
  if (!myPlayer()) { quienEres(); return; }
  const notas = Object.fromEntries(Object.entries(myRates).filter(([pid, n]) => +n >= 1 && +n <= 10 && rateCtx.votables.includes(pid)));
  const figura = rateCtx.votables.includes(myFigura) ? myFigura : null;
  const vacio = !Object.keys(notas).length && !figura;
  if (vacio && !rateCtx.existia) { toast('Pon al menos una nota o elige tu figura'); return; }
  const r = await accion('votar', { p_match: rateCtx.mid, p_notas: notas, p_figura: figura }, vacio ? 'Borraste tu voto de este partido' : 'Voto guardado');
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
  const t = e.target.closest('button,[data-player],[data-match]');
  if (armedDel && t !== armedDel) disarm();
  if (e.target.id === 'sheet') { closeSheet(); return; }
  if (!t) return;
  const ds = t.dataset;
  if (t.classList.contains('tab')) { S.view = ds.v; try { localStorage.setItem('favoritos-vista', S.view); } catch {} render(); window.scrollTo(0, 0); return; }
  if (ds.sort) { S.sort = ds.sort; render(); return; }
  if (ds.elegir) { pedirPin(ds.elegir); return; }
  if (ds.voy) { if (!necesitaJugador()) return; const on = t.getAttribute('aria-pressed') === 'true'; once(() => accion('anotar', { p_player: ds.voy, p_voy: !on })); return; }
  if (ds.asig !== undefined && draft) {
    keepInputs();
    if (ds.asig) draft.asign[ds.id] = ds.asig;
    else { delete draft.asign[ds.id]; delete draft.goles[ds.id]; delete draft.asist[ds.id]; if (draft.mvp === ds.id) draft.mvp = ''; }
    syncScore(); renderMatchForm(); return;
  }
  if (ds.st && draft) { keepInputs(); const o = draft[ds.st]; o[ds.id] = Math.max(0, (+o[ds.id] || 0) + (+ds.d)); if (ds.st === 'goles') syncScore(); renderMatchForm(); return; }
  if (ds.fig) { myFigura = myFigura === ds.fig ? '' : ds.fig; t.closest('.figs').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.fig === myFigura))); return; }
  if (ds.rate) { const cur = +myRates[ds.id]; myRates[ds.id] = cur === +ds.rate ? 0 : +ds.rate; t.closest('.rate').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.rate === myRates[ds.id]))); return; }
  if (ds.player && !ds.act) { playerSheet(ds.player); return; }
  if (ds.match) { matchSheet(ds.match); return; }
  switch (ds.act) {
    case 'close': closeSheet(); break;
    case 'reintentar': boot(); break;
    case 'cuenta': cuentaSheet(); break;
    case 'quien': quienEres(); break;
    case 'nuevo-yo': playerForm(null, true); break;
    case 'new-player': playerForm(null, false); break;
    case 'edit-player': playerForm(pById(ds.id)); break;
    case 'del-player':
      if (armedDel !== t) { arm(t, '¿Seguro? Toca otra vez'); return; }
      disarm(); once(async () => { if (await accion('borrar_jugador', { p_id: ds.id }, 'Jugador eliminado')) closeSheet(); }); break;
    case 'new-match': if (necesitaJugador()) matchForm(null); break;
    case 'edit-match': if (necesitaJugador()) matchForm(S.matches.find(m => m.id === ds.id)); break;
    case 'save-match': once(saveMatch); break;
    case 'del-match':
      if (armedDel !== t) { arm(t, '¿Seguro? Toca otra vez'); return; }
      disarm(); once(async () => { if (await accion('borrar_partido', { p_id: draft.id }, 'Partido borrado')) closeSheet(); }); break;
    case 'save-rates': once(saveRates); break;
    case 'edit-prox': if (necesitaJugador()) proxForm(); break;
    case 'armar': armar(); break;
    case 'usar-equipos': if (S.equipos && necesitaJugador()) matchForm(null, S.equipos); break;
    case 'limpiar':
      if (!necesitaJugador()) return;
      if (armedDel !== t) { arm(t, '¿Vaciar? Toca otra vez'); return; }
      disarm(); once(async () => { if (await accion('vaciar_anotados', {}, 'Lista vaciada')) { S.equipos = null; render(); } }); break;
    case 'salir-jugador': delete SES.jugador; delete SES.pin; guardarSes(); closeSheet(); render(); quienEres(); break;
    case 'salir-admin': delete SES.admin; guardarSes(); closeSheet(); toast('Saliste del modo administrador'); render(); break;
    case 'salir-grupo': SES = {}; guardarSes(); closeSheet(); S.pantalla = 'grupo'; render(); break;
    case 'instalar': if (instalarEvt) {
      const ev = instalarEvt; instalarEvt = null; bannerOculto = true; closeSheet(); refrescarBanner();
      ev.prompt(); ev.userChoice.then(c => { if (c.outcome === 'accepted') recienInstalada = true; }).catch(() => {});
    } break;
    case 'no-instalar': sinBanner = true; try { localStorage.setItem('favoritos-sin-banner', '1'); } catch {} refrescarBanner(); break;
  }
});
document.addEventListener('input', e => { if (e.target.id === 'mf-ga' || e.target.id === 'mf-gb') { draft.tocado = true; draft.golesA = +$('#mf-ga').value || 0; draft.golesB = +$('#mf-gb').value || 0; } });
document.addEventListener('submit', async e => {
  e.preventDefault();
  const id = e.target.id;
  if (id === 'f-player') once(savePlayer);
  else if (id === 'f-prox') once(saveProx);
  else if (id === 'f-pin') once(entrarJugador);
  else if (id === 'f-admin') once(activarAdmin);
  else if (id === 'f-grupo') once(entrarGrupo);
  else if (id === 'f-setup') once(configurar);
});
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

async function boot() {
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
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.pantalla === 'app') refrescar(); });
boot();

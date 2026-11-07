-- Los Favoritos: base de datos para Supabase.
-- Pegar completo en Supabase > SQL Editor > Run. Se puede volver a correr sin perder datos.
--
-- Seguridad: las tablas no se pueden leer ni escribir directo desde la app.
-- Todo pasa por funciones que revisan el PIN del grupo y el PIN de cada jugador
-- en el servidor. Los PIN se guardan cifrados (bcrypt) y hay bloqueo tras varios
-- intentos fallidos.

create extension if not exists pgcrypto with schema extensions;

-- ---------- tablas ----------
create table if not exists public.config (
  id int primary key default 1 check (id = 1),
  grupo_hash text not null,
  admin_hash text not null
);
-- Si es false, solo el administrador puede crear jugadores nuevos.
alter table public.config add column if not exists registro_abierto boolean not null default true;
-- Clave del grupo anterior: quien entra con ella recibe "la clave cambió" sin sumar intentos fallidos
-- (si no, los amigos con la clave vieja bloquearían la entrada de todos).
alter table public.config add column if not exists grupo_hash_anterior text;

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (char_length(nombre) between 1 and 40),
  apodo text not null default '' check (char_length(apodo) <= 24),
  posicion text not null default '' check (posicion in ('', 'POR', 'DEF', 'MED', 'DEL')),
  posicion2 text not null default '' check (posicion2 in ('', 'POR', 'DEF', 'MED', 'DEL')),
  numero int check (numero between 0 and 99),
  pie text not null default '' check (pie in ('', 'Derecho', 'Izquierdo', 'Los dos')),
  pin_hash text not null,
  creado timestamptz not null default now()
);

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  fecha date not null,
  lugar text not null default '' check (char_length(lugar) <= 50),
  equipo_a uuid[] not null,
  equipo_b uuid[] not null,
  goles_a int not null check (goles_a between 0 and 99),
  goles_b int not null check (goles_b between 0 and 99),
  goles jsonb not null default '{}',
  asist jsonb not null default '{}',
  mvp uuid,
  creado_por uuid,
  creado timestamptz not null default now()
);
-- Partidos borrados quedan en la papelera (el administrador los puede recuperar).
alter table public.matches add column if not exists borrado timestamptz;

create table if not exists public.notas (
  match_id uuid not null references public.matches(id) on delete cascade,
  rater uuid not null references public.players(id) on delete cascade,
  notas jsonb not null,
  ts timestamptz not null default now(),
  primary key (match_id, rater)
);
-- Voto de figura del partido (uno por jugador que jugó; nunca a sí mismo).
alter table public.notas add column if not exists figura uuid references public.players(id) on delete set null;

create table if not exists public.anotados (
  player_id uuid primary key references public.players(id) on delete cascade,
  ts timestamptz not null default now()
);

create table if not exists public.proxima (
  id int primary key default 1 check (id = 1),
  fecha date,
  hora text not null default '',
  lugar text not null default '' check (char_length(lugar) <= 50),
  cupos int not null default 0 check (cupos between 0 and 40)
);

create table if not exists public.intentos (
  clave text primary key,
  fallos int not null default 0,
  bloqueado_hasta timestamptz,
  ultimo timestamptz not null default now()
);
alter table public.intentos add column if not exists ultimo timestamptz not null default now();

-- Sin políticas: nadie entra directo a las tablas, solo por las funciones.
alter table public.config   enable row level security;
alter table public.players  enable row level security;
alter table public.matches  enable row level security;
alter table public.notas    enable row level security;
alter table public.anotados enable row level security;
alter table public.proxima  enable row level security;
alter table public.intentos enable row level security;
revoke all on public.config, public.players, public.matches, public.notas,
  public.anotados, public.proxima, public.intentos from anon, authenticated;

-- ---------- funciones internas (no accesibles desde la app) ----------
create schema if not exists priv;
revoke all on schema priv from public, anon, authenticated;

-- Revisa un PIN contra su hash con bloqueo por intentos fallidos.
-- No lanza errores: así el contador de fallos se guarda aunque el PIN esté malo.
-- El candado por clave evita que varios intentos al mismo tiempo se salten el bloqueo.
-- Los fallos se olvidan tras una hora sin fallar. Un acierto del PIN de un jugador o del
-- admin borra sus fallos; un acierto de la clave del grupo no (si no, el uso normal de
-- los amigos le reiniciaría el contador a quien esté probando claves).
create or replace function priv.revisar(p_clave text, p_pin text, p_hash text, p_max int, p_minutos int)
returns text language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare r public.intentos;
begin
  perform pg_advisory_xact_lock(hashtext('intentos:' || p_clave));
  select * into r from public.intentos where clave = p_clave;
  if r.bloqueado_hasta is not null and r.bloqueado_hasta > now() then
    return 'bloqueado';
  end if;
  if p_hash is not null and p_pin is not null and crypt(p_pin, p_hash) = p_hash then
    if p_clave <> 'grupo' then delete from public.intentos where clave = p_clave; end if;
    return 'ok';
  end if;
  insert into public.intentos (clave, fallos, ultimo) values (p_clave, 1, now())
    on conflict (clave) do update set
      fallos = case when public.intentos.ultimo < now() - interval '1 hour' then 1 else public.intentos.fallos + 1 end,
      ultimo = now();
  update public.intentos set bloqueado_hasta = now() + make_interval(mins => p_minutos), fallos = 0
    where clave = p_clave and fallos >= p_max;
  return 'pin';
end $$;

-- Autoriza una llamada. a = {grupo, jugador, pin, admin}.
-- Devuelve {ok, jugador (uuid o null), admin (bool), error}.
create or replace function priv.auth(a jsonb, p_necesita_jugador boolean)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare c public.config; v text; pid uuid; es_admin boolean := false; h text;
begin
  select * into c from public.config where id = 1;
  if c is null then return jsonb_build_object('ok', false, 'error', 'sin_configurar'); end if;
  -- La clave anterior se prueba solo si la actual no coincide y la entrada no está bloqueada;
  -- si no es ninguna de las dos, cuenta como intento fallido.
  if c.grupo_hash_anterior is not null and coalesce(a->>'grupo', '') <> ''
    and not exists (select 1 from public.intentos where clave = 'grupo' and bloqueado_hasta > now())
    and crypt(a->>'grupo', c.grupo_hash) <> c.grupo_hash
    and crypt(a->>'grupo', c.grupo_hash_anterior) = c.grupo_hash_anterior then
    return jsonb_build_object('ok', false, 'error', 'clave_cambiada');
  end if;
  v := priv.revisar('grupo', a->>'grupo', c.grupo_hash, 20, 10);
  if v <> 'ok' then return jsonb_build_object('ok', false, 'error', case when v = 'bloqueado' then 'bloqueado' else 'grupo' end); end if;

  if coalesce(a->>'admin', '') <> '' then
    v := priv.revisar('admin', a->>'admin', c.admin_hash, 5, 15);
    if v <> 'ok' then return jsonb_build_object('ok', false, 'error', case when v = 'bloqueado' then 'bloqueado' else 'admin' end); end if;
    es_admin := true;
  end if;

  if coalesce(a->>'jugador', '') <> '' then
    begin pid := (a->>'jugador')::uuid; exception when others then pid := null; end;
    select pin_hash into h from public.players where id = pid;
    if h is null then return jsonb_build_object('ok', false, 'error', 'jugador'); end if;
    v := priv.revisar('p:' || pid, a->>'pin', h, 5, 15);
    -- el administrador no queda sin herramientas si le bloquean el PIN de su jugador
    if v <> 'ok' and es_admin then pid := null;
    elsif v <> 'ok' then return jsonb_build_object('ok', false, 'error', case when v = 'bloqueado' then 'bloqueado' else 'pin' end); end if;
  end if;

  if p_necesita_jugador and pid is null and not es_admin then
    return jsonb_build_object('ok', false, 'error', 'sin_jugador');
  end if;
  return jsonb_build_object('ok', true, 'jugador', pid, 'admin', es_admin);
end $$;

create or replace function priv.pin_valido(p text) returns boolean language sql immutable as $$
  select p ~ '^[0-9]{4}$'
$$;

revoke all on all functions in schema priv from public, anon, authenticated;

-- ---------- funciones públicas (las que usa la app) ----------

-- Primera vez: fija el PIN del grupo y el de administrador. Solo funciona si no hay config.
create or replace function public.configurar(p_grupo text, p_admin text)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  if exists (select 1 from public.config) then return jsonb_build_object('ok', false, 'error', 'ya_configurado'); end if;
  if char_length(coalesce(p_grupo, '')) < 6 then return jsonb_build_object('ok', false, 'error', 'grupo_corto'); end if;
  if char_length(coalesce(p_admin, '')) < 6 then return jsonb_build_object('ok', false, 'error', 'admin_corto'); end if;
  if p_grupo = p_admin then return jsonb_build_object('ok', false, 'error', 'iguales'); end if;
  insert into public.config (id, grupo_hash, admin_hash)
    values (1, crypt(p_grupo, gen_salt('bf')), crypt(p_admin, gen_salt('bf')));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.configurado() returns boolean
language sql security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.config)
$$;

-- Revisa los PIN sin cambiar nada (para iniciar sesión).
create or replace function public.entrar(a jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin return priv.auth(a, false); end $$;

-- Todo lo que la app muestra. Las notas y la figura van resumidas (nunca quién votó qué):
-- la nota de un jugador en un partido solo si lo calificaron al menos 3, y la figura solo si
-- la votaron al menos 3 (con menos, quien votó podría restar el suyo y sacar el de otro).
-- Si viene el jugador con su PIN, también van sus propios votos.
create or replace function public.estado(a jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare au jsonb; yo uuid; err_jugador text; min_votos constant int := 3;
begin
  au := priv.auth(jsonb_build_object('grupo', a->>'grupo'), false);
  if not (au->>'ok')::boolean then
    -- la versión vieja de la app no conoce 'clave_cambiada' (y no manda 'jugador')
    if au->>'error' = 'clave_cambiada' and not (a ? 'jugador') then return jsonb_build_object('ok', false, 'error', 'grupo'); end if;
    return au;
  end if;
  if coalesce(a->>'jugador', '') <> '' then
    au := priv.auth(jsonb_build_object('grupo', a->>'grupo', 'jugador', a->>'jugador', 'pin', a->>'pin'), false);
    if (au->>'ok')::boolean then yo := (au->>'jugador')::uuid; else err_jugador := au->>'error'; end if;
  end if;
  return jsonb_build_object('ok', true, 'errorJugador', err_jugador, 'minVotos', min_votos,
    'registroAbierto', (select registro_abierto from public.config where id = 1),
    'votantes', coalesce((select jsonb_object_agg(n.match_id, n.c) from (select match_id, count(*) c from public.notas
      join public.matches m on m.id = match_id and m.borrado is null group by match_id) n), '{}'),
    'notasRes', coalesce((select jsonb_agg(jsonb_build_object('matchId', x.match_id, 'id', x.k, 'suma', x.s, 'n', x.c))
      from (select n.match_id, e.key k, sum(e.value::int) s, count(*) c
        from public.notas n join public.matches m on m.id = n.match_id and m.borrado is null, jsonb_each_text(n.notas) e
        group by n.match_id, e.key having count(*) >= min_votos) x), '[]'),
    'figuraRes', coalesce((select jsonb_agg(jsonb_build_object('matchId', x.match_id, 'id', x.figura, 'votos', x.c))
      from (select n.match_id, n.figura, count(*) c
        from public.notas n join public.matches m on m.id = n.match_id and m.borrado is null
        where n.figura is not null
          and (select count(*) from public.notas z where z.match_id = n.match_id and z.figura is not null) >= min_votos
        group by n.match_id, n.figura) x), '[]'),
    'misVotos', coalesce((select jsonb_agg(jsonb_build_object('matchId', match_id, 'notas', notas, 'figura', figura))
      from public.notas where yo is not null and rater = yo), '[]'),
    'players', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre, 'apodo', apodo,
        'posicion', posicion, 'posicion2', posicion2, 'numero', numero, 'pie', pie, 'creado', creado) order by creado)
      from public.players), '[]'),
    'matches', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'fecha', fecha, 'lugar', lugar,
        'equipoA', to_jsonb(equipo_a), 'equipoB', to_jsonb(equipo_b), 'golesA', goles_a, 'golesB', goles_b,
        'goles', goles, 'asist', asist, 'mvp', mvp, 'creado', extract(epoch from creado) * 1000))
      from public.matches where borrado is null), '[]'),
    'anotados', coalesce((select jsonb_agg(jsonb_build_object('id', player_id)) from public.anotados), '[]'),
    'proxima', (select jsonb_build_object('fecha', fecha, 'hora', hora, 'lugar', lugar, 'cupos', cupos)
      from public.proxima where id = 1));
end $$;

-- Crear jugador: basta la clave del grupo (así cada uno se anota solo),
-- salvo que el administrador haya cerrado el registro.
create or replace function public.crear_jugador(a jsonb, d jsonb, p_pin text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare au jsonb; nid uuid;
begin
  if (select registro_abierto from public.config where id = 1) is false then
    au := priv.auth(jsonb_build_object('grupo', a->>'grupo', 'admin', a->>'admin'), false);
    if not (au->>'ok')::boolean then return au; end if;
    if not (au->>'admin')::boolean then return jsonb_build_object('ok', false, 'error', 'registro_cerrado'); end if;
  else
    au := priv.auth(jsonb_build_object('grupo', a->>'grupo'), false);
    if not (au->>'ok')::boolean then return au; end if;
  end if;
  if not priv.pin_valido(p_pin) then return jsonb_build_object('ok', false, 'error', 'pin_formato'); end if;
  if (select count(*) from public.players) >= 60 then return jsonb_build_object('ok', false, 'error', 'lleno'); end if;
  insert into public.players (nombre, apodo, posicion, posicion2, numero, pie, pin_hash)
  values (trim(d->>'nombre'), trim(coalesce(d->>'apodo', '')), coalesce(d->>'posicion', ''), coalesce(d->>'posicion2', ''),
    nullif(d->>'numero', '')::int, coalesce(d->>'pie', ''), crypt(p_pin, gen_salt('bf')))
  returning id into nid;
  return jsonb_build_object('ok', true, 'id', nid);
exception when check_violation or invalid_text_representation or not_null_violation then
  return jsonb_build_object('ok', false, 'error', 'datos');
end $$;

-- Editar jugador: el mismo jugador o el administrador. p_pin_nuevo opcional.
create or replace function public.editar_jugador(a jsonb, p_id uuid, d jsonb, p_pin_nuevo text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare au jsonb;
begin
  au := priv.auth(a, true);
  if not (au->>'ok')::boolean then return au; end if;
  if not (au->>'admin')::boolean and (au->>'jugador')::uuid is distinct from p_id then
    return jsonb_build_object('ok', false, 'error', 'no_es_tuyo');
  end if;
  if coalesce(p_pin_nuevo, '') <> '' and not priv.pin_valido(p_pin_nuevo) then
    return jsonb_build_object('ok', false, 'error', 'pin_formato');
  end if;
  update public.players set nombre = trim(d->>'nombre'), apodo = trim(coalesce(d->>'apodo', '')),
    posicion = coalesce(d->>'posicion', ''), posicion2 = coalesce(d->>'posicion2', ''),
    numero = nullif(d->>'numero', '')::int, pie = coalesce(d->>'pie', ''),
    pin_hash = case when coalesce(p_pin_nuevo, '') <> '' then crypt(p_pin_nuevo, gen_salt('bf')) else pin_hash end
  where id = p_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'jugador'); end if;
  if coalesce(p_pin_nuevo, '') <> '' then delete from public.intentos where clave = 'p:' || p_id; end if;
  return jsonb_build_object('ok', true);
exception when check_violation or invalid_text_representation or not_null_violation then
  return jsonb_build_object('ok', false, 'error', 'datos');
end $$;

-- Borrar jugador: solo el administrador, y solo si no ha jugado partidos.
create or replace function public.borrar_jugador(a jsonb, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare au jsonb;
begin
  au := priv.auth(a, true);
  if not (au->>'ok')::boolean then return au; end if;
  if not (au->>'admin')::boolean then return jsonb_build_object('ok', false, 'error', 'solo_admin'); end if;
  if exists (select 1 from public.matches where borrado is null and (p_id = any(equipo_a) or p_id = any(equipo_b))) then
    return jsonb_build_object('ok', false, 'error', 'tiene_partidos');
  end if;
  if exists (select 1 from public.matches where p_id = any(equipo_a) or p_id = any(equipo_b)) then
    return jsonb_build_object('ok', false, 'error', 'en_papelera');
  end if;
  delete from public.players where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- Crear o editar un partido: cualquier jugador con su PIN.
create or replace function public.guardar_partido(a jsonb, p_id uuid, d jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare au jsonb; ea uuid[]; eb uuid[]; ga int; gb int; g jsonb := '{}'; s jsonb := '{}';
  k text; n int; sa int := 0; sb int := 0; mv uuid; nid uuid;
begin
  au := priv.auth(a, true);
  if not (au->>'ok')::boolean then return au; end if;
  select coalesce(array_agg(distinct x::uuid), '{}') into ea from jsonb_array_elements_text(d->'equipoA') x;
  select coalesce(array_agg(distinct x::uuid), '{}') into eb from jsonb_array_elements_text(d->'equipoB') x;
  if cardinality(ea) = 0 or cardinality(eb) = 0 then return jsonb_build_object('ok', false, 'error', 'equipos'); end if;
  if ea && eb then return jsonb_build_object('ok', false, 'error', 'equipos'); end if;
  if (select count(*) from public.players where id = any(ea || eb)) <> cardinality(ea) + cardinality(eb) then
    return jsonb_build_object('ok', false, 'error', 'jugador');
  end if;
  ga := (d->>'golesA')::int; gb := (d->>'golesB')::int;
  for k, n in select key, value::int from jsonb_each_text(coalesce(d->'goles', '{}')) loop
    if n > 0 then
      if k::uuid = any(ea) then sa := sa + n; elsif k::uuid = any(eb) then sb := sb + n; else continue; end if;
      g := g || jsonb_build_object(k, n);
    end if;
  end loop;
  for k, n in select key, value::int from jsonb_each_text(coalesce(d->'asist', '{}')) loop
    if n > 0 and k::uuid = any(ea || eb) then s := s || jsonb_build_object(k, n); end if;
  end loop;
  if sa > ga or sb > gb then return jsonb_build_object('ok', false, 'error', 'goles'); end if;
  mv := nullif(d->>'mvp', '')::uuid;
  if mv is not null and not (mv = any(ea || eb)) then mv := null; end if;
  if p_id is null then
    insert into public.matches (fecha, lugar, equipo_a, equipo_b, goles_a, goles_b, goles, asist, mvp, creado_por)
    values ((d->>'fecha')::date, trim(coalesce(d->>'lugar', '')), ea, eb, ga, gb, g, s, mv, (au->>'jugador')::uuid)
    returning id into nid;
  else
    update public.matches set fecha = (d->>'fecha')::date, lugar = trim(coalesce(d->>'lugar', '')),
      equipo_a = ea, equipo_b = eb, goles_a = ga, goles_b = gb, goles = g, asist = s, mvp = mv
    where id = p_id and borrado is null returning id into nid;
    if nid is null then return jsonb_build_object('ok', false, 'error', 'partido'); end if;
    -- si alguien ya no figura en el partido, sus notas (dadas o recibidas) dejan de valer
    delete from public.notas where match_id = nid and not (rater = any(ea || eb));
    update public.notas set notas = (select coalesce(jsonb_object_agg(key, value), '{}')
      from jsonb_each(notas) where key::uuid = any(ea || eb)) where match_id = nid;
    update public.notas set figura = null where match_id = nid and not (figura = any(ea || eb));
    delete from public.notas where match_id = nid and notas = '{}' and figura is null;
  end if;
  return jsonb_build_object('ok', true, 'id', nid);
exception when check_violation or invalid_text_representation or invalid_datetime_format
  or datetime_field_overflow or numeric_value_out_of_range or not_null_violation then
  return jsonb_build_object('ok', false, 'error', 'datos');
end $$;

-- Borrar partido: cualquier jugador con su PIN (Diego lo decidió así). Va a la papelera.
create or replace function public.borrar_partido(a jsonb, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare au jsonb;
begin
  au := priv.auth(a, true);
  if not (au->>'ok')::boolean then return au; end if;
  update public.matches set borrado = now() where id = p_id and borrado is null;
  return jsonb_build_object('ok', true);
end $$;

-- Papelera: solo el administrador la ve y recupera partidos.
create or replace function public.papelera(a jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare au jsonb;
begin
  au := priv.auth(a, true);
  if not (au->>'ok')::boolean then return au; end if;
  if not (au->>'admin')::boolean then return jsonb_build_object('ok', false, 'error', 'solo_admin'); end if;
  return jsonb_build_object('ok', true, 'partidos', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'fecha', fecha,
    'lugar', lugar, 'golesA', goles_a, 'golesB', goles_b, 'borrado', borrado) order by borrado desc)
    from public.matches where borrado is not null), '[]'));
end $$;

create or replace function public.restaurar_partido(a jsonb, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare au jsonb;
begin
  au := priv.auth(a, true);
  if not (au->>'ok')::boolean then return au; end if;
  if not (au->>'admin')::boolean then return jsonb_build_object('ok', false, 'error', 'solo_admin'); end if;
  update public.matches set borrado = null where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- Poner notas y votar figura: el jugador con su PIN, solo si jugó ese partido. Solo a quienes jugaron y nunca a sí mismo.
drop function if exists public.votar(jsonb, uuid, jsonb);
create or replace function public.votar(a jsonb, p_match uuid, p_notas jsonb, p_figura uuid default null) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare au jsonb; yo uuid; m public.matches; limpio jsonb := '{}'; k text; v text; n int; fig uuid;
begin
  au := priv.auth(jsonb_build_object('grupo', a->>'grupo', 'jugador', a->>'jugador', 'pin', a->>'pin'), true);
  if not (au->>'ok')::boolean then return au; end if;
  yo := (au->>'jugador')::uuid;
  select * into m from public.matches where id = p_match and borrado is null;
  if m is null then return jsonb_build_object('ok', false, 'error', 'partido'); end if;
  if not (yo = any(m.equipo_a || m.equipo_b)) then return jsonb_build_object('ok', false, 'error', 'no_jugaste'); end if;
  for k, v in select key, value from jsonb_each_text(coalesce(p_notas, '{}')) loop
    begin n := v::int; exception when others then continue; end;
    if n between 1 and 10 and k::uuid <> yo and k::uuid = any(m.equipo_a || m.equipo_b) then
      limpio := limpio || jsonb_build_object(k, n);
    end if;
  end loop;
  if p_figura <> yo and p_figura = any(m.equipo_a || m.equipo_b) then fig := p_figura; end if;
  if limpio = '{}' and fig is null then
    delete from public.notas where match_id = p_match and rater = yo;
  else
    insert into public.notas (match_id, rater, notas, figura) values (p_match, yo, limpio, fig)
      on conflict (match_id, rater) do update set notas = excluded.notas, figura = excluded.figura, ts = now();
  end if;
  return jsonb_build_object('ok', true);
exception when invalid_text_representation then
  return jsonb_build_object('ok', false, 'error', 'datos');
end $$;

-- Anotarse (o anotar a otro) para la próxima pichanga.
create or replace function public.anotar(a jsonb, p_player uuid, p_voy boolean) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare au jsonb;
begin
  au := priv.auth(a, true);
  if not (au->>'ok')::boolean then return au; end if;
  if p_voy then
    insert into public.anotados (player_id) values (p_player) on conflict do nothing;
  else
    delete from public.anotados where player_id = p_player;
  end if;
  return jsonb_build_object('ok', true);
exception when foreign_key_violation then
  return jsonb_build_object('ok', false, 'error', 'jugador');
end $$;

create or replace function public.vaciar_anotados(a jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare au jsonb;
begin
  au := priv.auth(a, true);
  if not (au->>'ok')::boolean then return au; end if;
  delete from public.anotados where true;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.guardar_proxima(a jsonb, d jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare au jsonb;
begin
  au := priv.auth(a, true);
  if not (au->>'ok')::boolean then return au; end if;
  insert into public.proxima (id, fecha, hora, lugar, cupos)
  values (1, nullif(d->>'fecha', '')::date, coalesce(d->>'hora', ''), trim(coalesce(d->>'lugar', '')), coalesce(nullif(d->>'cupos', '')::int, 0))
  on conflict (id) do update set fecha = excluded.fecha, hora = excluded.hora, lugar = excluded.lugar, cupos = excluded.cupos;
  return jsonb_build_object('ok', true);
exception when check_violation or invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
  return jsonb_build_object('ok', false, 'error', 'datos');
end $$;

-- Administrador: cambiar la clave del grupo y/o la de administrador ('' = no cambiar).
create or replace function public.cambiar_claves(a jsonb, p_grupo text, p_admin text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare au jsonb; g text := coalesce(p_grupo, ''); ad text := coalesce(p_admin, '');
begin
  au := priv.auth(a, true);
  if not (au->>'ok')::boolean then return au; end if;
  if not (au->>'admin')::boolean then return jsonb_build_object('ok', false, 'error', 'solo_admin'); end if;
  if g <> '' and char_length(g) < 6 then return jsonb_build_object('ok', false, 'error', 'grupo_corto'); end if;
  if ad <> '' and char_length(ad) < 6 then return jsonb_build_object('ok', false, 'error', 'admin_corto'); end if;
  if (g <> '' and g = coalesce(nullif(ad, ''), a->>'admin')) or (ad <> '' and ad = coalesce(nullif(g, ''), a->>'grupo')) then
    return jsonb_build_object('ok', false, 'error', 'iguales');
  end if;
  if g <> '' and g <> coalesce(a->>'grupo', '') then update public.config set grupo_hash_anterior = grupo_hash, grupo_hash = crypt(g, gen_salt('bf')) where id = 1; delete from public.intentos where clave = 'grupo'; end if;
  if ad <> '' then update public.config set admin_hash = crypt(ad, gen_salt('bf')) where id = 1; delete from public.intentos where clave = 'admin'; end if;
  return jsonb_build_object('ok', true);
end $$;

-- Administrador: abrir o cerrar el registro de jugadores nuevos.
create or replace function public.registro(a jsonb, p_abierto boolean) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare au jsonb;
begin
  au := priv.auth(a, true);
  if not (au->>'ok')::boolean then return au; end if;
  if not (au->>'admin')::boolean then return jsonb_build_object('ok', false, 'error', 'solo_admin'); end if;
  update public.config set registro_abierto = coalesce(p_abierto, true) where id = 1;
  return jsonb_build_object('ok', true);
end $$;

-- Administrador: copia de todos los datos (sin PIN ni claves) para guardar aparte.
create or replace function public.respaldo(a jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare au jsonb;
begin
  au := priv.auth(a, true);
  if not (au->>'ok')::boolean then return au; end if;
  if not (au->>'admin')::boolean then return jsonb_build_object('ok', false, 'error', 'solo_admin'); end if;
  return jsonb_build_object('ok', true, 'version', 1, 'fecha', now(),
    'players', coalesce((select jsonb_agg(to_jsonb(p) - 'pin_hash') from public.players p), '[]'),
    'matches', coalesce((select jsonb_agg(to_jsonb(m)) from public.matches m), '[]'),
    'notas', coalesce((select jsonb_agg(to_jsonb(n)) from public.notas n), '[]'),
    'anotados', coalesce((select jsonb_agg(to_jsonb(x)) from public.anotados x), '[]'),
    'proxima', (select to_jsonb(x) from public.proxima x where id = 1));
end $$;

-- Para que Supabase no pause el proyecto por falta de uso (GitHub Actions lo llama una vez al día).
create or replace function public.ping() returns int
language sql security definer set search_path = public, pg_temp as $$ select 1 $$;

-- Solo estas funciones quedan disponibles para la app.
revoke all on function public.configurar(text, text), public.configurado(), public.entrar(jsonb),
  public.estado(jsonb), public.crear_jugador(jsonb, jsonb, text), public.editar_jugador(jsonb, uuid, jsonb, text),
  public.borrar_jugador(jsonb, uuid), public.guardar_partido(jsonb, uuid, jsonb), public.borrar_partido(jsonb, uuid),
  public.votar(jsonb, uuid, jsonb, uuid), public.anotar(jsonb, uuid, boolean), public.vaciar_anotados(jsonb),
  public.guardar_proxima(jsonb, jsonb), public.ping(),
  public.papelera(jsonb), public.restaurar_partido(jsonb, uuid), public.cambiar_claves(jsonb, text, text),
  public.registro(jsonb, boolean), public.respaldo(jsonb) from public;
grant execute on function public.configurar(text, text), public.configurado(), public.entrar(jsonb),
  public.estado(jsonb), public.crear_jugador(jsonb, jsonb, text), public.editar_jugador(jsonb, uuid, jsonb, text),
  public.borrar_jugador(jsonb, uuid), public.guardar_partido(jsonb, uuid, jsonb), public.borrar_partido(jsonb, uuid),
  public.votar(jsonb, uuid, jsonb, uuid), public.anotar(jsonb, uuid, boolean), public.vaciar_anotados(jsonb),
  public.guardar_proxima(jsonb, jsonb), public.ping(),
  public.papelera(jsonb), public.restaurar_partido(jsonb, uuid), public.cambiar_claves(jsonb, text, text),
  public.registro(jsonb, boolean), public.respaldo(jsonb) to anon;

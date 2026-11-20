-- ============================================================
-- Haxball Futsal - Esquema de Supabase (Fase 2)
-- Ejecutar en el SQL Editor de tu proyecto Supabase.
-- ============================================================

-- ---------- players ----------
create table if not exists public.players (
    id              uuid primary key default gen_random_uuid(),
    name            text not null,
    normalized_name text not null unique,
    auth_provider   text,            -- 'google' | 'discord' | null (invitado)
    auth_subject    text,            -- id del proveedor
    elo             int not null default 100,
    matches         int not null default 0,
    official_matches int not null default 0,
    informal_matches int not null default 0,
    wins            int not null default 0,
    losses          int not null default 0,
    draws           int not null default 0,
    goals           int not null default 0,
    own_goals       int not null default 0,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    last_seen       timestamptz
);

create index if not exists players_normalized_name_idx
    on public.players (normalized_name);

-- ---------- matches ----------
create table if not exists public.matches (
    id              uuid primary key default gen_random_uuid(),
    external_id     text not null unique,
    server_version  text,
    type            text not null check (type in ('official','informal')),
    status          text not null,
    map_tier        text,
    map_name        text,
    started_at      timestamptz,
    ended_at        timestamptz,
    duration_seconds int,
    red_score       int not null default 0,
    blue_score      int not null default 0,
    elo_eligible    boolean not null default false,
    manual          boolean not null default false,
    end_reason      text,
    spectator_name  text,
    spectator_key   text,
    created_at      timestamptz not null default now()
);

create index if not exists matches_external_id_idx on public.matches (external_id);
create index if not exists matches_started_at_idx on public.matches (started_at desc);

-- ---------- match_participants ----------
create table if not exists public.match_participants (
    id                  uuid primary key default gen_random_uuid(),
    match_id            uuid not null references public.matches(id) on delete cascade,
    player_id           uuid references public.players(id),
    player_name         text not null,
    player_key          text not null,
    team                text not null check (team in ('red','blue')),
    join_order          int,
    goals               int not null default 0,
    own_goals           int not null default 0,
    left_match          boolean not null default false,
    moved_to_spectator  boolean not null default false,
    elo_before          int,
    elo_after           int,
    elo_change          int not null default 0,
    created_at          timestamptz not null default now()
);

create index if not exists match_participants_match_idx on public.match_participants (match_id);
create index if not exists match_participants_player_idx on public.match_participants (player_id);

-- ---------- match_goals ----------
create table if not exists public.match_goals (
    id              uuid primary key default gen_random_uuid(),
    match_id        uuid not null references public.matches(id) on delete cascade,
    scoring_team    text not null check (scoring_team in ('red','blue')),
    player_id       uuid references public.players(id),
    player_name     text,
    player_key      text,
    player_team     text,
    is_own_goal     boolean not null default false,
    elapsed_seconds int,
    attribution     text,
    estimated       boolean not null default true,
    created_at      timestamptz not null default now()
);

create index if not exists match_goals_match_idx on public.match_goals (match_id);

-- ---------- elo_history ----------
create table if not exists public.elo_history (
    id          uuid primary key default gen_random_uuid(),
    player_id   uuid not null references public.players(id),
    match_id    uuid references public.matches(id),
    elo_before  int not null,
    elo_after   int not null,
    elo_change  int not null,
    created_at  timestamptz not null default now()
);

create index if not exists elo_history_player_idx on public.elo_history (player_id);

-- ---------- Columna para vincular cuenta (login opcional) ----------
alter table public.players
    add column if not exists auth_user_id uuid references auth.users(id);

create index if not exists players_auth_user_idx on public.players (auth_user_id);

-- ---------- RLS ----------
alter table public.players enable row level security;
alter table public.matches enable row level security;
alter table public.match_participants enable row level security;
alter table public.match_goals enable row level security;
alter table public.elo_history enable row level security;

-- Lectura pública (anon) para la plataforma de estadísticas.
create policy "public read players" on public.players
    for select using (true);

-- Usuarios autenticados pueden vincular/desvincular su cuenta a un perfil.
create policy "auth link player" on public.players
    for update
    using (auth_user_id is null or auth_user_id = auth.uid())
    with check (auth_user_id is null or auth_user_id = auth.uid());
create policy "public read matches" on public.matches
    for select using (true);
create policy "public read match_participants" on public.match_participants
    for select using (true);
create policy "public read match_goals" on public.match_goals
    for select using (true);
create policy "public read elo_history" on public.elo_history
    for select using (true);

-- Escrituras solo desde la Edge Function (service_role), que ignora RLS.

-- ---------- Permisos para service_role ----------
grant select, insert, update, delete on public.players to service_role;
grant select, insert, update, delete on public.matches to service_role;
grant select, insert, update, delete on public.match_participants to service_role;
grant select, insert, update, delete on public.match_goals to service_role;
grant select, insert, update, delete on public.elo_history to service_role;
grant usage, select on all sequences in schema public to service_role;

-- ---------- updated_at automático ----------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists players_touch_updated_at on public.players;
create trigger players_touch_updated_at
    before update on public.players
    for each row execute function public.touch_updated_at();

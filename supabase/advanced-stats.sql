-- ============================================================
-- Estadísticas avanzadas: asistencias, tiros, pases, intercepciones,
-- paradas, pérdidas, distancia, posesión, xG, golazos.
-- ============================================================

-- match_participants: nuevas columnas
alter table public.match_participants
    add column if not exists shots int not null default 0,
    add column if not exists shots_on_target int not null default 0,
    add column if not exists passes int not null default 0,
    add column if not exists completed_passes int not null default 0,
    add column if not exists assists int not null default 0,
    add column if not exists interceptions int not null default 0,
    add column if not exists saves int not null default 0,
    add column if not exists possession_lost int not null default 0,
    add column if not exists distance_covered int not null default 0,
    add column if not exists xg numeric(6,3) not null default 0,
    add column if not exists golazos int not null default 0;

-- matches: posesión por equipo
alter table public.matches
    add column if not exists red_possession numeric(5,2),
    add column if not exists blue_possession numeric(5,2);

-- match_goals: xG y golazo
alter table public.match_goals
    add column if not exists xg numeric(6,3),
    add column if not exists is_golazo boolean not null default false;

-- players: acumulados
alter table public.players
    add column if not exists shots int not null default 0,
    add column if not exists shots_on_target int not null default 0,
    add column if not exists passes int not null default 0,
    add column if not exists completed_passes int not null default 0,
    add column if not exists assists int not null default 0,
    add column if not exists interceptions int not null default 0,
    add column if not exists saves int not null default 0,
    add column if not exists possession_lost int not null default 0,
    add column if not exists distance_covered int not null default 0,
    add column if not exists xg numeric(8,3) not null default 0,
    add column if not exists golazos int not null default 0;

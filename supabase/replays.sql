-- ============================================================
-- Repeticiones de goles.
-- Ejecutar en el SQL Editor de Supabase (idempotente).
-- ============================================================

alter table public.match_goals
    add column if not exists assist_name text,
    add column if not exists assist_player_key text,
    add column if not exists score_before text,
    add column if not exists score_after text,
    add column if not exists ball_speed_kmh int,
    add column if not exists replay jsonb;

-- Las repeticiones se consultan ordenadas por gol reciente.
create index if not exists match_goals_replay_idx
    on public.match_goals (id desc)
    where replay is not null;

-- Lectura pública ya cubierta por la policy "public read match_goals".
-- Las escrituras siguen siendo solo de la Edge Function (service_role).

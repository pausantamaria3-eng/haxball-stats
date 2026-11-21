-- ============================================================
-- Repeticiones de goles con grabaciones nativas de HaxBall (.hbr2).
-- Ejecutar en el SQL Editor de Supabase (idempotente).
-- ============================================================

-- Contexto de cada gol (ya presente en migraciones anteriores).
alter table public.match_goals
    add column if not exists assist_name text,
    add column if not exists assist_player_key text,
    add column if not exists score_before text,
    add column if not exists score_after text,
    add column if not exists ball_speed_kmh int,
    add column if not exists replay jsonb;

-- NUEVO: URL pública del archivo .hbr2 subido a Supabase Storage.
alter table public.match_goals
    add column if not exists replay_url text;

-- Bucket público donde la Edge Function guarda las grabaciones.
insert into storage.buckets (id, name, public)
values ('replays', 'replays', true)
on conflict (id) do update set public = true;

-- Las repeticiones se consultan ordenadas por gol reciente.
create index if not exists match_goals_replay_url_idx
    on public.match_goals (id desc)
    where replay_url is not null;

-- Lectura pública ya cubierta por la policy "public read match_goals".
-- Las escrituras siguen siendo solo de la Edge Function (service_role),
-- que también tiene acceso de escritura al bucket por ser service_role.

-- ============================================================
-- Códigos de verificación para vincular cuenta web <-> Haxball
-- ============================================================

create table if not exists public.verification_codes (
    id          uuid primary key default gen_random_uuid(),
    code        text not null,
    player_name text not null,
    player_key  text not null,
    created_at  timestamptz not null default now(),
    expires_at  timestamptz not null,
    used        boolean not null default false,
    used_by     uuid references auth.users(id),
    used_at     timestamptz
);

create index if not exists verification_codes_code_idx on public.verification_codes (code);
create index if not exists verification_codes_player_key_idx on public.verification_codes (player_key);

alter table public.verification_codes enable row level security;

-- Solo service_role accede (Edge Functions).
grant select, insert, update, delete on public.verification_codes to service_role;
grant usage, select on all sequences in schema public to service_role;

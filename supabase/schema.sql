-- Aangan Call Console — run once in Supabase → SQL Editor → New query → Run.
-- One row per call. The full call (dossier, transcript, criteria, HubSpot sync) is stored as JSON.

create table if not exists public.calls (
  id          text primary key,
  received_at timestamptz not null,
  data        jsonb not null,
  updated_at  timestamptz not null default now()
);

create index if not exists calls_received_at_idx on public.calls (received_at desc);

-- Lock the table down: no access through the public (anon) key at all.
-- The console talks to Supabase from the server with the secret key, which bypasses RLS.
alter table public.calls enable row level security;

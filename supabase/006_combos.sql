-- =============================================================
-- Agenda Mel — 006: combos de serviços
-- Rode este arquivo no SQL Editor do Supabase (DEPOIS do 005).
-- =============================================================

-- Um combo é um serviço que agrupa outros: a duração é a soma das
-- durações dos serviços incluídos (exibida ao cliente como tempo
-- médio, não como tempo exato) e o preço é definido pelo admin.
alter table public.services
  add column if not exists is_combo boolean not null default false;

alter table public.services
  add column if not exists combo_service_ids uuid[] not null default '{}';

-- =============================================================
-- MIMO — 049: favoritas, avaliações e a posição na fila
--
-- Três coisas que o desenho do MIMO pede e que não existiam em lugar
-- nenhum do banco. Nenhuma delas muda regra de agendamento; são camadas
-- em cima do que já acontece.
--
-- 1. FAVORITAS. O coração na lista de profissionais. Uma tabela de dois
--    ids, com a cliente como dona da própria lista.
--
-- 2. AVALIAÇÕES. Uma nota de 1 a 5 e um comentário, sempre amarrados a
--    um atendimento CONCLUÍDO da própria cliente. Não existe avaliar
--    quem nunca te atendeu — a chave estrangeira e a checagem no insert
--    garantem isso, não a tela.
--
-- 3. POSIÇÃO NA FILA. "Você está na fila" sem dizer em qual lugar é
--    ansiedade. A conta é: quantas entradas AGUARDANDO, para a mesma
--    profissional e o mesmo serviço, entraram antes desta.
-- =============================================================

-- 1. Favoritas ---------------------------------------------------------------
create table if not exists public.client_favorites (
  client_id uuid not null references public.profiles (id) on delete cascade,
  professional_id uuid not null references public.professionals (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (client_id, professional_id)
);

alter table public.client_favorites enable row level security;

drop policy if exists "minhas favoritas" on public.client_favorites;
create policy "minhas favoritas"
  on public.client_favorites for all
  to authenticated
  using (client_id = auth.uid())
  with check (client_id = auth.uid());

revoke truncate, references, trigger on public.client_favorites
  from anon, authenticated;

-- 2. Avaliações --------------------------------------------------------------
create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null unique
    references public.appointments (id) on delete cascade,
  client_id uuid not null references public.profiles (id) on delete cascade,
  professional_id uuid not null references public.professionals (id) on delete cascade,
  nota smallint not null check (nota between 1 and 5),
  comentario text,
  created_at timestamptz not null default now()
);

create index if not exists reviews_prof_idx on public.reviews (professional_id, created_at desc);

alter table public.reviews enable row level security;

-- qualquer pessoa lê (é o que dá sentido a avaliar); só a cliente do
-- atendimento escreve, e só uma vez por atendimento (unique acima)
drop policy if exists "ver avaliacoes" on public.reviews;
create policy "ver avaliacoes"
  on public.reviews for select
  to anon, authenticated
  using (true);

drop policy if exists "avaliar meu atendimento" on public.reviews;
create policy "avaliar meu atendimento"
  on public.reviews for insert
  to authenticated
  with check (
    client_id = auth.uid()
    and exists (
      select 1 from public.appointments a
      where a.id = appointment_id
        and a.client_id = auth.uid()
        and a.professional_id = reviews.professional_id
        and a.status = 'concluido'
    )
  );

revoke truncate, references, trigger on public.reviews from anon, authenticated;

-- a média e a contagem, para a capa da profissional. Sem avaliação
-- devolve nulo — a tela decide o que dizer, e "0.0 (0)" não é opção.
create or replace function public.avaliacao_da_profissional(prof uuid)
returns table (media numeric, quantas integer)
language sql
stable
security definer set search_path = public
as $$
  select round(avg(nota)::numeric, 1), count(*)::integer
  from public.reviews
  where professional_id = prof
  having count(*) > 0;
$$;

grant execute on function public.avaliacao_da_profissional(uuid) to anon, authenticated;

-- as últimas, com o primeiro nome de quem avaliou
create or replace function public.avaliacoes_da_profissional(prof uuid, quantas integer default 10)
returns table (nota smallint, comentario text, quem text, quando timestamptz)
language sql
stable
security definer set search_path = public
as $$
  select r.nota, r.comentario,
         split_part(coalesce(p.full_name, 'Cliente'), ' ', 1),
         r.created_at
  from public.reviews r
  left join public.profiles p on p.id = r.client_id
  where r.professional_id = prof
  order by r.created_at desc
  limit greatest(1, least(coalesce(quantas, 10), 50));
$$;

grant execute on function public.avaliacoes_da_profissional(uuid, integer) to anon, authenticated;

-- 3. Posição na fila ----------------------------------------------------------
create or replace function public.posicao_na_fila(entrada_id uuid)
returns table (posicao integer, na_frente integer, previsao text)
language plpgsql
stable
security definer set search_path = public
as $$
declare
  e public.waitlist_entries%rowtype;
  antes integer;
begin
  select * into e from public.waitlist_entries where id = entrada_id;
  if not found or e.client_id <> auth.uid() then
    return;
  end if;

  select count(*) into antes
  from public.waitlist_entries w
  where w.status = 'aguardando'
    and w.professional_id = e.professional_id
    and w.service_id = e.service_id
    and w.created_at < e.created_at;

  return query select
    antes + 1,
    antes,
    'entre ' || to_char(e.window_start, 'HH24:MI') || ' e ' ||
      to_char(e.window_end, 'HH24:MI') || ', até ' || to_char(e.date_to, 'DD/MM');
end;
$$;

revoke execute on function public.posicao_na_fila(uuid) from public, anon;
grant execute on function public.posicao_na_fila(uuid) to authenticated;

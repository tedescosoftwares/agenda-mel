-- =============================================================
-- Agenda Mel — 013: fechar o que estava aberto
-- Rode este arquivo no SQL Editor do Supabase (DEPOIS do 012).
--
-- Uma revisão encontrou quatro buracos no que já estava no ar. Este
-- arquivo fecha todos. Rode antes de colocar qualquer cliente real.
-- =============================================================

-- -------------------------------------------------------------
-- 1. Funções internas estavam abertas para qualquer um
--
-- O Postgres concede execução de função a PUBLIC por padrão, e o
-- PostgREST publica tudo que está no schema public. Na prática,
-- qualquer pessoa com a chave pública do app podia chamar
-- notificar() e injetar aviso no celular de qualquer cliente.
-- -------------------------------------------------------------
revoke execute on function public.notificar(uuid, text, text, text, text, jsonb, timestamptz)
  from public, anon, authenticated;

revoke execute on function public.ofertar_vaga(uuid, date, time, time)
  from public, anon, authenticated;

revoke execute on function public.gerar_codigo_indicacao(text)
  from public, anon, authenticated;

-- funções de gatilho não precisam ser chamáveis por ninguém
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.seed_professional_hours() from public, anon, authenticated;
revoke execute on function public.ao_liberar_horario() from public, anon, authenticated;
revoke execute on function public.creditar_indicacao_se_couber() from public, anon, authenticated;

-- -------------------------------------------------------------
-- 2. Consultas que liam dado de outra pessoa
--
-- saldo_creditos(uuid) e faltas_da_cliente(uuid) eram SECURITY
-- DEFINER e aceitavam qualquer identificador: bastava passar o de
-- outra cliente para ler o saldo ou o histórico de faltas dela.
-- -------------------------------------------------------------

-- a profissional só enxerga quem já agendou com ela
create or replace function public.atende_esta_cliente(cliente uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.appointments a
    where a.client_id = cliente
      and public.is_professional(a.professional_id)
  );
$$;

create or replace function public.saldo_creditos(cliente uuid default auth.uid())
returns integer
language plpgsql
stable
security definer set search_path = public
as $$
begin
  if cliente is null then
    return 0;
  end if;
  if not (
    cliente = auth.uid()
    or public.is_admin()
    or public.atende_esta_cliente(cliente)
  ) then
    raise exception 'Sem permissão para ver este saldo';
  end if;

  return (
    select coalesce(sum(amount_cents), 0)::integer
    from public.credit_transactions
    where client_id = cliente
      and (expires_at is null or expires_at > now())
  );
end;
$$;

create or replace function public.faltas_da_cliente(cliente uuid)
returns integer
language plpgsql
stable
security definer set search_path = public
as $$
begin
  if not (
    cliente = auth.uid()
    or public.is_admin()
    or public.atende_esta_cliente(cliente)
  ) then
    raise exception 'Sem permissão';
  end if;

  return (
    select count(*)::integer
    from public.appointments
    where client_id = cliente
      and status = 'faltou'
      and date >= (public.agora_local()::date - interval '6 months')
  );
end;
$$;

grant execute on function public.atende_esta_cliente(uuid) to authenticated;
grant execute on function public.saldo_creditos(uuid) to authenticated;
grant execute on function public.faltas_da_cliente(uuid) to authenticated;

-- -------------------------------------------------------------
-- 3. A cliente podia concluir o próprio atendimento
--
-- A política de update não tinha WITH CHECK e a tabela não tinha
-- limite de coluna. Dava para a cliente mudar data, horário e
-- status pelo navegador — inclusive marcar 'concluido', que é o
-- gatilho do crédito de indicação. Ou seja: crédito sem atendimento.
-- -------------------------------------------------------------

-- pela API, a cliente só encosta em status e observação
revoke update on public.appointments from authenticated;
grant update (status, notes) on public.appointments to authenticated;

drop policy if exists "alterar agendamentos" on public.appointments;
create policy "alterar agendamentos"
  on public.appointments for update
  to authenticated
  using (
    client_id = auth.uid()
    or public.is_admin()
    or public.is_professional(professional_id)
  )
  with check (
    client_id = auth.uid()
    or public.is_admin()
    or public.is_professional(professional_id)
  );

-- e a única mudança de status que ela pode fazer é cancelar
create or replace function public.valida_status_agendamento()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  -- rodando dentro de uma função do servidor (SECURITY DEFINER) ou
  -- pelo service_role: já foi validado lá dentro
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if not (public.is_admin() or public.is_professional(new.professional_id)) then
      if new.status <> 'pendente' then
        raise exception 'Um agendamento novo começa como pendente';
      end if;
    end if;
    return new;
  end if;

  if new.status is distinct from old.status then
    if public.is_admin() or public.is_professional(old.professional_id) then
      return new;
    end if;

    if old.client_id = auth.uid() then
      if new.status <> 'cancelado' then
        raise exception 'Você só pode cancelar o seu agendamento';
      end if;
      if old.status not in ('pendente', 'confirmado') then
        raise exception 'Este agendamento não pode mais ser cancelado';
      end if;
      return new;
    end if;

    raise exception 'Sem permissão para alterar este agendamento';
  end if;

  return new;
end;
$$;

revoke execute on function public.valida_status_agendamento() from public, anon, authenticated;

drop trigger if exists on_valida_status on public.appointments;
create trigger on_valida_status
  before insert or update on public.appointments
  for each row execute function public.valida_status_agendamento();

-- -------------------------------------------------------------
-- 4. Dois atendimentos podiam se sobrepor
--
-- O índice único só olhava o horário de INÍCIO: 14:00–15:00 e
-- 14:30–15:30 passavam os dois. Agora o próprio banco recusa
-- qualquer sobreposição na agenda da mesma profissional.
-- -------------------------------------------------------------
create extension if not exists btree_gist;

do $$
declare
  sobrepostos integer;
begin
  select count(*) into sobrepostos
  from public.appointments a
  join public.appointments b
    on a.professional_id = b.professional_id
   and a.date = b.date
   and a.id < b.id
   and a.status not in ('cancelado', 'faltou')
   and b.status not in ('cancelado', 'faltou')
   and a.start_time < b.end_time
   and b.start_time < a.end_time;

  if sobrepostos > 0 then
    raise notice 'ATENÇÃO: existem % pares de atendimentos sobrepostos. Ajuste-os e rode este bloco de novo para criar a trava.', sobrepostos;
  else
    alter table public.appointments
      drop constraint if exists appointments_sem_sobreposicao;
    -- o Postgres não tem um tipo "faixa de hora" pronto, então a faixa
    -- é montada como data + hora (tsrange), que já existe
    alter table public.appointments
      add constraint appointments_sem_sobreposicao
      exclude using gist (
        professional_id with =,
        tsrange(date + start_time, date + end_time) with &&
      ) where (status not in ('cancelado', 'faltou'));
  end if;
end;
$$;

-- agendamento sem profissional escapava de qualquer trava
do $$
begin
  if not exists (select 1 from public.appointments where professional_id is null) then
    alter table public.appointments alter column professional_id set not null;
  else
    raise notice 'ATENÇÃO: há agendamentos sem profissional (anteriores à equipe). Preencha-os para ativar a trava.';
  end if;
end;
$$;

-- -------------------------------------------------------------
-- 5. Quem faltou continuava ocupando a grade pública
--
-- O índice de conflito passou a ignorar 'faltou' no arquivo 011,
-- mas get_busy_slots não — então a vaga liberada pela falta não
-- aparecia para ninguém.
-- -------------------------------------------------------------
create or replace function public.get_busy_slots(dia date, prof uuid)
returns table (start_time time, end_time time)
language sql
stable
security definer set search_path = public
as $$
  select a.start_time, a.end_time
  from public.appointments a
  where a.date = dia
    and a.professional_id = prof
    and a.status not in ('cancelado', 'faltou');
$$;

grant execute on function public.get_busy_slots(date, uuid) to anon, authenticated;

-- -------------------------------------------------------------
-- 6. O telefone das profissionais estava público na internet
-- -------------------------------------------------------------
revoke select on public.professionals from anon;
grant select (id, name, slug, bio, photo_url, active, created_at)
  on public.professionals to anon;

-- -------------------------------------------------------------
-- 7. Uma profissional podia apagar a foto de outra
--
-- A foto passa a morar numa pasta com o identificador da dona, e a
-- permissão confere a pasta.
-- -------------------------------------------------------------
drop policy if exists "equipe envia foto de profissional" on storage.objects;
create policy "equipe envia foto de profissional"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'professional-photos'
    and (
      public.is_admin()
      or (storage.foldername(name))[1] = public.my_professional_id()::text
    )
  );

drop policy if exists "equipe atualiza foto de profissional" on storage.objects;
create policy "equipe atualiza foto de profissional"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'professional-photos'
    and (
      public.is_admin()
      or (storage.foldername(name))[1] = public.my_professional_id()::text
    )
  );

drop policy if exists "equipe remove foto de profissional" on storage.objects;
create policy "equipe remove foto de profissional"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'professional-photos'
    and (
      public.is_admin()
      or (storage.foldername(name))[1] = public.my_professional_id()::text
    )
  );

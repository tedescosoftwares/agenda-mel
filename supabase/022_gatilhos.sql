-- =============================================================
-- Agenda Mel — 022: os gatilhos de verdade
-- Rode este arquivo no SQL Editor do Supabase (DEPOIS do 021).
--
-- Correção de uma trava que nunca travou.
--
-- O 013 criou o gatilho que impede a cliente de marcar o próprio
-- atendimento como concluído. Ele começa assim:
--
--     if current_user not in ('authenticated', 'anon') then
--       return new;                      -- veio de função do servidor
--     end if;
--
-- Só que a função foi criada como SECURITY DEFINER. Dentro de uma
-- função SECURITY DEFINER, current_user é o DONO da função (postgres),
-- nunca 'authenticated' — então a primeira linha sempre saía fora e o
-- resto do gatilho jamais rodou. Na prática a cliente continuava
-- podendo mandar um PATCH e escrever status = 'concluido'.
--
-- Isso ficou pior agora que os números do mês somam justamente os
-- atendimentos concluídos: seria o faturamento mentindo.
--
-- A correção é uma palavra: SECURITY INVOKER. Aí current_user é
-- 'authenticated' quando a escrita vem da API, e vira o dono da função
-- quando a escrita nasce dentro de uma função nossa — que é
-- exatamente a distinção que o código queria fazer.
--
-- O gatilho não precisa de poder nenhum: ele só lê NEW e OLD e chama
-- is_admin() / is_professional(), que continuam SECURITY DEFINER.
-- =============================================================

-- Quem está falando, sem depender de o papel enxergar o schema auth.
-- O gatilho abaixo roda como SECURITY INVOKER; este atalho é a única
-- coisa nele que precisa de poder.
create or replace function public.meu_id()
returns uuid
language sql
stable
security definer set search_path = public
as $$
  select auth.uid();
$$;

revoke execute on function public.meu_id() from public;
grant execute on function public.meu_id() to anon, authenticated;

create or replace function public.valida_status_agendamento()
returns trigger
language plpgsql
security invoker set search_path = public
as $$
begin
  -- escrita nascida dentro de uma função do servidor (SECURITY DEFINER)
  -- ou vinda do service_role: já foi validada lá dentro
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

    if old.client_id = public.meu_id() then
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

revoke execute on function public.valida_status_agendamento()
  from public, anon, authenticated;

drop trigger if exists on_valida_status on public.appointments;
create trigger on_valida_status
  before insert or update on public.appointments
  for each row execute function public.valida_status_agendamento();

-- A cliente também não muda data nem horário por fora: adiantar é
-- convite, e responder ao convite passa por responder_antecipacao().
-- (o grant de coluna já limitava a status e notes; isto é o cinto)
revoke update on public.appointments from authenticated;
grant update (status, notes) on public.appointments to authenticated;

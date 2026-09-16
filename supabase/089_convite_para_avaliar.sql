-- 089 · Convite para avaliar, uma hora depois do último horário do dia
--
-- A cliente só era chamada a avaliar quando abria o app. Agora, uma hora
-- depois de terminar o ÚLTIMO horário dela no dia, chega um push por
-- serviço ("Como foi com Ana?") que abre direto a folha de estrelas.
-- Quem fez dois serviços no mesmo dia recebe os dois convites juntos,
-- depois do segundo, e não no meio da visita. Nada sai de noite: o que
-- termina depois das 21h espera as 8h do dia seguinte.
--
-- A baixa da profissional pode levar até 3 h (077); para a cliente não
-- esbarrar em "ainda não dá para avaliar", um horário confirmado que já
-- terminou também aceita avaliação.
--
--   appointments.avaliacao_pedida_em   quando o convite saiu (não repete)
--   convidar_avaliacoes(forcar)        a rotina; devolve quantos convites
--   rodar_rotinas()                    passa a chamá-la (a cada 5 min)
--   push.avaliar_atendimento           modelo editável na plataforma

alter table public.appointments add column if not exists avaliacao_pedida_em timestamptz;

-- 1. avaliar um horário que já aconteceu, mesmo antes da baixa ---------------
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
        and (a.status = 'concluido'
             or (a.status = 'confirmado' and (a.date + a.end_time) < public.agora_local()))
    )
  );

-- 2. a rotina -----------------------------------------------------------------
create or replace function public.convidar_avaliacoes(forcar boolean default false)
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  r record;
  n integer := 0;
  agora timestamp := public.agora_local();
  quando text;
begin
  -- só em hora decente; o que terminou de noite espera a manhã
  if not forcar and (extract(hour from agora) < 8 or extract(hour from agora) >= 21) then
    return 0;
  end if;

  for r in
    select a.id, a.client_id, a.date, a.start_time, a.professional_id,
           coalesce(a.service_name, s.name, 'atendimento') as servico,
           split_part(p.name, ' ', 1) as prof_nome
    from public.appointments a
    join public.professionals p on p.id = a.professional_id
    left join public.services s on s.id = a.service_id
    join public.profiles c on c.id = a.client_id
    where a.client_id is not null
      and a.status in ('confirmado', 'concluido')
      and a.avaliacao_pedida_em is null
      and c.accepts_reminders
      and a.date >= (agora::date - 2)                                  -- não cobra coisa velha
      and (a.date + a.end_time) + interval '1 hour' <= agora
      and not exists (select 1 from public.reviews rv where rv.appointment_id = a.id)
      and not exists (select 1 from public.appointments t where t.remarca_de = a.id and t.status = 'pendente')
      and not exists (select 1 from public.aceites ac where ac.appointment_id = a.id and ac.resultado is null)
      -- espera o último horário dela no dia terminar (e mais 1 h)
      and not exists (
        select 1 from public.appointments u
        where u.client_id = a.client_id and u.date = a.date and u.id <> a.id
          and u.status in ('pendente', 'confirmado', 'concluido')
          and (u.date + u.end_time) + interval '1 hour' > agora)
    order by a.date, a.start_time
    limit 200
  loop
    update public.appointments set avaliacao_pedida_em = now() where id = r.id;
    quando := case when r.date = agora::date then 'hoje' else 'dia ' || to_char(r.date, 'DD/MM') end
              || ' às ' || to_char(r.start_time, 'HH24:MI');
    perform public.notificar(
      r.client_id,
      'avaliar_atendimento',
      'Como foi com ' || r.prof_nome || '?',
      r.servico || ' ' || quando || '. Conta pra gente em 10 segundos: toque para avaliar.',
      '/cliente/agendamento/' || r.id || '?avaliar=1',
      jsonb_build_object('appointment_id', r.id, 'professional_id', r.professional_id),
      (agora + interval '7 days') at time zone 'America/Sao_Paulo');
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function public.convidar_avaliacoes(boolean) from public, anon, authenticated;

-- 3. o modelo de push, editável na plataforma -----------------------------------
insert into public.modelos_de_mensagem (chave, grupo, titulo, descricao, variaveis, padrao, ordem, exemplo) values
('push.avaliar_atendimento', 'push', 'Convite para avaliar', 'Uma hora depois do último horário do dia da cliente, um convite por serviço. Abre direto a folha de estrelas.', '{titulo,texto,nome,servico,profissional,quando}', E'{titulo}\n{texto}', 750,
  '{"titulo":"Como foi com Ana?","texto":"Manicure hoje às 14:00. Conta pra gente em 10 segundos: toque para avaliar."}')
on conflict (chave) do update set grupo = excluded.grupo, titulo = excluded.titulo, descricao = excluded.descricao,
  variaveis = excluded.variaveis, ordem = excluded.ordem, exemplo = excluded.exemplo;
insert into public.push_regras (kind, envia) values ('avaliar_atendimento', true) on conflict (kind) do nothing;

-- 4. entra no relógio ------------------------------------------------------------
create or replace function public.rodar_rotinas()
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  vencidos integer := 0;
  ofertas integer := 0;
  lembretes integer := 0;
  perguntas integer := 0;
  fechamentos integer := 0;
  concluidos integer := 0;
  avaliacoes integer := 0;
begin
  vencidos   := coalesce(public.resolver_aceites_vencidos(), 0);
  ofertas    := coalesce(public.avancar_ofertas_expiradas(), 0);
  lembretes  := coalesce(public.enviar_lembretes(), 0);
  begin
    perguntas := coalesce(public.perguntar_se_veio(), 0);
  exception when others then perguntas := -1;
  end;
  begin
    fechamentos := coalesce(public.lembrar_fechar_dia(), 0);
  exception when others then fechamentos := -1;
  end;
  begin
    concluidos := coalesce(public.concluir_atendimentos_passados(), 0);
  exception when others then concluidos := -1;
  end;
  begin
    avaliacoes := coalesce(public.convidar_avaliacoes(), 0);
  exception when others then avaliacoes := -1;
  end;
  return jsonb_build_object(
    'aceites_vencidos', vencidos,
    'ofertas_expiradas', ofertas,
    'lembretes', lembretes,
    'perguntas', perguntas,
    'fechamentos', fechamentos,
    'concluidos', concluidos,
    'avaliacoes', avaliacoes,
    'em', now());
end;
$$;
revoke execute on function public.rodar_rotinas() from public, anon, authenticated;

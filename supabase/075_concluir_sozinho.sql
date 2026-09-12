-- 075 · Atendimento que passou conclui sozinho
--
-- Horário confirmado que terminou há mais de 3 horas vira "concluído"
-- pela rotina (a cada 5 min), sem depender de a profissional dar baixa.
-- Só quando não há pergunta aberta: pedido de troca pendente apontando
-- para ele, ou pedido de aceite sem resposta. Esses ficam esperando a
-- resposta (a 076 trata "não veio" e "remarcamos").
--
-- A conclusão passa pelos gatilhos de sempre: pós-atendimento, retorno,
-- cashback de indicação, e a cliente ganha o "Avaliar".
--
--   concluir_atendimentos_passados()   a rotina; devolve quantos concluiu
--   rodar_rotinas()                    passa a chamá-la

create or replace function public.concluir_atendimentos_passados()
returns integer
language plpgsql
security definer set search_path = public
as $$
declare n integer;
begin
  with prontos as (
    select a.id
    from public.appointments a
    where a.status = 'confirmado'
      and (a.date + a.end_time) + interval '3 hours' < public.agora_local()
      and not exists (select 1 from public.appointments t where t.remarca_de = a.id and t.status = 'pendente')
      and not exists (select 1 from public.aceites ac where ac.appointment_id = a.id and ac.resultado is null)
    order by a.date, a.start_time
    limit 200
  )
  update public.appointments a set status = 'concluido'
  from prontos p where a.id = p.id;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.concluir_atendimentos_passados() from public, anon, authenticated;

create or replace function public.rodar_rotinas()
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  vencidos integer := 0;
  ofertas integer := 0;
  lembretes integer := 0;
  concluidos integer := 0;
begin
  vencidos   := coalesce(public.resolver_aceites_vencidos(), 0);
  ofertas    := coalesce(public.avancar_ofertas_expiradas(), 0);
  lembretes  := coalesce(public.enviar_lembretes(), 0);
  begin
    concluidos := coalesce(public.concluir_atendimentos_passados(), 0);
  exception when others then concluidos := -1;
  end;
  return jsonb_build_object(
    'aceites_vencidos', vencidos,
    'ofertas_expiradas', ofertas,
    'lembretes', lembretes,
    'concluidos', concluidos,
    'em', now());
end;
$$;
revoke execute on function public.rodar_rotinas() from public, anon, authenticated;

-- 238 · O teste da assistente marca como marcaria de verdade (3.95.3)
--
-- No "Testar de verdade", o marcar era só de mentira e dizia ao modelo "teste: nada foi marcado de verdade", e a
-- assistente respondia que o horário não estava confirmado. Agora o teste pergunta ao banco o que aconteceria
-- (bot_marcar_simular: as mesmas conferências do bot_marcar, sem gravar nada) e a resposta sai igual à de verdade:
-- confirmado na hora, ou pedido esperando a casa/profissional confirmar (Ajustes › Pedidos de horário).
-- A tela da assistente mostra essa regra (assistente_do_salao devolve 'aceite').

create or replace function public.bot_marcar_simular(salao uuid, profissional_id uuid, servico_id uuid, dia date, hora time)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
#variable_conflict use_variable
declare dur integer; manual boolean; nome_s text; nome_p text; virou text;
begin
  select s.duration_minutes, s.name into dur, nome_s from public.services s where s.id = servico_id and s.salon_id = salao and s.active;
  if dur is null then return jsonb_build_object('erro', 'serviço não encontrado neste salão'); end if;
  select p.aceite_manual, p.name into manual, nome_p from public.professionals p where p.id = profissional_id and p.salon_id = salao and p.active;
  if nome_p is null then return jsonb_build_object('erro', 'profissional não encontrada'); end if;
  if not exists (select 1 from public.professional_services ps where ps.professional_id = profissional_id and ps.service_id = servico_id) then
    return jsonb_build_object('erro', nome_p || ' não faz ' || nome_s);
  end if;
  if not exists (select 1 from public.horarios_livres(profissional_id, dia, dur) h where h.hora = hora) then
    return jsonb_build_object('erro', 'esse horário não está mais livre', 'sugestao', public.bot_horarios(salao, profissional_id, dia, servico_id));
  end if;
  virou := case when coalesce(manual, false) then 'pendente' else 'confirmado' end;
  return jsonb_build_object('ok', true, 'status', virou, 'servico', nome_s, 'profissional', nome_p,
    'dia', to_char(dia, 'DD/MM'), 'hora', to_char(hora, 'HH24:MI'),
    'aviso', case when virou = 'pendente' then 'a profissional precisa aceitar; a cliente recebe a resposta por aqui' else 'já está confirmado' end);
end;
$$;
revoke execute on function public.bot_marcar_simular(uuid, uuid, uuid, date, time) from public, anon, authenticated;

create or replace function public.assistente_do_salao(salao uuid)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare canal record; nome_salao text;
begin
  if not public.is_admin_do_salao(salao) then raise exception 'só quem administra o salão mexe na assistente'; end if;
  select * into canal from public.whatsapp_channels where salon_id = salao;
  select name into nome_salao from public.salons where id = salao;
  return jsonb_build_object(
    'salao', nome_salao,
    'config', public.assistente_config(salao),
    'recado', canal.orientacao_ia,
    'ligada', coalesce(canal.usa_ia, false),
    'agente_global', coalesce((select valor from public.config_publica where chave = 'ia_agente'), 'ligado') = 'ligado',
    'canal', jsonb_build_object('tipo', coalesce(canal.canal, 'manual'), 'ativo', coalesce(canal.ativo, false),
                                'numero_proprio', coalesce(canal.numero_proprio, false), 'numero', canal.numero_exibicao,
                                'conectado_em', canal.conectado_em, 'casa', public.instancia_da_casa() is not null),
    'horario', public.salao_horario_texto(salao),
    'aberto_agora', public.salao_aberto_agora(salao),
    -- 238: quem confirma o horário que ela marca (Ajustes › Pedidos de horário)
    'aceite', (select jsonb_build_object('modo', s.aceite_modo, 'minutos', s.minutos_para_aceitar, 'no_silencio', s.ao_expirar)
                 from public.salons s where s.id = salao));
end;
$$;
revoke execute on function public.assistente_do_salao(uuid) from public, anon;
grant execute on function public.assistente_do_salao(uuid) to authenticated;

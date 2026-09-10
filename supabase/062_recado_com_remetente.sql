-- 062 · O recado diz quem mandou
--
-- Na tela de bloqueio o iPhone escreve o nome do app (MIMO) em cima de
-- todo aviso — isso é do sistema e não muda. O que muda é o título:
-- um recado da Ana chega como "Ana Oliveira: Voltei de férias", e o do
-- salão como "Studio Mel: Sexta com horários extras". Recado da
-- plataforma fica só com o título, porque o remetente já é o MIMO.
create or replace function public.enviar_recado(
  publico text, titulo text, corpo text,
  url text default null, salao uuid default null, filtro jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
#variable_conflict use_variable
declare
  eu uuid := auth.uid();
  novo uuid;
  quem uuid;
  n integer := 0;
  c integer := 0;
  remetente text;
  titulo_aviso text;
begin
  titulo := btrim(coalesce(titulo, ''));
  corpo := btrim(coalesce(corpo, ''));
  url := nullif(btrim(coalesce(url, '')), '');
  if not public.pode_mandar_recado(publico, salao) then
    raise exception 'Você não pode mandar recado para esse público.';
  end if;
  if length(titulo) < 3 or length(titulo) > 80 then
    raise exception 'O título precisa ter entre 3 e 80 letras.';
  end if;
  if length(corpo) > 300 then
    raise exception 'A mensagem pode ter até 300 letras.';
  end if;
  if url is not null and url !~ '^/[a-zA-Z0-9/_?=&.-]*$' then
    raise exception 'O link tem de ser uma tela do app (começa com /).';
  end if;
  if exists (select 1 from public.recados r where r.autor = eu and r.titulo = titulo and r.corpo = corpo
              and r.criado_em > now() - interval '1 hour') then
    raise exception 'Esse mesmo recado já foi enviado há menos de uma hora.';
  end if;

  -- quem assina
  remetente := case
    when publico = 'minhas_clientes' then (select p.name from public.professionals p where p.user_id = eu limit 1)
    when publico in ('clientes', 'equipe') then (select s.name from public.salons s where s.id = salao)
    else null end;
  titulo_aviso := case when remetente is not null then remetente || ': ' || titulo else titulo end;

  insert into public.recados (salon_id, autor, publico, filtro, titulo, corpo, url)
  values (case when publico in ('clientes', 'equipe') then salao else null end, eu, publico, coalesce(filtro, '{}'::jsonb), titulo, corpo, url)
  returning id into novo;

  for quem in select u from public.publico_do_recado(publico, salao, filtro) q(u) loop
    perform public.notificar(quem, 'recado', titulo_aviso, nullif(corpo, ''), url,
                             jsonb_build_object('recado_id', novo, 'de', eu, 'remetente', remetente));
    n := n + 1;
    if exists (select 1 from public.push_subscriptions s where s.user_id = quem) then c := c + 1; end if;
  end loop;

  update public.recados set destinatarios = n, celulares = c where id = novo;
  return jsonb_build_object('id', novo, 'destinatarios', n, 'celulares', c, 'remetente', remetente);
end;
$$;
revoke execute on function public.enviar_recado(text, text, text, text, uuid, jsonb) from public, anon;
grant execute on function public.enviar_recado(text, text, text, text, uuid, jsonb) to authenticated;

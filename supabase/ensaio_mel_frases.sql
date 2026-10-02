-- Ensaio da 139: a biblioteca de frases da Mel. Desfaz no fim.
begin;
do $$
declare
  plat uuid; comum uuid; r jsonb; n integer; f1 uuid; f2 uuid; f3 uuid; antes integer; t text;
begin
  -- alguém vira plataforma só dentro desta transação
  select id into plat from public.profiles order by created_at limit 1;
  update public.profiles set role = 'plataforma' where id = plat;
  select id into comum from public.profiles where id <> plat and role <> 'plataforma' order by created_at limit 1;
  perform set_config('request.jwt.claim.sub', plat::text, true);
  delete from public.mel_exibicoes; delete from public.mel_frases;

  -- 1. o catálogo veio semeado
  select count(*) into n from public.mel_momentos;
  if n <> 27 then raise exception '1: esperava 27 momentos, veio %', n; end if;
  if (select placeholders from public.mel_momentos where chave = 'proxima_cliente_em_breve') <> '{cliente,hora,servico,minutos,profissional}' then raise exception '1b'; end if;
  raise notice '1 catálogo: % momentos', n;

  -- 2. gravar direto: válida entra; chave, placeholder, superfície e peso errados não
  insert into public.mel_frases (chave, superficie, texto, tom) values ('proxima_cliente_em_breve', 'mel_bubble', '{cliente} chega às {hora}. Dá tempo de um café.', 'feliz') returning id into f1;
  begin
    insert into public.mel_frases (chave, superficie, texto) values ('nao_existe', 'mel_bubble', 'x'); raise exception '2a: aceitou chave inexistente';
  exception when check_violation or foreign_key_violation then null; end;
  begin
    insert into public.mel_frases (chave, superficie, texto) values ('calor_extremo', 'mel_bubble', '{batata} graus'); raise exception '2b: aceitou {batata}';
  exception when check_violation then t := sqlerrm; end;
  if position('{batata}' in t) = 0 then raise exception '2b: mensagem ruim: %', t; end if;
  begin
    insert into public.mel_frases (chave, superficie, texto) values ('dia_vazio', 'weather_card', 'x'); raise exception '2c: aceitou superfície que o moment não usa';
  exception when check_violation then null; end;
  begin
    insert into public.mel_frases (chave, superficie, texto, peso) values ('dia_vazio', 'mel_bubble', 'x', 0); raise exception '2d: aceitou peso 0';
  exception when check_violation then null; end;
  begin
    insert into public.mel_frases (chave, superficie, texto) values ('dia_vazio', 'mel_bubble', 'chave { aberta'); raise exception '2e: aceitou chave sem fechar';
  exception when check_violation then null; end;
  begin
    insert into public.mel_frases (chave, superficie, texto, contextos_clima) values ('contexto_comum', 'mel_bubble', 'x', '{noite}'); raise exception '2f: aceitou noite em contextos_clima';
  exception when check_violation then null; end;
  -- lista vazia vira null (qualquer)
  insert into public.mel_frases (chave, superficie, texto, ramos) values ('calor_extremo', 'mel_bubble', 'Hoje até o café está pedindo gelo.', '{}') returning id into f2;
  if (select ramos from public.mel_frases where id = f2) is not null then raise exception '2g: ramos vazio devia virar null'; end if;
  raise notice '2 gravação direta: válida entra, inválidas barradas';

  -- 3. importação: prévia não grava, relatório aponta cada problema
  select count(*) into antes from public.mel_frases;
  r := public.mel_frases_importar($j$[
    {"chave":"calor_extremo","superficie":"mel_bubble","texto":"{temperatura} graus e o secador trabalhando dobrado.","ramos":["cabelo"],"tom":"cansada"},
    {"chave":"calor_extremo","superficie":"weather_card","texto":"Sensação de {sensacao} graus. Água pra cliente, água pra você.","ramos":null,"tom":"neutra","peso":2},
    {"id":"00000000-0000-0000-0000-000000000001","chave":"calor_extremo","superficie":"mel_bubble","texto":"id que não existe"},
    {"chave":"calor_extremo","superficie":"mel_bubble","texto":"{x} não existe aqui"},
    {"chave":"calor_extremo","superficie":"balao","texto":"superfície errada"},
    {"chave":"calor_extremo","superficie":"mel_bubble","texto":"Hoje até o café está pedindo gelo."},
    {"chave":"sei_la","superficie":"mel_bubble","texto":"moment errado"},
    "isso nem é objeto"
  ]$j$::jsonb, false);
  if (r ->> 'total')::int <> 8 or (r ->> 'validas')::int <> 2 or (r ->> 'invalidas')::int <> 6 then raise exception '3: %', r; end if;
  if (select count(*) from public.mel_frases) <> antes then raise exception '3b: prévia gravou'; end if;
  if r -> 'problemas' -> 0 ->> 'erro' not like 'id % não existe' then raise exception '3c: %', r -> 'problemas' -> 0; end if;
  if r -> 'problemas' -> 1 ->> 'erro' not like 'placeholder {x}%' then raise exception '3d: %', r -> 'problemas' -> 1; end if;
  if r -> 'problemas' -> 2 ->> 'erro' not like 'superfície%' then raise exception '3e: %', r -> 'problemas' -> 2; end if;
  if r -> 'problemas' -> 3 ->> 'erro' <> 'já existe' then raise exception '3f: %', r -> 'problemas' -> 3; end if;
  if r -> 'problemas' -> 4 ->> 'erro' not like 'moment%' then raise exception '3g: %', r -> 'problemas' -> 4; end if;
  if r -> 'problemas' -> 5 ->> 'erro' <> 'não é um objeto' then raise exception '3h: %', r -> 'problemas' -> 5; end if;
  raise notice '3 prévia: % válidas, % problemas, nada gravado', r ->> 'validas', r ->> 'invalidas';

  -- 4. aplicar: as 2 válidas entram, as 6 ficam de fora
  r := public.mel_frases_importar($j$[
    {"chave":"calor_extremo","superficie":"mel_bubble","texto":"{temperatura} graus e o secador trabalhando dobrado.","ramos":["cabelo"],"tom":"cansada"},
    {"chave":"calor_extremo","superficie":"weather_card","texto":"Sensação de {sensacao} graus. Água pra cliente, água pra você.","ramos":null,"tom":"neutra","peso":2},
    {"chave":"calor_extremo","superficie":"mel_bubble","texto":"{x} não existe aqui"},
    {"chave":"calor_extremo","superficie":"mel_bubble","texto":"Hoje até o café está pedindo gelo."}
  ]$j$::jsonb, true);
  if (r ->> 'inseridas')::int <> 2 or (r ->> 'atualizadas')::int <> 0 or (r ->> 'invalidas')::int <> 2 then raise exception '4: %', r; end if;
  if (select count(*) from public.mel_frases) <> antes + 2 then raise exception '4b'; end if;
  if (select ramos from public.mel_frases where texto like '{temperatura} graus e o secador%') <> '{cabelo}' then raise exception '4c: ramos não gravou'; end if;
  raise notice '4 importou: % inseridas', r ->> 'inseridas';

  -- 5. o ciclo real: exporta, edita o JSON, reimporta (id atualiza; sem id insere; inválida fica de fora)
  select id into f3 from public.mel_frases where texto like '{temperatura} graus e o secador%';
  r := public.mel_frases_importar(jsonb_build_array(
    jsonb_build_object('id', f3, 'chave', 'calor_extremo', 'superficie', 'mel_bubble', 'texto', '{temperatura} graus e o secador no talo.', 'ramos', jsonb_build_array('cabelo', 'beleza'), 'tom', 'cansada'),
    jsonb_build_object('id', f1, 'chave', 'proxima_cliente_em_breve', 'superficie', 'mel_bubble', 'texto', '{cliente} chega às {hora}. Dá tempo de um café.', 'peso', 3),
    jsonb_build_object('chave', 'frio_forte', 'superficie', 'weather_card', 'texto', '{temperatura} graus. Cliente chega de gorro e sai de escova feita.', 'ramos', jsonb_build_array('cabelo')),
    jsonb_build_object('chave', 'frio_forte', 'superficie', 'weather_card', 'texto', '{minima} graus e {batata}')
  ), true);
  if (r ->> 'atualizadas')::int <> 2 or (r ->> 'inseridas')::int <> 1 or (r ->> 'invalidas')::int <> 1 then raise exception '5: %', r; end if;
  if (select texto from public.mel_frases where id = f3) <> '{temperatura} graus e o secador no talo.' then raise exception '5b: não atualizou pelo id'; end if;
  if (select ramos from public.mel_frases where id = f3) <> '{cabelo,beleza}' then raise exception '5c: ramos'; end if;
  if (select peso from public.mel_frases where id = f1) <> 3 then raise exception '5d: peso'; end if;
  if (select tom from public.mel_frases where id = f1) <> 'feliz' then raise exception '5e: campo ausente no JSON devia ficar como estava'; end if;
  if (select updated_at > created_at from public.mel_frases where id = f3) is not true then raise exception '5f: updated_at'; end if;
  raise notice '5 ciclo exportar/editar/reimportar: 2 atualizadas, 1 nova, 1 rejeitada';

  -- 6. repetida dentro do mesmo lote: a segunda é apontada, a primeira fica
  r := public.mel_frases_importar($j$[
    {"chave":"dia_vazio","superficie":"mel_bubble","texto":"Hoje tá quieto por aqui."},
    {"chave":"dia_vazio","superficie":"mel_bubble","texto":"hoje tá quieto por aqui. "}
  ]$j$::jsonb, true);
  if (r ->> 'inseridas')::int <> 1 or (r ->> 'invalidas')::int <> 1 then raise exception '6: %', r; end if;
  raise notice '6 repetida no lote: só uma entra';

  -- 7. estatísticas: uma linha por frase, zeradas; quem não é plataforma não vê
  select count(*) into n from public.mel_frases_estatisticas() where exibicoes = 0;
  if n <> (select count(*) from public.mel_frases) then raise exception '7: %', n; end if;
  if comum is not null then
    perform set_config('request.jwt.claim.sub', comum::text, true);
    begin
      perform public.mel_frases_estatisticas(); raise exception '7b: comum viu estatísticas';
    exception when raise_exception then if sqlerrm like '%7b%' then raise; end if; end;
    begin
      perform public.mel_frases_importar('[]'::jsonb, false); raise exception '7c: comum importou';
    exception when raise_exception then if sqlerrm like '%7c%' then raise; end if; end;
    perform set_config('request.jwt.claim.sub', plat::text, true);
  end if;
  raise notice '7 estatísticas: zeradas e só da plataforma';

  -- 8. exclusão: sem histórico apaga; com histórico, não
  delete from public.mel_frases where id = f2;
  insert into public.mel_exibicoes (salon_id, user_id, chave, superficie, frase_id, texto_template_snapshot)
  values ((select id from public.salons limit 1), plat, 'proxima_cliente_em_breve', 'mel_bubble', f1, (select texto from public.mel_frases where id = f1));
  begin
    delete from public.mel_frases where id = f1; raise exception '8: apagou frase com histórico';
  exception when restrict_violation then t := sqlerrm; end;
  if position('Desative' in t) = 0 then raise exception '8b: mensagem: %', t; end if;
  update public.mel_frases set ativa = false where id = f1;
  if (select ativa from public.mel_frases where id = f1) then raise exception '8c'; end if;
  -- o snapshot sobrevive à edição da frase
  update public.mel_frases set texto = '{cliente} chega às {hora}. Café?' where id = f1;
  if (select texto_template_snapshot from public.mel_exibicoes where frase_id = f1) <> '{cliente} chega às {hora}. Dá tempo de um café.' then raise exception '8d: snapshot mudou'; end if;
  raise notice '8 exclusão protegida; desativa; snapshot preservado';

  -- 9. RLS: salão comum não lê o catálogo nem as frases; plataforma lê
  if comum is not null then
    perform set_config('request.jwt.claim.sub', comum::text, true);
    set local role authenticated;
    select count(*) into n from public.mel_momentos; if n <> 0 then raise exception '9: comum leu % momentos', n; end if;
    select count(*) into n from public.mel_frases; if n <> 0 then raise exception '9b: comum leu % frases', n; end if;
    begin
      select count(*) into n from public.mel_exibicoes; raise exception '9c: comum leu exibições';
    exception when insufficient_privilege then null; end;
    reset role;
    perform set_config('request.jwt.claim.sub', plat::text, true);
    set local role authenticated;
    select count(*) into n from public.mel_momentos; if n <> 27 then raise exception '9d: plataforma leu % momentos', n; end if;
    select count(*) into n from public.mel_frases; if n < 5 then raise exception '9e: plataforma leu % frases', n; end if;
    insert into public.mel_frases (chave, superficie, texto) values ('dia_cheio', 'mel_bubble', 'Agenda cheia hoje. Eu fico de olho.');
    reset role;
    raise notice '9 RLS: comum não vê nada; plataforma lê e escreve';
  end if;

  raise notice 'ensaio da 139 ok';
end $$;
rollback;

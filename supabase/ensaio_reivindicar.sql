-- Ensaio da reivindicação (159). Roda numa cópia do banco de teste com a 153–156 e a 159
-- aplicadas e desfaz tudo no fim (rollback):
--   psql -h /tmp -p 5433 -U postgres -d <cópia> -f supabase/ensaio_reivindicar.sql
-- Confere: a reivindicação válida grava e enfileira a confirmação em email_outbox;
-- validações, armadilha e limites (e-mail, rede, salão); os outros pedidos seguem
-- iguais (chamada antiga de 5 parâmetros); anon e cliente logada não leem nada; a
-- Plataforma vê, muda o status e o "atendido" acompanha.
\set ON_ERROR_STOP 1
\pset pager off
begin;

-- mais 3 salões no ar para testar o limite por e-mail
update public.guia_lugares set status = 'publicado', conteudo = coalesce(conteudo, '{}'::jsonb)
 where id in (select id from public.guia_lugares where status <> 'publicado' order by nome limit 3);
create temp table t_l as select id, nome, cidade_slug, slug, row_number() over (order by nome) n from public.guia_lugares where status = 'publicado';
grant select on t_l to anon, authenticated;
select n, nome from t_l order by n;

-- ===================== o público (anon) =====================
set role anon;
select set_config('request.headers', '{"user-agent":"Mozilla/5.0 Chrome/129","cf-connecting-ip":"1.2.3.4"}', false);

\echo '--- 1. reivindicação válida'
select public.guia_registrar_interesse(lugar_ => (select id from t_l where n = 1), tipo_ => 'sou_dono', nome_ => 'Ana Paula Souza',
  contato_ => '(13) 99812-0004', email_ => '  Ana.Paula@Exemplo.com ', ligacao_ => 'dona', aceite_ => true) as r1;
\echo '--- 2. de novo, mesmo e-mail e salão: repetido, sem linha nova'
select public.guia_registrar_interesse(lugar_ => (select id from t_l where n = 1), tipo_ => 'sou_dono', nome_ => 'Ana Paula',
  email_ => 'ana.paula@exemplo.com', ligacao_ => 'dona', aceite_ => true) as r2;
\echo '--- 3. validações'
select public.guia_registrar_interesse((select id from t_l where n = 1), 'sou_dono', 'Ana', null, null, 'ana@exemplo', 'dona', true) as email_ruim;
select public.guia_registrar_interesse((select id from t_l where n = 1), 'sou_dono', 'Ana', null, null, 'ana@@exemplo.com', 'dona', true) as email_ruim2;
select public.guia_registrar_interesse((select id from t_l where n = 1), 'sou_dono', 'Ana', null, null, null, 'dona', true) as sem_email;
select public.guia_registrar_interesse((select id from t_l where n = 1), 'sou_dono', 'Ana', null, null, 'ana2@exemplo.com', null, true) as sem_ligacao;
select public.guia_registrar_interesse((select id from t_l where n = 1), 'sou_dono', 'Ana', null, null, 'ana2@exemplo.com', 'chefe', true) as ligacao_ruim;
select public.guia_registrar_interesse((select id from t_l where n = 1), 'sou_dono', 'Ana', null, null, 'ana2@exemplo.com', 'gerente', false) as sem_aceite;
select public.guia_registrar_interesse((select id from t_l where n = 1), 'sou_dono', '', null, null, 'ana2@exemplo.com', 'gerente', true) as sem_nome;
select public.guia_registrar_interesse((select id from t_l where n = 1), 'sou_dono', 'Ana', '1234', null, 'ana2@exemplo.com', 'gerente', true) as zap_ruim;
select public.guia_registrar_interesse('00000000-0000-0000-0000-000000000000', 'sou_dono', 'Ana', null, null, 'ana2@exemplo.com', 'gerente', true) as sem_pagina;
\echo '--- 4. armadilha: finge que deu certo, não grava'
select public.guia_registrar_interesse(lugar_ => (select id from t_l where n = 1), tipo_ => 'sou_dono', nome_ => 'Robô',
  email_ => 'robo@exemplo.com', ligacao_ => 'dona', aceite_ => true, armadilha_ => 'http://spam') as armadilha;
\echo '--- 5. os outros pedidos seguem iguais (chamada antiga, 5 parâmetros por nome e por posição)'
select public.guia_registrar_interesse(lugar_ => (select id from t_l where n = 1), tipo_ => 'quero_marcar', nome_ => null, contato_ => null, mensagem_ => null) as marcar_nomeado;
select public.guia_registrar_interesse((select id from t_l where n = 1), 'quero_marcar', 'Bia', '(13) 99000-0000', null) as marcar_posicional;
select public.guia_registrar_interesse((select id from t_l where n = 1), 'corrigir', null, null, 'horário mudou') as corrigir_sem_contato;
select public.guia_registrar_interesse((select id from t_l where n = 1), 'corrigir', null, 'x@exemplo.com', 'horário mudou') as c1,
       public.guia_registrar_interesse((select id from t_l where n = 1), 'corrigir', null, 'x@exemplo.com', 'horário mudou') as c2,
       public.guia_registrar_interesse((select id from t_l where n = 1), 'corrigir', null, 'x@exemplo.com', 'horário mudou') as c3,
       public.guia_registrar_interesse((select id from t_l where n = 1), 'corrigir', null, 'x@exemplo.com', 'horário mudou') as c4_repetido;
select public.guia_registrar_interesse((select id from t_l where n = 1), 'xyz') as tipo_ruim;

\echo '--- 6. anon não lê nada'
do $$ begin perform 1 from public.guia_interesses limit 1; raise exception 'FALHOU: anon leu guia_interesses';
exception when insufficient_privilege then raise notice 'ok: anon não lê guia_interesses'; end $$;
do $$ begin perform 1 from public.email_outbox limit 1; raise exception 'FALHOU: anon leu email_outbox';
exception when insufficient_privilege then raise notice 'ok: anon não lê email_outbox'; end $$;
do $$ begin perform public.guia_confirmacoes(); raise exception 'FALHOU: anon chamou guia_confirmacoes';
exception when insufficient_privilege then raise notice 'ok: anon não chama guia_confirmacoes'; end $$;
do $$ begin perform * from public.plataforma_atividade(5); raise exception 'FALHOU: anon chamou plataforma_atividade';
exception when insufficient_privilege then raise notice 'ok: anon não chama plataforma_atividade'; end $$;
do $$ begin perform public.email_reivindicacao('a', 'b', 'dona', 'x', 3); raise exception 'FALHOU: anon chamou email_reivindicacao';
exception when insufficient_privilege then raise notice 'ok: anon não chama email_reivindicacao'; end $$;
do $$ begin perform public.enfileirar_email('a@b.com', 'x', 'y'); raise exception 'FALHOU: anon enfileirou';
exception when insufficient_privilege then raise notice 'ok: anon não enfileira e-mail'; end $$;
do $$ begin update public.guia_interesses set status = 'confirmada'; raise exception 'FALHOU: anon mudou status';
exception when insufficient_privilege then raise notice 'ok: anon não muda status'; end $$;
-- o que o público lê da página não traz nada do pedido
select (public.guia_pagina(l.cidade_slug, l.slug))::text ~* 'exemplo\.com|ana paula' as pagina_vaza_pedido, public.guia_pagina(l.cidade_slug, l.slug) is not null as pagina_existe from t_l l where l.n = 1;

\echo '--- 7. limite por e-mail: 3 salões por dia'
select n, public.guia_registrar_interesse(lugar_ => id, tipo_ => 'sou_dono', nome_ => 'Carla', email_ => 'carla@exemplo.com', ligacao_ => 'socia', aceite_ => true) as r
  from t_l where n between 1 and 4 order by n;

\echo '--- 8. limite por rede: 5 por dia (Ana e Carla já gastaram 4 nesta rede)'
select i, public.guia_registrar_interesse(lugar_ => (select id from t_l where n = 2), tipo_ => 'sou_dono', nome_ => 'Rede ' || i,
  email_ => 'rede' || i || '@exemplo.com', ligacao_ => 'funcionaria', aceite_ => true) as r from generate_series(1, 3) i;

\echo '--- 9. limite por salão: 10 por dia (redes diferentes)'
do $$
declare i int; r jsonb; ok int := 0; barrado int := 0; lug uuid := (select id from t_l where n = 3);
begin
  for i in 1..12 loop
    perform set_config('request.headers', json_build_object('user-agent', 'Mozilla/5.0 Chrome/129', 'cf-connecting-ip', '10.0.0.' || i)::text, false);
    r := public.guia_registrar_interesse(lugar_ => lug, tipo_ => 'sou_dono', nome_ => 'Pessoa ' || i, email_ => 'p' || i || '@exemplo.com', ligacao_ => 'gerente', aceite_ => true);
    if (r ->> 'ok')::boolean and not coalesce((r ->> 'repetido')::boolean, false) then ok := ok + 1; else barrado := barrado + 1; end if;
  end loop;
  raise notice 'salão 3: % aceitas, % barradas (esperado: 9 + a da Carla = 10; o resto barrado)', ok, barrado;
end $$;
reset role;

\echo '--- 10. o que ficou gravado (como postgres)'
select l.n, i.nome, i.email, i.contato, i.ligacao, i.status, i.aceite_em is not null as aceite, i.rede is not null as tem_rede, i.email_id is not null as tem_email
  from public.guia_interesses i join t_l l on l.id = i.lugar_id where i.tipo = 'sou_dono' and i.nome in ('Ana Paula Souza', 'Carla') order by i.criado_em;
select tipo, count(*) from public.guia_interesses group by tipo order by tipo;
select count(*) filter (where nome = 'Robô') as robo_gravado, count(*) filter (where email = 'ana2@exemplo.com') as invalidas_gravadas from public.guia_interesses;
\echo '--- 11. a fila de e-mail'
select count(*) as emails_na_fila, count(distinct para) as destinatarios, bool_and(kind = 'guia_reivindicacao') as kind_ok, bool_and(status = 'na_fila') as na_fila, bool_and(user_id is null) as sem_conta
  from public.email_outbox where kind = 'guia_reivindicacao';
select count(*) = (select count(*) from public.guia_interesses where tipo = 'sou_dono') as um_email_por_reivindicacao from public.email_outbox where kind = 'guia_reivindicacao';
select para, nome, assunto, html ~ 'O que acontece agora' as html_ok, html ~ 'contato@mimo.com.vc' as tem_contato, html ~ '/saloes/' as tem_link
  from public.email_outbox o where o.id = (select email_id from public.guia_interesses where email = 'ana.paula@exemplo.com');
select texto from public.email_outbox o where o.id = (select email_id from public.guia_interesses where email = 'ana.paula@exemplo.com');

-- ===================== outra conta logada (não Plataforma) =====================
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'cliente@exemplo.com'), 'role', 'authenticated')::text, false);
set role authenticated;
\echo '--- 12. cliente logada não vê pedido nem confirmação'
select count(*) as cliente_ve from public.guia_interesses;
select public.guia_confirmacoes() as cliente_confirmacoes;
select count(*) as cliente_atividade from public.plataforma_atividade(50);
update public.guia_interesses set status = 'confirmada';
select count(*) as cliente_mudou from public.guia_interesses where status = 'confirmada';
reset role;

-- ===================== a Plataforma =====================
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'admin@exemplo.com'), 'role', 'authenticated')::text, false);
set role authenticated;
\echo '--- 13. a Plataforma vê tudo e o aviso entra em "interesses novos"'
select count(*) as reivindicacoes, count(*) filter (where atendido_em is null) as novas from public.guia_interesses where tipo = 'sou_dono';
select count(*) filter (where atendido_em is null) as interesses_novos_do_topo from public.guia_interesses;
select (select count(*) from jsonb_object_keys(public.guia_confirmacoes())) as confirmacoes,
       (select count(*) from jsonb_each(public.guia_confirmacoes()) where value ->> 'status' = 'na_fila') as na_fila;
select titulo, detalhe from public.plataforma_atividade(100) where titulo = 'Reivindicação no guia' limit 3;
\echo '--- 14. status: em contato, confirmada, volta para nova; e o "Marcar atendido" antigo'
update public.guia_interesses set status = 'em_contato' where email = 'ana.paula@exemplo.com';
select status, atendido_em is not null as atendido, atendido_por is not null as por, status_em is not null as status_em, status_por is not null as status_por from public.guia_interesses where email = 'ana.paula@exemplo.com';
update public.guia_interesses set status = 'confirmada' where email = 'ana.paula@exemplo.com';
select status, atendido_em is not null as atendido from public.guia_interesses where email = 'ana.paula@exemplo.com';
update public.guia_interesses set status = 'nova' where email = 'ana.paula@exemplo.com';
select status, atendido_em is null as voltou_a_novo, atendido_por is null as sem_por from public.guia_interesses where email = 'ana.paula@exemplo.com';
update public.guia_interesses set atendido_em = now() where email = 'ana.paula@exemplo.com';
select status as depois_de_marcar_atendido from public.guia_interesses where email = 'ana.paula@exemplo.com';
update public.guia_interesses set atendido_em = null where email = 'ana.paula@exemplo.com';
select status as depois_de_reabrir from public.guia_interesses where email = 'ana.paula@exemplo.com';
update public.guia_interesses set status = 'recusada', atendido_em = now() where email = 'carla@exemplo.com';
select status, atendido_em is not null as atendido from public.guia_interesses where email = 'carla@exemplo.com' limit 1;
do $$ begin update public.guia_interesses set status = 'aprovada' where email = 'ana.paula@exemplo.com'; raise exception 'FALHOU: status inválido passou';
exception when check_violation then raise notice 'ok: status inválido barrado'; end $$;
-- os outros pedidos não ganham status
select count(*) as outros_com_status from public.guia_interesses where tipo <> 'sou_dono' and status is not null;
update public.guia_interesses set atendido_em = now() where tipo = 'corrigir';
select count(*) as corrigir_com_status from public.guia_interesses where tipo = 'corrigir' and status is not null;
reset role;

rollback;

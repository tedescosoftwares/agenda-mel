-- Ensaio dos números de teste (070). Roda no banco de teste e desfaz.
begin;
do $$
declare plat uuid; r jsonb; n int; lista text[];
begin
  select id into plat from public.profiles where role = 'cliente' limit 1;
  update public.profiles set role = 'plataforma', phone = null where id = plat;
  perform set_config('request.jwt.claim.sub', plat::text, false);
  insert into public.whatsapp_channels (salon_id, canal, ativo, identificador)
    select s.id, 'evolution', true, 'mimo' from public.salons s limit 1
    on conflict (salon_id) do update set ativo = true, canal = 'evolution';

  -- 1. sem lista e sem telefone no perfil: erro claro
  begin
    perform public.plataforma_testar_modelo('Oi, {nome}!');
    raise exception 'devia ter reclamado da falta de número';
  exception when others then
    if sqlerrm not like 'Cadastre pelo menos um número%' then raise; end if;
    raise notice '1 sem número: % (ok)', sqlerrm;
  end;

  -- 2. salva a lista (com apelido, com formatação solta, com repetido)
  select array_agg(telefone) into lista from public.plataforma_salvar_telefones_teste(array['Bruno: (13) 99999-0000', '13988880000', '13 99999-0000', '']);
  if array_length(lista, 1) <> 2 then raise exception 'esperava 2 números, veio %', lista; end if;
  if (select apelido from public.telefones_de_teste where telefone = '5513999990000') <> 'Bruno' then raise exception 'apelido não ficou'; end if;
  raise notice '2 lista salva: % (ok)', lista;

  -- 3. número inválido é recusado
  begin
    perform public.plataforma_salvar_telefones_teste(array['123']);
    raise exception 'devia recusar 123';
  exception when others then
    if sqlerrm not like 'Número inválido%' then raise; end if;
    raise notice '3 inválido recusado (ok)';
  end;

  -- 4. teste vai para a lista inteira
  r := public.plataforma_testar_modelo('Oi, {nome}! Teste.');
  if (r ->> 'quantos')::int <> 2 then raise exception 'esperava 2 envios: %', r; end if;
  select count(*) into n from public.message_outbox where kind = 'teste_modelo' and corpo = 'Oi, Juliana! Teste.' or (kind = 'teste_modelo' and corpo like 'Oi, %! Teste.');
  if n < 2 then raise exception 'faltou mensagem na fila: %', n; end if;
  raise notice '4 teste para %: % (ok)', r -> 'para', n;

  -- 5. teste para números avulsos, ignorando a lista; repetido conta uma vez
  r := public.plataforma_testar_modelo('Só pra um', array['11 97777-0000', '(11) 97777-0000']);
  if (r ->> 'quantos')::int <> 1 or (r -> 'para' ->> 0) <> '5511977770000' then raise exception 'avulso errado: %', r; end if;
  raise notice '5 avulso: % (ok)', r -> 'para';

  -- 6. tirar um da lista
  select array_agg(telefone) into lista from public.plataforma_salvar_telefones_teste(array['13988880000']);
  if lista <> array['5513988880000'] then raise exception 'remoção falhou: %', lista; end if;
  raise notice '6 lista reduzida (ok)';

  -- 7. quem não é plataforma não vê nem salva
  update public.profiles set role = 'cliente' where id = plat;
  if exists (select 1 from public.plataforma_telefones_teste()) then raise exception 'cliente viu a lista'; end if;
  begin
    perform public.plataforma_salvar_telefones_teste(array['13988880000']);
    raise exception 'cliente salvou';
  exception when others then
    if sqlerrm <> 'Só a plataforma.' then raise; end if;
  end;
  raise notice '7 só a plataforma (ok)';
  raise notice 'FIM DO ENSAIO — tudo certo';
end $$;
rollback;

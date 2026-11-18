-- Ensaio da 249 e da 250 (3.99.1 e 3.99.2): os toques do Instagram da MIMO no guia e os números da aba Instagram.
-- Desfaz no fim.
begin;
do $$
declare plat uuid := '00000000-0000-0000-0000-0000000a1a01'; cli uuid := '00000000-0000-0000-0000-0000000a1a02'; r jsonb;
begin
  insert into auth.users (id, email) values (plat, 'plataforma-insta@ensaio.mimo'), (cli, 'cliente-insta@ensaio.mimo') on conflict do nothing;
  insert into public.profiles (id, full_name, role) values (plat, 'Plataforma Ensaio', 'plataforma'), (cli, 'Cliente Ensaio', 'cliente')
  on conflict (id) do update set role = excluded.role;
  delete from public.site_eventos where tipo like 'insta\_%' or tipo in ('whatsapp', 'ligar');

  -- A. os três tipos existem e não somam como contato
  if (select count(*) from public.site_eventos_tipos where tipo in ('insta_convite', 'insta_seguir', 'insta_direto') and grupo = 'outro' and ativo) <> 3 then
    raise exception 'A1: faltam os tipos do Instagram';
  end if;
  raise notice 'A os três toques do Instagram existem, no grupo outro';

  -- B. os números: convite, seguir (toques, pessoas, de onde), direto e os contatos para comparar
  insert into public.site_eventos (em, tipo, pagina, visitante, area) values
    (now() - interval '1 hour', 'insta_convite', '/saloes/x/a', 'v1', 'heroi'),
    (now() - interval '1 hour', 'whatsapp', '/saloes/x/a', 'v1', 'heroi'),
    (now() - interval '50 minutes', 'insta_seguir', '/saloes/x/a', 'v1', 'insta_modal'),
    (now() - interval '40 minutes', 'insta_seguir', '/saloes/x', 'v1', 'insta_lista'),
    (now() - interval '30 minutes', 'insta_convite', '/saloes/x/b', 'v2', 'barra'),
    (now() - interval '30 minutes', 'ligar', '/saloes/x/b', 'v2', 'barra'),
    (now() - interval '29 minutes', 'insta_direto', '/saloes/x/b', 'v2', 'insta_modal'),
    (now() - interval '10 days', 'insta_seguir', '/saloes/x/c', 'v3', 'insta_cartao'),
    (now() - interval '60 days', 'insta_seguir', '/saloes/x/d', 'v4', 'insta_cartao');
  perform set_config('request.jwt.claim.sub', plat::text, true);
  r := public.guia_instagram_numeros(30);
  if (r ->> 'convites')::int <> 2 or (r ->> 'seguir')::int <> 3 or (r ->> 'seguir_pessoas')::int <> 2 or (r ->> 'direto')::int <> 1
     or (r ->> 'contatos')::int <> 2 or (r ->> 'seguir_do_convite')::int <> 1 then
    raise exception 'B1: números de 30 dias: %', r;
  end if;
  if (r -> 'por_area' ->> 'insta_modal')::int <> 1 or (r -> 'por_area' ->> 'insta_lista')::int <> 1 or (r -> 'por_area' ->> 'insta_cartao')::int <> 1 then
    raise exception 'B2: de onde veio o Seguir: %', r -> 'por_area';
  end if;
  if (public.guia_instagram_numeros(7) ->> 'seguir')::int <> 2 then raise exception 'B3: o período de 7 dias'; end if;
  if (public.guia_instagram_numeros(90) ->> 'seguir')::int <> 4 then raise exception 'B4: o período de 90 dias'; end if;
  raise notice 'B números: convite, seguir (toques e pessoas, de onde), direto e contatos, por período';

  -- C. quem não é da Plataforma não vê
  perform set_config('request.jwt.claim.sub', cli::text, true);
  begin
    perform public.guia_instagram_numeros(30);
    raise exception 'C1: a cliente viu os números';
  exception when raise_exception then if sqlerrm like 'C1%' then raise; end if;
  end;
  raise notice 'C só a Plataforma vê os números';

  raise notice 'ensaio_guia_instagram: tudo certo';
end $$;
rollback;

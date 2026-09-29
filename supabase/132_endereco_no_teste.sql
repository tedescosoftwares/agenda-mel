-- 132: o endereço próprio faz parte do teste, não do pagamento (2.80.1)
--
-- Na 131 só a assinatura ativa escolhia studiomel.mimo.com.vc. Ficou
-- estranho: o salão em teste imprime o QR, coloca na bio, e o endereço
-- só nascia depois de pagar. Agora escolhe na ativação (ou em Ajustes)
-- e usa durante o teste; só perde se a assinatura parar de vez
-- (fase bloqueado), quando resolver_endereco já responde "pausado".
create or replace function public.subdominio_definir(salao uuid, nome text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  s public.salons%rowtype;
  chk jsonb;
  n text;
  fase text;
begin
  if not (public.is_admin_do_salao(salao) or public.eh_plataforma()) then raise exception 'Só a dona muda o endereço do salão.'; end if;
  select * into s from public.salons where id = salao;
  if not found then raise exception 'Salão não encontrado.'; end if;
  if s.tipo = 'autonoma' then raise exception 'O endereço próprio é para salão. A autônoma usa o link mimo.com.vc/p/…'; end if;
  fase := coalesce(public.acesso_do_salao(salao) ->> 'fase', '');
  if fase = 'bloqueado' and not public.eh_plataforma() then
    raise exception 'A assinatura está parada. Regularize para mexer no endereço.';
  end if;
  chk := public.subdominio_disponivel(nome, salao);
  if not (chk ->> 'ok')::boolean then raise exception '%', chk ->> 'motivo'; end if;
  n := chk ->> 'nome';
  if s.subdominio = n then
    return jsonb_build_object('ok', true, 'subdominio', n, 'mudou', false);
  end if;
  delete from public.subdominios_antigos where subdominio = n and salon_id = salao;
  if s.subdominio is not null then
    insert into public.subdominios_antigos (subdominio, salon_id) values (s.subdominio, salao)
    on conflict (subdominio) do update set salon_id = excluded.salon_id, trocado_em = now();
  end if;
  update public.salons set subdominio = n where id = salao;
  return jsonb_build_object('ok', true, 'subdominio', n, 'mudou', true, 'antigo', s.subdominio);
end;
$$;

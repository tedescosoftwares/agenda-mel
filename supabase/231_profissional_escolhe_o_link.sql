-- 231 · A profissional escolhe o próprio link (3.89)
--
-- O link da profissional do salão é o endereço do salão + /profissionais/<nome> (salaomimo.mimo.com.vc/profissionais/
-- melissa); sem endereço próprio, mimo.com.vc/p/<nome>. O <nome> é o slug dela, que nascia do nome. Agora ela escolhe
-- (em Meu link), e a dona também pode trocar pela gaveta. O slug continua único na MIMO inteira (o /p/<nome> do domínio
-- principal precisa disso). O link antigo deixa de abrir quando ela troca (a tela avisa); o QR com o código continua.
--   profissional_link_livre(nome, profissional)    confere sem gravar: { ok, nome, motivo }
--   profissional_definir_link(profissional, nome)  grava; só ela mesma ou a dona/admin do salão

create or replace function public.profissional_link_livre(nome text, profissional uuid default null)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  n text := left(public.slug_de(coalesce(nome, '')), 40);
  dono uuid;
begin
  if n is null or length(n) < 2 then
    return jsonb_build_object('ok', false, 'nome', n, 'motivo', 'Use pelo menos 2 letras ou números.');
  end if;
  if n !~ '^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$' then
    return jsonb_build_object('ok', false, 'nome', n, 'motivo', 'Só letras, números e hífen no meio.');
  end if;
  -- os caminhos do app (os mesmos de EnderecoDoSalao.jsx) e os do endereço do salão
  if n = any (array['login', 'cadastro', 'entrar', 'comecar', 'onboarding', 'splash', 'landing', 'blog', 'planos', 'sobre',
                    'contato', 'termos', 'privacidade', 'estilo', 'agenda', 'perfil', 'cliente', 'pro', 'admin', 'plataforma',
                    'p', 'v', 'convite', 'equipe', 'ativar', 'bem-vinda', 'assets', 'imagens', 'profissionais', 'profissional',
                    'mimo', 'salao', 'servicos', 'guia']) then
    return jsonb_build_object('ok', false, 'nome', n, 'motivo', 'Esse nome é reservado.');
  end if;
  select p.id into dono from public.professionals p where p.slug = n;
  if dono is not null and dono is distinct from profissional then
    return jsonb_build_object('ok', false, 'nome', n, 'motivo', 'Esse já é de outra profissional na MIMO. Tente com o sobrenome ou com o nome do salão.');
  end if;
  return jsonb_build_object('ok', true, 'nome', n, 'mesmo', dono is not null);
end;
$$;
revoke execute on function public.profissional_link_livre(text, uuid) from public, anon;
grant execute on function public.profissional_link_livre(text, uuid) to authenticated;

create or replace function public.profissional_definir_link(profissional uuid, nome text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  p public.professionals%rowtype;
  chk jsonb;
begin
  select * into p from public.professionals where id = profissional;
  if p.id is null then raise exception 'Profissional não encontrada.'; end if;
  if not (p.user_id = auth.uid() or public.is_admin_do_salao(p.salon_id) or public.eh_plataforma()) then
    raise exception 'Só ela mesma ou a dona do salão trocam este link.';
  end if;
  chk := public.profissional_link_livre(nome, profissional);
  if not (chk ->> 'ok')::boolean then raise exception '%', chk ->> 'motivo'; end if;
  update public.professionals set slug = chk ->> 'nome' where id = profissional;
  return jsonb_build_object('ok', true, 'slug', chk ->> 'nome', 'antigo', p.slug);
end;
$$;
revoke execute on function public.profissional_definir_link(uuid, text) from public, anon;
grant execute on function public.profissional_definir_link(uuid, text) to authenticated;

do $$ begin raise notice '231: a profissional escolhe o próprio link (profissional_link_livre, profissional_definir_link)'; end $$;

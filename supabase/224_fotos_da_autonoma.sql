-- 224_fotos_da_autonoma.sql
-- 3.77.2 — A autônoma consegue subir as fotos. Quem se cadastra como autônoma fica com o papel 'profissional' (053,
-- abrir_negocio; 114, trocar_tipo_negocio), embora seja a dona do próprio negócio (salons.owner_id). As regras das
-- pastas de imagem 'saloes' (logo, fotos do espaço, capas dos serviços: 085) e 'service-images' (a foto de cada
-- serviço: 005) só aceitavam o papel 'admin', e o cadastro dela parava em "new row violates row-level security policy"
-- na hora da foto (no Onboarding, em Ajustes › Página do salão e em Serviços).
--   'saloes': também pode quem é dona ou admin do salão da pasta (o caminho começa pelo id do salão: <salão>/logo/…).
--   'service-images': também pode quem é dona ou admin de algum salão (esses arquivos ficam na raiz, sem o salão).
-- O que já valia continua valendo (o papel 'admin' e a equipe da MIMO).

-- a pasta é de um salão meu? (o primeiro nível do caminho é o id do salão; um caminho sem esse id não é)
create or replace function public.pasta_do_meu_salao(caminho text)
returns boolean language sql stable security definer set search_path = public as $$
  select case when (storage.foldername(caminho))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then public.is_admin_do_salao(((storage.foldername(caminho))[1])::uuid)
              else false end
$$;
revoke execute on function public.pasta_do_meu_salao(text) from public, anon;
grant execute on function public.pasta_do_meu_salao(text) to authenticated;

-- sou dona ou admin de algum salão? (a autônoma é: o negócio é dela)
create or replace function public.tenho_salao()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.meus_saloes())
$$;
revoke execute on function public.tenho_salao() from public, anon;
grant execute on function public.tenho_salao() to authenticated;

drop policy if exists "dona envia foto do salao" on storage.objects;
create policy "dona envia foto do salao" on storage.objects for insert to authenticated
  with check (bucket_id = 'saloes' and (public.is_admin() or public.eh_plataforma() or public.pasta_do_meu_salao(name)));
drop policy if exists "dona troca foto do salao" on storage.objects;
create policy "dona troca foto do salao" on storage.objects for update to authenticated
  using (bucket_id = 'saloes' and (public.is_admin() or public.eh_plataforma() or public.pasta_do_meu_salao(name)));
drop policy if exists "dona remove foto do salao" on storage.objects;
create policy "dona remove foto do salao" on storage.objects for delete to authenticated
  using (bucket_id = 'saloes' and (public.is_admin() or public.eh_plataforma() or public.pasta_do_meu_salao(name)));

drop policy if exists "admin envia imagens de servicos" on storage.objects;
create policy "admin envia imagens de servicos" on storage.objects for insert to authenticated
  with check (bucket_id = 'service-images' and (public.is_admin() or public.tenho_salao()));
drop policy if exists "admin atualiza imagens de servicos" on storage.objects;
create policy "admin atualiza imagens de servicos" on storage.objects for update to authenticated
  using (bucket_id = 'service-images' and (public.is_admin() or public.tenho_salao()));
drop policy if exists "admin remove imagens de servicos" on storage.objects;
create policy "admin remove imagens de servicos" on storage.objects for delete to authenticated
  using (bucket_id = 'service-images' and (public.is_admin() or public.tenho_salao()));

do $$ begin raise notice '224: a autônoma sobe as fotos (pastas saloes e service-images aceitam a dona do salão)'; end $$;

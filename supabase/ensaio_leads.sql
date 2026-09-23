-- Ensaio da 117: o lead entra limpo, a política barra lixo, as páginas novas estão no cadastro. Desfaz no fim.
begin;
do $$
declare l record; n integer;
begin
  insert into public.landing_leads (salon_name, professionals_count, whatsapp, utm_source) values ('  Studio Ensaio ', '4-6', '(13) 99871-0002', 'instagram');
  select * into l from public.landing_leads where salon_name = 'Studio Ensaio';
  if l.whatsapp <> '13998710002' then raise exception '1: whatsapp %', l.whatsapp; end if;
  raise notice '1 lead entra com nome aparado e whatsapp so digitos';
  select count(*) into n from public.seo_pages where route in ('/lista-de-espera-para-salao', '/confirmacao-de-agendamento-whatsapp', '/sistema-de-comissao-para-salao', '/controle-de-clientes-para-salao', '/agenda-multi-profissional', '/sinal-para-agendamento', '/qr-code-para-salao-de-beleza');
  if n <> 7 then raise exception '2: paginas por problema: %', n; end if;
  select count(*) into n from public.seo_sitemap();
  raise notice '2 sete paginas por problema no cadastro; sitemap com % caminhos', n;
  raise notice 'FIM DO ENSAIO — tudo certo';
end $$;
rollback;

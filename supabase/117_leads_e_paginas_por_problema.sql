-- 117: a captura de lead da landing e as páginas SEO por problema.
-- Quem visita mimo.com.vc deixa nome do salão, quantas profissionais e
-- WhatsApp; a plataforma lê. Anônimo só insere, nunca lê.

create table if not exists public.landing_leads (
  id uuid primary key default gen_random_uuid(),
  salon_name text not null,
  professionals_count text,
  whatsapp text not null,
  origem text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  atendido_em timestamptz,
  observacao text,
  created_at timestamptz not null default now()
);
alter table public.landing_leads enable row level security;
drop policy if exists "leads: qualquer um deixa" on public.landing_leads;
create policy "leads: qualquer um deixa" on public.landing_leads for insert to anon, authenticated
  with check (length(btrim(salon_name)) between 2 and 120 and length(regexp_replace(whatsapp, '\D', '', 'g')) between 10 and 13);
drop policy if exists "leads: plataforma ve e cuida" on public.landing_leads;
create policy "leads: plataforma ve e cuida" on public.landing_leads for select to authenticated using (public.eh_plataforma());
drop policy if exists "leads: plataforma atualiza" on public.landing_leads;
create policy "leads: plataforma atualiza" on public.landing_leads for update to authenticated using (public.eh_plataforma()) with check (public.eh_plataforma());
grant insert on public.landing_leads to anon, authenticated;
grant select, update on public.landing_leads to authenticated;
create index if not exists landing_leads_recentes on public.landing_leads (created_at desc);

-- o whatsapp entra só com dígitos, venha como vier
create or replace function public.landing_lead_preparar()
returns trigger
language plpgsql
as $$
begin
  new.whatsapp := regexp_replace(coalesce(new.whatsapp, ''), '\D', '', 'g');
  new.salon_name := btrim(new.salon_name);
  return new;
end;
$$;
drop trigger if exists landing_leads_preparar on public.landing_leads;
create trigger landing_leads_preparar before insert or update on public.landing_leads for each row execute function public.landing_lead_preparar();

-- as sete páginas por problema entram no cadastro de páginas (metas editáveis)
insert into public.seo_pages (route, page_type, title, slug, seo_title, meta_description, og_title, og_description, og_image_url, schema_type) values ('/lista-de-espera-para-salao', 'SEO_LANDING', 'Cancelou às 14:07? Às 14:20 a vaga já tem dona.', 'lista-de-espera-para-salao', 'Lista de Espera para Salão de Beleza | MIMO', 'Lista de espera para salão de beleza: quando um horário é cancelado, a MIMO mostra as clientes compatíveis por serviço, profissional e período. Preencha a vaga em minutos.', 'Lista de Espera para Salão de Beleza | MIMO', 'Lista de espera para salão de beleza: quando um horário é cancelado, a MIMO mostra as clientes compatíveis por serviço, profissional e período. Preencha a vaga em minutos.', 'https://mimo.com.vc/imagens/agenda-celular-1400.webp', 'WebPage') on conflict (route) do nothing;
insert into public.seo_pages (route, page_type, title, slug, seo_title, meta_description, og_title, og_description, og_image_url, schema_type) values ('/confirmacao-de-agendamento-whatsapp', 'SEO_LANDING', 'Confirme o horário sem procurar conversa antiga.', 'confirmacao-de-agendamento-whatsapp', 'Confirmação de Agendamento pelo WhatsApp para Salão | MIMO', 'Confirmação de agendamento pelo WhatsApp para salão de beleza: mensagem com serviço, profissional e hora, resposta que confirma ou remarca direto na agenda, lembrete na véspera.', 'Confirmação de Agendamento pelo WhatsApp para Salão | MIMO', 'Confirmação de agendamento pelo WhatsApp para salão de beleza: mensagem com serviço, profissional e hora, resposta que confirma ou remarca direto na agenda, lembrete na véspera.', 'https://mimo.com.vc/imagens/cliente-1400.webp', 'WebPage') on conflict (route) do nothing;
insert into public.seo_pages (route, page_type, title, slug, seo_title, meta_description, og_title, og_description, og_image_url, schema_type) values ('/sistema-de-comissao-para-salao', 'SEO_LANDING', 'O que é de quem, no fechamento de cada dia.', 'sistema-de-comissao-para-salao', 'Sistema de Comissão para Salão de Beleza | MIMO', 'Sistema de comissão para salão: regra de repasse por profissional, comanda que separa o que é de quem, desconto rateado e relatório por período. Sem planilha no fim do mês.', 'Sistema de Comissão para Salão de Beleza | MIMO', 'Sistema de comissão para salão: regra de repasse por profissional, comanda que separa o que é de quem, desconto rateado e relatório por período. Sem planilha no fim do mês.', 'https://mimo.com.vc/imagens/painel-1400.webp', 'WebPage') on conflict (route) do nothing;
insert into public.seo_pages (route, page_type, title, slug, seo_title, meta_description, og_title, og_description, og_image_url, schema_type) values ('/controle-de-clientes-para-salao', 'SEO_LANDING', 'Quem veio, quem voltou, quem sumiu, quem chegou por quem.', 'controle-de-clientes-para-salao', 'Controle de Clientes para Salão de Beleza | MIMO', 'Controle de clientes para salão de beleza: histórico por serviço e profissional, retorno no prazo, origem de cada cliente, avaliações e chamada pelo WhatsApp. Sem caderno.', 'Controle de Clientes para Salão de Beleza | MIMO', 'Controle de clientes para salão de beleza: histórico por serviço e profissional, retorno no prazo, origem de cada cliente, avaliações e chamada pelo WhatsApp. Sem caderno.', 'https://mimo.com.vc/imagens/cliente-1400.webp', 'WebPage') on conflict (route) do nothing;
insert into public.seo_pages (route, page_type, title, slug, seo_title, meta_description, og_title, og_description, og_image_url, schema_type) values ('/agenda-multi-profissional', 'SEO_LANDING', 'Seis agendas. Uma tela. Zero conflito.', 'agenda-multi-profissional', 'Agenda Multi-profissional para Salão de Beleza | MIMO', 'Agenda multi-profissional para salão: uma coluna por profissional, horário e folga de cada uma, serviços por quem executa, encaixe sem conflito e app próprio para cada profissional.', 'Agenda Multi-profissional para Salão de Beleza | MIMO', 'Agenda multi-profissional para salão: uma coluna por profissional, horário e folga de cada uma, serviços por quem executa, encaixe sem conflito e app próprio para cada profissional.', 'https://mimo.com.vc/imagens/equipe-1400.webp', 'WebPage') on conflict (route) do nothing;
insert into public.seo_pages (route, page_type, title, slug, seo_title, meta_description, og_title, og_description, og_image_url, schema_type) values ('/sinal-para-agendamento', 'SEO_LANDING', 'Sinal por Pix. Horário reservado. Regra clara.', 'sinal-para-agendamento', 'Sinal para Agendamento em Salão de Beleza por Pix | MIMO', 'Sinal para agendamento em salão de beleza: cobrança por Pix na hora de marcar, sinal fixo ou porcentagem, horário reservado só com o pagamento, restante no salão e regra de remarcação clara.', 'Sinal para Agendamento em Salão de Beleza por Pix | MIMO', 'Sinal para agendamento em salão de beleza: cobrança por Pix na hora de marcar, sinal fixo ou porcentagem, horário reservado só com o pagamento, restante no salão e regra de remarcação clara.', 'https://mimo.com.vc/imagens/lifestyle-1400.webp', 'WebPage') on conflict (route) do nothing;
insert into public.seo_pages (route, page_type, title, slug, seo_title, meta_description, og_title, og_description, og_image_url, schema_type) values ('/qr-code-para-salao-de-beleza', 'SEO_LANDING', 'Um QR no balcão. A cliente marca sozinha.', 'qr-code-para-salao-de-beleza', 'QR Code para Salão de Beleza: agendamento pelo balcão | MIMO', 'QR Code para salão de beleza: a cliente escaneia no balcão, espelho ou cartão, entra no ambiente do salão e agenda sozinha. QR por salão e por profissional, com origem registrada.', 'QR Code para Salão de Beleza: agendamento pelo balcão | MIMO', 'QR Code para salão de beleza: a cliente escaneia no balcão, espelho ou cartão, entra no ambiente do salão e agenda sozinha. QR por salão e por profissional, com origem registrada.', 'https://mimo.com.vc/imagens/qr-1400.webp', 'WebPage') on conflict (route) do nothing;

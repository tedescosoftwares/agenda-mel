-- 220_comercial_guia_a_favor.sql
-- 3.74.2 — A cidade e o nome do salão servem ao guia e à venda. A assistente comercial acha a página do salão no
-- guia e usa os números dela a favor: visitas, contatos e pedidos pela Mel nos últimos 30 dias, e quem pediu o
-- salão no app ("quero na MIMO"); quem já está no guia é um lead mais qualificado (já tem exposição). Numa cidade
-- fora do guia ela explica a expansão: a agenda funciona em qualquer cidade; ao entrar na MIMO o salão ganha a
-- página dele no guia; o primeiro da cidade abre o guia dela. Quem já tem agenda com esse nome nessa cidade segue
-- como cliente, e cliente é suporte (219). Os textos novos entram só onde ainda estão iguais à semente da 218.
-- Depois: publicar whatsapp-webhook e comercial (bat 9) e o site (bat 2).

-- 1. comercial_buscar_salao v3: cada lugar achado traz os números da página (30 dias) e os pedidos no app
create or replace function public.comercial_buscar_salao(cidade_ text, nome_ text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  cs text := public.slug_de(left(coalesce(cidade_, ''), 80));
  nome_cidade text;
  pw text[] := public.guia_whats_palavras(coalesce(nome_, ''));
  -- o texto inteiro como slug, para o nome feito só de palavras genéricas ou curtas ("Salão da Rô", "Studio M")
  tx text := public.slug_de(left(coalesce(nome_, ''), 120));
  de timestamptz := now() - interval '30 days';
  lugares jsonb;
  mimo jsonb;
begin
  if cs is null or cs = '' then return jsonb_build_object('cidade_coberta', false, 'lugares', '[]'::jsonb, 'mimo', null); end if;
  -- 1. quem já tem agenda na MIMO com esse nome nessa cidade (219): cliente, em qualquer cidade, mesmo de outro número
  if cardinality(pw) > 0 or length(tx) >= 4 then
    with c as (
      select s.id, s.name, s.city, public.slug_de(s.name) as sl,
             (select count(*) from unnest(public.guia_whats_palavras(s.name)) w where w = any (pw))::int as comuns,
             cardinality(public.guia_whats_palavras(s.name)) as total
        from public.salons s
       where s.active and public.slug_de(coalesce(s.city, '')) = cs
    ),
    p as (
      select *, case when length(sl) >= 4 and ('-' || tx || '-' like '%-' || sl || '-%' or (length(tx) >= 4 and sl like '%' || tx || '%')) then 3 + comuns::numeric / 10
                     when comuns >= 2 or (comuns >= 1 and comuns * 2 >= total) then comuns + comuns::numeric / greatest(total, 1)
                     else 0 end as pontos
        from c
    )
    select jsonb_build_object('id', p.id, 'nome', p.name, 'cidade', p.city) into mimo
      from p where p.pontos > 0 order by p.pontos desc, length(p.name) limit 1;
  end if;
  -- 2. o guia: a cidade é coberta? (fora do guia, nem procura o salão: só a resposta da expansão)
  select min(l.cidade) into nome_cidade from public.guia_lugares l where l.status = 'publicado' and l.cidade_slug = cs;
  if nome_cidade is null then return jsonb_build_object('cidade_coberta', false, 'cidade_slug', cs, 'lugares', '[]'::jsonb, 'mimo', mimo); end if;
  with c as (
    select l.id, l.nome, l.slug, l.bairro, l.cidade_slug, l.salon_id, l.fotos, l.votos,
           (select count(*) from unnest(public.guia_whats_palavras(l.slug)) w where w = any (pw))::int as comuns,
           cardinality(public.guia_whats_palavras(l.slug)) as total
      from public.guia_lugares l
     where l.status = 'publicado' and l.cidade_slug = cs and (cardinality(pw) > 0 or length(tx) >= 4)
  ),
  p as (
    select *, case when length(slug) >= 4 and ('-' || tx || '-' like '%-' || slug || '-%' or (length(tx) >= 4 and slug like '%' || tx || '%')) then 3 + comuns::numeric / 10
                   when comuns >= 2 or (comuns >= 1 and comuns * 2 >= total) then comuns + comuns::numeric / greatest(total, 1)
                   else 0 end as pontos
      from c
  ),
  m as (select * from p where pontos > 0 order by pontos desc, length(nome) limit 3),
  -- os números da página (só dos até 3 achados): visitas e toques de contato em 30 dias, pedidos pela Mel em 30 dias, "quero na MIMO" no app
  n as (
    select m.id,
           coalesce((select count(*) from public.site_eventos e where e.lugar_id = m.id and e.em >= de and e.tipo = 'visita'), 0)::int as visitas,
           coalesce((select count(*) from public.site_eventos e join public.site_eventos_tipos t using (tipo) where e.lugar_id = m.id and e.em >= de and t.grupo = 'contato'), 0)::int as contatos,
           coalesce((select count(*) from public.guia_whats_leads ld where ld.lugar_id = m.id and ld.criado_em >= de), 0)::int as pedidos,
           coalesce(m.votos, 0)::int as quero
      from m
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id, 'nome', m.nome, 'slug', m.slug, 'bairro', m.bairro, 'cidade_slug', m.cidade_slug,
           'link', public.app_base() || '/saloes/' || m.cidade_slug || '/' || m.slug,
           'na_mimo', m.salon_id is not null, 'fotos_n', coalesce(array_length(m.fotos, 1), 0),
           'numeros', jsonb_build_object('visitas', n.visitas, 'contatos', n.contatos, 'pedidos', n.pedidos, 'quero', n.quero)) order by m.pontos desc, length(m.nome)), '[]'::jsonb)
    into lugares from m join n on n.id = m.id;
  -- o melhor do guia já tem agenda: é cliente também (mesmo que o nome na MIMO seja um pouco diferente)
  if mimo is null and jsonb_array_length(lugares) > 0 and (lugares -> 0 ->> 'na_mimo')::boolean then
    select jsonb_build_object('id', s.id, 'nome', s.name, 'cidade', s.city) into mimo
      from public.guia_lugares l join public.salons s on s.id = l.salon_id
     where l.id = (lugares -> 0 ->> 'id')::uuid;
  end if;
  return jsonb_build_object('cidade_coberta', true, 'cidade_slug', cs, 'cidade', nome_cidade, 'lugares', lugares, 'mimo', mimo);
end $$;
revoke execute on function public.comercial_buscar_salao(text, text) from public, anon, authenticated;

-- 2. os textos: a cidade fora do guia explica a expansão; o "achei" usa os números ({numeros}: a frase com os acessos da
--    página, vazia quando não há o que dizer); o conhecimento e a FAQ ganham o guia em expansão. Só onde ainda é a semente.
alter table public.comercial_config alter column msg_cidade_fora set default 'O guia da MIMO ainda não chegou em {cidade}: estamos em expansão pelo Brasil, cidade a cidade, e é questão de tempo. Isso não muda nada para a agenda, que funciona em qualquer cidade. E quando você entra na MIMO, o seu salão ganha a página dele no guia; se for o primeiro de {cidade}, a gente monta o guia da cidade para incluir você. 💗';
alter table public.comercial_config alter column msg_achei_no_guia set default E'Achei o {salao} no nosso guia: {link} 💗 A página já está no ar, de graça.\n\n{numeros}\n\nCom a MIMO Agenda, quem chega pela página marca o horário direto com você, sem precisar chamar no WhatsApp. Quer colocar fotos ou corrigir alguma coisa na página? Me passa um e-mail seu que eu mando o pedido para a equipe.';
update public.comercial_config set msg_cidade_fora = 'O guia da MIMO ainda não chegou em {cidade}: estamos em expansão pelo Brasil, cidade a cidade, e é questão de tempo. Isso não muda nada para a agenda, que funciona em qualquer cidade. E quando você entra na MIMO, o seu salão ganha a página dele no guia; se for o primeiro de {cidade}, a gente monta o guia da cidade para incluir você. 💗' where msg_cidade_fora = 'O guia da MIMO ainda não chegou em {cidade}, mas a agenda funciona em qualquer cidade. Anotei o seu interesse para a equipe avisar quando o guia abrir aí.';
update public.comercial_config set msg_achei_no_guia = E'Achei o {salao} no nosso guia: {link} 💗 A página já está no ar, de graça.\n\n{numeros}\n\nCom a MIMO Agenda, quem chega pela página marca o horário direto com você, sem precisar chamar no WhatsApp. Quer colocar fotos ou corrigir alguma coisa na página? Me passa um e-mail seu que eu mando o pedido para a equipe.' where msg_achei_no_guia = 'Achei o {salao} no nosso guia: {link} 💗 A página já está no ar, de graça. Quer colocar fotos ou corrigir alguma coisa? Me passa um e-mail seu que eu mando o pedido para a equipe.';
update public.comercial_config set conhecimento = conhecimento || E'\n\n' || 'O guia está em expansão pelo Brasil, cidade a cidade. Se a cidade do salão ainda não está no guia, isso não impede nada na agenda: ela funciona em qualquer cidade. Ao entrar na MIMO, o salão ganha a página dele no guia (com o botão de agendar) e, se for o primeiro da cidade, a MIMO monta o guia daquela cidade para incluir. Quem já está no guia tem a página e os acessos dela a favor: com a agenda, quem chega pela página marca direto, em vez de passar pela Mel.' where conhecimento = $c$A MIMO Agenda organiza os agendamentos do salão num lugar só. O salão ganha um link próprio (nome.mimo.com.vc) e um QR Code para o balcão: a cliente abre, escolhe o serviço e a profissional e marca sozinha, pelo site ou pelo app MIMO (Android). Lembretes automáticos para as clientes, pelo app e também pelo WhatsApp quando o salão conecta o WhatsApp dele; reagendamento e lista de espera (quando alguém cancela, a MIMO aponta quem está esperando); lista de retorno (a cliente que não volta há tempo aparece para o salão chamar). Equipe com permissões: cada profissional vê a própria agenda; serviços e horários por profissional; comanda, caixa, comissões e relatórios. Sinal por Pix para segurar o horário. Promoções e novidades para as clientes que seguem o salão no app.

O guia de salões da MIMO (mimo.com.vc/saloes) é grátis: cada salão das cidades atendidas tem uma página com endereço, serviços, horários e fotos; quem usa a MIMO Agenda ganha o selo "Agenda pela MIMO" e o botão de agendar direto na página e no app. A Mel, atendente das clientes, anota pedidos de horário para os salões do guia que ainda não têm agenda.

Como se paga: 7 dias grátis para testar, sem cartão; o prazo só começa a contar quando a agenda está configurada (serviços e equipe). Depois, mensalidade paga por Pix pelo painel, no modelo pré-pago; sem contrato de fidelidade, cancela quando quiser. O painel funciona no celular e no computador, pelo navegador; as clientes usam o app MIMO ou o site.$c$;
alter table public.comercial_config alter column conhecimento set default $c$A MIMO Agenda organiza os agendamentos do salão num lugar só. O salão ganha um link próprio (nome.mimo.com.vc) e um QR Code para o balcão: a cliente abre, escolhe o serviço e a profissional e marca sozinha, pelo site ou pelo app MIMO (Android). Lembretes automáticos para as clientes, pelo app e também pelo WhatsApp quando o salão conecta o WhatsApp dele; reagendamento e lista de espera (quando alguém cancela, a MIMO aponta quem está esperando); lista de retorno (a cliente que não volta há tempo aparece para o salão chamar). Equipe com permissões: cada profissional vê a própria agenda; serviços e horários por profissional; comanda, caixa, comissões e relatórios. Sinal por Pix para segurar o horário. Promoções e novidades para as clientes que seguem o salão no app.

O guia de salões da MIMO (mimo.com.vc/saloes) é grátis: cada salão das cidades atendidas tem uma página com endereço, serviços, horários e fotos; quem usa a MIMO Agenda ganha o selo "Agenda pela MIMO" e o botão de agendar direto na página e no app. A Mel, atendente das clientes, anota pedidos de horário para os salões do guia que ainda não têm agenda.

Como se paga: 7 dias grátis para testar, sem cartão; o prazo só começa a contar quando a agenda está configurada (serviços e equipe). Depois, mensalidade paga por Pix pelo painel, no modelo pré-pago; sem contrato de fidelidade, cancela quando quiser. O painel funciona no celular e no computador, pelo navegador; as clientes usam o app MIMO ou o site.

O guia está em expansão pelo Brasil, cidade a cidade. Se a cidade do salão ainda não está no guia, isso não impede nada na agenda: ela funciona em qualquer cidade. Ao entrar na MIMO, o salão ganha a página dele no guia (com o botão de agendar) e, se for o primeiro da cidade, a MIMO monta o guia daquela cidade para incluir. Quem já está no guia tem a página e os acessos dela a favor: com a agenda, quem chega pela página marca direto, em vez de passar pela Mel.$c$;
update public.comercial_config set faq = faq || E'\n' || E'Minha cidade não está no guia. Posso usar a agenda? Pode: a agenda funciona em qualquer cidade. O guia está em expansão e chega aí; ao entrar na MIMO, o seu salão ganha a página dele no guia, e se for o primeiro da cidade a gente monta o guia da cidade.\nMeu salão já está no guia. O que muda com a agenda? A página ganha o botão de agendar: quem te acha no guia marca direto com você, em vez de pedir pela Mel; e os acessos da página viram horários.' where faq = $f$Quanto custa? A tabela de planos, pelo número de agendas. Sem taxa de adesão.
Tem teste grátis? 7 dias, sem cartão. O relógio só começa quando a agenda está montada.
Como as minhas clientes marcam? Pelo seu link, pelo QR Code do balcão ou pelo app MIMO. Quem marca pelo WhatsApp continua marcando: você lança na agenda em segundos.
Preciso de computador? Não. O painel abre no navegador do celular.
E as profissionais da minha equipe? Cada uma tem a sua agenda e o seu acesso; você define o que cada uma vê. Comissões e repasses saem na comanda.
Já uso outro sistema ou agenda de papel. Dá para testar lado a lado nos 7 dias. O cadastro de serviços é rápido e a equipe ajuda a montar.
Meus dados e os das minhas clientes? São do salão. A MIMO não vende nem repassa dados.
Sou autônoma. O plano Autônoma é grátis: uma agenda, link próprio, lembretes e o app para as suas clientes.
O guia é pago? Não. A página do salão no guia é grátis, com fotos. Com a agenda, ela ganha o botão de agendar.
Como eu começo? Eu aviso a equipe agora e alguém monta a conta com você.$f$;
alter table public.comercial_config alter column faq set default $f$Quanto custa? A tabela de planos, pelo número de agendas. Sem taxa de adesão.
Tem teste grátis? 7 dias, sem cartão. O relógio só começa quando a agenda está montada.
Como as minhas clientes marcam? Pelo seu link, pelo QR Code do balcão ou pelo app MIMO. Quem marca pelo WhatsApp continua marcando: você lança na agenda em segundos.
Preciso de computador? Não. O painel abre no navegador do celular.
E as profissionais da minha equipe? Cada uma tem a sua agenda e o seu acesso; você define o que cada uma vê. Comissões e repasses saem na comanda.
Já uso outro sistema ou agenda de papel. Dá para testar lado a lado nos 7 dias. O cadastro de serviços é rápido e a equipe ajuda a montar.
Meus dados e os das minhas clientes? São do salão. A MIMO não vende nem repassa dados.
Sou autônoma. O plano Autônoma é grátis: uma agenda, link próprio, lembretes e o app para as suas clientes.
O guia é pago? Não. A página do salão no guia é grátis, com fotos. Com a agenda, ela ganha o botão de agendar.
Como eu começo? Eu aviso a equipe agora e alguém monta a conta com você.
Minha cidade não está no guia. Posso usar a agenda? Pode: a agenda funciona em qualquer cidade. O guia está em expansão e chega aí; ao entrar na MIMO, o seu salão ganha a página dele no guia, e se for o primeiro da cidade a gente monta o guia da cidade.
Meu salão já está no guia. O que muda com a agenda? A página ganha o botão de agendar: quem te acha no guia marca direto com você, em vez de pedir pela Mel; e os acessos da página viram horários.$f$;

do $$ begin raise notice '220: a assistente comercial usa o guia a favor da venda (números da página, expansão, lead do guia)'; end $$;

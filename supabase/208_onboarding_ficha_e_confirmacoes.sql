-- 208: o onboarding pelo WhatsApp com a ficha da empresa, correções e confirmações (3.61)
-- Do uso do agente de onboarding (203/204): (1) depois do CNPJ ele mostra a FICHA da empresa (nome fantasia, razão
-- social, CNPJ e o endereço formatado) e pede confirmação; se algo estiver errado, pergunta o quê e corrige campo a
-- campo. (2) O endereço se corrige pelo CEP; quem não sabe o CEP manda o nome da rua e o sistema procura (ViaCEP) e
-- devolve alternativas; depois pede o número e o complemento, e confirma o endereço de volta. (3) Autônoma não passa por
-- "quantas profissionais". (4) Nome, profissionais, serviços (com exemplos dos mais escolhidos) e horários passam a ser
-- perguntas do sistema, cada uma confirmada de volta, lembrando que tudo se ajusta no painel. (5) A qualquer momento ela
-- pode pedir *ajuda*: a equipe é avisada e um humano assume. (6) No fim: o resumo, "um minutinho que estou criando o seu
-- cadastro…" (a espera é configurável), o link ("cadastro criado, acesse e crie a sua senha") e o convite ao suporte.
-- Idempotente; só muda textos que ainda estão iguais à semente.

alter table public.guia_onboarding_config add column if not exists criar_espera_seg integer not null default 20 check (criar_espera_seg between 0 and 90);
alter table public.guia_onboarding_config add column if not exists servicos_exemplos text not null default 'corte, escova, coloração, manicure, pedicure, unhas em gel, design de sobrancelhas, depilação, limpeza de pele, extensão de cílios, maquiagem' check (length(servicos_exemplos) between 5 and 600);
-- a ficha da empresa e as correções
alter table public.guia_onboarding_config add column if not exists msg_empresa_confirmar text not null default E'Achei na Receita! 📋 Confere os dados da sua empresa:\n\n{ficha}\n\nEstá tudo certo? Responde *sim* que eu sigo, ou me diz o que está errado: *nome fantasia*, *razão social*, *CNPJ* ou *endereço*.' check (length(msg_empresa_confirmar) between 10 and 2000 and msg_empresa_confirmar like '%{ficha}%');
alter table public.guia_onboarding_config add column if not exists msg_empresa_qual text not null default 'Sem problema! O que está errado? Responde *nome fantasia*, *razão social*, *CNPJ* ou *endereço* que eu corrijo com você.' check (length(msg_empresa_qual) between 10 and 2000);
alter table public.guia_onboarding_config add column if not exists msg_empresa_cnpj text not null default 'Então me manda o CNPJ certo (só os números) que eu consulto de novo.' check (length(msg_empresa_cnpj) between 10 and 2000);
alter table public.guia_onboarding_config add column if not exists msg_empresa_nome text not null default 'Qual é o nome fantasia certo?' check (length(msg_empresa_nome) between 10 and 2000);
alter table public.guia_onboarding_config add column if not exists msg_empresa_razao text not null default 'Qual é a razão social certa, como está no cartão CNPJ?' check (length(msg_empresa_razao) between 10 and 2000);
-- o endereço: a rua pelo nome, o complemento e a confirmação
alter table public.guia_onboarding_config add column if not exists msg_rua text not null default 'Sem problema! Me manda o nome da rua e a cidade (ex.: Rua das Flores, Itanhaém) que eu procuro o CEP para você.' check (length(msg_rua) between 10 and 2000);
alter table public.guia_onboarding_config add column if not exists msg_rua_opcoes text not null default E'Achei mais de uma 📍 Qual é a sua? Responde com o número:\n\n{opcoes}\n\nSe nenhuma for, responde *nenhuma* e me manda o endereço escrito.' check (length(msg_rua_opcoes) between 10 and 2000 and msg_rua_opcoes like '%{opcoes}%');
alter table public.guia_onboarding_config add column if not exists msg_rua_nao_achei text not null default 'Não achei essa rua em {cidade} 😕 Confere o nome e me manda de novo? Se for outra cidade, manda junto (ex.: Rua das Flores, Peruíbe). Ou me manda o endereço completo escrito (rua, número, bairro e cidade).' check (length(msg_rua_nao_achei) between 10 and 2000);
alter table public.guia_onboarding_config add column if not exists msg_complemento text not null default 'Tem complemento (sala, loja, fundos, apartamento)? Me manda, ou responde *não*.' check (length(msg_complemento) between 10 and 2000);
alter table public.guia_onboarding_config add column if not exists msg_endereco_ok text not null default E'Ficou assim: 📍 {endereco}\n\nEstá certo? Responde *sim* ou me manda o CEP de novo.' check (length(msg_endereco_ok) between 10 and 2000 and msg_endereco_ok like '%{endereco}%');
-- as perguntas do sistema (nome, profissionais, serviços, horários) e a confirmação de cada dado
alter table public.guia_onboarding_config add column if not exists msg_nome text not null default 'Qual é o nome do negócio, do jeito que as clientes conhecem? É ele que vai no seu link (nome.mimo.com.vc).' check (length(msg_nome) between 10 and 2000);
alter table public.guia_onboarding_config add column if not exists msg_nome_confirmar text not null default 'Para as clientes, o nome do negócio fica *{nome}*? Responde *sim* ou me manda o nome certo.' check (length(msg_nome_confirmar) between 10 and 2000 and msg_nome_confirmar like '%{nome}%');
alter table public.guia_onboarding_config add column if not exists msg_profissionais text not null default 'Quantas profissionais atendem aí, contando você? (Só o número; dá para mudar depois no painel.)' check (length(msg_profissionais) between 10 and 2000);
alter table public.guia_onboarding_config add column if not exists msg_servicos text not null default E'Quais são os 3 a 5 serviços principais que você oferece? Os mais escolhidos por aqui: {exemplos}.\n\nA lista completa, com preço e duração, você ajusta depois no painel — assim como horários, fotos e o resto.' check (length(msg_servicos) between 10 and 2000);
alter table public.guia_onboarding_config add column if not exists msg_horarios text not null default 'Quais são os dias e horários de atendimento? (ex.: segunda a sexta 9h às 19h, sábado 9h às 14h). Depois dá para ajustar no painel.' check (length(msg_horarios) between 10 and 2000);
alter table public.guia_onboarding_config add column if not exists msg_dado_confirmar text not null default 'Anotei {rotulo}: *{valor}*. Está certo? Responde *sim* ou me manda o certo.' check (length(msg_dado_confirmar) between 10 and 2000 and msg_dado_confirmar like '%{valor}%');
-- a ajuda humana, o "criando…" e o fim
alter table public.guia_onboarding_config add column if not exists msg_ajuda_dica text not null default 'Ah, e se a qualquer momento você quiser falar com uma pessoa da equipe, é só escrever *ajuda* 💗' check (length(msg_ajuda_dica) between 10 and 2000);
alter table public.guia_onboarding_config add column if not exists msg_ajuda text not null default E'Claro! Já avisei a equipe da MIMO: alguém vai te chamar por aqui 💗\nSe preferir chamar direto: {atendimento}\n\nEnquanto isso, se quiser, a gente continua o cadastro.' check (length(msg_ajuda) between 10 and 2000);
alter table public.guia_onboarding_config add column if not exists msg_criando text not null default 'Perfeito! 💗 Me dá um minutinho que eu estou criando o seu cadastro… ⏳' check (length(msg_criando) between 10 and 2000);
alter table public.guia_onboarding_config add column if not exists msg_final text not null default E'Ficou alguma dúvida? 💗\n\nTemos um suporte para te ajudar a começar a configurar a sua agenda — serviços, horários, fotos, tudo. É só chamar aqui que a gente te acompanha. Estamos à disposição!' check (length(msg_final) between 10 and 2000);

-- os textos que mudaram de sentido: só onde ainda está igual à semente
do $$
declare
  trocas text[][] := array[
    ['msg_link', E'Prontinho! 💗 O cadastro de *{nome}* está anotado. Agora é só criar sua senha e aceitar os termos neste link seguro (vale {dias} dias):\n{link}\n\nQualquer dúvida, me chama por aqui.', E'Cadastro criado! 🎉 Agora é só acessar o link e criar a sua senha (vale {dias} dias):\n{link}\n\nDepois de entrar, você já configura serviços, horários e fotos no painel.'],
    ['msg_resumo', E'Antes do link, confere se está tudo certo:\n\n{resumo}\n\nResponde *sim* que eu mando o link, ou me diz o que quer corrigir.', E'Pronto, anotei tudo! 💗 Confere se está certo:\n\n{resumo}\n\nEstá tudo certo? Responde *sim* ou me diz o que corrigir.'],
    ['passo_endereco', 'Se o sistema trouxe o endereço do CNPJ, ele mesmo mostra e pede confirmação; se ela disser que atende em outro endereço, anote o novo. Sem CNPJ, pergunte o endereço onde ela atende (rua, número, bairro e cidade); se atende em domicílio, basta bairro e cidade.', 'O sistema mostra a ficha do CNPJ (nome fantasia, razão social, CNPJ e endereço) para ela confirmar ou corrigir; sem CNPJ, pede o CEP (ou procura a rua pelo nome) e depois o número e o complemento, e confirma o endereço de volta. Se ela escrever o endereço inteiro em texto, anote em "endereco"; se atende em domicílio, basta bairro e cidade.'],
    ['passo_nome', 'Pergunte o nome do negócio como as clientes conhecem (o nome fantasia). Se o CNPJ trouxe um nome, sugira e pergunte se é esse mesmo o nome para as clientes.', 'O sistema pergunta o nome do negócio (ou confirma o nome fantasia do CNPJ) e confirma de volta. Se ela perguntar, explique que é o nome que as clientes conhecem e que vai no link dela (nome.mimo.com.vc).'],
    ['passo_profissionais', 'Pergunte quantas profissionais atendem no espaço, contando ela. Autônoma é 1.', 'O sistema pergunta quantas profissionais atendem, contando ela, e confirma de volta. Só para salão: autônoma é 1 e nem passa por aqui. Se ela perguntar, diga que dá para mudar no painel.'],
    ['passo_servicos', 'Pergunte os 3 a 5 serviços principais que ela oferece (só os nomes). Explique, curto, que a lista completa — com preço e duração — ela cadastra no painel depois de entrar, em "Serviços", e que é rápido.', 'O sistema pergunta os 3 a 5 serviços principais, com exemplos dos mais escolhidos, e confirma de volta. Se ela perguntar algo, explique curto que a lista completa — com preço e duração — ela ajusta no painel depois de entrar, assim como horários, fotos e o resto.'],
    ['passo_horarios', 'Pergunte os dias e horários de atendimento (ex.: segunda a sexta 9h às 19h, sábado 9h às 14h).', 'O sistema pergunta os dias e horários de atendimento e confirma de volta. Se ela perguntar, diga que dá para ajustar no painel depois.']
  ];
  t text[];
begin
  foreach t slice 1 in array trocas loop
    execute format('alter table public.guia_onboarding_config alter column %I set default %L', t[1], t[3]);
    execute format('update public.guia_onboarding_config set %I = %L where id = 1 and %I = %L', t[1], t[3], t[1], t[2]);
  end loop;
end $$;

create or replace function public.guia_onboarding_config_salvar(c jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  gat text[];
  atend text;
  k text;
  -- os textos livres: cada um vai para a coluna de mesmo nome (vazio = não mexe)
  textos text[] := array['orientacao', 'servicos_exemplos',
    'passo_tipo', 'passo_documento', 'passo_endereco', 'passo_nome', 'passo_profissionais', 'passo_servicos', 'passo_horarios', 'passo_email', 'passo_telefone', 'passo_explicacoes', 'passo_resumo',
    'msg_confirmar', 'msg_boas_vindas', 'msg_nao_sou', 'msg_cnpj_invalido', 'msg_cpf_invalido', 'msg_email_invalido', 'msg_endereco_confirmar', 'msg_link', 'msg_encerrar',
    'msg_numero_em_uso', 'msg_nome_em_uso', 'msg_email_em_uso', 'msg_documento_em_uso', 'msg_email_confirmar', 'msg_cep', 'msg_cep_invalido', 'msg_cep_numero',
    'msg_telefone', 'msg_telefone_extra', 'msg_telefone_invalido', 'msg_resumo',
    'msg_empresa_confirmar', 'msg_empresa_qual', 'msg_empresa_cnpj', 'msg_empresa_nome', 'msg_empresa_razao',
    'msg_rua', 'msg_rua_opcoes', 'msg_rua_nao_achei', 'msg_complemento', 'msg_endereco_ok',
    'msg_nome', 'msg_nome_confirmar', 'msg_profissionais', 'msg_servicos', 'msg_horarios', 'msg_dado_confirmar',
    'msg_ajuda_dica', 'msg_ajuda', 'msg_criando', 'msg_final'];
  simnao text[] := array['ligado', 'bolhas', 'com_servicos', 'com_horarios', 'com_email', 'com_telefone', 'com_explicacoes', 'com_resumo'];
  inteiros text[] := array['tolerancia', 'tolerancia_cnpj', 'link_dias', 'pausa_seg', 'criar_espera_seg'];
begin
  if not public.eh_plataforma() then raise exception 'só a plataforma configura o onboarding'; end if;
  if c ? 'gatilhos' then
    select array_agg(g order by o) into gat from (
      select min(o) as o, g from (
        select o, nullif(btrim(regexp_replace(regexp_replace(lower(translate(x, 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')), '[^a-z0-9 ]+', ' ', 'g'), ' +', ' ', 'g')), '') as g
          from jsonb_array_elements_text(c -> 'gatilhos') with ordinality as e(x, o)) t
       where g is not null and length(g) between 4 and 80 group by g) u;
    if gat is null or cardinality(gat) = 0 then raise exception 'informe pelo menos um gatilho (a frase do botão)'; end if;
  end if;
  if c ? 'numero_atendimento' then
    atend := nullif(regexp_replace(coalesce(c ->> 'numero_atendimento', ''), '\D', '', 'g'), '');
    if atend is not null and length(atend) in (10, 11) then atend := '55' || atend; end if;
    if atend is not null and atend !~ '^[1-9][0-9]{9,14}$' then raise exception 'número de atendimento inválido: use DDD e número (com 55 na frente, se quiser)'; end if;
  end if;
  begin
    update public.guia_onboarding_config g set
      provedor = coalesce(nullif(c ->> 'provedor', ''), g.provedor),
      modelo = case when c ? 'modelo' then nullif(btrim(c ->> 'modelo'), '') else g.modelo end,
      gatilhos = coalesce(gat, g.gatilhos),
      numero_atendimento = case when c ? 'numero_atendimento' then atend else g.numero_atendimento end,
      atualizado_em = now(), atualizado_por = auth.uid()
     where g.id = 1;
    foreach k in array simnao loop
      if c ? k then execute format('update public.guia_onboarding_config set %I = coalesce(($1 ->> %L)::boolean, %I) where id = 1', k, k, k) using c; end if;
    end loop;
    foreach k in array inteiros loop
      if c ? k then execute format('update public.guia_onboarding_config set %I = coalesce(($1 ->> %L)::integer, %I) where id = 1', k, k, k) using c; end if;
    end loop;
    foreach k in array textos loop
      if c ? k and nullif(btrim(c ->> k), '') is not null then execute format('update public.guia_onboarding_config set %I = $1 where id = 1', k) using btrim(c ->> k); end if;
    end loop;
  exception
    when check_violation then
      raise exception '%', case
        when sqlerrm ~ 'provedor' then 'IA: groq ou claude'
        when sqlerrm ~ 'modelo' then 'modelo inválido'
        when sqlerrm ~ 'gatilhos' then 'gatilhos: de 1 a 40 frases'
        when sqlerrm ~ 'numero_atendimento' then 'número de atendimento inválido: use DDD e número'
        when sqlerrm ~ 'tolerancia_cnpj' then 'tolerância do CNPJ: de 1 a 20 tentativas'
        when sqlerrm ~ 'tolerancia' then 'tolerância: de 1 a 20 respostas inválidas'
        when sqlerrm ~ 'link_dias' then 'validade do link: de 1 a 60 dias'
        when sqlerrm ~ 'pausa_seg' then 'pausa entre as mensagens: de 0 a 30 segundos'
        when sqlerrm ~ 'criar_espera_seg' then 'a espera do "criando o cadastro": de 0 a 90 segundos'
        when sqlerrm ~ 'servicos_exemplos' then 'os exemplos de serviços: de 5 a 600 letras'
        when sqlerrm ~ 'orientacao' then 'a orientação do agente: de 20 a 8000 letras'
        when sqlerrm ~ 'msg_link' then 'a mensagem do link precisa ter {link} e de 10 a 2000 letras'
        when sqlerrm ~ 'msg_resumo' then 'a mensagem do resumo precisa ter {resumo} e de 10 a 2000 letras'
        when sqlerrm ~ 'msg_empresa_confirmar' then 'a mensagem da ficha precisa ter {ficha} e de 10 a 2000 letras'
        when sqlerrm ~ 'msg_rua_opcoes' then 'a mensagem das ruas precisa ter {opcoes} e de 10 a 2000 letras'
        when sqlerrm ~ 'msg_endereco_ok' then 'a confirmação do endereço precisa ter {endereco} e de 10 a 2000 letras'
        when sqlerrm ~ 'msg_nome_confirmar' then 'a confirmação do nome precisa ter {nome} e de 10 a 2000 letras'
        when sqlerrm ~ 'msg_dado_confirmar' then 'a confirmação de um dado precisa ter {valor} e de 10 a 2000 letras'
        when sqlerrm ~ 'passo_' then 'o texto de um passo: de 5 a 2000 letras'
        when sqlerrm ~ 'msg_' then 'mensagem curta ou longa demais (10 a 2000 letras)'
        else sqlerrm end;
    when invalid_text_representation then raise exception 'valor inválido num campo de número ou sim/não';
  end;
  if (select o.ligado and not (w.ligado and w.numero is not null) from public.guia_onboarding_config o, public.guia_whats_config w where o.id = 1 and w.id = 1) then
    update public.guia_onboarding_config set ligado = false where id = 1;
    raise exception 'para ligar o onboarding, o WhatsApp do guia (a Mel) precisa estar ligado e com número';
  end if;
  return (select to_jsonb(g) from public.guia_onboarding_config g where g.id = 1);
end $$;

insert into public.migracoes_aplicadas (arquivo) values ('208_onboarding_ficha_e_confirmacoes.sql') on conflict (arquivo) do nothing;

do $$ begin
  raise notice '208: o onboarding com a ficha da empresa, correções por campo, a rua pelo nome, complemento, confirmações, ajuda humana, "criando…" e o suporte no fim';
end $$;

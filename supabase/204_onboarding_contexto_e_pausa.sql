-- 204 (3.56): o agente de onboarding com contexto, CEP, pausa e confirmações.
-- O que entrou depois da 203 (3.55), do feedback de uso:
--   • CONTEXTO antes de aceitar cada dado (guia_onboarding_conferir, para as Edge Functions): o número que está escrevendo
--     já é de uma conta/salão? (→ manda para o número de atendimento, numero_atendimento, setável na aba); o nome do salão
--     já existe? (o endereço nome.mimo.com.vc precisa ser único); o e-mail, o CPF ou o CNPJ já estão cadastrados?
--   • ENDEREÇO PELO CEP (sem CNPJ, ou quando o endereço do CNPJ não é o de atendimento): pede o CEP, puxa rua/bairro/cidade
--     (BrasilAPI) e só pergunta o número. Mensagens msg_cep, msg_cep_invalido, msg_cep_numero.
--   • PAUSA entre as mensagens (pausa_seg) e cada parágrafo numa bolha (bolhas): a conversa respira, como gente.
--   • CONFIRMAÇÕES: o e-mail de volta (msg_email_confirmar); o WhatsApp do salão — o de onde ela fala, ou outro, com a
--     orientação de que precisa ser o do salão por causa da integração com o bot — e um telefone extra (passo telefone);
--     e o RESUMO de tudo para ela conferir antes do link (passo resumo).
-- Idempotente; só acrescenta colunas e recria guia_onboarding_config_salvar.

alter table public.guia_onboarding_config add column if not exists numero_atendimento text check (numero_atendimento is null or numero_atendimento ~ '^[1-9][0-9]{9,14}$');
alter table public.guia_onboarding_config add column if not exists pausa_seg integer not null default 2 check (pausa_seg between 0 and 30);
alter table public.guia_onboarding_config add column if not exists bolhas boolean not null default true;
alter table public.guia_onboarding_config add column if not exists com_telefone boolean not null default true;
alter table public.guia_onboarding_config add column if not exists com_resumo boolean not null default true;
alter table public.guia_onboarding_config add column if not exists passo_telefone text not null default 'O sistema pergunta se o WhatsApp do salão é o número de onde ela está falando ou outro, e se ela quer cadastrar mais um telefone. Se ela tiver dúvida, explique curto: precisa ser o WhatsApp do salão (o que as clientes usam) porque a MIMO se conecta a ele para mandar confirmações e lembretes automáticos.' check (length(passo_telefone) between 5 and 2000);
alter table public.guia_onboarding_config add column if not exists passo_resumo text not null default 'Ela está conferindo o resumo do cadastro. Se disser que algo está errado, anote o campo corrigido (nome, endereço, profissionais, serviços, horários, e-mail, telefone); se confirmar que está tudo certo, passo_concluido = true.' check (length(passo_resumo) between 5 and 2000);
alter table public.guia_onboarding_config add column if not exists msg_numero_em_uso text not null default 'Esse número já está cadastrado na MIMO{salao} 💗 Para entrar na sua conta ou recuperar o acesso, fale com o atendimento: {atendimento}' check (length(msg_numero_em_uso) between 10 and 2000);
alter table public.guia_onboarding_config add column if not exists msg_nome_em_uso text not null default 'Já existe um salão chamado *{nome}* na MIMO{cidade}, e o endereço nome.mimo.com.vc precisa ser único. Quer usar outro nome, ou acrescentar o bairro ou a cidade (tipo "{nome} Centro")?' check (length(msg_nome_em_uso) between 10 and 2000);
alter table public.guia_onboarding_config add column if not exists msg_email_em_uso text not null default 'O e-mail {email} já tem conta na MIMO. Se é o seu, você já tem conta — fale com o atendimento: {atendimento}. Se quiser usar outro e-mail, é só me mandar.' check (length(msg_email_em_uso) between 10 and 2000);
alter table public.guia_onboarding_config add column if not exists msg_documento_em_uso text not null default 'Esse {documento} já está cadastrado na MIMO — então você já tem conta! 💗 Para entrar ou recuperar o acesso, fale com o atendimento: {atendimento}' check (length(msg_documento_em_uso) between 10 and 2000);
alter table public.guia_onboarding_config add column if not exists msg_email_confirmar text not null default 'Anotei *{email}* — está certinho? Responde *sim* ou me manda o e-mail certo.' check (length(msg_email_confirmar) between 10 and 2000);
alter table public.guia_onboarding_config add column if not exists msg_cep text not null default 'Me manda o CEP de onde você atende (só os números) que eu puxo o endereço. Se não souber o CEP, responde *não sei* que a gente escreve o endereço.' check (length(msg_cep) between 10 and 2000);
alter table public.guia_onboarding_config add column if not exists msg_cep_invalido text not null default 'Não achei esse CEP: {motivo}. Confere os 8 números e me manda de novo? Se não souber, responde *não sei*.' check (length(msg_cep_invalido) between 10 and 2000);
alter table public.guia_onboarding_config add column if not exists msg_cep_numero text not null default E'Achei! 📍 {endereco}\n\nQual é o número (e o complemento, se tiver)?' check (length(msg_cep_numero) between 10 and 2000);
alter table public.guia_onboarding_config add column if not exists msg_telefone text not null default 'O WhatsApp do salão vai ser este número de onde você está falando, {numero}? Ele precisa ser o WhatsApp do salão — o que as clientes usam —, porque a MIMO se conecta a ele para mandar as confirmações e os lembretes automáticos. Responde *sim* ou me manda o número certo, com DDD.' check (length(msg_telefone) between 10 and 2000);
alter table public.guia_onboarding_config add column if not exists msg_telefone_extra text not null default 'Quer cadastrar mais algum telefone (fixo ou outro WhatsApp)? Me manda o número com DDD, ou responde *não*.' check (length(msg_telefone_extra) between 10 and 2000);
alter table public.guia_onboarding_config add column if not exists msg_telefone_invalido text not null default 'Esse número não parece certo 😅 Me manda com DDD, tipo (13) 99999-0000.' check (length(msg_telefone_invalido) between 10 and 2000);
alter table public.guia_onboarding_config add column if not exists msg_resumo text not null default E'Antes do link, confere se está tudo certo:\n\n{resumo}\n\nResponde *sim* que eu mando o link, ou me diz o que quer corrigir.' check (length(msg_resumo) between 10 and 2000 and msg_resumo like '%{resumo}%');

-- ---- o contexto: o que já existe na MIMO (Edge Functions) --------------------------------------------------------------
-- Cada argumento é opcional; só o que veio é conferido. Telefones comparam pela chave da Mel (guia_whats_chave: celular
-- com e sem o 9º dígito batem); nomes pelo slug (slug_de: "Studio X" = "studio-x" = o subdomínio); documentos pelos dígitos.
create or replace function public.guia_onboarding_conferir(tel_ text default null, email_ text default null, documento_ text default null, nome_ text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  r jsonb := '{}'::jsonb;
  k text;
  d text;
  s record;
begin
  if tel_ is not null then
    k := public.guia_whats_chave(tel_);
    select sa.name, sa.city into s from public.salons sa
     where k is not null and (public.guia_whats_chave(sa.phone) = k or public.guia_whats_chave(sa.whatsapp) = k or sa.owner_id in (select p.id from public.profiles p where public.guia_whats_chave(p.phone) = k))
     limit 1;
    r := r || jsonb_build_object('numero', jsonb_build_object(
      'em_uso', k is not null and (s.name is not null or exists (select 1 from public.profiles p where public.guia_whats_chave(p.phone) = k)),
      'salao', s.name, 'cidade', s.city));
  end if;
  if email_ is not null then
    r := r || jsonb_build_object('email', jsonb_build_object('em_uso',
      exists (select 1 from auth.users u where lower(u.email) = lower(btrim(email_)))
      or exists (select 1 from public.salons sa where lower(sa.email) = lower(btrim(email_)))));
  end if;
  if documento_ is not null then
    d := regexp_replace(documento_, '\D', '', 'g');
    s := null;
    if length(d) = 14 then
      select sa.name, sa.city into s from public.salons sa where regexp_replace(coalesce(sa.cnpj, ''), '\D', '', 'g') = d limit 1;
    elsif length(d) = 11 then
      select sa.name, sa.city into s from public.salons sa where regexp_replace(coalesce(sa.responsavel_cpf, ''), '\D', '', 'g') = d limit 1;
    end if;
    r := r || jsonb_build_object('documento', jsonb_build_object('em_uso', s.name is not null, 'tipo', case when length(d) = 14 then 'cnpj' when length(d) = 11 then 'cpf' else null end, 'salao', s.name));
  end if;
  if nome_ is not null then
    s := null;
    select sa.name, sa.city into s from public.salons sa
     where length(public.slug_de(nome_)) >= 2 and (public.slug_de(sa.name) = public.slug_de(nome_) or sa.subdominio = public.slug_de(nome_) or sa.slug = public.slug_de(nome_))
     limit 1;
    r := r || jsonb_build_object('nome', jsonb_build_object('em_uso', s.name is not null, 'nome', s.name, 'cidade', s.city));
  end if;
  return r;
end $$;
revoke execute on function public.guia_onboarding_conferir(text, text, text, text) from public, anon, authenticated;

-- ---- salvar a configuração (os campos novos) ----------------------------------------------------------------------------
create or replace function public.guia_onboarding_config_salvar(c jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  gat text[];
  atend text;
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
      ligado = coalesce((c ->> 'ligado')::boolean, g.ligado),
      provedor = coalesce(nullif(c ->> 'provedor', ''), g.provedor),
      modelo = case when c ? 'modelo' then nullif(btrim(c ->> 'modelo'), '') else g.modelo end,
      orientacao = coalesce(nullif(btrim(c ->> 'orientacao'), ''), g.orientacao),
      gatilhos = coalesce(gat, g.gatilhos),
      numero_atendimento = case when c ? 'numero_atendimento' then atend else g.numero_atendimento end,
      tolerancia = coalesce((c ->> 'tolerancia')::integer, g.tolerancia),
      tolerancia_cnpj = coalesce((c ->> 'tolerancia_cnpj')::integer, g.tolerancia_cnpj),
      link_dias = coalesce((c ->> 'link_dias')::integer, g.link_dias),
      pausa_seg = coalesce((c ->> 'pausa_seg')::integer, g.pausa_seg),
      bolhas = coalesce((c ->> 'bolhas')::boolean, g.bolhas),
      com_servicos = coalesce((c ->> 'com_servicos')::boolean, g.com_servicos),
      com_horarios = coalesce((c ->> 'com_horarios')::boolean, g.com_horarios),
      com_email = coalesce((c ->> 'com_email')::boolean, g.com_email),
      com_telefone = coalesce((c ->> 'com_telefone')::boolean, g.com_telefone),
      com_explicacoes = coalesce((c ->> 'com_explicacoes')::boolean, g.com_explicacoes),
      com_resumo = coalesce((c ->> 'com_resumo')::boolean, g.com_resumo),
      passo_tipo = coalesce(nullif(btrim(c ->> 'passo_tipo'), ''), g.passo_tipo),
      passo_documento = coalesce(nullif(btrim(c ->> 'passo_documento'), ''), g.passo_documento),
      passo_endereco = coalesce(nullif(btrim(c ->> 'passo_endereco'), ''), g.passo_endereco),
      passo_nome = coalesce(nullif(btrim(c ->> 'passo_nome'), ''), g.passo_nome),
      passo_profissionais = coalesce(nullif(btrim(c ->> 'passo_profissionais'), ''), g.passo_profissionais),
      passo_servicos = coalesce(nullif(btrim(c ->> 'passo_servicos'), ''), g.passo_servicos),
      passo_horarios = coalesce(nullif(btrim(c ->> 'passo_horarios'), ''), g.passo_horarios),
      passo_email = coalesce(nullif(btrim(c ->> 'passo_email'), ''), g.passo_email),
      passo_telefone = coalesce(nullif(btrim(c ->> 'passo_telefone'), ''), g.passo_telefone),
      passo_explicacoes = coalesce(nullif(btrim(c ->> 'passo_explicacoes'), ''), g.passo_explicacoes),
      passo_resumo = coalesce(nullif(btrim(c ->> 'passo_resumo'), ''), g.passo_resumo),
      msg_confirmar = coalesce(nullif(btrim(c ->> 'msg_confirmar'), ''), g.msg_confirmar),
      msg_boas_vindas = coalesce(nullif(btrim(c ->> 'msg_boas_vindas'), ''), g.msg_boas_vindas),
      msg_nao_sou = coalesce(nullif(btrim(c ->> 'msg_nao_sou'), ''), g.msg_nao_sou),
      msg_cnpj_invalido = coalesce(nullif(btrim(c ->> 'msg_cnpj_invalido'), ''), g.msg_cnpj_invalido),
      msg_cpf_invalido = coalesce(nullif(btrim(c ->> 'msg_cpf_invalido'), ''), g.msg_cpf_invalido),
      msg_email_invalido = coalesce(nullif(btrim(c ->> 'msg_email_invalido'), ''), g.msg_email_invalido),
      msg_endereco_confirmar = coalesce(nullif(btrim(c ->> 'msg_endereco_confirmar'), ''), g.msg_endereco_confirmar),
      msg_link = coalesce(nullif(btrim(c ->> 'msg_link'), ''), g.msg_link),
      msg_encerrar = coalesce(nullif(btrim(c ->> 'msg_encerrar'), ''), g.msg_encerrar),
      msg_numero_em_uso = coalesce(nullif(btrim(c ->> 'msg_numero_em_uso'), ''), g.msg_numero_em_uso),
      msg_nome_em_uso = coalesce(nullif(btrim(c ->> 'msg_nome_em_uso'), ''), g.msg_nome_em_uso),
      msg_email_em_uso = coalesce(nullif(btrim(c ->> 'msg_email_em_uso'), ''), g.msg_email_em_uso),
      msg_documento_em_uso = coalesce(nullif(btrim(c ->> 'msg_documento_em_uso'), ''), g.msg_documento_em_uso),
      msg_email_confirmar = coalesce(nullif(btrim(c ->> 'msg_email_confirmar'), ''), g.msg_email_confirmar),
      msg_cep = coalesce(nullif(btrim(c ->> 'msg_cep'), ''), g.msg_cep),
      msg_cep_invalido = coalesce(nullif(btrim(c ->> 'msg_cep_invalido'), ''), g.msg_cep_invalido),
      msg_cep_numero = coalesce(nullif(btrim(c ->> 'msg_cep_numero'), ''), g.msg_cep_numero),
      msg_telefone = coalesce(nullif(btrim(c ->> 'msg_telefone'), ''), g.msg_telefone),
      msg_telefone_extra = coalesce(nullif(btrim(c ->> 'msg_telefone_extra'), ''), g.msg_telefone_extra),
      msg_telefone_invalido = coalesce(nullif(btrim(c ->> 'msg_telefone_invalido'), ''), g.msg_telefone_invalido),
      msg_resumo = coalesce(nullif(btrim(c ->> 'msg_resumo'), ''), g.msg_resumo),
      atualizado_em = now(), atualizado_por = auth.uid()
     where g.id = 1;
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
        when sqlerrm ~ 'orientacao' then 'a orientação do agente: de 20 a 8000 letras'
        when sqlerrm ~ 'msg_link' then 'a mensagem do link precisa ter {link} e de 10 a 2000 letras'
        when sqlerrm ~ 'msg_resumo' then 'a mensagem do resumo precisa ter {resumo} e de 10 a 2000 letras'
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

do $$
begin
  raise notice '204: o onboarding com contexto (guia_onboarding_conferir: número, e-mail, CPF/CNPJ e nome já cadastrados; numero_atendimento), endereço pelo CEP, pausa entre mensagens (pausa_seg, bolhas), confirmações (e-mail, WhatsApp do salão, resumo antes do link)';
end $$;

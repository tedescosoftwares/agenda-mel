-- =============================================================
-- Agenda Mel — 036: num telefone repetido, quem manda é a cliente
--
-- O cliente_pelo_telefone() devolve um perfil só, e escolhia pela ordem
-- de criação. Isso funciona por acidente: no banco de teste a cliente
-- foi criada antes da profissional, então a cliente ganha. Se a ordem
-- fosse a outra, o bot trataria a PROFISSIONAL como cliente e marcaria
-- horário dela com ela mesma.
--
-- E telefone repetido não é caso de laboratório. Mãe e filha atendidas
-- pelo mesmo número, a dona do salão que também é cliente, o celular da
-- recepção — acontece.
--
-- A regra passa a ser explícita: entre perfis com o mesmo telefone,
-- quem responde no WhatsApp é a CLIENTE. Quem atende usa o app.
-- =============================================================

create or replace function public.cliente_pelo_telefone(tel text)
returns uuid
language sql
stable
security definer set search_path = public
as $$
  select p.id
  from public.profiles p
  where public.telefone_e164(p.phone) = public.telefone_e164(tel)
  order by
    -- cliente primeiro; entre iguais, a mais antiga
    case p.role when 'cliente' then 0 when 'admin' then 1 else 2 end,
    p.created_at
  limit 1;
$$;

revoke execute on function public.cliente_pelo_telefone(text)
  from public, anon, authenticated;

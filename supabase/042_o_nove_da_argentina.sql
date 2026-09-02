-- =============================================================
-- Agenda Mel — 042: o mesmo telefone escrito de duas formas
--
-- Na Argentina o celular tem um 9 depois do código do país que o
-- WhatsApp às vezes manda e às vezes não:
--
--   +54 9 11 3619-7412   o que a pessoa digita no cadastro
--    54   11 3619-7412   o que costuma chegar no webhook
--
-- É o MESMO aparelho. Para o banco eram dois números diferentes, então
-- cliente_pelo_telefone() não achava ninguém e toda mensagem caía como
-- sem_cadastro: o bot não sabia com quem estava falando e ficava mudo.
-- O México tem exatamente a mesma armadilha, com um 1 no lugar do 9.
--
-- A saída não é normalizar na entrada. telefone_e164() precisa continuar
-- devolvendo o número como ele é, porque é ele que a gente usa para
-- ENVIAR. O que muda é a chave de COMPARAÇÃO: uma forma canônica usada
-- só para decidir se dois telefones são a mesma pessoa.
--
-- Guardar o número; comparar a chave. São perguntas diferentes.
-- =============================================================

-- 1. A chave ---------------------------------------------------------------
create or replace function public.telefone_chave(bruto text)
returns text
language plpgsql
immutable
as $$
declare
  d text;
begin
  d := public.telefone_e164(bruto);
  if d is null then
    return null;
  end if;

  -- Argentina: 54 + 9 + 10 dígitos é o mesmo que 54 + 10 dígitos
  if length(d) = 13 and left(d, 3) = '549' then
    return '54' || substr(d, 4);
  end if;

  -- México: 52 + 1 + 10 dígitos é o mesmo que 52 + 10 dígitos
  if length(d) = 13 and left(d, 3) = '521' then
    return '52' || substr(d, 4);
  end if;

  return d;
end;
$$;

comment on function public.telefone_chave(text) is
  'Forma canônica para COMPARAR telefones. Para enviar, use telefone_e164().';

revoke execute on function public.telefone_chave(text)
  from public, anon, authenticated;

-- 2. Quem compara passa a comparar pela chave ------------------------------
-- Mesma regra de desempate da 036: entre perfis com o mesmo telefone,
-- quem responde no WhatsApp é a CLIENTE.
create or replace function public.cliente_pelo_telefone(tel text)
returns uuid
language sql
stable
security definer set search_path = public
as $$
  select p.id
  from public.profiles p
  where public.telefone_chave(p.phone) = public.telefone_chave(tel)
  order by
    case p.role when 'cliente' then 0 when 'admin' then 1 else 2 end,
    p.created_at
  limit 1;
$$;

revoke execute on function public.cliente_pelo_telefone(text)
  from public, anon, authenticated;

-- 3. E quem procura a profissional também ----------------------------------
-- Aqui a busca é no histórico de envios: o número que ELA recebeu pode
-- ter sido gravado numa forma e chegar de volta na outra.
create or replace function public.profissional_do_telefone(tel text)
returns uuid
language sql
stable
security definer set search_path = public
as $$
  select o.professional_id
  from public.message_outbox o
  where public.telefone_chave(o.telefone) = public.telefone_chave(tel)
    and o.professional_id is not null
  order by o.criado_em desc
  limit 1;
$$;

revoke execute on function public.profissional_do_telefone(text)
  from public, anon, authenticated;

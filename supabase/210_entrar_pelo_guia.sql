-- 210 (3.64): a cliente entra na agenda de um salão pelo guia, dentro do app (e sem código).
--
-- Até aqui a cliente só entrava na agenda de um salão por convite: o QR, o código de seis letras ou o link /v/<código>.
-- Com o guia dentro do app da cliente, ela descobre o salão sozinha e, se ele já agenda pela MIMO, entra com um toque.
-- A cadeia do vínculo continua a mesma (vincular_interno, os mesmos efeitos): só o jeito muda, e fica registrado que ela
-- veio pelo guia (vinculos.como = 'guia' e a página do guia que a trouxe, guia_lugar_id). O salão pode fechar essa porta
-- (salons.aberto_no_guia = false): aí a página do guia mostra o salão, mas a agenda continua só por convite.

alter table public.vinculos drop constraint if exists vinculos_como_check;
alter table public.vinculos add constraint vinculos_como_check
  check (como in ('qr', 'link', 'codigo', 'cadastro', 'vitrine', 'agendamento', 'encaixe', 'whatsapp', 'guia'));
alter table public.vinculos add column if not exists guia_lugar_id uuid references public.guia_lugares (id) on delete set null;
comment on column public.vinculos.guia_lugar_id is 'Vínculo (210): a página do guia pela qual a cliente entrou, quando veio pelo guia (como = guia).';
create index if not exists vinculos_guia_idx on public.vinculos (guia_lugar_id) where guia_lugar_id is not null;

alter table public.salons add column if not exists aberto_no_guia boolean not null default true;
comment on column public.salons.aberto_no_guia is 'Salão (210): a cliente pode entrar na agenda pelo guia, sem convite (padrão sim). Desligado, a agenda fica só por QR, código ou link.';

-- a cliente logada entra na agenda do salão (salao_) a partir da página do guia (lugar_, opcional: o registro de onde veio).
-- Devolve { ok, novo, salao: { id, nome, tipo, cidade, logo } } ou { ok: false, motivo }.
create or replace function public.vincular_pelo_guia(salao_ uuid, lugar_ uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s public.salons;
  r jsonb;
  lugar_ok uuid;
begin
  if auth.uid() is null then raise exception 'entre na sua conta primeiro'; end if;
  if public.eh_equipe() then
    raise exception 'Você está logada como equipe. Saia da conta e entre como cliente.';
  end if;
  select * into s from public.salons where id = salao_;
  if not found or not coalesce(s.active, true) then
    return jsonb_build_object('ok', false, 'motivo', 'Esse salão não está mais na MIMO.');
  end if;
  if not coalesce(s.aberto_no_guia, true) then
    return jsonb_build_object('ok', false, 'motivo', 'Esse salão recebe clientes só por convite: peça o código ou o QR para a profissional.', 'so_convite', true);
  end if;
  -- a página do guia precisa ser deste salão (ou fica sem registro de origem)
  if lugar_ is not null then
    select l.id into lugar_ok from public.guia_lugares l where l.id = lugar_ and l.salon_id = salao_;
  end if;
  r := public.vincular_interno(auth.uid(), s.id, null, 'guia');
  if lugar_ok is not null then
    update public.vinculos set guia_lugar_id = lugar_ok where client_id = auth.uid() and salon_id = s.id and guia_lugar_id is null;
  end if;
  return jsonb_build_object('ok', true, 'novo', (r ->> 'novo')::boolean,
    'salao', jsonb_build_object('id', s.id, 'nome', s.name, 'tipo', s.tipo, 'cidade', s.city, 'logo', s.logo_url));
end $$;
comment on function public.vincular_pelo_guia(uuid, uuid) is 'Cliente (210): entra na agenda de um salão a partir do guia, sem código (como = guia, com a página do guia que a trouxe). Respeita salons.aberto_no_guia.';
revoke execute on function public.vincular_pelo_guia(uuid, uuid) from public, anon;
grant execute on function public.vincular_pelo_guia(uuid, uuid) to authenticated;

insert into public.migracoes_aplicadas (arquivo) values ('210_entrar_pelo_guia.sql') on conflict (arquivo) do nothing;
do $$ begin raise notice '210: vincular_pelo_guia (a cliente entra na agenda pelo guia; como = guia, guia_lugar_id), salons.aberto_no_guia'; end $$;

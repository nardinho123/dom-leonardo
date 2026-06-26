alter table public.pedidos
  add column if not exists mp_payment_id text,
  add column if not exists pagamento_status text not null default 'pendente',
  add column if not exists aceite_status text not null default 'pendente';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'pedidos_pagamento_status_check'
      and conrelid = 'public.pedidos'::regclass
  ) then
    alter table public.pedidos
      add constraint pedidos_pagamento_status_check
      check (pagamento_status in ('pendente', 'pago', 'estornado', 'expirado'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'pedidos_aceite_status_check'
      and conrelid = 'public.pedidos'::regclass
  ) then
    alter table public.pedidos
      add constraint pedidos_aceite_status_check
      check (aceite_status in ('pendente', 'aceito', 'recusado'));
  end if;
end $$;

create index if not exists pedidos_mp_payment_id_idx
  on public.pedidos (mp_payment_id)
  where mp_payment_id is not null;

create index if not exists pedidos_pagamento_status_idx
  on public.pedidos (pagamento_status);

comment on column public.pedidos.mp_payment_id is
  'ID do pagamento no Mercado Pago usado pelo webhook para conciliar PIX sem depender da tela do cliente.';

comment on column public.pedidos.pagamento_status is
  'Ciclo financeiro do pedido: pendente, pago, estornado ou expirado. Separado do status da cozinha.';

comment on column public.pedidos.aceite_status is
  'Ciclo de aceite do lojista: pendente, aceito ou recusado. Separado do status da cozinha.';

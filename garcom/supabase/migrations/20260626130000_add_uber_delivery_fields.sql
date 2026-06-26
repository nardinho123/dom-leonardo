-- Parte 3: campos da entrega Uber Direct no pedido (despacho de motoboy no aceite).
alter table public.pedidos
  add column if not exists uber_delivery_id text,
  add column if not exists uber_status text,
  add column if not exists uber_tracking_url text,
  add column if not exists uber_fee numeric(10,2),
  add column if not exists uber_eta_min int;

create index if not exists pedidos_uber_delivery_id_idx
  on public.pedidos (uber_delivery_id)
  where uber_delivery_id is not null;

comment on column public.pedidos.uber_delivery_id is 'ID da entrega na Uber Direct.';
comment on column public.pedidos.uber_status is 'Status da entrega Uber (pending, pickup, dropoff, delivered, canceled...).';
comment on column public.pedidos.uber_tracking_url is 'URL de rastreio da Uber para acompanhar o motoboy.';
comment on column public.pedidos.uber_fee is 'Custo da entrega cobrado pela Uber (R$).';
comment on column public.pedidos.uber_eta_min is 'ETA estimado da entrega em minutos (cotacao Uber).';

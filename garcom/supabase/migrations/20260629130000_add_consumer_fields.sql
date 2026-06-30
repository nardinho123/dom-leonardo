-- Integracao com o Consumer (PDV homologado iFood) via "API do Parceiro".
-- O Consumer faz polling dos pedidos pagos; precisamos marcar quais ja foram puxados
-- e guardar o ultimo status que o Consumer reporta (CONFIRMED/OUT_FOR_DELIVERY/CONCLUDED...).
alter table public.pedidos
  add column if not exists consumer_status text,
  add column if not exists consumer_sent_at timestamptz;

create index if not exists pedidos_consumer_pendentes_idx
  on public.pedidos (criado_em)
  where consumer_sent_at is null and pagamento_status = 'pago';

comment on column public.pedidos.consumer_status is 'Ultimo status reportado pelo Consumer (DETAILS_SENT, CONFIRMED, OUT_FOR_DELIVERY, CONCLUDED, CANCELLED...).';
comment on column public.pedidos.consumer_sent_at is 'Quando o Consumer puxou os detalhes deste pedido (para o polling nao repetir).';

-- Limpeza: Uber e Foody foram descartados; remove as colunas nao usadas.
alter table public.pedidos
  drop column if exists uber_delivery_id,
  drop column if exists uber_status,
  drop column if exists uber_tracking_url,
  drop column if exists uber_fee,
  drop column if exists uber_eta_min,
  drop column if exists foody_uid,
  drop column if exists foody_status,
  drop column if exists foody_tracking_url,
  drop column if exists foody_fee,
  drop column if exists foody_eta_min;

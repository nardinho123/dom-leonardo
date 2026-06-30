alter table public.pratos
  add column if not exists codigo_pdv text;

create index if not exists pratos_codigo_pdv_idx
  on public.pratos (codigo_pdv)
  where codigo_pdv is not null;

comment on column public.pratos.codigo_pdv is
  'Codigo do produto no Consumer/PDV usado como externalCode na API do Parceiro.';

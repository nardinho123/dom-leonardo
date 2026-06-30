-- Captura leve da pagina "Sua chave do menu".
-- Mantem o cadastro em public.clientes e cria um token publico que nao expoe o telefone.

alter table public.clientes
  add column if not exists link_token text,
  add column if not exists entrada_origem text,
  add column if not exists ultimo_acesso_em timestamptz,
  add column if not exists entrada_meta jsonb not null default '{}'::jsonb;

create unique index if not exists clientes_link_token_key
  on public.clientes (link_token)
  where link_token is not null;

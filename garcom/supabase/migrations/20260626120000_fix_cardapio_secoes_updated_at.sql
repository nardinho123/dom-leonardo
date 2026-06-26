-- Corrige o trigger de cardapio_secoes: a coluna real e atualizado_em, nao updated_at.
-- Sem isso, qualquer UPDATE em cardapio_secoes falha (record "new" has no field "updated_at"),
-- o que quebrava excluir/editar/mover secao no painel admin (INSERT funcionava).
create or replace function public.set_cardapio_secoes_updated_at()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  new.atualizado_em = now();
  return new;
end;
$function$;

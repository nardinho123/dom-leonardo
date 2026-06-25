# Contexto do Projeto — Dom Leonardo

> Mapa compacto do que já está pronto. Gerado em 2026-06-24 por leitura read-only do código + MCPs.
> Restaurante italiano (trattoria/delivery) em Curitiba-PR. Stack: 1 arquivo HTML por app (React via Babel no navegador) + Supabase + Edge Functions, servido por Nginx (EasyPanel).

## 1. Visão geral

Três apps independentes (cada um é **um HTML único**), dois projetos Supabase distintos:

| App | Arquivo | Banco | Papel |
|-----|---------|-------|-------|
| **ERP** | `index.html` (~8k linhas) | **Supabase ERP** (`ippeiearkgnqdeiquiuy`) | Gestão interna: compras, produção, vendas, estoque, CMV, caixa/DRE |
| **Cardápio / Garçom** | `garcom/index.html` (PWA) | **Supabase Cardápio** (`jewamqbdonudiapxbzay`) | Cardápio público, carrinho, checkout, chat, gamificação |
| **Admin do cardápio** | `admin-dom-leonardo.html` | **Supabase Cardápio** | Painel para gerenciar pratos/cupons/config/pedidos |

Infra: `Dockerfile` (nginx:alpine, copia workspace p/ `/usr/share/nginx/html`, porta 80) → deploy via GitHub no EasyPanel. Host conhecido: `https://domleonardo-erp.be3jfe.easypanel.host/garcom/`.

## 2. Supabase Cardápio (`jewamqbdonudiapxbzay`) — 16 tabelas, RLS em todas

**Cardápio:** `categorias` · `pratos` (preço base/promo, badges, textos de venda: frase_fome, como_chega, porcao, melhor_para, evitar_se, selo_experiencia, urgencia; `exclusivo_clube`) · `pratos_tamanhos` (peso_g, preço_delta) · `grupos_opcionais` (tipo: unico/multiplo/obrigatorio) · `opcionais` (preço_delta)
**Cupons:** `cupons` (percentual/valor_fixo/frete_gratis) · `prato_cupons`
**Clientes:** `clientes` (chave = whatsapp) · `enderecos_cliente`
**Pedidos:** `pedidos` · `pedido_itens` (snapshots de prato/tamanho/opcionais; `preco_total` gerado)
**Atendimento (chat):** `atendimentos` (por `device_id`) · `atendimento_mensagens` (autor: cliente/admin/sistema)
**Gamificação:** `minigame_cozinha_config` · `minigame_cozinha_scores` (recompensa = cupom)
**Config:** `configuracoes` (singleton `id=1`) — nome/logo/capa, entrega, horários, tema, microcopy do garçom, chaves públicas e textos de checkout, `topo_config` (jsonb)

`pedidos` (campos-chave): `numero_pedido` (seq), `endereco_snapshot` (jsonb), `subtotal/taxa_entrega/desconto/total`, `forma_pagamento` (enum: dinheiro, cartao_entrega, pix_manual, mercado_pago, **stripe**), `status` (novo→em_preparo→pronto→saiu_entrega→entregue / cancelado) com timestamp por etapa, e bloco Stripe: `stripe_payment_intent_id`, `stripe_payment_status`, `stripe_payment_method`, `pago_em`.

**RPCs usadas:** `criar_pedido`, `atualizar_status_pedido`.

**Edge Functions (5, todas ACTIVE, `verify_jwt=false`):**
- `garcom-responder` (v41) — **núcleo público**. Ações: `listar_pratos/listar_cardapio`, `mensagens_chat`, `registrar_atendimento`, `listar_atendimento`, `buscar_cliente`, `criar_checkout` (MP), `processar_pagamento_brick` (MP), `criar_pagamento_stripe`. Código em `garcom/supabase/functions/garcom-responder/index.ts`.
- `stripe-webhook` (v4) — valida assinatura HMAC manual; em `payment_intent.*` atualiza `pedidos` por `stripe_payment_intent_id`. Código local presente.
- `meta-conversions` (v4) — Meta Conversions API server-side (Pixel `2687533954980204`), eventos padrão + custom (CartOpen, ChatOpen, CouponApply, GameStart…), hash SHA-256 de external_id. Código local presente.
- `garcom-bot` (v12) — **deployada, sem código no repo local.**
- `cardapio-bind-visitor` (v9) — **deployada, sem código no repo local.**

## 3. Supabase ERP (`ippeiearkgnqdeiquiuy`) — inferido do `index.html` (MCP estava offline)

> Schema não lido via MCP (server caiu no reload). Mapa abaixo é do código.

**Tabelas/views:** `produtos`, `fornecedores`, `unidades`, `categorias`, `categorias_caixa`, `compras_itens`, `producoes`, `producao_insumos`, `vendas_itens`, `vendas_custos_extras`, `vendas_descontos`, `estoque_movimentacoes`, `ajustes_estoque`, `fluxo_caixa`, `receitas_ficha_tecnica`, `receita_itens`, `precos_venda` · views `v_estoque_atual`, `v_cmv_pratos`
**RPCs (tudo via server-side):** compras (`rpc_lancar_compra_lista`, `rpc_adicionar_compra_itens`, `rpc_editar_compra_item`, `rpc_excluir_compra`), produção (`rpc_lancar_producao`, `rpc_adicionar_producao_insumos`, `rpc_editar_producao`, `rpc_excluir_producao`), vendas (`rpc_lancar_venda`, `rpc_adicionar_venda_itens`, `rpc_*_venda_*`, `rpc_cancelar_venda_item`), perdas/uso (`rpc_lancar_perda`, `rpc_lancar_uso`, `rpc_editar_perda`), despesas (`rpc_lancar_despesa_fixa`…), fichas (`rpc_criar_ficha_tecnica`, `rpc_duplicar_ficha_tecnica`), estoque (`rpc_zerar_estoque`, `rpc_excluir_produto_estoque`), cadastros (`rpc_criar_produto_seguro`), relatórios (`rpc_lucro_por_prato_periodo`).
**Telas prontas:** dashboard, lançar compra/produção/venda/perda/despesa, fichas técnicas, estoque in natura + preparado, CMV, fluxo de caixa/DRE, auditoria. Login Supabase configurável na UI.

## 4. Pagamentos

- **Stripe** (cardápio): PaymentIntent criado em `garcom-responder` (`criar_pagamento_stripe`) via API REST direta (currency BRL, `automatic_payment_methods`), confirmação via `stripe-webhook`. Secret em env (`STRIPE_SECRET_KEY`); ⚠️ `STRIPE_PUBLISHABLE_KEY` tem **fallback `pk_live_…` hardcoded** no código (publishable, mas idealmente vir só de env).
- **Mercado Pago** (cardápio): Checkout Pro (`criar_checkout`) e brick transparente (`processar_pagamento_brick`, suporta Pix/cartão). Token em env (`MERCADO_PAGO_ACCESS_TOKEN`); public key na tabela `configuracoes`.

Secrets esperados nas Edge Functions: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PUBLISHABLE_KEY`, `MERCADO_PAGO_ACCESS_TOKEN`, `META_CAPI_ACCESS_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`.

## 5. Ferramentas / MCPs (Claude Code)

Ativos (lidos OK em modo leitura hoje): `supabase-cardapio`, `google-cloud-gcloud` (ADC=conta do Léo, projeto `cardapio-dom-leonardo`), `google-cloud-storage` (sem buckets), `n8n-mcp`.
Caídos no último reload (reconectar via `/mcp`): **`supabase-erp`**, **`stripe`** (plugin). Não subiu: `google-cloud-observability`. Pendente de formato: `google-developer-knowledge` (config em sintaxe Gemini CLI no `.mcp.json`).
Skills globais: Supabase (`supabase`, `supabase-postgres-best-practices`), Stripe (`stripe-best-practices` + comandos `/explain-error`, `/test-cards`).

## 6. Pendências conhecidas

**ERP (do `plano-de-execucao-codex.md`):** tela **Cadastros** ainda é placeholder; validar datas operacionais (`data_movimentacao` vs `created_at`), conferir se vendas/compras caem corretamente em `fluxo_caixa`, alertas de dashboard (preço +10%, item parado 15 dias, top 5 menos lucrativos). Regra firme: **não alterar Supabase sem aprovação**.
**Cardápio:** recuperar/versionar código de `garcom-bot` e `cardapio-bind-visitor` (deployadas sem fonte local); mover `pk_live` para env.
**Dados:** ambos os bancos com poucos dados de teste (cardápio: 4 pedidos, resto vazio).

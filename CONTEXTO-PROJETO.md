# Contexto do Projeto — Dom Leonardo

> Mapa compacto + auditoria. Atualizado em 2026-06-25 por leitura read-only do código + MCP Supabase (logs/SQL/advisors).
> Trattoria/delivery italiano, Curitiba-PR. Stack: **1 HTML por app** (React via Babel no navegador) + Supabase + Edge Functions, servido por **Nginx no EasyPanel**. Deploy = push no `main` → ~1-2 min no ar. Cada `.html` = sua própria URL (sem fallback de SPA).

## 1. Apps e bancos

| App | Arquivo | Banco | URL viva |
|-----|---------|-------|----------|
| **ERP** (interno) | `index.html` (~8k linhas) | Supabase **ERP** `ippeiearkgnqdeiquiuy` | (interno) — **NÃO TOCAR** |
| **Cardápio/Garçom** (público) | `garcom/index.html` (4945 linhas) | Supabase **Cardápio** `jewamqbdonudiapxbzay` | `…/garcom/` |
| **Admin do cardápio** | `admin-dom-leonardo.html` (3145 linhas) | Supabase **Cardápio** | `…/admin-dom-leonardo.html` |
| **Protótipo de design** | `prototipo-codex/index.html` (1326 linhas, OFFLINE) | — (lê `cardapio-data.js`) | `…/prototipo-codex/index.html` |

Host: `https://domleonardo-erp.be3jfe.easypanel.host/` e domínio `https://cardapio.domleonardo.com.br/` (raiz ainda serve HTML antigo; cardápio novo só em `/garcom/`).

## 2. Supabase Cardápio — 20 tabelas (RLS em todas), contagens REAIS

> ⚠️ `list_tables` mostra contagem ESTIMADA (mentia: dizia pratos=0/categorias=1). Valores reais por `count(*)`:

**Cardápio (núcleo):** `categorias` (7) · `cardapio_secoes` (7) ⟵ NOVA · `pratos` (21) · `pratos_tamanhos` (39) · `grupos_opcionais` (56) · `opcionais` (247).
**Cupons:** `cupons` (1) · `prato_cupons` (0).
**Clientes/Pedidos:** `clientes` (2) · `enderecos_cliente` (9) · `pedidos` (29) · `pedido_itens` (9).
**Chat:** `atendimentos` (0) · `atendimento_mensagens` (0).
**Gamificação:** `minigame_cozinha_config` (0) · `minigame_cozinha_scores` (0).
**Entrega (Google Maps):** `entrega_faixas` (30) · `entrega_estimativas_cache` (8, TTL) · `entrega_rate_limits` (6).
**Config:** `configuracoes` (singleton id=1) — topo/capa, entrega, horários, tema, microcopy, chaves públicas, `topo_config` jsonb.

**RPCs (SECURITY DEFINER):** `criar_pedido`, `atualizar_status_pedido`, `aplicar_cupom`, `calcular_preco_item`, `get_cardapio_publico`, `pedidos_admin`, `salvar_prato_completo`, `validar_grupos_obrigatorios`.

**Edge Functions (8, ACTIVE, verify_jwt=false):**
- `garcom-responder` **v49** — núcleo público. Ações: `listar_pratos/listar_cardapio` (agora devolve **secoes**), `mensagens_chat`, `registrar_atendimento`, `listar_atendimento`, `buscar_cliente`, `maps_public_config`, `calcular_entrega_google`, `criar_checkout` (MP), `processar_pagamento_brick` (MP Pix/cartão), `criar_pagamento_stripe`. Fonte local em sync.
- `stripe-webhook` v8 — confirma PaymentIntent → atualiza `pedidos`.
- `meta-conversions` v8 — Meta CAPI server-side.
- `reverse-geocode` v3 — geolocalização→rua/bairro (server key, sem referrer).
- `uber-entrega` v3 — Uber Direct (quote/create/status/cancel). **Credenciais de TESTE embutidas; webhook = TODO; NÃO chamado por nenhum HTML.**
- `garcom-bot` v16 e `cardapio-bind-visitor` v13 — **sem fonte local e sem chamador em HTML** (provável código morto/legado).

## 3. Fluxo do cardápio novo (secoes → tipo_visual → render)

`garcom-responder` devolve `categorias`, `secoes`, `pratos` separados. No `garcom/index.html`:
- `montarSecao` (≈3680): cada seção (de `cardapio_secoes`) tem `categoria_id` + `tipo_visual`; puxa `pratos` por `categoria_id`.
- `secoesCardapio` (≈3694): em "Todos" prepende carrossel "Mais pedidos", depois mapeia as seções; filtra seção sem prato.
- `renderSecaoCardapio` (≈4236) despacha por `tipo_visual`: `carrossel_horizontal`→posterCard · `feature_foto_grande`→featureCard · `nhoque_molhos`→nhoque (abas de molho) · `sobremesas`→doceCard · `risotos`→pratoCard(risoto-list) · default→pratoCard.
- CSS das seções (poster/feature+glow+steam/sauce-tabs/doce+wedge/dish-list) **existe** (≈2046-2460). Admin gerencia seções em `cardapio_secoes` (tipo_visual, ordem, ativo) — direto via supabase-js (NÃO pelo garcom-responder).

## 4. Integrações — estado

- **Stripe (LIVE):** `criar_pagamento_stripe` cria PaymentIntent (BRL, automatic_payment_methods) → `stripe-webhook` confirma. ⚠️ `STRIPE_PUBLISHABLE_KEY` tem **fallback `pk_live_…` hardcoded** no código (publishable, mas devia vir só de env). Secret em env OK.
- **Mercado Pago:** Checkout Pro (`criar_checkout`) + Brick transparente (`processar_pagamento_brick`, Pix/cartão). Token em env; public key na `configuracoes`.
- **Google Maps (server key):** `calcularEntregaGoogle` (geocode + distance matrix), `reverse-geocode`. Tem cache (`entrega_estimativas_cache`) + rate limit (`entrega_rate_limits`, 25/h device, 500/dia global). Browser key via `maps_public_config`.
- **Uber Direct:** function pronta porém **em TESTE e desconectada** (sem chamada no front, webhook não atualiza pedido, creds sandbox).

## 5. ⚠️ Homologação (PagBank / Uber) — realidade

- Pagamento HOJE = **Stripe + Mercado Pago**. **NÃO existe integração PagBank** no código. "Homologar na PagBank" = ou trocar/adicionar gateway PagBank (trabalho novo), ou outra coisa. **CONFIRMAR COM O LÉO.**
- Uber: integração existe mas em sandbox; produção exige creds reais + validação de assinatura no webhook + atualizar `pedidos`.

## 6. Boas práticas Supabase — desvios (advisors)

- **`cardapio_secoes` criada SEM migration versionada** (e demais mudanças). Banco diverge do Git → recriar do zero em outro ambiente quebra. Recomendado: versionar via `supabase/migrations`.
- **RLS "always true"** (USING/WITH CHECK = true) em ALL para `authenticated`: categorias, clientes, configuracoes, cupons, enderecos_cliente, grupos_opcionais, opcionais, pedido_itens, pedidos, prato_cupons, pratos, pratos_tamanhos. Pra cliente público OK, mas pra homologação convém restringir escrita.
- **SECURITY DEFINER executável por `authenticated`:** aplicar_cupom, atualizar_status_pedido, calcular_preco_item, criar_pedido, get_cardapio_publico, pedidos_admin, salvar_prato_completo, validar_grupos_obrigatorios. Revisar EXECUTE.
- **`citext` no schema public** (mover de schema). **Leaked password protection desativado** (ligar no Auth).

## 7. 🗑️ LIXO a deletar (precisa OK do Léo)

**Arquivos HTML/dados (raiz + garcom):**
- `index.html.claude.backup` (backup), `garcom-ia.html`, `garcom/prototipo-premium-offline.html`, `garcom/_offline-cardapio-data.js`, `garcom/_offline-cardapio-data.json`.
- Protótipos de exploração já superados: `garcom/prototipo-claude.html`, `prototipo-claude-2.html`, `prototipo-claude-3.html`. (Manter `prototipo-codex/index.html` = fonte de design.)
**Supabase:**
- Linha de teste em `cardapio_secoes`: `titulo="Test leo"` / `tipo_visual=risotos` / `ordem=0` (id `33357a25…`).
- Edge Functions órfãs `garcom-bot` e `cardapio-bind-visitor` (confirmar que n8n/externo não usa antes de remover).
**Código (no salvar_prato_completo / form de prato):** campos legados **frase_fome, como_chega_texto, porcao_texto, duvida_tamanho_texto, melhor_para, evitar_se, selo_experiencia, urgencia_texto** — Léo quer fora do cadastro de prato.

## 8. 🐛 BUGS a corrigir

1. **Lançamento de prato falha:** `ERROR: duplicate key value violates unique constraint "pratos_slug_key"` (logs Postgres, 2x hoje). Admin gera slug = `slug || slugify(nome)`; duplicar/nomes iguais colidem. Fix front: slug único (sufixo) antes do `salvar_prato_completo`.
2. **Design do `garcom/index.html` não bate com o protótipo:** pipeline e CSS existem e dados carregam (logs 200) — é mismatch visual/layout. Fix = alinhar seção a seção ao `prototipo-codex/index.html` (precisa ver na tela do iPhone p/ acertar fino).
3. **Campos desnecessários no cadastro de prato** (item 7).

## 9. Regras fixas (do Léo)

- **Não tocar produção sem pedido:** ERP, cardápio público, admin = read-only por padrão.
- **NÃO mexer no ERP** nesta etapa.
- **Toda mudança de DESIGN vai no `prototipo-codex/index.html`** (fonte de verdade do visual); só replicar no `garcom/index.html` quando alinhado.
- Client Secret/Access Token **nunca** no HTML/git.
- Commitar de forma aditiva/reversível; **deletar só com OK explícito** (vai pra homologação).

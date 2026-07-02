# Monte do seu jeito — Fase 1 (bandeja + pedido)

_Spec de design. Data: 2026-07-02._

## Objetivo
Novo cardápio do Dom Leonardo no estilo "Monte do seu jeito": o cliente navega por categorias e **arrasta as fotos dos pratos** para uma **bandeja de madeira**, montando o pedido, com um painel **"Seu pedido"** à direita. Visual limpo e escuro, igual aos mockups do Léo, funcionando bem no **celular**.

Este documento cobre **apenas a Fase 1**: a experiência de montar o pedido (navegar + arrastar + carrinho). Checkout, Pix, WhatsApp, endereço, login e Marco ficam para fases seguintes.

## Decisões travadas
- **2.5D, sem WebGL.** Bandeja de madeira via imagem/CSS + fotos com sombra e drag-and-drop em DOM. Nada de Three.js/R3F (overkill e pesado no celular para este visual).
- **Paralelo à produção.** Projeto novo em pasta separada. O `garcom/index.html` (produção, recebendo pedidos) **não é tocado**.
- **Reusa o backend existente** (Supabase): lê o mesmo menu (pratos: nome, preço, `foto_url`, categoria). Sem escrever nada no banco na Fase 1.
- **Sem Python.** Backend é o Supabase que já existe.
- **Deploy = build estático + push** (igual ao fluxo atual): Vite gera arquivos prontos servidos pelo mesmo nginx/EasyPanel em `/monte/`. Push na `main` → no ar.

## Stack
- **Vite + React 18 + TypeScript**
- **dnd-kit** — drag-and-drop com suporte a touch/celular
- **zustand** — estado do carrinho (leve)
- **@supabase/supabase-js** — leitura do menu
- Estilo: CSS (CSS Modules ou CSS puro), tema escuro/madeira

## Estrutura no repo
```
monte/
  index.html
  package.json
  tsconfig.json
  vite.config.ts        # base: '/monte/'
  .env.example          # VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
  src/
    main.tsx
    App.tsx
    lib/supabase.ts
    lib/categoryMap.ts
    hooks/useMenu.ts
    store/cart.ts        # zustand
    components/
      CategoryRail.tsx
      Tray.tsx           # dropzone + itens na bandeja
      DishCard.tsx       # arrastável (+ tap pra adicionar)
      DishGrid.tsx
      OrderPanel.tsx     # "Seu pedido"
    styles/...
```
Build sai em `monte/dist/` (servido em `/monte/`). Chave `anon` do Supabase é pública (client-side), sem service-role no front.

## Tela "Monte do seu jeito"
Layout desktop (3 colunas), igual aos mockups:
- **Esquerda — `CategoryRail`:** ícones/labels das categorias (Principais · Acompanhamentos · Bebidas · Sobremesas). Seleciona a categoria ativa.
- **Centro-topo — `Tray`:** bandeja de madeira; **dropzone** onde as fotos caem com sombra. Mostra os itens já colocados. Botão de remover por item (x).
- **Centro-abaixo — `DishGrid`:** grade de `DishCard` da categoria ativa (foto + nome + preço), **arrastáveis**.
- **Direita — `OrderPanel` ("Seu pedido"):** lista de itens, subtotal, taxa de entrega (placeholder/estático na Fase 1), total, e botão **"Servir pedido →"** (na Fase 1 só um stub que leva ao futuro checkout).

Mobile (responsivo, mesmo conteúdo):
- Categorias viram **barra rolável no topo**.
- Bandeja no topo do conteúdo.
- `DishGrid` abaixo.
- "Seu pedido" vira **barra fixa embaixo** que expande num **sheet** com o resumo e o botão.

## Interação
- Arrastar um `DishCard` e soltar na `Tray` → adiciona o item ao carrinho (zustand) e coloca a foto na bandeja.
- **Atalho/fallback:** tocar no `DishCard` (ou num "+") também adiciona (importante no celular).
- Remover: `x` no item da bandeja ou no `OrderPanel`.
- Quantidade: adicionar o mesmo prato incrementa a quantidade.

## Dados
- `useMenu` busca os pratos do Supabase (mesma origem do cardápio atual): campos usados = `id`, `nome`, `preco`/`preco_base`, `foto_url`, `categoria` (nome exato a confirmar na implementação, lendo a tabela `pratos`).
- `categoryMap` mapeia as categorias atuais do menu (ex.: massas/nhoque/risoto/pão/sobremesa) para os 4 grupos da tela (**Principais / Acompanhamentos / Bebidas / Sobremesas**). O mapa fica num único arquivo, fácil de ajustar.
- Carrinho é 100% client-side na Fase 1 (nada persistido/enviado).

## Componentes (fronteiras)
| Unidade | Faz | Depende de |
|---|---|---|
| `useMenu` | busca e normaliza o menu | `lib/supabase`, `categoryMap` |
| `cart` (store) | itens, add/remove/qtd, totais | — |
| `CategoryRail` | escolher categoria ativa | — (props) |
| `DishGrid` | listar pratos da categoria | `DishCard` |
| `DishCard` | card arrastável / tap-add | `cart`, dnd-kit |
| `Tray` | dropzone + itens na bandeja | `cart`, dnd-kit |
| `OrderPanel` | resumo do pedido | `cart` |

Cada peça é testável isolada: recebe dados por props/store e não conhece as internas das outras.

## Fora de escopo (Fase 1)
Checkout "sacola de papel", Pix Mercado Pago, redirect WhatsApp, endereço/mapa, login ("Entrar"), Marco, cálculo real de taxa de entrega, envio ao Consumer.

## Verificação (Fase 1)
- `npm run build` do Vite passa sem erro (TS incluso).
- App abre em `/monte/` (dev e build estático), lê o menu real do Supabase e renderiza as categorias/pratos.
- Arrastar e tocar adicionam ao "Seu pedido"; remover e quantidade funcionam.
- Layout responsivo testado no **celular** (o critério do Léo).

## Riscos / notas
- Nome exato das colunas/categorias da tabela `pratos` será confirmado ao ler o schema no início da implementação (evita suposição).
- Se o drag no celular ficar ruim em algum aparelho, o **tap-pra-adicionar** garante o fluxo (já previsto).
- A imagem da bandeja de madeira: usar uma textura leve (asset local otimizado) para não pesar no mobile.

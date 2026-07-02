# Monte do seu jeito — Fase 1 Implementation Plan

> **For agentic workers:** implementar task-a-task; cada task termina com deliverable testável (build + checagem visual) e commit.

**Goal:** App novo (bandeja 2.5D + montar pedido) lendo o menu real do Supabase, responsivo pra celular, sem tocar produção.

**Architecture:** Vite+React+TS em `monte/`, servido estático em `/monte/`. dnd-kit pro drag (com tap-fallback), zustand pro carrinho, supabase-js pra ler `pratos`+`categorias`. Sem checkout/pagamento (Fase 2).

**Tech Stack:** Vite, React 18, TypeScript, @dnd-kit/core, zustand, @supabase/supabase-js.

## Global Constraints
- Não tocar `garcom/index.html` nem nada de produção.
- Só a chave `anon` do Supabase no front (nunca service-role).
- `vite.config.ts` com `base: '/monte/'`; build estático em `monte/dist`.
- Menu real: tabela `pratos` (`id, nome, preco_base, preco_promocional, foto_url, categoria_id, ordem, ativo`) + `categorias` (`id, nome, ordem`). Só `ativo = true`.
- Categorias reais → grupos de exibição (arquivo `categoryMap.ts`):
  - **Principais** ← Mais Pedidos, Risotos Cremosos do Dom, Massas do Dom, Monte seu Nhoque, Dom Recheou um Pão Italiano
  - **Bebidas** ← Bebidas
  - **Sobremesas** ← Sobremesas Italianas
  - **Acompanhamentos** ← (vazio por ora; grupo só aparece se tiver item)
  - Ignorar categorias sem prato ativo (ex.: "Test leo").
- Verificação de cada task: `npm run build` passa + checagem de comportamento no dev server.

---

### Task 1: Scaffold Vite + React + TS em `monte/`
**Files:** Create `monte/package.json`, `monte/vite.config.ts`, `monte/tsconfig.json`, `monte/index.html`, `monte/src/main.tsx`, `monte/src/App.tsx`, `monte/.env.example`, `monte/.gitignore`.
- [ ] Criar projeto Vite (template react-ts) dentro de `monte/`.
- [ ] Instalar deps: `@dnd-kit/core @dnd-kit/utilities zustand @supabase/supabase-js`.
- [ ] `vite.config.ts`: `base: '/monte/'`.
- [ ] `.env.example` com `VITE_SUPABASE_URL=` e `VITE_SUPABASE_ANON_KEY=`; criar `.env.local` real (mesmos valores do projeto cardápio `jewamqbdonudiapxbzay`).
- [ ] `App.tsx` placeholder "Monte do seu jeito".
- **Verify:** `npm run dev` abre; `npm run build` gera `monte/dist`. **Commit.**

### Task 2: Supabase client + tipos + `useMenu` + `categoryMap`
**Files:** Create `monte/src/lib/supabase.ts`, `monte/src/lib/types.ts`, `monte/src/lib/categoryMap.ts`, `monte/src/hooks/useMenu.ts`.
- [ ] `supabase.ts`: `createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY)`.
- [ ] `types.ts`: `Prato { id, nome, preco, foto, grupo, categoriaNome, ordem }`, `Grupo = 'Principais'|'Acompanhamentos'|'Bebidas'|'Sobremesas'`.
- [ ] `categoryMap.ts`: `mapCategoria(nome: string): Grupo | null` com o mapeamento das Global Constraints (case-insensitive; retorna null pra ignoradas).
- [ ] `useMenu.ts`: busca `pratos` com join `categorias` (`select id,nome,preco_base,preco_promocional,foto_url,ordem,categorias(nome,ordem)`), filtra `ativo=true`, normaliza `preco = preco_promocional ?? preco_base`, aplica `mapCategoria`, descarta grupo null, ordena por `categorias.ordem, pratos.ordem`. Retorna `{ pratos, gruposComItens, loading, error }`.
- **Verify:** logar os pratos no `App`; build passa; console mostra pratos reais agrupados. **Commit.**

### Task 3: Carrinho (zustand)
**Files:** Create `monte/src/store/cart.ts`.
- [ ] `useCart` com `itens: {prato: Prato, qtd: number}[]`, `add(prato)`, `remove(id)`, `dec(id)`, `clear()`, e seletores `subtotal`, `totalItens`.
- [ ] `add` incrementa qtd se já existir.
- **Verify:** teste rápido no App (botões temporários add/remove atualizam totais); build passa. **Commit.**

### Task 4: Shell de layout + `CategoryRail` (responsivo)
**Files:** Create `monte/src/components/CategoryRail.tsx`, `monte/src/components/Layout.tsx`, `monte/src/styles/theme.css`. Modify `monte/src/App.tsx`.
- [ ] Tema escuro/madeira em `theme.css` (fundo madeira, tipografia, cores).
- [ ] Layout 3 colunas no desktop (rail | centro | Seu pedido); no mobile: rail vira barra rolável no topo, Seu pedido vira barra embaixo.
- [ ] `CategoryRail`: recebe `grupos` + `ativo` + `onSelect`; destaca o ativo.
- **Verify:** rail lista os grupos reais (Principais/Bebidas/Sobremesas); troca de categoria muda o estado; responsivo no devtools mobile. **Commit.**

### Task 5: `DishGrid` + `DishCard` (arrastável + tap)
**Files:** Create `monte/src/components/DishGrid.tsx`, `monte/src/components/DishCard.tsx`.
- [ ] `DishGrid`: grade dos pratos do grupo ativo.
- [ ] `DishCard`: foto + nome + preço; `useDraggable` (dnd-kit) com id do prato; `onClick`/botão "+" chama `cart.add` (fallback/atalho).
- **Verify:** cards do grupo aparecem com foto real; clicar/+ adiciona no carrinho (ver totais); arrastar levanta o card. **Commit.**

### Task 6: `Tray` (bandeja = dropzone)
**Files:** Create `monte/src/components/Tray.tsx`. Modify `App.tsx` para envolver em `DndContext`.
- [ ] `DndContext` no App com `onDragEnd`: se soltou sobre a bandeja, `cart.add(prato)`.
- [ ] `Tray`: `useDroppable`; textura de bandeja de madeira; renderiza as fotos dos itens do carrinho com sombra; `x` remove.
- [ ] Feedback visual de "solte aqui" quando arrastando.
- **Verify:** arrastar um prato pra bandeja adiciona e mostra a foto na bandeja; `x` remove; funciona no touch (devtools mobile). **Commit.**

### Task 7: `OrderPanel` ("Seu pedido") + sheet mobile
**Files:** Create `monte/src/components/OrderPanel.tsx`. Modify `Layout.tsx`.
- [ ] Lista de itens (nome, qtd, preço), subtotal, taxa de entrega (valor estático placeholder na Fase 1), total, botão "Servir pedido →" (stub: `alert`/console por ora).
- [ ] Mobile: barra fixa embaixo com total + "Servir"; toca e expande num sheet com a lista.
- **Verify:** painel reflete o carrinho em tempo real; no mobile vira barra/sheet. **Commit.**

### Task 8: Polish visual + responsivo + build final
**Files:** Modify `theme.css` e componentes conforme necessário. Create `monte/public/bandeja.webp` (textura leve) se preciso.
- [ ] Aproximar do mockup (espaçamentos, sombras, bandeja, cores) mantendo leve.
- [ ] Passe responsivo real (larguras 360–420px).
- [ ] `npm run build` final; conferir `monte/dist` servível em `/monte/`.
- **Verify:** fluxo completo (navegar → arrastar/tocar → Seu pedido) liso no mobile; build ok. **Commit.**

## Deploy (após Fase 1 aprovada por Léo)
Definir como o `/monte/dist` é servido pelo nginx/EasyPanel (rota `/monte/`) e commitar/publicar no fluxo push→main. Não incluído nas tasks de código; alinhar com o Léo ao final.

## Self-review
- Cobertura da spec: stack, deploy path, telas (rail/tray/grid/painel), dados (Supabase real), interação (drag+tap), responsivo, fora-de-escopo — todos com task. ✅
- Sem placeholders de lógica (mapeamento e queries explícitos). Taxa de entrega é intencionalmente estática na Fase 1 (documentado).
- Nomes consistentes: `useMenu`, `useCart`, `mapCategoria`, `Grupo`, `Prato` usados igual entre tasks.

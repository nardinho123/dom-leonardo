# Plano de Execucao Codex

## Objetivo

Finalizar o ERP Dom Leonardo para comecar a usar em operacao real hoje ou o quanto antes, aproveitando o `index.html` que o Claude Code ja montou, sem mexer no Supabase sem autorizacao explicita.

Este plano assume:

- O usuario vai criar um backup local do estado atual antes de eu editar o HTML.
- O Supabase ja esta com dados de teste e pode ser lido para diagnostico.
- Eu posso editar `index.html` depois do backup.
- Eu nao posso criar, alterar ou apagar nada no Supabase sem pedir antes.
- O app continua como arquivo unico HTML servido por Nginx no EasyPanel.

## Estado Atual Que Encontrei

O projeto esta hospedavel como site estatico:

- `Dockerfile` usa `nginx:alpine`.
- Copia o workspace para `/usr/share/nginx/html`.
- Expondo porta `80`.
- EasyPanel provavelmente faz build/deploy a partir do GitHub.

O `index.html` atual ja implementa muita coisa do plano:

- App shell com sidebar, topbar, tema claro/escuro e login Supabase.
- Dashboard.
- Lancar compra, incluindo compra unica, lista de compras e extrato.
- Lancar producao, incluindo producao unica, lote e historico.
- Lancar venda, incluindo historico e ranking.
- Lancar perda.
- Lancar despesa fixa.
- Fichas tecnicas.
- Estoque in natura.
- Estoque preparado.
- CMV e analise.
- Fluxo de caixa e DRE.
- Auditoria / balanco.

O ponto claramente incompleto:

- `Cadastros` existe no menu, mas ainda esta como placeholder "Em construcao".

Minha leitura: o Claude Code nao terminou o produto 100%. Ele chegou em um MVP avancado, mas ainda falta a rodada de estabilizacao, testes, correcao de bugs e fechamento de cadastro.

## Diferenca Entre Promessa e Codigo Atual

A conversa com Gemini descreveu bem a visao do produto, mas parte dela foi linguagem de produto, nao necessariamente codigo pronto.

Ja existe no codigo:

- Dashboard com cards de dia/mes.
- Break-even.
- Alertas basicos de estoque zerado/critico.
- Graficos financeiros.
- Podio e matriz BCG.
- Compras em lote.
- Producao em lote.
- Vendas com preco por canal.
- Fichas tecnicas com breakdown de custo.
- Estoques separados.
- Registros por produto.
- CMV com expansao por ingredientes.
- Fluxo de caixa com DRE.
- Auditoria/balanco.

Ainda precisa confirmar/completar:

- Alerta no dashboard de preco subindo acima de 10%.
- Alerta de itens parados ha mais de 15 dias.
- Top 5 pratos menos lucrativos no dashboard.
- Tela de Cadastros completa.
- Todas as telas com comportamento correto em dados reais.
- Se o filtro por data usa sempre a data operacional certa.
- Se venda, compra, producao, perda e despesa caem corretamente em estoque e caixa.

## Regra Principal Para Supabase

Nao alterar Supabase sem aprovacao.

Permitido sem pedir:

- Ler schema.
- Ler views.
- Ler funcoes.
- Ler triggers.
- Ler pequenas amostras de dados de teste.
- Rodar consultas `select` para diagnostico.

Precisa pedir antes:

- `insert`.
- `update`.
- `delete`.
- `create`.
- `alter`.
- `drop`.
- `grant`.
- `revoke`.
- `apply_migration`.
- Criar ou alterar view, trigger, funcao, policy, extension ou tabela.
- Limpar dados de teste.

Se eu encontrar que o HTML precisa de algo que o banco nao fornece, eu devo primeiro propor a alternativa:

1. Ajustar apenas no frontend.
2. Pedir autorizacao para alterar Supabase.

## Riscos Tecnicos Prioritarios

### 1. Datas entre `created_at` e `data_movimentacao`

Muitas telas lancam uma data editavel em `movimentacoes.data_movimentacao`, mas alguns relatorios filtram `fluxo_caixa.created_at`.

Risco:

- Se voce lancar hoje uma venda/despesa de ontem, ela pode aparecer no relatorio de hoje em vez de ontem.

Plano:

- Padronizar relatorios para data operacional sempre que existir `movimentacoes.data_movimentacao`.
- Onde `fluxo_caixa` nao trouxer `movimentacoes`, ajustar o select para fazer join.
- Se alguma relacao nao permitir join limpo, pedir autorizacao antes de mudar Supabase.

### 2. Venda e fluxo de caixa

O HTML chama `registrar_receita_venda`.

Risco:

- Se essa RPC ja cria `fluxo_caixa`, esta certo.
- Se nao cria, venda pode nao entrar no caixa.
- Se o HTML criar tambem sem conferir, pode duplicar receita.

Plano:

- Ler a funcao `registrar_receita_venda` em modo read-only.
- Confirmar se ela cria `fluxo_caixa`.
- Ajustar o HTML somente depois dessa confirmacao.

### 3. Compra e fluxo de caixa

O plano dizia que triggers criam estoque e despesa.

Risco:

- O HTML insere `compras_itens`, mas depende do banco calcular `preco_total`, `quantidade_gramas`, entrada no estoque e talvez despesa no caixa.

Plano:

- Ler triggers/funcoes relacionados a `compras_itens`.
- Confirmar que a compra unica e a compra em lista disparam tudo corretamente.
- Corrigir frontend se estiver passando campos incompletos.

### 4. Producao e retorno JSON

O plano avisava que `finalizar_producao` retorna `jsonb`.

Estado atual:

- O codigo atual parece tratar o retorno como objeto, nao como array.

Plano:

- Confirmar o shape real da RPC.
- Garantir que toast e historico leem `custo_total`, `custo_unitario_grama` e `rendimento_percentual` corretamente.

### 5. Tela Cadastros incompleta

Risco:

- Para usar no dia a dia, voce precisa criar/editar/desativar produtos, fornecedores, categorias e talvez unidades sem entrar no Supabase.

Plano:

- Implementar `TelaCadastros`.
- Comecar por Produtos e Fornecedores.
- Depois Categorias e Categorias de Caixa.
- Evitar hard delete como primeira opcao; preferir ativar/desativar quando existir coluna `ativo`.
- Qualquer delete destrutivo deve ter confirmacao forte.

### 6. Encoding e textos quebrados

Durante leitura no terminal apareceram caracteres quebrados em alguns trechos.

Risco:

- Pode ser apenas o PowerShell renderizando errado.
- Se estiver quebrado no navegador, a UI fica feia e confusa.

Plano:

- Abrir localmente e verificar visualmente.
- Se estiver quebrado no arquivo, corrigir para UTF-8.
- Se for so terminal, nao mexer.

### 7. Acoes perigosas no HTML

Existe botao para zerar estoque e auditoria que cria ajustes em massa.

Risco:

- Em uso real, um clique errado pode baguncar o estoque.

Plano:

- Manter a funcionalidade, mas revisar confirmacao.
- Garantir confirmacao textual forte.
- Garantir que o usuario entenda quantos itens serao afetados antes de confirmar.

## Ordem de Execucao Recomendada

### Fase 0 - Backup e congelamento

Responsavel: usuario.

1. Criar backup local do `index.html` atual.
2. Opcional: criar copia da pasta inteira.
3. Confirmar para mim que posso editar o HTML.

Eu nao faco alteracoes antes desse aviso.

### Fase 1 - Auditoria read-only do Supabase

Objetivo: entender exatamente o que o banco ja faz.

Consultas somente leitura:

- Source de `registrar_receita_venda`.
- Source de `finalizar_producao`.
- Source de funcoes de compra, venda, estoque e producao.
- Triggers ativos em tabelas principais.
- Relacoes entre `fluxo_caixa` e `movimentacoes`.

Resultado esperado:

- Mapa de responsabilidades: o que o banco calcula e o que o HTML deve calcular.
- Lista de ajustes somente frontend.
- Lista separada de possiveis ajustes Supabase, se existirem, para sua aprovacao.

### Fase 2 - Rodar localmente e capturar erros

Objetivo: ver erro real no navegador.

Passos:

1. Servir o HTML localmente.
2. Abrir o app.
3. Logar com defaults.
4. Navegar pelas telas.
5. Anotar erros de console.

Importante:

- Nao fazer lancamentos reais nessa fase.
- Se precisar testar insert, pedir sua permissao antes.

### Fase 3 - Corrigir bugs bloqueantes do HTML

Prioridade:

1. Datas operacionais.
2. Fluxo de caixa de vendas/despesas/compras.
3. Retorno de RPCs.
4. Erros de chart.
5. Erros de filtros.
6. Erros de dropdown/search.
7. Quebras mobile mais graves.

Meta:

- Todas as telas abrem sem erro.
- Relatorios usam a data certa.
- Lancamentos basicos nao duplicam nem somem.

### Fase 4 - Completar Cadastros

Implementar:

- Produtos.
- Fornecedores.
- Categorias de produto.
- Categorias de caixa.
- Talvez unidades, se fizer sentido e o banco permitir com seguranca.

Campos esperados:

- Produto: nome, tipo, categoria, unidade padrao, ativo.
- Fornecedor: nome, telefone, CNPJ, ativo.
- Categoria: nome, descricao, ativo quando existir.
- Categoria de caixa: nome, tipo, descricao.

Regras:

- Preferir desativar a deletar.
- Delete so com confirmacao.
- Se alguma operacao exigir mudanca no banco, pausar e pedir.

### Fase 5 - Completar promessas do dashboard

Adicionar ou revisar:

- Preco subindo acima de 10%.
- Item parado ha mais de 15 dias.
- Top 5 menos lucrativos.
- Melhorar alerta de estoque critico usando consumo real quando existir.
- Garantir que BCG usa periodo coerente, preferencialmente mes atual.

### Fase 6 - Teste ponta a ponta com dados de teste

Depois de sua autorizacao para fazer lancamentos de teste:

1. Criar/selecionar produto de teste.
2. Lancar compra.
3. Conferir estoque.
4. Lancar producao.
5. Conferir baixa de insumos e entrada de preparado.
6. Lancar venda.
7. Conferir CMV.
8. Conferir estoque.
9. Conferir fluxo de caixa.
10. Lancar perda.
11. Conferir desperdicio/estoque.
12. Fazer mini balanco.

Nada disso deve ser feito sem seu ok.

### Fase 7 - Preparar para deploy

Quando estiver validado:

1. Revisar `git status`.
2. Mostrar arquivos alterados.
3. Commit com mensagem clara, se voce quiser.
4. Push para GitHub, se voce quiser.
5. EasyPanel deve redeployar ou voce aciona redeploy manual.

## Criterios Para Dizer "Pode Usar Hoje"

Eu so diria que esta pronto para uso real quando:

- Compra unica funciona.
- Compra em lista funciona.
- Producao funciona.
- Venda funciona.
- Perda funciona.
- Despesa fixa funciona.
- Estoque atual reflete os lancamentos.
- Fluxo de caixa bate com as vendas/despesas.
- Fichas tecnicas permitem editar e recalcular CMV.
- Cadastros basicos existem.
- Nao ha erro de console navegando nas telas principais.

## O Que Eu Nao Vou Fazer Sem Voce Aprovar

- Alterar Supabase.
- Limpar dados.
- Rodar inserts de teste.
- Fazer deploy.
- Dar push.
- Remover funcionalidades grandes.
- Trocar stack para Vite/Next/etc.
- Separar o HTML em varios arquivos.

## Minha Avaliacao Final

O projeto esta muito perto de virar ferramenta real. O Claude Code montou quase todo o corpo do ERP. Agora falta a etapa que mais importa antes de usar no restaurante: estabilizar, validar fluxo financeiro/estoque e completar Cadastros.

A melhor estrategia e nao reescrever tudo de novo. E aproveitar o que ja existe, corrigir bugs, fechar lacunas e testar o caminho operacional real.


# Claude Code — project context












































































<!-- cloude-code-toolbox:mcp-skills-awareness-begin -->

### MCP & Skills awareness (Cloude Code ToolBox)

_Last synced: 2026-06-29T04:30:44.146Z._

- **Full report:** `.claude/cloude-code-toolbox-mcp-skills-awareness.md` in this workspace (auto-overwritten on each scan). Use it as ground truth for configured servers and skill folders.
- **MCP:** For **live tools** in Claude Code, enable the matching server via `/mcp`. Servers are configured in `~/.claude.json` (user) and `.mcp.json` (project).
- **When the user’s task matches a server** (e.g. Confluence work and a **Confluence** / **Atlassian** MCP is listed), **prefer that server id** and plan on tool use—not only file search.
- **Skills:** Folders below contain `SKILL.md`; attach or cite paths in chat when relevant.

#### Workspace MCP

- `c:\Users\leona\dom-leonardo\.mcp.json` _(workspace: dom-leonardo)_ — _servers defined_

| Server id | Kind | Detail |
|-----------|------|--------|
| supabase-erp | http | https://mcp.supabase.com/mcp?project_ref=ippeiearkgnqdeiquiuy&features=docs%2Caccount%2Cdatabase%2Cdebugging%2Cdevelopment%2Cfunctions%2Cbranching%2Cstorage |
| supabase-cardapio | http | https://mcp.supabase.com/mcp?project_ref=jewamqbdonudiapxbzay&features=docs%2Caccount%2Cdatabase%2Cdebugging%2Cdevelopment%2Cfunctions%2Cbranching%2Cstorage |
| google-cloud-gcloud | stdio | C:\Users\leona\dom-leonardo\scripts\mcp\google-cloud-gcloud.cmd |
| google-cloud-observability | stdio | C:\Users\leona\dom-leonardo\scripts\mcp\google-cloud-observability.cmd |
| google-cloud-storage | stdio | C:\Users\leona\dom-leonardo\scripts\mcp\google-cloud-storage.cmd |
| google-developer-knowledge | ? | {"httpUrl":"https://developerknowledge.googleapis.com/mcp","authProviderType":"g |
| mercadopago | http | https://mcp.mercadopago.com/mcp |

#### User MCP

- `C:\Users\leona\.claude.json` — _servers defined_

| Server id | Kind | Detail |
|-----------|------|--------|
| n8n-mcp | http | https://automacao-n8n.be3jfe.easypanel.host/mcp-server/http |

#### Project skills

_None found (or no workspace open)._

#### User skills

- **supabase** — `C:\Users\leona\.agents\skills\supabase` — Use when doing ANY task involving Supabase. Triggers: Supabase products (Database, Auth, Edge Functions, Realtime, Storage, Vectors, Cron, Queues); client libraries and SSR integrations (supabase-js, @supabase/ssr) in Ne

- **supabase-postgres-best-practices** — `C:\Users\leona\.agents\skills\supabase-postgres-best-practices` — Postgres performance optimization and best practices from Supabase. Use this skill when writing, reviewing, or optimizing Postgres queries, schema designs, or database configurations.

- **uber-direct** — `C:\Users\leona\.agents\skills\uber-direct` — Integrar a Uber Direct (delivery-as-a-service da Uber) para despachar motoboy/courier sob demanda a partir do seu próprio app/cardápio. Use ao chamar entregador via API, pegar cotação/ETA de entrega, rastrear status por

<!-- cloude-code-toolbox:mcp-skills-awareness-end -->
<!-- cloude-code-toolbox:token-optimization-begin -->

### Token Optimization (Claude Code ToolBox)

_Active level: concise_

- Respond concisely: 1-3 sentences max unless the user asks for detail.
- Never restate the user's question or echo file contents back verbatim.
- When showing code changes, show only modified lines with 2 lines of context.
- Skip meta-commentary ("I'll now...", "Let me...", "Here's what I did...").
- Before reading a file, check `.claude/project-map.md` for structural context.
- If you already read a file this session and it hasn't changed, reference your memory instead of re-reading.
- Do not read files matching `.claudeignore` patterns unless explicitly asked.

<!-- cloude-code-toolbox:token-optimization-end -->
# Cloude Code ToolBox — MCP & Skills awareness

_Generated: 2026-06-29T04:30:44.132Z_

## How to use this report

- **Saved copy:** This file is **`.claude/cloude-code-toolbox-mcp-skills-awareness.md`** — refreshed whenever the toolbox runs an MCP & Skills scan (including on workspace open when auto-scan is enabled). It is meant for **Claude Code workspace context** together with `CLAUDE.md` (which gets a shorter replaceable summary when auto-merge is on).
- **MCP:** Lists **configured** servers from Claude Code config (`~/.claude.json` for user scope, `.mcp.json` for project scope). Use `/mcp` in the Claude Code panel to connect servers for your session.
- **Skills:** **On-disk** folders with `SKILL.md`. Claude Code does not auto-load them; attach `SKILL.md` or paths in chat when useful.
- **Task routing:** When the user’s request matches a server’s purpose (e.g. Confluence → Confluence/Atlassian MCP), prefer that **server id** from the tables below.

---

## MCP — workspace

Workspace `mcp.json` _(folder: dom-leonardo)_

- **c:\Users\leona\dom-leonardo\.mcp.json** — _File exists — servers defined_

| Server id | Kind | Detail |
|-----------|------|--------|
| supabase-erp | http | https://mcp.supabase.com/mcp?project_ref=ippeiearkgnqdeiquiuy&features=docs%2Caccount%2Cdatabase%2Cdebugging%2Cdevelopment%2Cfunctions%2Cbranching%2Cstorage |
| supabase-cardapio | http | https://mcp.supabase.com/mcp?project_ref=jewamqbdonudiapxbzay&features=docs%2Caccount%2Cdatabase%2Cdebugging%2Cdevelopment%2Cfunctions%2Cbranching%2Cstorage |
| google-cloud-gcloud | stdio | C:\Users\leona\dom-leonardo\scripts\mcp\google-cloud-gcloud.cmd |
| google-cloud-observability | stdio | C:\Users\leona\dom-leonardo\scripts\mcp\google-cloud-observability.cmd |
| google-cloud-storage | stdio | C:\Users\leona\dom-leonardo\scripts\mcp\google-cloud-storage.cmd |
| google-developer-knowledge | ? | {"httpUrl":"https://developerknowledge.googleapis.com/mcp","authProviderType":"g |
| mercadopago | http | https://mcp.mercadopago.com/mcp |

## MCP — user profile

- **C:\Users\leona\.claude.json** — _File exists — servers defined_

| Server id | Kind | Detail |
|-----------|------|--------|
| n8n-mcp | http | https://automacao-n8n.be3jfe.easypanel.host/mcp-server/http |

## Skills (local `SKILL.md` folders)

### Project-scoped

_None found (or no workspace open)._

### User-scoped

- **supabase** — `C:\Users\leona\.agents\skills\supabase`
  - Use when doing ANY task involving Supabase. Triggers: Supabase products (Database, Auth, Edge Functions, Realtime, Storage, Vectors, Cron, Queues); client libraries and SSR integrations (supabase-js, @supabase/ssr) in Ne

- **supabase-postgres-best-practices** — `C:\Users\leona\.agents\skills\supabase-postgres-best-practices`
  - Postgres performance optimization and best practices from Supabase. Use this skill when writing, reviewing, or optimizing Postgres queries, schema designs, or database configurations.

- **uber-direct** — `C:\Users\leona\.agents\skills\uber-direct`
  - Integrar a Uber Direct (delivery-as-a-service da Uber) para despachar motoboy/courier sob demanda a partir do seu próprio app/cardápio. Use ao chamar entregador via API, pegar cotação/ETA de entrega, rastrear status por 

---

## Suggested next steps

- **MCP:** Use this extension’s hub **MCP** tab, or `claude mcp list` in the terminal. In Claude Code, use `/mcp` to connect servers for the session.
- **Edit config:** Open `~/.claude.json` (user MCP) or `<workspace>/.mcp.json` (project MCP) via the extension commands.
- **Refresh this report:** run **Intelligence — scan MCP & Skills awareness** again after changing MCP config or adding skills.

_Report from Cloude Code ToolBox extension._

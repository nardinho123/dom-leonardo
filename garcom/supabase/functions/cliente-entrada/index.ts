// Edge Function: cliente-entrada
// Pagina "Chave do Menu". O TOKEN (link_token) e a conta-sem-senha do cliente:
// modos -> capturar (cria/atualiza), buscar (existe?), por_token (recupera estado).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function cleanText(value: unknown, max = 180): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function normalizePhone(value: unknown): string {
  let d = cleanText(value, 40).replace(/\D/g, "");
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  return d;
}

function phoneLookupValues(value: unknown): string[] {
  const canonical = normalizePhone(value);
  const values = new Set<string>();
  if (canonical) values.add(canonical);
  if (canonical.startsWith("55") && (canonical.length === 12 || canonical.length === 13)) {
    values.add(canonical.slice(2));
  }
  return [...values].filter((v) => v.length >= 10 && v.length <= 14);
}

function primeiroNome(nome: unknown): string {
  return String(nome || "").trim().split(/\s+/)[0] || "";
}

function slugNome(nome: string): string {
  const base = String(nome)
    .normalize("NFD")
    .replace(/[^\x00-\x7F]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 18);
  return base || "cliente";
}

function tokenCandidate(nome: string, whatsapp: string): string {
  const tail = whatsapp.slice(-4) || Math.random().toString(36).slice(2, 6);
  const entropy = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  return `${slugNome(nome)}-${tail}-${entropy}`;
}

// deno-lint-ignore no-explicit-any
async function uniqueToken(sb: any, nome: string, whatsapp: string): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const candidate = tokenCandidate(nome, whatsapp);
    const { data, error } = await sb.from("clientes").select("id").eq("link_token", candidate).maybeSingle();
    if (error) throw error;
    if (!data) return candidate;
  }
  return crypto.randomUUID().replace(/-/g, "");
}

// deno-lint-ignore no-explicit-any
async function findClienteByPhone(sb: any, whatsapp: string): Promise<any | null> {
  const values = phoneLookupValues(whatsapp);
  if (!values.length) return null;
  const { data, error } = await sb
    .from("clientes")
    .select("id, nome, whatsapp, link_token, total_pedidos, ultimo_pedido_em, entrada_meta")
    .in("whatsapp", values)
    .order("total_pedidos", { ascending: false })
    .order("ultimo_pedido_em", { ascending: false, nullsFirst: false })
    .limit(1);
  if (error) throw error;
  return data?.[0] || null;
}

// deno-lint-ignore no-explicit-any
async function findClienteFromPedido(sb: any, whatsapp: string, now: string): Promise<any | null> {
  const values = phoneLookupValues(whatsapp);
  if (!values.length) return null;
  const { data: pedidos, error } = await sb
    .from("pedidos")
    .select("cliente_id, cliente_nome, cliente_whatsapp, criado_em")
    .in("cliente_whatsapp", values)
    .order("criado_em", { ascending: false })
    .limit(1);
  if (error) throw error;
  const pedido = pedidos?.[0];
  if (!pedido) return null;

  if (pedido.cliente_id) {
    const { data: cli, error: cliError } = await sb
      .from("clientes")
      .select("id, nome, whatsapp, link_token, total_pedidos, ultimo_pedido_em, entrada_meta")
      .eq("id", pedido.cliente_id)
      .maybeSingle();
    if (cliError) throw cliError;
    if (cli) return cli;
  }

  const nome = cleanText(pedido.cliente_nome, 80) || "Cliente Dom";
  const canonical = normalizePhone(whatsapp);
  const linkToken = await uniqueToken(sb, nome, canonical);
  const { data: novo, error: insertError } = await sb
    .from("clientes")
    .insert({
      nome,
      whatsapp: canonical,
      link_token: linkToken,
      entrada_origem: "pedido-existente",
      ultimo_acesso_em: now,
      entrada_meta: { criado_por: "cliente-entrada", origem_pedido: true },
    })
    .select("id, nome, whatsapp, link_token, total_pedidos, ultimo_pedido_em, entrada_meta")
    .single();
  if (insertError) throw insertError;

  await sb
    .from("pedidos")
    .update({ cliente_id: novo.id })
    .in("cliente_whatsapp", values)
    .is("cliente_id", null);

  return novo;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!supabaseUrl || !serviceRole) throw new Error("Supabase env ausente");

    const sb = createClient(supabaseUrl, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const body = await req.json().catch(() => ({}));
    const acao = cleanText(body.acao, 20) || "capturar";
    const now = new Date().toISOString();

    // ===== BUSCAR: telefone existe? (debounce do "Ja sou cliente") =====
    if (acao === "buscar") {
      const whatsapp = normalizePhone(body.whatsapp);
      if (whatsapp.length < 12 || whatsapp.length > 14) return json({ existe: false });

      const data = await findClienteByPhone(sb, whatsapp) || await findClienteFromPedido(sb, whatsapp, now);
      if (!data) return json({ existe: false });

      let token = cleanText(data.link_token, 120);
      if (!token) token = await uniqueToken(sb, data.nome || "cliente", whatsapp);
      await sb.from("clientes").update({ link_token: token, ultimo_acesso_em: now }).eq("id", data.id);

      return json({
        existe: true,
        primeiro_nome: primeiroNome(data.nome),
        link_token: token,
        cliente: {
          id: data.id,
          nome: data.nome,
          whatsapp,
          link_token: token,
          total_pedidos: data.total_pedidos ?? 0,
          ultimo_pedido_em: data.ultimo_pedido_em ?? null,
        },
      });
    }

    // ===== POR_TOKEN: recupera identidade + estado (restore no cardapio) =====
    if (acao === "por_token") {
      const token = cleanText(body.token, 120);
      if (!token) return json({ encontrado: false });

      const { data: cli, error } = await sb
        .from("clientes")
        .select("id, nome, whatsapp, link_token")
        .eq("link_token", token)
        .maybeSingle();
      if (error) throw error;
      if (!cli) return json({ encontrado: false });

      await sb.from("clientes").update({ ultimo_acesso_em: now }).eq("id", cli.id);

      const { data: end } = await sb
        .from("enderecos_cliente")
        .select("logradouro, numero, bairro, complemento, cidade, uf, cep, ponto_referencia")
        .eq("cliente_id", cli.id)
        .eq("ativo", true)
        .order("padrao", { ascending: false })
        .order("criado_em", { ascending: false })
        .limit(1)
        .maybeSingle();

      const { data: peds } = await sb
        .from("pedidos")
        .select("id, numero_pedido, status, pagamento_status, aceite_status, total, criado_em")
        .eq("cliente_id", cli.id)
        .order("criado_em", { ascending: false })
        .limit(5);
      const pedidoAberto = (peds || []).find((p: Record<string, unknown>) => !["entregue", "cancelado"].includes(String(p.status))) || null;

      return json({
        encontrado: true,
        cliente: { id: cli.id, nome: cli.nome, whatsapp: cli.whatsapp, link_token: cli.link_token },
        endereco: end || null,
        pedido_aberto: pedidoAberto,
      });
    }

    // ===== CAPTURAR (default): cria/atualiza e devolve o token pessoal =====
    const nome = cleanText(body.nome, 80);
    const whatsapp = normalizePhone(body.whatsapp);
    const deviceId = cleanText(body.device_id, 120);
    const origem = cleanText(body.origem, 80) || "chave-do-menu";
    const userAgent = cleanText(req.headers.get("user-agent"), 300);

    if (nome.length < 2) return json({ error: "Nome muito curto" }, 400);
    if (whatsapp.length < 12 || whatsapp.length > 14) return json({ error: "WhatsApp invalido" }, 400);

    const existente = await findClienteByPhone(sb, whatsapp);

    const linkToken = cleanText(existente?.link_token, 120) || await uniqueToken(sb, nome, whatsapp);
    const entradaMeta = {
      ...(existente?.entrada_meta && typeof existente.entrada_meta === "object" ? existente.entrada_meta : {}),
      device_id: deviceId || null,
      user_agent: userAgent || null,
      ultima_origem: origem,
      ultima_captura_em: now,
    };

    // Toda pessoa identificada ganha um chat no painel (mesmo sem nunca falar com o Marco):
    // cria/atualiza o atendimento do device com o nome e registra a captura como mensagem de sistema.
    async function garantirChatDaPessoa(clienteNovo: boolean) {
      if (!deviceId) return;
      try {
        const { data: atExistente } = await sb
          .from("atendimentos")
          .select("id")
          .eq("device_id", deviceId)
          .maybeSingle();
        const texto = `🔑 ${nome} ${clienteNovo ? "criou a chave do menu" : "recuperou a chave do menu"} (${whatsapp}).`;
        let atendimentoId = atExistente?.id;
        if (atendimentoId) {
          await sb.from("atendimentos").update({ cliente_nome: nome, ultima_mensagem_em: now }).eq("id", atendimentoId);
        } else {
          const { data: novoAt, error: atError } = await sb
            .from("atendimentos")
            .insert({ device_id: deviceId, cliente_nome: nome, status: "aberto", ultimo_texto: texto, aberto_em: now, ultima_mensagem_em: now, nao_lidas: 0 })
            .select("id")
            .single();
          if (atError) throw atError;
          atendimentoId = novoAt?.id;
        }
        if (atendimentoId) {
          await sb.from("atendimento_mensagens").insert({
            atendimento_id: atendimentoId,
            autor: "sistema",
            texto,
            contexto: { origem, whatsapp },
          });
        }
      } catch (err) {
        console.warn("cliente-entrada: nao consegui garantir o chat da pessoa:", err);
      }
    }

    if (existente?.id) {
      const { data, error } = await sb
        .from("clientes")
        .update({ nome, link_token: linkToken, entrada_origem: origem, ultimo_acesso_em: now, entrada_meta: entradaMeta, atualizado_em: now })
        .eq("id", existente.id)
        .select("id, nome, whatsapp, link_token")
        .single();
      if (error) throw error;
      await garantirChatDaPessoa(false);
      return json({ cliente: data, novo: false, link_token: linkToken });
    }

    const { data, error } = await sb
      .from("clientes")
      .insert({ nome, whatsapp, link_token: linkToken, entrada_origem: origem, ultimo_acesso_em: now, entrada_meta: entradaMeta })
      .select("id, nome, whatsapp, link_token")
      .single();
    if (error) throw error;

    await garantirChatDaPessoa(true);
    return json({ cliente: data, novo: true, link_token: linkToken });
  } catch (err) {
    console.error("cliente-entrada error:", err);
    return json({ error: String((err as Error)?.message || err) }, 500);
  }
});

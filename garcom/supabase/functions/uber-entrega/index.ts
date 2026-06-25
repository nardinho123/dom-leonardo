// Edge Function: uber-entrega
// Integra o Uber Direct (despacho de motoboy) para o Dom Leonardo.
//
// CREDENCIAIS:
//   - Client ID e Customer ID: valores de TESTE embutidos abaixo (sobrescreviveis por env).
//   - Client Secret: NUNCA no codigo -> definir a secret UBER_DIRECT_CLIENT_SECRET no Supabase.
//   Em PRODUCAO, defina tambem UBER_DIRECT_CLIENT_ID e UBER_DIRECT_CUSTOMER_ID por env.
//
// Acoes (POST JSON { acao, ... }):
//   - "quote"  : { pickup_address, dropoff_address }  -> cotacao (preco + ETA)
//   - "create" : { delivery: {...} }                  -> despacha o motoboy
//   - "status" : { delivery_id }                      -> status da entrega
//   - "cancel" : { delivery_id }                      -> cancela a entrega
// Webhook da Uber (POST sem "acao") -> recebido e logado (atualiza pedidos: TODO).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-uber-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const AUTH_URL = "https://auth.uber.com/oauth/v2/token";
const API_BASE = "https://api.uber.com/v1/customers";

// Defaults de TESTE (sandbox) — sem risco; sobrescreviveis por env em producao.
const TEST_CLIENT_ID = "qSs2ShW28465LX77SF3Yo2hyCFfil55I";
const TEST_CUSTOMER_ID = "d840941e-b1d7-5038-a885-19e49d44a75d";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function creds() {
  return {
    clientId: Deno.env.get("UBER_DIRECT_CLIENT_ID") || TEST_CLIENT_ID,
    clientSecret: Deno.env.get("UBER_DIRECT_CLIENT_SECRET") || "",
    customerId: Deno.env.get("UBER_DIRECT_CUSTOMER_ID") || TEST_CUSTOMER_ID,
  };
}

let tokenCache: { token: string; exp: number } = { token: "", exp: 0 };

async function getToken(clientId: string, clientSecret: string): Promise<string> {
  const now = Date.now();
  if (tokenCache.token && tokenCache.exp > now + 60000) return tokenCache.token;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "client_credentials",
    scope: "eats.deliveries",
  });
  const r = await fetch(AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const d = await r.json().catch(() => ({})) as Record<string, unknown>;
  if (!r.ok || !d.access_token) {
    throw new Error("auth_falhou: " + String(d.error_description || d.error || r.status));
  }
  tokenCache = {
    token: String(d.access_token),
    exp: now + (Number(d.expires_in || 2592000) * 1000),
  };
  return tokenCache.token;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "use POST" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "json_invalido" }, 400);
  }

  const acao = String(body.acao || "");

  // Webhook da Uber (delivery_status / courier_update): POST sem "acao".
  if (!acao && (body.event_type || body.kind || body.event_id || body.resource_href)) {
    console.log("uber-webhook recebido:", JSON.stringify(body).slice(0, 800));
    // TODO: validar assinatura (x-uber-signature) e atualizar public.pedidos pelo delivery id/status.
    return json({ ok: true, received: true });
  }

  const { clientId, clientSecret, customerId } = creds();
  if (!clientId || !clientSecret || !customerId) {
    return json({ ok: false, error: "credenciais_uber_ausentes",
      dica: "Defina a secret UBER_DIRECT_CLIENT_SECRET no Supabase (Edge Functions > Secrets)." });
  }

  try {
    const token = await getToken(clientId, clientSecret);
    const authHeaders = { "Authorization": "Bearer " + token, "Content-Type": "application/json" };

    if (acao === "quote") {
      const r = await fetch(`${API_BASE}/${customerId}/delivery_quotes`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          pickup_address: body.pickup_address,
          dropoff_address: body.dropoff_address,
        }),
      });
      const d = await r.json().catch(() => ({}));
      return json({ ok: r.ok, http: r.status, quote: d });
    }

    if (acao === "create") {
      const r = await fetch(`${API_BASE}/${customerId}/deliveries`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify(body.delivery || {}),
      });
      const d = await r.json().catch(() => ({}));
      return json({ ok: r.ok, http: r.status, delivery: d });
    }

    if (acao === "status") {
      const r = await fetch(`${API_BASE}/${customerId}/deliveries/${String(body.delivery_id || "")}`, {
        headers: authHeaders,
      });
      const d = await r.json().catch(() => ({}));
      return json({ ok: r.ok, http: r.status, delivery: d });
    }

    if (acao === "cancel") {
      const r = await fetch(`${API_BASE}/${customerId}/deliveries/${String(body.delivery_id || "")}/cancel`, {
        method: "POST",
        headers: authHeaders,
      });
      const d = await r.json().catch(() => ({}));
      return json({ ok: r.ok, http: r.status, delivery: d });
    }

    return json({ ok: false, error: "acao_invalida", acoes: ["quote", "create", "status", "cancel"] }, 400);
  } catch (err) {
    return json({ ok: false, error: String((err as Error)?.message ?? err) });
  }
});

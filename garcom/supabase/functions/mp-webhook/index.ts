// Edge Function: mp-webhook
// Recebe webhooks do Mercado Pago e concilia PIX em public.pedidos.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-signature, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function cleanText(value: unknown): string {
  return String(value ?? "").trim();
}

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

function parseMercadoPagoSignature(header: string): { ts: string; v1: string } {
  const parts = header.split(",").map((part) => part.trim());
  const ts = parts.find((part) => part.startsWith("ts="))?.slice(3) || "";
  const v1 = parts.find((part) => part.startsWith("v1="))?.slice(3) || "";
  return { ts, v1 };
}

function normalizeDataIdForSignature(dataId: string): string {
  const id = cleanText(dataId);
  return /^[A-Z0-9]+$/.test(id) ? id.toLowerCase() : id;
}

async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
}

async function verifyMercadoPagoSignature({
  signatureHeader,
  requestId,
  dataId,
  secret,
}: {
  signatureHeader: string;
  requestId: string;
  dataId: string;
  secret: string;
}): Promise<boolean> {
  const { ts, v1 } = parseMercadoPagoSignature(signatureHeader);
  if (!ts || !v1 || !secret) return false;

  const manifest = [
    dataId ? `id:${normalizeDataIdForSignature(dataId)};` : "",
    requestId ? `request-id:${requestId};` : "",
    `ts:${ts};`,
  ].join("");

  const expected = await hmacSha256Hex(secret, manifest);
  return safeEqual(v1, expected);
}

function paymentIdFromPayload(payload: Record<string, unknown>, url: URL): string {
  const data = payload.data && typeof payload.data === "object"
    ? payload.data as Record<string, unknown>
    : {};

  return cleanText(data.id)
    || cleanText(url.searchParams.get("data.id"))
    || cleanText(url.searchParams.get("data_id"))
    || cleanText(url.searchParams.get("id"));
}

function topicFromPayload(payload: Record<string, unknown>, url: URL): string {
  return cleanText(payload.type)
    || cleanText(payload.topic)
    || cleanText(url.searchParams.get("topic"))
    || cleanText(url.searchParams.get("type"));
}

function mapPagamentoStatus(mpStatus: string): "pendente" | "pago" | "estornado" | "expirado" {
  if (mpStatus === "approved") return "pago";
  if (["refunded", "charged_back"].includes(mpStatus)) return "estornado";
  if (["cancelled", "expired"].includes(mpStatus)) return "expirado";
  return "pendente";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "use POST" }), {
      status: 405,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  try {
    const webhookSecret = Deno.env.get("MERCADO_PAGO_WEBHOOK_SECRET") || "";
    if (!webhookSecret) throw new Error("MERCADO_PAGO_WEBHOOK_SECRET nao configurado.");

    const rawBody = await req.text();
    const payload = JSON.parse(rawBody || "{}") as Record<string, unknown>;
    const url = new URL(req.url);
    const paymentId = paymentIdFromPayload(payload, url);
    const requestId = cleanText(req.headers.get("x-request-id"));
    const signatureHeader = cleanText(req.headers.get("x-signature"));

    const valid = await verifyMercadoPagoSignature({
      signatureHeader,
      requestId,
      dataId: paymentId,
      secret: webhookSecret,
    });

    if (!valid) {
      return new Response(JSON.stringify({ error: "assinatura invalida" }), {
        status: 401,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const topic = topicFromPayload(payload, url);
    if (topic && topic !== "payment") {
      return new Response(JSON.stringify({ received: true, ignored: true, topic }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    if (!paymentId) {
      return new Response(JSON.stringify({ received: true, ignored: true, reason: "payment_id ausente" }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const mercadoPagoToken = Deno.env.get("MERCADO_PAGO_ACCESS_TOKEN") || "";
    if (!mercadoPagoToken) throw new Error("MERCADO_PAGO_ACCESS_TOKEN nao configurado.");

    const mpResp = await fetch(
      `https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`,
      { headers: { "Authorization": `Bearer ${mercadoPagoToken}` } },
    );
    const mpData = await mpResp.json().catch(() => ({})) as Record<string, unknown>;
    if (!mpResp.ok) {
      console.error("mp-webhook payment lookup error", mpData);
      return new Response(JSON.stringify({ error: "falha ao consultar pagamento", detalhe: mpData }), {
        status: 502,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const mpStatus = cleanText(mpData.status);
    const pagamentoStatus = mapPagamentoStatus(mpStatus);
    const update: Record<string, unknown> = {
      pagamento_status: pagamentoStatus,
      atualizado_em: new Date().toISOString(),
    };
    if (pagamentoStatus === "pago") {
      update.pago_em = new Date().toISOString();
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data, error } = await supabase
      .from("pedidos")
      .update(update)
      .eq("mp_payment_id", paymentId)
      .select("id, numero_pedido, pagamento_status, pago_em");

    if (error) throw error;

    return new Response(JSON.stringify({
      received: true,
      payment_id: paymentId,
      mercado_pago_status: mpStatus,
      pagamento_status: pagamentoStatus,
      pedidos_atualizados: data?.length ?? 0,
    }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("mp-webhook error:", err);
    return new Response(JSON.stringify({ error: String((err as Error)?.message ?? err) }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});

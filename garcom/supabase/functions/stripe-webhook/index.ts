// Edge Function: stripe-webhook
// Recebe eventos da Stripe e sincroniza o status do pagamento com public.pedidos.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, stripe-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

function parseStripeSignature(header: string): { timestamp: string; signatures: string[] } {
  const parts = header.split(",").map((part) => part.trim());
  const timestamp = parts.find((part) => part.startsWith("t="))?.slice(2) || "";
  const signatures = parts
    .filter((part) => part.startsWith("v1="))
    .map((part) => part.slice(3))
    .filter(Boolean);
  return { timestamp, signatures };
}

async function verifyStripeSignature(rawBody: string, signatureHeader: string, secret: string): Promise<boolean> {
  const { timestamp, signatures } = parseStripeSignature(signatureHeader);
  if (!timestamp || signatures.length === 0) return false;

  const signedPayload = `${timestamp}.${rawBody}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedPayload)));
  return signatures.some((sig) => safeEqual(sig, expected));
}

function paymentMethodFromIntent(intent: Record<string, unknown>): string | null {
  const latestCharge = intent.latest_charge;
  if (latestCharge && typeof latestCharge === "object") {
    const charge = latestCharge as Record<string, unknown>;
    const details = charge.payment_method_details;
    if (details && typeof details === "object") {
      return String((details as Record<string, unknown>).type || "").trim() || null;
    }
  }
  return String(intent.payment_method_types ?? "").trim() || null;
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
    const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET") || "";
    if (!webhookSecret) throw new Error("STRIPE_WEBHOOK_SECRET nao configurado.");

    const rawBody = await req.text();
    const signature = req.headers.get("stripe-signature") || "";
    const valid = await verifyStripeSignature(rawBody, signature, webhookSecret);
    if (!valid) {
      return new Response(JSON.stringify({ error: "assinatura invalida" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const event = JSON.parse(rawBody) as Record<string, unknown>;
    const type = String(event.type || "");
    const object = (event.data as Record<string, unknown> | undefined)?.object as Record<string, unknown> | undefined;
    if (!object || !String(object.id || "").startsWith("pi_")) {
      return new Response(JSON.stringify({ received: true, ignored: true }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const paymentIntentId = String(object.id);
    const status = String(object.status || "");
    const update: Record<string, unknown> = {
      stripe_payment_status: status,
      stripe_payment_method: paymentMethodFromIntent(object),
      atualizado_em: new Date().toISOString(),
    };

    if (type === "payment_intent.succeeded" || status === "succeeded") {
      update.pago_em = new Date().toISOString();
    }

    const { error } = await supabase
      .from("pedidos")
      .update(update)
      .eq("stripe_payment_intent_id", paymentIntentId);

    if (error) throw error;

    return new Response(JSON.stringify({ received: true }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("stripe-webhook error:", err);
    return new Response(JSON.stringify({ error: String((err as Error)?.message ?? err) }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});

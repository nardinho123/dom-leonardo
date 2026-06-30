// Edge Function: mp-connect-callback
// Recebe o 'code' do Mercado Pago, troca por credenciais e salva no banco.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function cleanText(value: unknown): string {
  return String(value ?? "").trim();
}

async function exchangeCodeForToken(code: string, redirectUri: string) {
  const appSecret = Deno.env.get("MERCADO_PAGO_APP_SECRET");
  if (!appSecret) {
    throw new Error("A variável de ambiente MERCADO_PAGO_APP_SECRET não está configurada.");
  }

  const resp = await fetch("https://api.mercadopago.com/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_secret: appSecret,
      code: code,
      redirect_uri: redirectUri,
    }),
  });

  const data = await resp.json();
  if (!resp.ok) {
    console.error("MP Token Exchange Error:", data);
    throw new Error(data.message || "Falha ao obter credenciais do Mercado Pago.");
  }
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  try {
    const url = new URL(req.url);
    const code = cleanText(url.searchParams.get("code"));
    const redirectUri = cleanText(url.searchParams.get("state"));

    if (!code) throw new Error("Código de autorização ('code') não encontrado.");
    if (!redirectUri) throw new Error("URI de redirecionamento ('state') não encontrado.");

    const tokenData = await exchangeCodeForToken(code, redirectUri);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const expiresAt = new Date(Date.now() + (tokenData.expires_in * 1000)).toISOString();

    const { error: dbError } = await supabase.from("mercado_pago_credentials").insert({
      access_token: tokenData.access_token,
      public_key: tokenData.public_key,
      refresh_token: tokenData.refresh_token,
      expires_at: expiresAt,
      mp_user_id: tokenData.user_id,
      is_active: true,
    });

    if (dbError) throw dbError;

    return new Response("<h1>Conta Mercado Pago conectada com sucesso!</h1><p>Pode fechar esta janela.</p>", {
      headers: { "Content-Type": "text/html" },
    });
  } catch (err) {
    console.error("MP Callback Error:", err);
    return new Response(`<h1>Erro ao conectar conta</h1><p>${(err as Error).message}</p>`, {
      status: 500,
      headers: { "Content-Type": "text/html" },
    });
  }
});
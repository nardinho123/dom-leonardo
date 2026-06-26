// Edge Function: admin-pedidos
// Acoes administrativas do gestor de pedidos. Requer JWT valido.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const STATUS_COZINHA = new Set(["novo", "em_preparo", "pronto", "saiu_entrega", "entregue", "cancelado"]);

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function cleanText(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizePhone(value: unknown): string {
  return cleanText(value).replace(/\D/g, "");
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function groupByPedidoId(items: Array<Record<string, unknown>>) {
  return items.reduce((acc, item) => {
    const pedidoId = cleanText(item.pedido_id);
    if (!pedidoId) return acc;
    if (!acc[pedidoId]) acc[pedidoId] = [];
    acc[pedidoId].push(item);
    return acc;
  }, {} as Record<string, Array<Record<string, unknown>>>);
}

function countByCustomer(rows: Array<Record<string, unknown>>) {
  const byClienteId: Record<string, number> = {};
  const byPhone: Record<string, number> = {};

  for (const row of rows) {
    const clienteId = cleanText(row.cliente_id);
    const phone = normalizePhone(row.cliente_whatsapp);
    if (clienteId) byClienteId[clienteId] = (byClienteId[clienteId] || 0) + 1;
    if (phone) byPhone[phone] = (byPhone[phone] || 0) + 1;
  }

  return { byClienteId, byPhone };
}

// ===== Uber Direct (motoboy) =====
const RESTAURANTE_NOME = "Dom Leonardo";
const RESTAURANTE_PHONE_FALLBACK = "+5541999999999";
const RESTAURANTE_ADDRESS = JSON.stringify({
  street_address: ["Rua Francisco Dallaribera, 1811"],
  city: "Curitiba",
  state: "PR",
  zip_code: "82410-030",
  country: "BR",
});

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toE164(value: unknown): string {
  const d = normalizePhone(value);
  if (!d) return "";
  return d.startsWith("55") ? `+${d}` : `+55${d}`;
}

function uberDropoffAddress(snapshot: Record<string, unknown> | null): string {
  const s = (snapshot || {}) as Record<string, unknown>;
  const rua = cleanText(s.logradouro);
  const numero = cleanText(s.numero);
  const linha = [rua, numero].filter(Boolean).join(", ");
  return JSON.stringify({
    street_address: [linha || rua || "Endereco"],
    city: cleanText(s.cidade) || "Curitiba",
    state: cleanText(s.uf) || "PR",
    zip_code: cleanText(s.cep),
    country: "BR",
  });
}

async function callUber(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/uber-entrega`;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${key}`,
      "apikey": key,
    },
    body: JSON.stringify(payload),
  });
  return await r.json().catch(() => ({})) as Record<string, unknown>;
}

async function cotarMotoboy(supabase: ReturnType<typeof createClient>, pedidoId: string) {
  const { data: pedido, error } = await supabase
    .from("pedidos")
    .select("id, endereco_snapshot")
    .eq("id", pedidoId)
    .single();
  if (error) throw error;

  const resp = await callUber({
    acao: "quote",
    pickup_address: RESTAURANTE_ADDRESS,
    dropoff_address: uberDropoffAddress(pedido.endereco_snapshot as Record<string, unknown>),
  });
  if (!resp.ok) return { ok: false, erro: resp.quote ?? resp.error ?? resp };

  const q = (resp.quote || {}) as Record<string, unknown>;
  return {
    ok: true,
    fee: num(q.fee) ? num(q.fee) / 100 : 0,
    eta_min: num(q.duration) || num(q.dropoff_eta),
    quote: q,
  };
}

async function chamarMotoboy(supabase: ReturnType<typeof createClient>, pedidoId: string) {
  const { data: pedido, error } = await supabase
    .from("pedidos")
    .select("*")
    .eq("id", pedidoId)
    .single();
  if (error) throw error;
  if (!pedido) throw new Error("Pedido nao encontrado.");
  if (pedido.pagamento_status !== "pago") throw new Error("So e possivel chamar motoboy para pedido pago.");
  if (cleanText(pedido.uber_delivery_id)) throw new Error("Motoboy ja foi chamado para este pedido.");

  const { data: itens } = await supabase
    .from("pedido_itens")
    .select("prato_nome, quantidade")
    .eq("pedido_id", pedidoId);
  const manifest = (itens || []).map((i: Record<string, unknown>) => ({
    name: cleanText(i.prato_nome) || "Item",
    quantity: Math.max(1, Math.floor(num(i.quantidade) || 1)),
    size: "small",
  }));
  if (manifest.length === 0) {
    manifest.push({ name: `Pedido ${pedido.numero_pedido}`, quantity: 1, size: "small" });
  }

  let pickupPhone = RESTAURANTE_PHONE_FALLBACK;
  const { data: cfg } = await supabase.from("configuracoes").select("whatsapp_pedidos").eq("id", 1).single();
  const cfgPhone = toE164(cfg?.whatsapp_pedidos);
  if (cfgPhone) pickupPhone = cfgPhone;

  const snapshot = (pedido.endereco_snapshot || {}) as Record<string, unknown>;
  const notas = [cleanText(snapshot.complemento), cleanText(snapshot.ponto_referencia)].filter(Boolean).join(" - ");

  const delivery = {
    pickup_name: RESTAURANTE_NOME,
    pickup_address: RESTAURANTE_ADDRESS,
    pickup_phone_number: pickupPhone,
    dropoff_name: cleanText(pedido.cliente_nome) || "Cliente",
    dropoff_address: uberDropoffAddress(snapshot),
    dropoff_phone_number: toE164(pedido.cliente_whatsapp) || pickupPhone,
    dropoff_notes: notas || undefined,
    manifest_items: manifest,
  };

  const resp = await callUber({ acao: "create", delivery });
  if (!resp.ok) return { ok: false, erro: resp.delivery ?? resp.error ?? resp };

  const d = (resp.delivery || {}) as Record<string, unknown>;
  const { data: updated, error: upErr } = await supabase
    .from("pedidos")
    .update({
      uber_delivery_id: cleanText(d.id),
      uber_status: cleanText(d.status) || "pending",
      uber_tracking_url: cleanText(d.tracking_url),
      uber_fee: num(d.fee) ? num(d.fee) / 100 : null,
      uber_eta_min: num(d.duration) || null,
      atualizado_em: new Date().toISOString(),
    })
    .eq("id", pedidoId)
    .select("*")
    .single();
  if (upErr) throw upErr;
  return { ok: true, pedido: updated, delivery: d };
}

async function statusMotoboy(supabase: ReturnType<typeof createClient>, pedidoId: string) {
  const { data: pedido, error } = await supabase
    .from("pedidos")
    .select("id, uber_delivery_id, status")
    .eq("id", pedidoId)
    .single();
  if (error) throw error;
  if (!cleanText(pedido?.uber_delivery_id)) throw new Error("Sem entrega Uber para este pedido.");

  const resp = await callUber({ acao: "status", delivery_id: cleanText(pedido.uber_delivery_id) });
  if (!resp.ok) return { ok: false, erro: resp.delivery ?? resp.error ?? resp };

  const d = (resp.delivery || {}) as Record<string, unknown>;
  const uberStatus = cleanText(d.status);

  await supabase
    .from("pedidos")
    .update({
      uber_status: uberStatus,
      uber_tracking_url: cleanText(d.tracking_url) || undefined,
      atualizado_em: new Date().toISOString(),
    })
    .eq("id", pedidoId);

  // Reflete no status da cozinha (best-effort).
  if (uberStatus === "delivered" && pedido.status !== "entregue") {
    await supabase.rpc("atualizar_status_pedido", { p_pedido_id: pedidoId, p_novo_status: "entregue", p_motivo: null });
  } else if (
    ["pickup_complete", "dropoff", "en_route_to_dropoff", "courier_en_route_to_dropoff"].includes(uberStatus)
    && !["saiu_entrega", "entregue"].includes(cleanText(pedido.status))
  ) {
    await supabase.rpc("atualizar_status_pedido", { p_pedido_id: pedidoId, p_novo_status: "saiu_entrega", p_motivo: null });
  }

  const { data: fresh } = await supabase.from("pedidos").select("*").eq("id", pedidoId).single();
  return { ok: true, uber_status: uberStatus, pedido: fresh };
}

async function cancelarMotoboy(supabase: ReturnType<typeof createClient>, pedidoId: string) {
  const { data: pedido, error } = await supabase
    .from("pedidos")
    .select("id, uber_delivery_id")
    .eq("id", pedidoId)
    .single();
  if (error) throw error;
  if (!cleanText(pedido?.uber_delivery_id)) throw new Error("Sem entrega Uber para cancelar.");

  const resp = await callUber({ acao: "cancel", delivery_id: cleanText(pedido.uber_delivery_id) });
  if (!resp.ok) return { ok: false, erro: resp.delivery ?? resp.error ?? resp };

  const { data: updated } = await supabase
    .from("pedidos")
    .update({ uber_status: "canceled", atualizado_em: new Date().toISOString() })
    .eq("id", pedidoId)
    .select("*")
    .single();
  return { ok: true, pedido: updated };
}

async function assertAuthenticated(req: Request, supabase: ReturnType<typeof createClient>) {
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) throw new Error("nao autenticado");

  const token = authHeader.replace("Bearer ", "").trim();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) throw new Error("nao autenticado");
  return data.user;
}

async function listarPedidos(supabase: ReturnType<typeof createClient>) {
  const { data: pedidos, error } = await supabase
    .from("pedidos")
    .select("*")
    .order("criado_em", { ascending: false })
    .limit(150);
  if (error) throw error;

  const ids = (pedidos || []).map((pedido: Record<string, unknown>) => cleanText(pedido.id)).filter(Boolean);
  let itens: Array<Record<string, unknown>> = [];
  if (ids.length) {
    const { data, error: itensError } = await supabase
      .from("pedido_itens")
      .select("*")
      .in("pedido_id", ids)
      .order("ordem", { ascending: true });
    if (itensError) throw itensError;
    itens = data || [];
  }

  const { data: historico, error: historicoError } = await supabase
    .from("pedidos")
    .select("id, cliente_id, cliente_whatsapp")
    .order("criado_em", { ascending: false })
    .limit(3000);
  if (historicoError) throw historicoError;

  const itensByPedido = groupByPedidoId(itens);
  const counts = countByCustomer(historico || []);

  return (pedidos || []).map((pedido: Record<string, unknown>) => {
    const clienteId = cleanText(pedido.cliente_id);
    const phone = normalizePhone(pedido.cliente_whatsapp);
    return {
      ...pedido,
      itens: itensByPedido[cleanText(pedido.id)] || [],
      cliente_total_pedidos: clienteId
        ? (counts.byClienteId[clienteId] || 1)
        : (phone ? (counts.byPhone[phone] || 1) : 1),
    };
  });
}

async function aceitarPedido(supabase: ReturnType<typeof createClient>, pedidoId: string) {
  const { data: pedido, error } = await supabase
    .from("pedidos")
    .select("id, numero_pedido, pagamento_status, aceite_status, status")
    .eq("id", pedidoId)
    .single();
  if (error) throw error;
  if (!pedido) throw new Error("Pedido nao encontrado.");
  if (pedido.pagamento_status !== "pago") throw new Error("So e possivel aceitar pedido pago.");
  if (pedido.aceite_status === "recusado") throw new Error("Pedido ja foi recusado.");

  const { error: rpcError } = await supabase.rpc("atualizar_status_pedido", {
    p_pedido_id: pedidoId,
    p_novo_status: "em_preparo",
    p_motivo: null,
  });
  if (rpcError) throw rpcError;

  const { data, error: updateError } = await supabase
    .from("pedidos")
    .update({
      aceite_status: "aceito",
      atualizado_em: new Date().toISOString(),
    })
    .eq("id", pedidoId)
    .select("*")
    .single();
  if (updateError) throw updateError;

  return data;
}

async function recusarPedido(supabase: ReturnType<typeof createClient>, pedidoId: string, motivo: string) {
  const { data: pedido, error } = await supabase
    .from("pedidos")
    .select("id, numero_pedido, mp_payment_id, pagamento_status, aceite_status, status")
    .eq("id", pedidoId)
    .single();
  if (error) throw error;
  if (!pedido) throw new Error("Pedido nao encontrado.");
  if (pedido.pagamento_status !== "pago") throw new Error("So e possivel recusar com estorno quando o pedido ja esta pago.");
  if (!pedido.mp_payment_id) throw new Error("Pedido pago sem mp_payment_id. Estorno automatico nao pode ser feito.");

  const mercadoPagoToken = Deno.env.get("MERCADO_PAGO_ACCESS_TOKEN") || "";
  if (!mercadoPagoToken) throw new Error("MERCADO_PAGO_ACCESS_TOKEN nao configurado.");

  const refundResp = await fetch(
    `https://api.mercadopago.com/v1/payments/${encodeURIComponent(cleanText(pedido.mp_payment_id))}/refunds`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${mercadoPagoToken}`,
        "X-Idempotency-Key": `pedido-${pedidoId}-refund-total`,
      },
    },
  );
  const refundData = await refundResp.json().catch(() => ({}));
  if (!refundResp.ok) {
    console.error("admin-pedidos refund error", refundResp.status, refundData);
    return {
      ok: false,
      status: refundResp.status,
      erro_estorno: refundData,
    };
  }

  const { error: rpcError } = await supabase.rpc("atualizar_status_pedido", {
    p_pedido_id: pedidoId,
    p_novo_status: "cancelado",
    p_motivo: motivo || "Pedido recusado pelo restaurante",
  });
  if (rpcError) throw rpcError;

  const { data, error: updateError } = await supabase
    .from("pedidos")
    .update({
      aceite_status: "recusado",
      pagamento_status: "estornado",
      atualizado_em: new Date().toISOString(),
    })
    .eq("id", pedidoId)
    .select("*")
    .single();
  if (updateError) throw updateError;

  return {
    ok: true,
    pedido: data,
    estorno: refundData,
  };
}

async function alterarStatus(supabase: ReturnType<typeof createClient>, pedidoId: string, status: string) {
  if (!STATUS_COZINHA.has(status)) throw new Error("Status invalido.");

  const { error } = await supabase.rpc("atualizar_status_pedido", {
    p_pedido_id: pedidoId,
    p_novo_status: status,
    p_motivo: null,
  });
  if (error) throw error;

  const { data, error: fetchError } = await supabase
    .from("pedidos")
    .select("*")
    .eq("id", pedidoId)
    .single();
  if (fetchError) throw fetchError;
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "use POST" }, 405);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    await assertAuthenticated(req, supabase);

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const acao = cleanText(body.acao || "listar");
    const pedidoId = cleanText(body.pedido_id);

    if (acao !== "listar" && !isUuid(pedidoId)) {
      return json({ error: "pedido_id invalido" }, 400);
    }

    if (acao === "listar") {
      const pedidos = await listarPedidos(supabase);
      return json({ pedidos });
    }

    if (acao === "aceitar") {
      const pedido = await aceitarPedido(supabase, pedidoId);
      return json({ ok: true, pedido });
    }

    if (acao === "recusar") {
      const result = await recusarPedido(supabase, pedidoId, cleanText(body.motivo));
      if (!result.ok) return json({ error: "Falha ao estornar no Mercado Pago.", detalhe: result.erro_estorno }, 502);
      return json(result);
    }

    if (acao === "alterar_status") {
      const pedido = await alterarStatus(supabase, pedidoId, cleanText(body.status));
      return json({ ok: true, pedido });
    }

    if (acao === "cotar_motoboy") {
      const result = await cotarMotoboy(supabase, pedidoId);
      if (!result.ok) return json({ error: "Falha ao cotar entrega na Uber.", detalhe: result.erro }, 502);
      return json(result);
    }

    if (acao === "chamar_motoboy") {
      const result = await chamarMotoboy(supabase, pedidoId);
      if (!result.ok) return json({ error: "Falha ao chamar motoboy na Uber.", detalhe: result.erro }, 502);
      return json(result);
    }

    if (acao === "status_motoboy") {
      const result = await statusMotoboy(supabase, pedidoId);
      if (!result.ok) return json({ error: "Falha ao consultar entrega na Uber.", detalhe: result.erro }, 502);
      return json(result);
    }

    if (acao === "cancelar_motoboy") {
      const result = await cancelarMotoboy(supabase, pedidoId);
      if (!result.ok) return json({ error: "Falha ao cancelar entrega na Uber.", detalhe: result.erro }, 502);
      return json(result);
    }

    return json({ error: "acao desconhecida" }, 400);
  } catch (err) {
    if (String((err as Error)?.message ?? err) === "nao autenticado") {
      return json({ error: "nao autenticado" }, 401);
    }
    console.error("admin-pedidos error:", err);
    return json({ error: String((err as Error)?.message ?? err) }, 500);
  }
});

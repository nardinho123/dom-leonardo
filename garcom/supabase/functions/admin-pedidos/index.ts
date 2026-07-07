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

  const paymentId = encodeURIComponent(cleanText(pedido.mp_payment_id));

  const refundResp = await fetch(
    `https://api.mercadopago.com/v1/payments/${paymentId}/refunds`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${mercadoPagoToken}`,
        "X-Idempotency-Key": `pedido-${pedidoId}-refund-total`,
      },
    },
  );
  let refundData = await refundResp.json().catch(() => ({}));
  if (!refundResp.ok) {
    console.error("admin-pedidos refund error", refundResp.status, refundData);
    // Pedidos antigos: o pagamento pode ja estar estornado/cancelado/expirado no MP.
    // Nesses casos nao ha o que estornar - segue a recusa normalmente.
    const statusResp = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { "Authorization": `Bearer ${mercadoPagoToken}` },
    });
    const payData = await statusResp.json().catch(() => ({})) as Record<string, unknown>;
    const payStatus = String(payData?.status ?? "");
    const jaResolvido = ["refunded", "cancelled", "charged_back", "rejected"].includes(payStatus);
    if (!jaResolvido) {
      const mpMsg = String((refundData as Record<string, unknown>)?.message ?? "") || `HTTP ${refundResp.status}`;
      return {
        ok: false,
        status: refundResp.status,
        erro_estorno: { mensagem_mp: mpMsg, pagamento_status_mp: payStatus || "desconhecido", detalhe: refundData },
      };
    }
    console.warn(`admin-pedidos: pagamento ${paymentId} ja estava '${payStatus}' no MP - recusando sem novo estorno`);
    refundData = { ja_resolvido: true, pagamento_status_mp: payStatus };
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

    return json({ error: "acao desconhecida" }, 400);
  } catch (err) {
    if (String((err as Error)?.message ?? err) === "nao autenticado") {
      return json({ error: "nao autenticado" }, 401);
    }
    console.error("admin-pedidos error:", err);
    return json({ error: String((err as Error)?.message ?? err) }, 500);
  }
});

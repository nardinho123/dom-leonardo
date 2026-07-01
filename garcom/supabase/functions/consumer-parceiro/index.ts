// Edge Function: consumer-parceiro
// "API do Parceiro" que o sistema Consumer (PDV homologado iFood) CONSOME via polling.
// O Consumer puxa os pedidos pagos do nosso cardapio, mostra na Fila de Pedidos com
// endereco/valor preenchidos, e o operador despacha o motoboy iFood (Entrega Facil) - sem digitar.
//
// O Consumer chama 4 URLs (configuradas no painel dele -> APPS > Pedidos Online > API do parceiro):
//   GET  .../consumer-parceiro/polling           -> eventos de pedidos novos (PLACED)
//   GET  .../consumer-parceiro/detalhes/{orderId}-> detalhes completos do pedido (schema Consumer)
//   POST .../consumer-parceiro/status/{orderId}  -> Consumer informa mudanca de status
//   POST .../consumer-parceiro/envio/{orderId}   -> Consumer envia detalhes (pedidos originados nele) [stub Fase 1]
//
// Auth: token do parceiro (CONSUMER_PARTNER_TOKEN). O Consumer manda esse token; validamos
// em Authorization (Bearer ou cru), header "token"/"x-token" ou query ?token=. Fase 1 e LENIENTE
// (loga e deixa passar) ate confirmarmos como o Consumer envia; depois CONSUMER_AUTH_STRICT=1 trava.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, token, x-token",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const MERCHANT_ID = Deno.env.get("CONSUMER_MERCHANT_ID") || "dom-leonardo";
const MERCHANT_NOME = "Dom Leonardo";
const PRODUTO_PADRAO = Deno.env.get("CONSUMER_PRODUTO_PADRAO") || "DOMLEO"; // codigo PDV do produto generico no Consumer

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function cleanText(value: unknown): string {
  return String(value ?? "").trim();
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function money(value: unknown): number {
  return Math.round(num(value) * 100) / 100;
}

function sb() {
  return createClient(
    Deno.env.get("SUPABASE_URL") || "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

// ===== Auth do parceiro =====
function extractToken(req: Request, url: URL, body: Record<string, unknown>): string {
  const auth = req.headers.get("authorization") || "";
  if (auth) {
    const bearer = auth.replace(/^Bearer\s+/i, "").trim();
    if (bearer) return bearer;
  }
  return cleanText(req.headers.get("token"))
    || cleanText(req.headers.get("x-token"))
    || cleanText(url.searchParams.get("token"))
    || cleanText(body.token);
}

function authOk(req: Request, url: URL, body: Record<string, unknown>): boolean {
  const expected = Deno.env.get("CONSUMER_PARTNER_TOKEN") || "";
  if (!expected) return true; // sem token configurado: nao bloqueia
  const got = extractToken(req, url, body);
  if (got && got === expected) return true;
  const strict = Boolean(Deno.env.get("CONSUMER_AUTH_STRICT"));
  if (!strict) {
    console.warn("consumer-parceiro AUTH lenient: token nao confere (got len=" + got.length + ")");
    return true; // Fase 1: deixa passar pra observar o formato
  }
  return false;
}

// ===== Mapeamento pedido -> schema Consumer =====
function enderecoConsumer(snapshot: Record<string, unknown>) {
  const streetName = cleanText(snapshot.logradouro) || "Endereco";
  const streetNumber = cleanText(snapshot.numero) || "S/N";
  const neighborhood = cleanText(snapshot.bairro);
  const city = cleanText(snapshot.cidade) || "Curitiba";
  const state = cleanText(snapshot.uf) || "PR";
  const postalCode = cleanText(snapshot.cep).replace(/\D/g, "");
  const complement = cleanText(snapshot.complemento);
  const reference = cleanText(snapshot.ponto_referencia);
  const lat = num(snapshot.lat) || num(snapshot.latitude);
  const lng = num(snapshot.lng) || num(snapshot.longitude);
  const formatted = [
    [streetName, streetNumber].filter(Boolean).join(", "),
    neighborhood, city, state,
  ].filter(Boolean).join(" - ");

  const endereco: Record<string, unknown> = {
    country: "BR",
    state,
    city,
    postalCode,
    streetName,
    streetNumber,
    neighborhood,
    complement,
    reference,
    formattedAddress: formatted,
  };
  // So manda coordenada se for REAL; senao deixa o Consumer geocodificar pelo endereco (chave Maps).
  if (lat && lng) endereco.coordinates = { latitude: lat, longitude: lng };
  return endereco;
}

function resumoItens(itens: Array<Record<string, unknown>>): string {
  return (itens || [])
    .map((i) => {
      const qtd = Math.max(1, Math.floor(num(i.quantidade) || 1));
      const nome = cleanText(i.prato_nome) || "Item";
      const tam = cleanText(i.tamanho_nome);
      return `${qtd}x ${nome}${tam ? ` (${tam})` : ""}`;
    })
    .filter(Boolean)
    .join(", ");
}

function resumoOpcionais(snapshot: unknown): string {
  if (!Array.isArray(snapshot)) return "";
  return snapshot
    .map((op) => {
      const row = op as Record<string, unknown>;
      const qtd = Math.max(1, Math.floor(num(row.qtd) || num(row.quantidade) || 1));
      const nome = cleanText(row.nome) || cleanText(row.opcional_nome);
      return nome ? `${qtd}x ${nome}` : "";
    })
    .filter(Boolean)
    .join(", ");
}

function normalizeKey(value: unknown): string {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

// Extrai o CEP (postal_code) dos address_components do Google.
function extrairCep(results: Array<Record<string, unknown>>): string {
  for (const r of results) {
    const comps = (r.address_components as Array<Record<string, unknown>>) || [];
    for (const c of comps) {
      const types = (c.types as string[]) || [];
      if (types.includes("postal_code")) {
        return cleanText(c.long_name).replace(/\D/g, "");
      }
    }
  }
  return "";
}

// Geocodifica (forward pelo endereco OU reverse por lat/lng) -> coordenada + CEP (best-effort).
// O iFood Sob Demanda exige CEP; o cardapio guarda a coordenada mas nem sempre o CEP.
async function geocodeInfo(opts: { query?: string; lat?: number; lng?: number }): Promise<{ latitude?: number; longitude?: number; postalCode?: string } | null> {
  const key = Deno.env.get("MAPS_API_KEY_CONSUMER") || Deno.env.get("DOM_LEONARDO_MAPS_SERVER") || "";
  if (!key) return null;
  let url = "";
  if (opts.lat && opts.lng) {
    url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${opts.lat},${opts.lng}&region=br&key=${key}`;
  } else if (opts.query) {
    url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(opts.query)}&region=br&key=${key}`;
  } else {
    return null;
  }
  try {
    const r = await fetch(url);
    const d = await r.json().catch(() => ({})) as Record<string, unknown>;
    const results = (d.results as Array<Record<string, unknown>>) || [];
    const out: { latitude?: number; longitude?: number; postalCode?: string } = {};
    const cep = extrairCep(results);
    if (cep) out.postalCode = cep;
    const geometry = results[0]?.geometry as Record<string, unknown> | undefined;
    const loc = geometry?.location as Record<string, unknown> | undefined;
    const lat = Number(loc?.lat);
    const lng = Number(loc?.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)) {
      out.latitude = lat;
      out.longitude = lng;
    }
    return Object.keys(out).length ? out : null;
  } catch (_err) { /* best-effort */ }
  return null;
}

async function montarDetalhes(supabase: ReturnType<typeof createClient>, pedido: Record<string, unknown>) {
  const { data: itens } = await supabase
    .from("pedido_itens")
    .select("*")
    .eq("pedido_id", pedido.id)
    .order("ordem", { ascending: true });

  const itensPedido = Array.isArray(itens) ? itens as Array<Record<string, unknown>> : [];
  const codigosPdv = new Map<string, string>();
  const codigosPdvPorNome = new Map<string, string>();
  const fotosPorId = new Map<string, string>();
  const fotosPorNome = new Map<string, string>();
  if (itensPedido.length) {
    const { data: pratos } = await supabase
      .from("pratos")
      .select("id,nome,codigo_pdv,foto_url");
    for (const prato of pratos ?? []) {
      const p = prato as Record<string, unknown>;
      const id = cleanText(p.id);
      const codigo = cleanText(p.codigo_pdv);
      const foto = cleanText(p.foto_url);
      const nomeKey = normalizeKey(p.nome);
      if (id && codigo) codigosPdv.set(id, codigo);
      if (nomeKey && codigo) codigosPdvPorNome.set(nomeKey, codigo);
      if (id && foto) fotosPorId.set(id, foto);
      if (nomeKey && foto) fotosPorNome.set(nomeKey, foto);
    }
  }

  const snapshot = (pedido.endereco_snapshot || {}) as Record<string, unknown>;
  const total = money(pedido.total);
  const taxa = money(pedido.taxa_entrega);
  const subTotal = money(total - taxa);
  const criado = cleanText(pedido.criado_em) || new Date().toISOString();
  const numero = cleanText(pedido.numero_pedido) || cleanText(pedido.id).slice(0, 8);
  const obs = resumoItens(itensPedido) || `Pedido ${numero}`;

  const items = itensPedido.length
    ? itensPedido.map((pedidoItem, index) => {
      const qtd = Math.max(1, Math.floor(num(pedidoItem.quantidade) || 1));
      const unitPrice = money(pedidoItem.preco_unitario);
      const totalPrice = money(pedidoItem.preco_total || unitPrice * qtd);
      const pratoId = cleanText(pedidoItem.prato_id);
      const tamanho = cleanText(pedidoItem.tamanho_nome);
      const observacoes = cleanText(pedidoItem.observacoes);
      const opcionais = resumoOpcionais(pedidoItem.opcionais_snapshot);
      const itemObs = [
        tamanho ? `Tamanho: ${tamanho}` : "",
        opcionais ? `Adicionais: ${opcionais}` : "",
        observacoes ? `Obs: ${observacoes}` : "",
      ].filter(Boolean).join(" | ");

      return {
        id: cleanText(pedidoItem.id) || `${cleanText(pedido.id)}-${index + 1}`,
        uniqueId: cleanText(pedidoItem.id) || `${cleanText(pedido.id)}-${index + 1}`,
        externalCode: codigosPdv.get(pratoId) || codigosPdvPorNome.get(normalizeKey(pedidoItem.prato_nome)) || PRODUTO_PADRAO,
        name: cleanText(pedidoItem.prato_nome) || `Pedido Dom Leonardo #${numero}`,
        quantity: qtd,
        unit: "UN",
        ean: null,
        unitPrice,
        price: unitPrice,
        totalPrice,
        optionsPrice: 0,
        addition: 0,
        observations: itemObs || "",
        imageUrl: fotosPorId.get(pratoId) || fotosPorNome.get(normalizeKey(pedidoItem.prato_nome)) || "",
        options: [],
        scalePrices: null,
        index: index + 1,
        type: "DEFAULT",
      };
    })
    : [{
      id: cleanText(pedido.id),
      uniqueId: cleanText(pedido.id),
      externalCode: PRODUTO_PADRAO,
      name: `Pedido Dom Leonardo #${numero}`,
      quantity: 1,
      unit: "UN",
      ean: null,
      unitPrice: subTotal,
      price: subTotal,
      totalPrice: subTotal,
      optionsPrice: 0,
      addition: 0,
      observations: obs,
      imageUrl: "",
      options: [],
      scalePrices: null,
      index: 1,
      type: "DEFAULT",
    }];

  const agora = Date.now();
  const previsaoEntrega = new Date(agora + 45 * 60 * 1000).toISOString();
  const localizerExp = new Date(agora + 2 * 60 * 60 * 1000).toISOString();
  const localizerCode = cleanText(pedido.cliente_whatsapp).replace(/\D/g, "").slice(-8) || numero.padStart(8, "0");

  // Endereco com coordenada REAL + CEP (o iFood Sob Demanda EXIGE CEP; o cardapio nem sempre salva).
  const endereco = enderecoConsumer(snapshot) as Record<string, unknown>;
  const coordAtual = endereco.coordinates as { latitude: number; longitude: number } | undefined;
  const temCep = !!cleanText(endereco.postalCode);
  if (!coordAtual || !temCep) {
    // Se ja tem coordenada, reverse-geocode (mais preciso pro CEP); senao forward pelo endereco.
    const geo = coordAtual
      ? await geocodeInfo({ lat: coordAtual.latitude, lng: coordAtual.longitude })
      : await geocodeInfo({ query: String(endereco.formattedAddress || "") });
    if (geo) {
      if (!coordAtual && geo.latitude && geo.longitude) {
        endereco.coordinates = { latitude: geo.latitude, longitude: geo.longitude };
      }
      if (!temCep && geo.postalCode) endereco.postalCode = geo.postalCode;
    }
  }

  return {
    item: {
      id: cleanText(pedido.id),
      displayId: numero,
      orderType: "DELIVERY",
      salesChannel: "PARTNER",
      category: "FOOD",
      orderTiming: "IMMEDIATE",
      createdAt: criado,
      preparationStartDateTime: criado,
      merchant: { id: MERCHANT_ID, name: MERCHANT_NOME },
      picking: { picker: "DEFAULT", replacementOptions: null },
      total: {
        subTotal,
        deliveryFee: taxa,
        orderAmount: total,
        benefits: 0,
        additionalFees: 0,
      },
      payments: {
        methods: [{
          method: "PIX",
          type: "ONLINE",
          currency: "BRL",
          value: total,
          prepaid: true,
          cash: null,
          card: { brand: "PIX" },
          wallet: null,
          transaction: { authorizationCode: cleanText(pedido.mp_payment_id) || "PIX", acquirerDocument: "" },
        }],
        pending: 0,
        prepaid: total,
      },
      customer: {
        id: cleanText(pedido.cliente_id) || cleanText(pedido.id),
        name: cleanText(pedido.cliente_nome) || "Cliente Dom Leonardo",
        documentType: null,
        documentNumber: null,
        ordersCountOnMerchant: 0,
        segmentation: "Cliente",
        phone: {
          number: cleanText(pedido.cliente_whatsapp) || "",
          localizer: localizerCode,
          localizerExpiration: localizerExp,
        },
      },
      delivery: {
        mode: "DEFAULT",
        deliveredBy: "Partner",
        description: "Padrão",
        pickupCode: numero,
        deliveryDateTime: previsaoEntrega,
        deliveryAddress: endereco,
        observations: cleanText(snapshot.complemento) || "",
      },
      items,
      benefits: [],
      additionalFees: [],
      extraInfo: obs,
      schedule: null,
      indoor: null,
      dineIn: null,
      takeout: null,
      additionalInfometadata: null,
      isTest: false,
      error: null,
    },
    statusCode: 0,
    reasonPhrase: null,
  };
}

// Consumer -> status interno da cozinha
function mapStatusConsumer(status: string): string | null {
  switch (status.toUpperCase()) {
    case "OUT_FOR_DELIVERY": return "saiu_entrega";
    case "CONCLUDED": return "entregue";
    default: return null; // CONFIRMED/READY_FOR_PICKUP/CANCELLED: so registra
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const idx = parts.indexOf("consumer-parceiro");
  const sub = (idx >= 0 ? parts[idx + 1] : parts[parts.length - 1]) || "";
  const tail = idx >= 0 ? parts.slice(idx + 2) : [];

  let body: Record<string, unknown> = {};
  if (req.method === "POST") {
    body = await req.json().catch(() => ({})) as Record<string, unknown>;
  }

  if (!authOk(req, url, body)) return json({ statusCode: 401, reasonPhrase: "token invalido" }, 401);

  const orderId = cleanText(tail[0]) || cleanText(url.searchParams.get("orderId"))
    || cleanText(url.searchParams.get("id")) || cleanText(body.OrderId) || cleanText(body.orderId);

  try {
    const supabase = sb();

    // ===== POLLING: pedidos pagos ainda nao enviados =====
    if (sub === "polling" || sub === "" || sub === "consumer-parceiro") {
      const { data: pedidos, error: pollErr } = await supabase
        .from("pedidos")
        .select("id, criado_em")
        .eq("pagamento_status", "pago")
        .is("consumer_sent_at", null)
        .neq("status", "cancelado")
        .order("criado_em", { ascending: true })
        .limit(20);
      if (pollErr) console.error("consumer-polling query error:", pollErr.message);

      const items = (pedidos || []).map((p: Record<string, unknown>) => ({
        id: cleanText(p.id),
        orderId: cleanText(p.id),
        createdAt: cleanText(p.criado_em) || new Date().toISOString(),
        fullCode: "PLACED",
        code: "PLC",
      }));
      return json({ items, statusCode: 0, reasonPhrase: null });
    }

    // ===== DETALHES: objeto completo do pedido =====
    if (sub === "detalhes" || sub === "detail" || sub === "order") {
      if (!orderId) return json({ statusCode: 1, reasonPhrase: "orderId ausente" }, 400);
      const { data: pedido, error: detErr } = await supabase.from("pedidos").select("*").eq("id", orderId).maybeSingle();
      if (detErr) console.error("consumer-detalhes query error:", detErr.message);
      if (!pedido) return json({ statusCode: 1, reasonPhrase: "pedido nao encontrado" }, 404);

      const payload = await montarDetalhes(supabase, pedido);
      // marca como enviado pro polling nao repetir
      await supabase.from("pedidos")
        .update({ consumer_sent_at: new Date().toISOString(), consumer_status: "DETAILS_SENT" })
        .eq("id", orderId);
      return json(payload);
    }

    // ===== STATUS: Consumer informa mudanca (SEMPRE responde 200 pra ele nao re-tentar/re-alertar) =====
    if (sub === "status") {
      const oid = orderId || cleanText(body.Id) || cleanText(body.id);
      const status = cleanText(tail[1]) || cleanText(url.searchParams.get("status"))
        || cleanText(body.status) || cleanText(body.Status);
      const justification = cleanText(tail[2]) || cleanText(url.searchParams.get("justification"))
        || cleanText(body.justification) || cleanText(body.Justification);
      console.log("consumer-status RAW:", JSON.stringify({ path: url.pathname, tail, query: Object.fromEntries(url.searchParams), body }).slice(0, 800));

      if (oid && status) {
        const { data: pedido } = await supabase.from("pedidos").select("id, status").eq("id", oid).maybeSingle();
        if (pedido) {
          await supabase.from("pedidos")
            .update({ consumer_status: status.toUpperCase(), atualizado_em: new Date().toISOString() })
            .eq("id", oid);
          const novo = mapStatusConsumer(status);
          if (novo && cleanText(pedido.status) !== novo && !["entregue", "cancelado"].includes(cleanText(pedido.status))) {
            await supabase.rpc("atualizar_status_pedido", { p_pedido_id: oid, p_novo_status: novo, p_motivo: justification || null });
          }
        }
      }
      // Confirma SEMPRE (statusCode 0). Sem isso, o Consumer fica re-tentando o mesmo pedido.
      return json({ statusCode: 0, reasonPhrase: oid ? `${oid} -> ${status}` : "ok" });
    }

    // ===== ENVIO de detalhes (Consumer -> nos): stub Fase 1 =====
    if (sub === "envio" || sub === "details" || sub === "send") {
      console.log("consumer-envio (stub):", JSON.stringify({ orderId, body }).slice(0, 500));
      return json({ statusCode: 0, reasonPhrase: "recebido" });
    }

    return json({ statusCode: 1, reasonPhrase: "rota desconhecida", rota: sub }, 404);
  } catch (err) {
    console.error("consumer-parceiro error:", err);
    return json({ statusCode: 1, reasonPhrase: String((err as Error)?.message ?? err) }, 500);
  }
});

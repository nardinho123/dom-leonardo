// Edge Function: garcom-responder
// API publica do cardapio do Garcom:
// entrega cardapio/configuracoes/mensagens automaticas do Marco
// e cria checkout via Stripe sem expor token secreto no HTML.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CHAT_PADRAO_SAUDACOES = [
  "Ciao! Que bom te ver por aqui.",
  "Boa noite! Fica a vontade para olhar com calma.",
  "Bem-vindo ao Dom Leonardo.",
  "Opa, cheguei por aqui. Bom apetite desde ja.",
  "Salve! Hoje o cardapio esta bonito.",
];

const CHAT_PADRAO_MENSAGENS = [
  "Se algum prato chamar sua atencao, abre ele e escolhe tamanho e adicionais por ali.",
  "Quando adicionar algo, a sacola aparece embaixo para voce revisar tudo com calma.",
  "Dica do Dom: os pratos maiores costumam valer muito a pena para dividir.",
];

const DEFAULT_SITE_URL = "https://domleonardo-erp.be3jfe.easypanel.host/garcom/";

function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asList(value: unknown, fallback: string[]): string[] {
  if (Array.isArray(value)) {
    const list = value.map((item) => String(item || "").trim()).filter(Boolean);
    return list.length ? list : fallback;
  }

  if (typeof value === "string") {
    const list = value
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
    return list.length ? list : fallback;
  }

  return fallback;
}

function groupBy<T extends Record<string, unknown>>(items: T[], key: string): Record<string, T[]> {
  return items.reduce<Record<string, T[]>>((acc, item) => {
    const groupKey = String(item[key] ?? "");
    if (!groupKey) return acc;
    if (!acc[groupKey]) acc[groupKey] = [];
    acc[groupKey].push(item);
    return acc;
  }, {});
}

const TOPO_DEFAULTS = {
  kicker: "Trattoria delivery",
  nome: "Dom Leonardo",
  descricao: "Massa quente, risoto cremoso e aquele cheiro de manteiga boa chegando na tampa. Escolha sem pressa; a sacola fica pronta no fim.",
  chip_1_label: "Preparo",
  chip_1_valor: "5 min",
  chip_2_label: "Entrega",
  chip_2_valor: "12 a 30 min",
  chip_3_label: "Varia pelo",
  chip_3_valor: "endereco",
  faixa_titulo: "Frete do chef:",
  faixa_texto: "acima de R$ 60,00, ate R$ 10,00 da entrega fica por nossa conta.",
  logo_url: null as string | null,
  capa_url: null as string | null,
  capa_tipo: "imagem",
  capa_video_url: null as string | null,
};

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function textOr(value: unknown, fallback: string): string {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function nullableText(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

function mapTopoConfig(config: Record<string, unknown>) {
  const topo = asObject(config.topo_config);
  const tipo = textOr(topo.capa_tipo, textOr(config.restaurante_capa_tipo, TOPO_DEFAULTS.capa_tipo));
  return {
    kicker: textOr(topo.kicker, TOPO_DEFAULTS.kicker),
    nome: textOr(topo.nome, textOr(config.restaurante_nome, TOPO_DEFAULTS.nome)),
    descricao: textOr(topo.descricao, textOr(config.restaurante_descricao, TOPO_DEFAULTS.descricao)),
    chip_1_label: textOr(topo.chip_1_label, TOPO_DEFAULTS.chip_1_label),
    chip_1_valor: textOr(topo.chip_1_valor, TOPO_DEFAULTS.chip_1_valor),
    chip_2_label: textOr(topo.chip_2_label, TOPO_DEFAULTS.chip_2_label),
    chip_2_valor: textOr(topo.chip_2_valor, TOPO_DEFAULTS.chip_2_valor),
    chip_3_label: textOr(topo.chip_3_label, TOPO_DEFAULTS.chip_3_label),
    chip_3_valor: textOr(topo.chip_3_valor, TOPO_DEFAULTS.chip_3_valor),
    faixa_titulo: textOr(topo.faixa_titulo, TOPO_DEFAULTS.faixa_titulo),
    faixa_texto: textOr(topo.faixa_texto, TOPO_DEFAULTS.faixa_texto),
    logo_url: nullableText(topo.logo_url) ?? nullableText(config.restaurante_logo_url),
    capa_url: nullableText(topo.capa_url) ?? nullableText(config.restaurante_capa_url),
    capa_tipo: ["imagem", "gif", "video"].includes(tipo) ? tipo : TOPO_DEFAULTS.capa_tipo,
    capa_video_url: nullableText(topo.capa_video_url) ?? nullableText(config.restaurante_capa_video_url),
  };
}

function mapConfig(config: Record<string, unknown> | null) {
  const cfg = config ?? {};
  const topo = mapTopoConfig(cfg);
  return {
    topo,
    restaurante_nome: topo.nome,
    restaurante_descricao: topo.descricao,
    restaurante_logo_url: topo.logo_url,
    restaurante_capa_url: topo.capa_url,
    restaurante_capa_tipo: topo.capa_tipo,
    restaurante_capa_video_url: topo.capa_video_url,
    restaurante_avaliacao: toNumber(cfg.restaurante_avaliacao, 4.9),
    restaurante_total_avaliacoes: toNumber(cfg.restaurante_total_avaliacoes, 0),
    whatsapp_pedidos: cfg.whatsapp_pedidos ?? "",
    taxa_entrega_padrao: toNumber(cfg.taxa_entrega_padrao, 0),
    pedido_minimo: toNumber(cfg.pedido_minimo, 0),
    raio_entrega_km: toNumber(cfg.raio_entrega_km, 5),
    tempo_entrega_min: toNumber(cfg.tempo_entrega_min, 20),
    tempo_entrega_max: toNumber(cfg.tempo_entrega_max, 30),
    horario_abertura: cfg.horario_abertura ?? "18:00",
    horario_fechamento: cfg.horario_fechamento ?? "23:30",
    aviso_topo: cfg.aviso_topo ?? null,
    loja_aberta_manual: cfg.loja_aberta_manual !== false,
    tema_cardapio: cfg.tema_cardapio ?? "preto",
    destaques_titulo: cfg.destaques_titulo ?? "O Dom recomenda",
    destaques_descricao: cfg.destaques_descricao ?? "Os pratos que mais saem por aqui.",
    cupons_titulo: cfg.cupons_titulo ?? "Cupons do Dom",
    cupons_descricao: cfg.cupons_descricao ?? "Toque para ver onde usar e quando acaba.",
    mercado_pago_public_key: cfg.mercado_pago_public_key ?? "",
    checkout_mercado_pago_ativo: cfg.checkout_mercado_pago_ativo !== false,
    checkout_titulo: cfg.checkout_titulo ?? "Fechar pedido com seguranca",
    checkout_subtitulo: cfg.checkout_subtitulo ?? "Revise sua janta, informe entrega e pague pelo Mercado Pago.",
    checkout_botao_texto: cfg.checkout_botao_texto ?? "Pagar com Mercado Pago",
    checkout_sucesso_texto: cfg.checkout_sucesso_texto ?? "Pedido recebido. Assim que o pagamento confirmar, o Dom ja ve na cozinha.",
    checkout_pendente_texto: cfg.checkout_pendente_texto ?? "Pagamento pendente. Se for Pix, aguarde a confirmacao do Mercado Pago.",
  };
}

function mapMicrocopy(config: Record<string, unknown> | null) {
  const cfg = config ?? {};
  return {
    entrega_texto: cfg.garcom_entrega_texto ?? "tempo em media para chegar na sua casa 20 a 30 min",
    entrega_botao_texto: cfg.garcom_entrega_botao_texto ?? "quero saber o tempo exato",
    tamanhos_texto: cfg.garcom_tamanhos_texto ?? "400g individual | 800g serve 2",
    fome_botao_texto: cfg.garcom_fome_botao_texto ?? "quero saber se vai matar minha fome",
  };
}

function mapChatConfig(config: Record<string, unknown> | null) {
  const cfg = config ?? {};
  return {
    saudacoes: asList(cfg.garcom_chat_saudacoes, CHAT_PADRAO_SAUDACOES),
    mensagens_automaticas: asList(cfg.garcom_chat_mensagens_auto, CHAT_PADRAO_MENSAGENS),
  };
}

function cleanText(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizePhone(value: unknown): string {
  return cleanText(value).replace(/\D/g, "");
}

function normalizeSiteUrl(value: unknown): string {
  const raw = cleanText(value) || DEFAULT_SITE_URL;
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) return DEFAULT_SITE_URL;
    return url.href;
  } catch (_) {
    return DEFAULT_SITE_URL;
  }
}

function toPedidoItens(rawItens: unknown): unknown[] {
  if (!Array.isArray(rawItens)) return [];
  return rawItens.map((item) => {
    const row = item as Record<string, unknown>;
    const opcionaisRaw = Array.isArray(row.opcionais) ? row.opcionais : [];
    return {
      prato_id: row.prato_id,
      tamanho_id: (row.tamanho as Record<string, unknown> | null)?.id ?? row.tamanho_id ?? null,
      quantidade: Math.max(1, Math.floor(toNumber(row.qtd ?? row.quantidade, 1))),
      opcionais_ids: opcionaisRaw.flatMap((op) => {
        const opt = op as Record<string, unknown>;
        const qtd = Math.max(1, Math.floor(toNumber(opt.qtd, 1)));
        return Array.from({ length: qtd }, () => opt.id ?? opt.opcional_id).filter(Boolean);
      }),
      observacoes: cleanText(row.obs ?? row.observacoes) || null,
    };
  });
}

function toStripeAmount(value: unknown): number {
  return Math.max(50, Math.round(toNumber(value, 0) * 100));
}

function stripeSecretKey(): string {
  const key = Deno.env.get("STRIPE_SECRET_KEY") || "";
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY nao configurada no Supabase.");
  }
  return key;
}

function stripePublishableKey(): string {
  return Deno.env.get("STRIPE_PUBLISHABLE_KEY")
    || "pk_live_51TlWo3Q8mlsqNv4rKQK8ubQgLWnDzCs6Xl237Xll5FjbaWmBiLCasCQLrC9cONXwU4lP7TaR7UrAUH5j4A0mpp5z00VY2KLhSz";
}

const RESTAURANTE_ORIGEM = "Rua Francisco Dallaribera, 1811, Santa Felicidade, Curitiba, PR, 82410-030, Brasil";

function mapsServerKey(): string {
  return Deno.env.get("GOOGLE_MAPS_SERVER_KEY")
    || Deno.env.get("DOM_LEONARDO_MAPS_SERVER")
    || Deno.env.get("GOOGLE_MAPS_API_KEY")
    || "";
}

function mapsBrowserKey(): string {
  return Deno.env.get("GOOGLE_MAPS_BROWSER_KEY")
    || Deno.env.get("DOM_LEONARDO_MAPS_BROWSER")
    || Deno.env.get("GOOGLE_MAPS_BROWSER")
    || "";
}

function arredondaDinheiro(value: number): number {
  return Math.round(value * 100) / 100;
}

function calcularFreteEstimado(distanceKm: number | null, config: Record<string, unknown>, subtotal: number) {
  const taxaPadrao = toNumber(config.taxa_entrega_padrao, 0);
  const raioEntregaKm = toNumber(config.raio_entrega_km, 8);
  const freteCalculado = distanceKm
    ? Math.max(taxaPadrao, 5 + (distanceKm * 1.35))
    : taxaPadrao;
  const freteBruto = arredondaDinheiro(freteCalculado);
  const descontoChef = subtotal >= 60 ? Math.min(freteBruto, 10) : 0;

  return {
    frete_bruto: freteBruto,
    desconto_frete_chef: arredondaDinheiro(descontoChef),
    frete_final: arredondaDinheiro(Math.max(0, freteBruto - descontoChef)),
    dentro_raio: !distanceKm || distanceKm <= raioEntregaKm,
    raio_entrega_km: raioEntregaKm,
  };
}

function entregaFallback(config: Record<string, unknown>, subtotal: number, motivo: string) {
  const tempoMin = toNumber(config.tempo_entrega_min, 20);
  const tempoMax = toNumber(config.tempo_entrega_max, 30);
  const frete = calcularFreteEstimado(null, config, subtotal);

  return {
    sucesso: true,
    fonte: "configuracao",
    motivo,
    endereco_formatado: null,
    distancia_km: null,
    rota_minutos: null,
    tempo_min: tempoMin,
    tempo_max: Math.max(tempoMax, tempoMin + 8),
    texto_tempo: `${tempoMin} a ${Math.max(tempoMax, tempoMin + 8)} min`,
    ...frete,
  };
}

async function calcularEntregaGoogle(params: {
  endereco: Record<string, unknown>;
  subtotal: number;
  config: Record<string, unknown>;
}) {
  const key = mapsServerKey();
  if (!key) return entregaFallback(params.config, params.subtotal, "google_maps_key_ausente");

  const logradouro = cleanText(params.endereco.logradouro);
  const numero = cleanText(params.endereco.numero);
  const bairro = cleanText(params.endereco.bairro);
  const cep = cleanText(params.endereco.cep);
  const cidade = cleanText(params.endereco.cidade) || "Curitiba";
  const uf = cleanText(params.endereco.uf) || "PR";
  const latInformado = toNumber(params.endereco.lat, NaN);
  const lngInformado = toNumber(params.endereco.lng, NaN);
  const temCoordenada = Number.isFinite(latInformado) && Number.isFinite(lngInformado);

  if ((!logradouro || !numero || !bairro) && !temCoordenada) {
    throw new Error("Informe rua, numero e bairro para calcular a entrega.");
  }

  const destinoTexto = `${logradouro}, ${numero}, ${bairro}, ${cidade}, ${uf}, ${cep ? `${cep}, ` : ""}Brasil`;

  let enderecoFormatado = cleanText(params.endereco.endereco_formatado);
  let lat = latInformado;
  let lng = lngInformado;

  if (!temCoordenada) {
    const geoUrl = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    geoUrl.searchParams.set("address", destinoTexto);
    geoUrl.searchParams.set("region", "br");
    geoUrl.searchParams.set("language", "pt-BR");
    geoUrl.searchParams.set("key", key);

    const geoResp = await fetch(geoUrl);
    const geoData = await geoResp.json().catch(() => ({})) as Record<string, unknown>;
    const geoResults = Array.isArray(geoData.results) ? geoData.results as Array<Record<string, unknown>> : [];
    const geoStatus = cleanText(geoData.status);
    if (!geoResp.ok || geoStatus !== "OK" || geoResults.length === 0) {
      return entregaFallback(params.config, params.subtotal, `geocode_${geoStatus || geoResp.status}`);
    }

    const best = geoResults[0];
    const geometry = asObject(best.geometry);
    const location = asObject(geometry.location);
    lat = toNumber(location.lat, NaN);
    lng = toNumber(location.lng, NaN);
    enderecoFormatado = cleanText(best.formatted_address);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return entregaFallback(params.config, params.subtotal, "geocode_sem_coordenadas");
    }
  }

  const matrixUrl = new URL("https://maps.googleapis.com/maps/api/distancematrix/json");
  matrixUrl.searchParams.set("origins", RESTAURANTE_ORIGEM);
  matrixUrl.searchParams.set("destinations", `${lat},${lng}`);
  matrixUrl.searchParams.set("mode", "driving");
  matrixUrl.searchParams.set("language", "pt-BR");
  matrixUrl.searchParams.set("region", "br");
  matrixUrl.searchParams.set("units", "metric");
  matrixUrl.searchParams.set("key", key);

  const matrixResp = await fetch(matrixUrl);
  const matrixData = await matrixResp.json().catch(() => ({})) as Record<string, unknown>;
  const rows = Array.isArray(matrixData.rows) ? matrixData.rows as Array<Record<string, unknown>> : [];
  const elements = Array.isArray(rows[0]?.elements) ? rows[0].elements as Array<Record<string, unknown>> : [];
  const element = elements[0] ?? {};
  const elementStatus = cleanText(element.status);
  if (!matrixResp.ok || cleanText(matrixData.status) !== "OK" || elementStatus !== "OK") {
    return entregaFallback(params.config, params.subtotal, `distance_${cleanText(matrixData.status) || elementStatus || matrixResp.status}`);
  }

  const distance = asObject(element.distance);
  const duration = asObject(element.duration);
  const distanciaKm = arredondaDinheiro(toNumber(distance.value, 0) / 1000);
  const rotaMinutos = Math.ceil(toNumber(duration.value, 0) / 60);
  const tempoBaseMin = toNumber(params.config.tempo_entrega_min, 20);
  const tempoBaseMax = toNumber(params.config.tempo_entrega_max, 30);
  const tempoMin = Math.max(tempoBaseMin, rotaMinutos + 10);
  const tempoMax = Math.max(tempoBaseMax, tempoMin + 10, rotaMinutos + 20);
  const frete = calcularFreteEstimado(distanciaKm, params.config, params.subtotal);

  return {
    sucesso: true,
    fonte: "google_maps",
    endereco_formatado: enderecoFormatado || destinoTexto,
    coordenadas: { lat, lng },
    distancia_texto: cleanText(distance.text),
    distancia_km: distanciaKm,
    rota_texto: cleanText(duration.text),
    rota_minutos: rotaMinutos,
    tempo_min: tempoMin,
    tempo_max: tempoMax,
    texto_tempo: `${tempoMin} a ${tempoMax} min`,
    ...frete,
  };
}

function normalizarParteEndereco(value: unknown): string {
  return cleanText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function entregaCacheKey(params: {
  endereco: Record<string, unknown>;
  subtotal: number;
  config: Record<string, unknown>;
}): Promise<{ chave: string; enderecoTexto: string; subtotalBucket: string }> {
  const cidade = normalizarParteEndereco(params.endereco.cidade) || "curitiba";
  const uf = normalizarParteEndereco(params.endereco.uf) || "pr";
  const lat = toNumber(params.endereco.lat, NaN);
  const lng = toNumber(params.endereco.lng, NaN);
  const coordenadaTexto = Number.isFinite(lat) && Number.isFinite(lng)
    ? `${lat.toFixed(6)},${lng.toFixed(6)}`
    : "";
  const enderecoTexto = [
    coordenadaTexto,
    normalizarParteEndereco(params.endereco.logradouro),
    normalizarParteEndereco(params.endereco.numero),
    normalizarParteEndereco(params.endereco.bairro),
    cidade,
    uf,
    normalizarParteEndereco(params.endereco.cep),
  ].filter(Boolean).join(", ");
  const subtotalBucket = params.subtotal >= 60 ? "frete_chef" : "normal";
  const configParte = [
    toNumber(params.config.taxa_entrega_padrao, 0),
    toNumber(params.config.raio_entrega_km, 8),
    toNumber(params.config.tempo_entrega_min, 20),
    toNumber(params.config.tempo_entrega_max, 30),
  ].join("|");
  const chave = await sha256Hex(`${enderecoTexto}|${subtotalBucket}|${configParte}`);
  return { chave, enderecoTexto, subtotalBucket };
}

function identidadeEntrega(req: Request, body: Record<string, unknown>): string {
  const forwarded = cleanText(req.headers.get("x-forwarded-for")).split(",")[0]?.trim();
  return cleanText(body.device_id)
    || cleanText(req.headers.get("x-client-device"))
    || cleanText(req.headers.get("cf-connecting-ip"))
    || forwarded
    || "anon";
}

async function permiteChamadaMaps(
  supabase: any,
  chaveRaw: string,
  limite: number,
  janelaMinutos: number,
): Promise<{ permitido: boolean; motivo?: string; chamadas?: number; limite: number }> {
  const chave = `maps:${await sha256Hex(chaveRaw)}`;
  const agora = new Date();
  const janelaMs = janelaMinutos * 60 * 1000;

  const { data, error } = await supabase
    .from("entrega_rate_limits")
    .select("chave, janela_inicio, chamadas")
    .eq("chave", chave)
    .maybeSingle();

  if (error) {
    return { permitido: false, motivo: "rate_limit_db_error", limite };
  }

  if (!data) {
    await supabase.from("entrega_rate_limits").insert({
      chave,
      janela_inicio: agora.toISOString(),
      chamadas: 1,
      atualizado_em: agora.toISOString(),
    });
    return { permitido: true, chamadas: 1, limite };
  }

  const janelaInicio = new Date(String(data.janela_inicio));
  const expirou = !Number.isFinite(janelaInicio.getTime()) || agora.getTime() - janelaInicio.getTime() > janelaMs;
  const chamadasAtuais = toNumber(data.chamadas, 0);

  if (expirou) {
    await supabase
      .from("entrega_rate_limits")
      .update({ janela_inicio: agora.toISOString(), chamadas: 1, atualizado_em: agora.toISOString() })
      .eq("chave", chave);
    return { permitido: true, chamadas: 1, limite };
  }

  if (chamadasAtuais >= limite) {
    return { permitido: false, motivo: "rate_limit_excedido", chamadas: chamadasAtuais, limite };
  }

  await supabase
    .from("entrega_rate_limits")
    .update({ chamadas: chamadasAtuais + 1, atualizado_em: agora.toISOString() })
    .eq("chave", chave);

  return { permitido: true, chamadas: chamadasAtuais + 1, limite };
}

async function calcularEntregaComProtecao(
  supabase: any,
  req: Request,
  body: Record<string, unknown>,
  params: {
    endereco: Record<string, unknown>;
    subtotal: number;
    config: Record<string, unknown>;
  },
) {
  const cache = await entregaCacheKey(params);
  const agoraIso = new Date().toISOString();

  const { data: cacheHit, error: cacheError } = await supabase
    .from("entrega_estimativas_cache")
    .select("resposta")
    .eq("chave", cache.chave)
    .gt("expira_em", agoraIso)
    .maybeSingle();

  if (!cacheError && cacheHit?.resposta) {
    return { ...asObject(cacheHit.resposta), cache: true };
  }

  const identidade = identidadeEntrega(req, body);
  const hoje = new Date().toISOString().slice(0, 10);
  const deviceLimit = await permiteChamadaMaps(supabase, `device:${identidade}`, 25, 60);
  if (!deviceLimit.permitido) {
    return { ...entregaFallback(params.config, params.subtotal, `rate_limit_device_${deviceLimit.motivo || "excedido"}`), rate_limited: true };
  }

  const globalLimit = await permiteChamadaMaps(supabase, `global:${hoje}`, 500, 24 * 60);
  if (!globalLimit.permitido) {
    return { ...entregaFallback(params.config, params.subtotal, `rate_limit_global_${globalLimit.motivo || "excedido"}`), rate_limited: true };
  }

  const entrega = await calcularEntregaGoogle(params);
  const ttlMinutos = entrega.fonte === "google_maps" ? 12 * 60 : 5;
  const expiraEm = new Date(Date.now() + ttlMinutos * 60 * 1000).toISOString();

  await supabase.from("entrega_estimativas_cache").upsert({
    chave: cache.chave,
    endereco_texto: cache.enderecoTexto,
    subtotal_bucket: cache.subtotalBucket,
    resposta: entrega,
    expira_em: expiraEm,
  }, { onConflict: "chave" });

  return { ...entrega, cache: false };
}

async function createStripePaymentIntent(params: {
  amount: number;
  pedidoId: string;
  numeroPedido: string;
  clienteNome: string;
  clienteWhatsapp: string;
  origem: string;
  idempotencyKey: string;
}) {
  const form = new URLSearchParams();
  form.set("amount", String(params.amount));
  form.set("currency", "brl");
  form.set("description", `Pedido Dom Leonardo #${params.numeroPedido}`);
  form.set("statement_descriptor", "DOM LEONARDO");
  form.set("automatic_payment_methods[enabled]", "true");
  form.set("metadata[pedido_id]", params.pedidoId);
  form.set("metadata[numero_pedido]", params.numeroPedido);
  form.set("metadata[origem]", params.origem);
  form.set("metadata[cliente_nome]", params.clienteNome.slice(0, 450));
  form.set("metadata[cliente_whatsapp]", params.clienteWhatsapp.slice(0, 80));

  const resp = await fetch("https://api.stripe.com/v1/payment_intents", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${stripeSecretKey()}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": params.idempotencyKey,
    },
    body: form,
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    console.error("stripe payment_intent error", data);
    const stripeError = (data as Record<string, unknown>).error as Record<string, unknown> | undefined;
    throw new Error(String(stripeError?.message ?? "Nao consegui criar o pagamento na Stripe."));
  }
  return data as Record<string, unknown>;
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
    const body = await req.json().catch(() => ({}));
    const acao = String(body?.acao || "listar_pratos");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    if (!["listar_pratos", "listar_cardapio", "mensagens_chat", "registrar_atendimento", "listar_atendimento", "buscar_cliente", "maps_public_config", "calcular_entrega_google", "criar_checkout", "processar_pagamento_brick", "criar_pagamento_stripe", "status_pagamento_mp", "status_pedido_publico"].includes(acao)) {
      return new Response(JSON.stringify({ error: "acao invalida" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    if (acao === "maps_public_config") {
      const key = mapsBrowserKey();
      return new Response(JSON.stringify({
        google_maps_browser_key: key || null,
        enabled: Boolean(key),
        libraries: ["places"],
      }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    if (acao === "registrar_atendimento") {
      const deviceId = cleanText(body?.device_id);
      const texto = cleanText(body?.texto);
      if (!deviceId) throw new Error("device_id obrigatorio");
      if (!texto) throw new Error("Mensagem vazia");

      const clienteNome = cleanText(body?.cliente_nome) || null;
      const contexto = typeof body?.contexto === "object" && body?.contexto !== null ? body.contexto : {};

      const { data: existente, error: buscarError } = await supabase
        .from("atendimentos")
        .select("*")
        .eq("device_id", deviceId)
        .maybeSingle();
      if (buscarError) throw buscarError;

      let atendimento = existente as Record<string, unknown> | null;
      if (!atendimento) {
        const { data, error } = await supabase
          .from("atendimentos")
          .insert({
            device_id: deviceId,
            cliente_nome: clienteNome,
            ultimo_texto: texto,
            nao_lidas: 1,
            ultima_mensagem_em: new Date().toISOString(),
          })
          .select("*")
          .single();
        if (error) throw error;
        atendimento = data as Record<string, unknown>;
      } else {
        const { data, error } = await supabase
          .from("atendimentos")
          .update({
            cliente_nome: clienteNome || atendimento.cliente_nome || null,
            status: "aberto",
            ultimo_texto: texto,
            nao_lidas: toNumber(atendimento.nao_lidas, 0) + 1,
            ultima_mensagem_em: new Date().toISOString(),
          })
          .eq("id", atendimento.id)
          .select("*")
          .single();
        if (error) throw error;
        atendimento = data as Record<string, unknown>;
      }

      const { data: mensagem, error: msgError } = await supabase
        .from("atendimento_mensagens")
        .insert({
          atendimento_id: atendimento.id,
          autor: "cliente",
          texto,
          contexto,
        })
        .select("*")
        .single();
      if (msgError) throw msgError;

      return new Response(JSON.stringify({ sucesso: true, atendimento, mensagem }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    if (acao === "listar_atendimento") {
      const deviceId = cleanText(body?.device_id);
      if (!deviceId) throw new Error("device_id obrigatorio");
      const { data: atendimento, error: atendimentoError } = await supabase
        .from("atendimentos")
        .select("*")
        .eq("device_id", deviceId)
        .maybeSingle();
      if (atendimentoError) throw atendimentoError;
      if (!atendimento) {
        return new Response(JSON.stringify({ atendimento: null, mensagens: [] }), {
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }
      const { data: mensagens, error: mensagensError } = await supabase
        .from("atendimento_mensagens")
        .select("*")
        .eq("atendimento_id", atendimento.id)
        .order("criado_em", { ascending: true })
        .limit(80);
      if (mensagensError) throw mensagensError;
      return new Response(JSON.stringify({ atendimento, mensagens: mensagens ?? [] }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    if (acao === "buscar_cliente") {
      const whatsapp = normalizePhone(body?.whatsapp);
      if (whatsapp.length < 8) {
        return new Response(JSON.stringify({ encontrado: false }), {
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }

      const finalTelefone = whatsapp.slice(-8);
      let cliente: Record<string, unknown> | null = null;

      const { data: clienteExato, error: clienteExatoError } = await supabase
        .from("clientes")
        .select("*")
        .eq("whatsapp", whatsapp)
        .maybeSingle();
      if (clienteExatoError) throw clienteExatoError;
      cliente = clienteExato as Record<string, unknown> | null;

      if (!cliente) {
        const { data: candidatos, error: candidatosError } = await supabase
          .from("clientes")
          .select("*")
          .ilike("whatsapp", `%${finalTelefone}`)
          .order("ultimo_pedido_em", { ascending: false, nullsFirst: false })
          .limit(1);
        if (candidatosError) throw candidatosError;
        cliente = (candidatos?.[0] ?? null) as Record<string, unknown> | null;
      }

      if (!cliente) {
        return new Response(JSON.stringify({ encontrado: false }), {
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }

      const { data: endereco, error: enderecoError } = await supabase
        .from("enderecos_cliente")
        .select("*")
        .eq("cliente_id", cliente.id)
        .eq("ativo", true)
        .order("padrao", { ascending: false })
        .order("criado_em", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (enderecoError) throw enderecoError;

      return new Response(JSON.stringify({
        encontrado: true,
        cliente: {
          nome: cliente.nome ?? "",
          whatsapp: cliente.whatsapp ?? whatsapp,
          email: cliente.email ?? "",
          total_pedidos: cliente.total_pedidos ?? 0,
          ultimo_pedido_em: cliente.ultimo_pedido_em ?? null,
        },
        endereco: endereco ?? null,
      }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const { data: config, error: configError } = await supabase
      .from("configuracoes")
      .select("*")
      .eq("id", 1)
      .maybeSingle();

    if (configError) throw configError;

    const chatConfig = mapChatConfig(config as Record<string, unknown> | null);
    if (acao === "mensagens_chat") {
      return new Response(JSON.stringify({ chat_config: chatConfig }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    if (acao === "calcular_entrega_google") {
      const estimativa = await calcularEntregaComProtecao(supabase, req, body as Record<string, unknown>, {
        endereco: asObject(body?.endereco),
        subtotal: toNumber(body?.subtotal, 0),
        config: (config as Record<string, unknown> | null) ?? {},
      });

      return new Response(JSON.stringify({ sucesso: true, entrega: estimativa }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    if (acao === "criar_pagamento_stripe") {
      const cliente = body?.cliente ?? {};
      const endereco = body?.endereco ?? {};
      const itens = toPedidoItens(body?.itens);

      if (!cleanText((cliente as Record<string, unknown>).nome)) {
        throw new Error("Informe seu nome para fechar o pedido.");
      }
      if (!normalizePhone((cliente as Record<string, unknown>).whatsapp)) {
        throw new Error("Informe um telefone/WhatsApp para o motoboy te encontrar.");
      }
      if (itens.length === 0) {
        throw new Error("Sua sacola esta vazia.");
      }

      const { data: pedido, error: pedidoError } = await supabase.rpc("criar_pedido", {
        p_cliente: {
          nome: cleanText((cliente as Record<string, unknown>).nome),
          whatsapp: normalizePhone((cliente as Record<string, unknown>).whatsapp),
          email: cleanText((cliente as Record<string, unknown>).email) || null,
        },
        p_endereco: {
          cep: cleanText((endereco as Record<string, unknown>).cep) || null,
          logradouro: cleanText((endereco as Record<string, unknown>).logradouro),
          numero: cleanText((endereco as Record<string, unknown>).numero),
          complemento: cleanText((endereco as Record<string, unknown>).complemento) || null,
          bairro: cleanText((endereco as Record<string, unknown>).bairro),
          cidade: cleanText((endereco as Record<string, unknown>).cidade) || "Curitiba",
          uf: cleanText((endereco as Record<string, unknown>).uf) || "PR",
          ponto_referencia: cleanText((endereco as Record<string, unknown>).ponto_referencia) || null,
        },
        p_itens: itens,
        p_forma_pagamento: "stripe",
        p_troco_para: null,
        p_cupom_codigo: cleanText(body?.cupom_codigo) || null,
        p_observacoes: cleanText(body?.observacoes) || null,
        p_origem: "cardapio_garcom_stripe",
      });

      if (pedidoError) throw pedidoError;

      const pedidoObj = pedido as Record<string, unknown>;
      const pedidoId = String(pedidoObj.pedido_id ?? "");
      const numeroPedido = String(pedidoObj.numero_pedido ?? "");
      let total = toNumber(pedidoObj.total, 0);

      if (body?.entrega_google === true) {
        const entrega = await calcularEntregaComProtecao(supabase, req, body as Record<string, unknown>, {
          endereco: asObject(endereco),
          subtotal: toNumber(pedidoObj.subtotal, 0),
          config: (config as Record<string, unknown> | null) ?? {},
        });
        const taxaEntregaGoogle = toNumber(entrega.frete_final, NaN);

        if (Number.isFinite(taxaEntregaGoogle) && taxaEntregaGoogle >= 0) {
          const subtotalPedido = toNumber(pedidoObj.subtotal, 0);
          const descontoPedido = toNumber(pedidoObj.desconto, 0);
          total = arredondaDinheiro(Math.max(0, subtotalPedido + taxaEntregaGoogle - descontoPedido));
          const obsAtual = cleanText(pedidoObj.observacoes);
          const obsEntrega = [
            `Entrega Google Maps: ${cleanText(entrega.texto_tempo) || "estimativa indisponivel"}`,
            entrega.distancia_texto ? `distancia ${cleanText(entrega.distancia_texto)}` : "",
            entrega.fonte === "google_maps" ? "fonte google_maps" : `fonte configuracao (${cleanText(entrega.motivo) || "fallback"})`,
          ].filter(Boolean).join(" | ");
          const observacoes = [obsAtual, obsEntrega].filter(Boolean).join("\n");

          const { error: entregaUpdateError } = await supabase
            .from("pedidos")
            .update({
              taxa_entrega: taxaEntregaGoogle,
              total,
              observacoes,
            })
            .eq("id", pedidoId);
          if (entregaUpdateError) throw entregaUpdateError;

          pedidoObj.taxa_entrega = taxaEntregaGoogle;
          pedidoObj.total = total;
          pedidoObj.observacoes = observacoes;
          pedidoObj.entrega_google = entrega;
        }
      }

      const idempotencyKey = cleanText(body?.idempotency_key) || `dom-leonardo-${pedidoId}`;
      const paymentIntent = await createStripePaymentIntent({
        amount: toStripeAmount(total),
        pedidoId,
        numeroPedido,
        clienteNome: cleanText((cliente as Record<string, unknown>).nome),
        clienteWhatsapp: normalizePhone((cliente as Record<string, unknown>).whatsapp),
        origem: "cardapio_garcom_stripe",
        idempotencyKey,
      });

      const { error: stripeUpdateError } = await supabase
        .from("pedidos")
        .update({
          stripe_payment_intent_id: paymentIntent.id,
          stripe_payment_status: paymentIntent.status,
        })
        .eq("id", pedidoId);
      if (stripeUpdateError) throw stripeUpdateError;

      return new Response(JSON.stringify({
        sucesso: true,
        pedido: pedidoObj,
        stripe: {
          publishable_key: stripePublishableKey(),
          payment_intent_id: paymentIntent.id,
          client_secret: paymentIntent.client_secret,
          status: paymentIntent.status,
          amount: paymentIntent.amount,
          currency: paymentIntent.currency,
        },
      }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    if (acao === "processar_pagamento_brick") {
      const cfg = mapConfig(config as Record<string, unknown> | null);
      if (!cfg.checkout_mercado_pago_ativo) {
        return new Response(JSON.stringify({ error: "checkout desativado no painel" }), {
          status: 400,
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }

      const mercadoPagoToken = Deno.env.get("MERCADO_PAGO_ACCESS_TOKEN");
      if (!mercadoPagoToken) {
        return new Response(JSON.stringify({
          error: "MERCADO_PAGO_ACCESS_TOKEN nao configurado",
          detalhe: "Adicione o Access Token como secret da Edge Function no Supabase.",
        }), {
          status: 500,
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }

      const cliente = body?.cliente ?? {};
      const endereco = body?.endereco ?? {};
      const itens = toPedidoItens(body?.itens);
      const formData = (typeof body?.form_data === "object" && body?.form_data !== null)
        ? body.form_data as Record<string, unknown>
        : {};
      const payer = (typeof formData.payer === "object" && formData.payer !== null)
        ? formData.payer as Record<string, unknown>
        : {};
      const identification = (typeof payer.identification === "object" && payer.identification !== null)
        ? payer.identification as Record<string, unknown>
        : null;

      if (!cleanText((cliente as Record<string, unknown>).nome)) {
        throw new Error("Informe seu nome para fechar o pedido.");
      }
      if (!normalizePhone((cliente as Record<string, unknown>).whatsapp)) {
        throw new Error("Informe um telefone/WhatsApp para o motoboy te encontrar.");
      }
      if (itens.length === 0) {
        throw new Error("Sua sacola esta vazia.");
      }

      const paymentMethodId = cleanText(formData.payment_method_id);
      const clientePhone = normalizePhone((cliente as Record<string, unknown>).whatsapp);
      // Pix nao pede e-mail do cliente no formulario do cardapio: se nao vier, sintetizamos
      // um e-mail valido (o MP so precisa do formato para emitir o QR). Cartao continua
      // dependendo do e-mail real informado no Brick.
      const payerEmail = cleanText(payer.email)
        || (paymentMethodId === "pix" ? `pix-${clientePhone || Date.now()}@cliente.domleonardo.com.br` : "");

      if (!paymentMethodId) throw new Error("Meio de pagamento nao informado pelo Mercado Pago.");
      if (!payerEmail) throw new Error("Informe um e-mail no pagamento para o Mercado Pago processar.");

      const { data: pedido, error: pedidoError } = await supabase.rpc("criar_pedido", {
        p_cliente: {
          nome: cleanText((cliente as Record<string, unknown>).nome),
          whatsapp: normalizePhone((cliente as Record<string, unknown>).whatsapp),
          email: cleanText((cliente as Record<string, unknown>).email) || cleanText(payer.email) || null,
        },
        p_endereco: {
          cep: cleanText((endereco as Record<string, unknown>).cep) || null,
          logradouro: cleanText((endereco as Record<string, unknown>).logradouro),
          numero: cleanText((endereco as Record<string, unknown>).numero),
          complemento: cleanText((endereco as Record<string, unknown>).complemento) || null,
          bairro: cleanText((endereco as Record<string, unknown>).bairro),
          cidade: cleanText((endereco as Record<string, unknown>).cidade) || "Curitiba",
          uf: cleanText((endereco as Record<string, unknown>).uf) || "PR",
          ponto_referencia: cleanText((endereco as Record<string, unknown>).ponto_referencia) || null,
        },
        p_itens: itens,
        p_forma_pagamento: "mercado_pago",
        p_troco_para: null,
        p_cupom_codigo: cleanText(body?.cupom_codigo) || null,
        p_observacoes: cleanText(body?.observacoes) || null,
        p_origem: "cardapio_garcom_mp_brick",
      });

      if (pedidoError) throw pedidoError;

      const pedidoObj = pedido as Record<string, unknown>;
      let total = toNumber(pedidoObj.total, 0);

      // Frete: criar_pedido so conhece a taxa_entrega_padrao (hoje 0). O cardapio calcula o
      // frete real (Google/faixa) e envia em body.taxa_entrega. Aqui ajustamos o pedido e o
      // valor cobrado para incluir a entrega (sem isso o cliente nao paga o frete).
      const taxaInformada = toNumber(body?.taxa_entrega, NaN);
      if (Number.isFinite(taxaInformada) && taxaInformada >= 0) {
        const subtotalPedido = toNumber(pedidoObj.subtotal, 0);
        const descontoPedido = toNumber(pedidoObj.desconto, 0);
        const freteAtual = toNumber(pedidoObj.taxa_entrega, 0);
        if (Math.abs(taxaInformada - freteAtual) > 0.009) {
          const novoTotal = Math.max(0, subtotalPedido + taxaInformada - descontoPedido);
          const { error: freteError } = await supabase
            .from("pedidos")
            .update({
              taxa_entrega: Number(taxaInformada.toFixed(2)),
              total: Number(novoTotal.toFixed(2)),
            })
            .eq("id", pedidoObj.pedido_id);
          if (freteError) throw freteError;
          total = Number(novoTotal.toFixed(2));
        }
      }

      const paymentBody: Record<string, unknown> = {
        transaction_amount: Number(total.toFixed(2)),
        description: `Pedido Dom Leonardo #${pedidoObj.numero_pedido}`,
        payment_method_id: paymentMethodId,
        external_reference: String(pedidoObj.pedido_id ?? ""),
        statement_descriptor: "DOM LEONARDO",
        notification_url: cleanText(body?.notification_url) || undefined,
        metadata: {
          pedido_id: String(pedidoObj.pedido_id ?? ""),
          numero_pedido: String(pedidoObj.numero_pedido ?? ""),
          origem: "cardapio_garcom_mp_brick",
        },
        payer: {
          email: payerEmail,
          first_name: cleanText((cliente as Record<string, unknown>).nome),
          phone: {
            number: normalizePhone((cliente as Record<string, unknown>).whatsapp),
          },
          address: {
            zip_code: cleanText((endereco as Record<string, unknown>).cep),
            street_name: cleanText((endereco as Record<string, unknown>).logradouro),
            street_number: cleanText((endereco as Record<string, unknown>).numero),
            neighborhood: cleanText((endereco as Record<string, unknown>).bairro),
            city: cleanText((endereco as Record<string, unknown>).cidade) || "Curitiba",
            federal_unit: cleanText((endereco as Record<string, unknown>).uf) || "PR",
          },
          ...(identification ? {
            identification: {
              type: cleanText(identification.type),
              number: cleanText(identification.number),
            },
          } : {}),
        },
      };

      const token = cleanText(formData.token);
      const issuerId = cleanText(formData.issuer_id ?? formData.issuer);
      const installments = Math.max(1, Math.floor(toNumber(formData.installments, 1)));
      if (token) paymentBody.token = token;
      if (issuerId) paymentBody.issuer_id = issuerId;
      if (paymentMethodId !== "pix" && installments) paymentBody.installments = installments;

      const idempotencyKey = cleanText(body?.idempotency_key) || crypto.randomUUID();
      const mpResp = await fetch("https://api.mercadopago.com/v1/payments", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${mercadoPagoToken}`,
          "Content-Type": "application/json",
          "X-Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify(paymentBody),
      });

      const mpData = await mpResp.json().catch(() => ({}));
      if (!mpResp.ok) {
        console.error("mercado pago payment brick error", mpData);
        const cause = Array.isArray((mpData as Record<string, unknown>).cause)
          ? ((mpData as Record<string, unknown>).cause as Array<Record<string, unknown>>)
          : [];
        const mpMessage = cleanText((mpData as Record<string, unknown>).message);
        const pixKeyDisabled = paymentMethodId === "pix" && (
          cause.some((item) => Number(item.code) === 13253)
          || /without key enabled|QR render/i.test(mpMessage)
        );
        try {
          const { error: cancelarError } = await supabase.rpc("atualizar_status_pedido", {
            p_pedido_id: pedidoObj.pedido_id,
            p_novo_status: "cancelado",
            p_motivo: cleanText((mpData as Record<string, unknown>).message) || "Pagamento nao processado",
          });
          if (cancelarError) console.warn("falha ao cancelar pedido apos erro MP", cancelarError);
        } catch (cancelarErr) {
          console.warn("falha ao cancelar pedido apos erro MP", cancelarErr);
        }
        return new Response(JSON.stringify({
          error: pixKeyDisabled
            ? "Pix ainda nao esta habilitado nessa conta do Mercado Pago. Ative/cadastre uma chave Pix no Mercado Pago ou use cartao por enquanto."
            : "Nao consegui processar o pagamento pelo Mercado Pago.",
          codigo: pixKeyDisabled ? "mp_pix_key_not_enabled" : "mp_payment_error",
          detalhe: mpData,
          pedido,
        }), {
          status: pixKeyDisabled ? 409 : 502,
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }

      const status = cleanText((mpData as Record<string, unknown>).status);
      const mpPaymentId = cleanText((mpData as Record<string, unknown>).id);
      if (mpPaymentId) {
        const updatePagamento: Record<string, unknown> = {
          mp_payment_id: mpPaymentId,
          pagamento_status: status === "approved" ? "pago" : "pendente",
        };
        if (status === "approved") {
          updatePagamento.pago_em = new Date().toISOString();
        }

        const { error: mpPedidoUpdateError } = await supabase
          .from("pedidos")
          .update(updatePagamento)
          .eq("id", pedidoObj.pedido_id);

        if (mpPedidoUpdateError) {
          console.warn("falha ao registrar pagamento Mercado Pago no pedido", mpPedidoUpdateError);
        }
      }

      if (["rejected", "cancelled", "refunded", "charged_back"].includes(status)) {
        await supabase.rpc("atualizar_status_pedido", {
          p_pedido_id: pedidoObj.pedido_id,
          p_novo_status: "cancelado",
          p_motivo: cleanText((mpData as Record<string, unknown>).status_detail) || "Pagamento nao aprovado",
        });
      }

      return new Response(JSON.stringify({
        sucesso: true,
        pedido,
        mercado_pago: {
          id: (mpData as Record<string, unknown>).id,
          status,
          status_detail: (mpData as Record<string, unknown>).status_detail,
          payment_method_id: (mpData as Record<string, unknown>).payment_method_id,
          payment_type_id: (mpData as Record<string, unknown>).payment_type_id,
          point_of_interaction: (mpData as Record<string, unknown>).point_of_interaction,
          transaction_details: (mpData as Record<string, unknown>).transaction_details,
        },
      }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    if (acao === "status_pedido_publico") {
      // Acompanhamento do pedido pelo cliente. O pedido_id e um UUID nao-adivinhavel
      // (funciona como link magico); devolve apenas campos seguros de status.
      const pedidoId = cleanText(body?.pedido_id);
      if (!pedidoId) throw new Error("pedido_id nao informado.");

      const { data: pedidoStatus, error: statusError } = await supabase
        .from("pedidos")
        .select("numero_pedido, status, pagamento_status, aceite_status, uber_status, uber_tracking_url")
        .eq("id", pedidoId)
        .single();

      if (statusError || !pedidoStatus) {
        return new Response(JSON.stringify({ error: "pedido nao encontrado" }), {
          status: 404,
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ ok: true, ...pedidoStatus }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    if (acao === "status_pagamento_mp") {
      const mercadoPagoToken = Deno.env.get("MERCADO_PAGO_ACCESS_TOKEN");
      if (!mercadoPagoToken) {
        return new Response(JSON.stringify({ error: "MERCADO_PAGO_ACCESS_TOKEN nao configurado" }), {
          status: 500,
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }

      const paymentId = cleanText(body?.payment_id);
      if (!paymentId) throw new Error("payment_id nao informado.");

      const mpResp = await fetch(
        `https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`,
        { headers: { "Authorization": `Bearer ${mercadoPagoToken}` } },
      );
      const mpData = await mpResp.json().catch(() => ({}));
      if (!mpResp.ok) {
        console.error("mercado pago status error", mpData);
        return new Response(JSON.stringify({ error: "Nao consegui consultar o pagamento.", detalhe: mpData }), {
          status: 502,
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }

      const status = cleanText((mpData as Record<string, unknown>).status);
      const statusDetail = cleanText((mpData as Record<string, unknown>).status_detail);
      const externalReference = cleanText((mpData as Record<string, unknown>).external_reference);

      // Aprovado: marca o pedido como pago (best-effort; nao quebra a resposta se falhar).
      if (status === "approved" && externalReference) {
        try {
          await supabase
            .from("pedidos")
            .update({
              pagamento_status: "pago",
              pago_em: new Date().toISOString(),
              mp_payment_id: paymentId,
            })
            .eq("id", externalReference)
            .or(`pago_em.is.null,pagamento_status.neq.pago`);
        } catch (err) {
          console.warn("falha ao marcar pedido pago (pix)", err);
        }
      }

      return new Response(JSON.stringify({
        status,
        status_detail: statusDetail,
        aprovado: status === "approved",
        pendente: ["pending", "in_process", "authorized"].includes(status),
      }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    if (acao === "criar_checkout") {
      const cfg = mapConfig(config as Record<string, unknown> | null);
      if (!cfg.checkout_mercado_pago_ativo) {
        return new Response(JSON.stringify({ error: "checkout desativado no painel" }), {
          status: 400,
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }

      const mercadoPagoToken = Deno.env.get("MERCADO_PAGO_ACCESS_TOKEN");
      if (!mercadoPagoToken) {
        return new Response(JSON.stringify({
          error: "MERCADO_PAGO_ACCESS_TOKEN nao configurado",
          detalhe: "Adicione o Access Token como secret da Edge Function no Supabase. A Public Key pode ficar no painel, mas o Access Token nunca deve ir para o HTML.",
        }), {
          status: 500,
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }

      const cliente = body?.cliente ?? {};
      const endereco = body?.endereco ?? {};
      const itens = toPedidoItens(body?.itens);

      if (!cleanText((cliente as Record<string, unknown>).nome)) {
        throw new Error("Informe seu nome para fechar o pedido.");
      }
      if (!normalizePhone((cliente as Record<string, unknown>).whatsapp)) {
        throw new Error("Informe um telefone/WhatsApp para o motoboy te encontrar.");
      }
      if (itens.length === 0) {
        throw new Error("Sua sacola esta vazia.");
      }

      const { data: pedido, error: pedidoError } = await supabase.rpc("criar_pedido", {
        p_cliente: {
          nome: cleanText((cliente as Record<string, unknown>).nome),
          whatsapp: normalizePhone((cliente as Record<string, unknown>).whatsapp),
          email: cleanText((cliente as Record<string, unknown>).email) || null,
        },
        p_endereco: {
          cep: cleanText((endereco as Record<string, unknown>).cep) || null,
          logradouro: cleanText((endereco as Record<string, unknown>).logradouro),
          numero: cleanText((endereco as Record<string, unknown>).numero),
          complemento: cleanText((endereco as Record<string, unknown>).complemento) || null,
          bairro: cleanText((endereco as Record<string, unknown>).bairro),
          cidade: cleanText((endereco as Record<string, unknown>).cidade) || "Curitiba",
          uf: cleanText((endereco as Record<string, unknown>).uf) || "PR",
          ponto_referencia: cleanText((endereco as Record<string, unknown>).ponto_referencia) || null,
        },
        p_itens: itens,
        p_forma_pagamento: "mercado_pago",
        p_troco_para: null,
        p_cupom_codigo: cleanText(body?.cupom_codigo) || null,
        p_observacoes: cleanText(body?.observacoes) || null,
        p_origem: "cardapio_garcom_mp",
      });

      if (pedidoError) throw pedidoError;

      const pedidoObj = pedido as Record<string, unknown>;
      const total = toNumber(pedidoObj.total, 0);
      const siteUrl = normalizeSiteUrl(body?.site_url);
      const successUrl = new URL(siteUrl);
      successUrl.searchParams.set("pagamento", "sucesso");
      successUrl.searchParams.set("pedido", String(pedidoObj.numero_pedido ?? ""));
      const pendingUrl = new URL(siteUrl);
      pendingUrl.searchParams.set("pagamento", "pendente");
      pendingUrl.searchParams.set("pedido", String(pedidoObj.numero_pedido ?? ""));
      const failureUrl = new URL(siteUrl);
      failureUrl.searchParams.set("pagamento", "falha");
      failureUrl.searchParams.set("pedido", String(pedidoObj.numero_pedido ?? ""));

      const preferenceBody = {
        items: [{
          title: `Pedido Dom Leonardo #${pedidoObj.numero_pedido}`,
          description: "Cardapio Dom Leonardo",
          quantity: 1,
          currency_id: "BRL",
          unit_price: Number(total.toFixed(2)),
        }],
        payer: {
          name: cleanText((cliente as Record<string, unknown>).nome),
          phone: {
            number: normalizePhone((cliente as Record<string, unknown>).whatsapp),
          },
        },
        external_reference: String(pedidoObj.pedido_id ?? ""),
        statement_descriptor: "DOM LEONARDO",
        back_urls: {
          success: successUrl.href,
          pending: pendingUrl.href,
          failure: failureUrl.href,
        },
        auto_return: "approved",
        metadata: {
          pedido_id: String(pedidoObj.pedido_id ?? ""),
          numero_pedido: String(pedidoObj.numero_pedido ?? ""),
          origem: "cardapio_garcom_mp",
        },
      };

      const mpResp = await fetch("https://api.mercadopago.com/checkout/preferences", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${mercadoPagoToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(preferenceBody),
      });

      const mpData = await mpResp.json().catch(() => ({}));
      if (!mpResp.ok) {
        console.error("mercado pago preference error", mpData);
        return new Response(JSON.stringify({
          error: "Nao consegui criar o checkout do Mercado Pago.",
          detalhe: mpData,
          pedido,
        }), {
          status: 502,
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({
        sucesso: true,
        pedido,
        mercado_pago: {
          preference_id: mpData.id,
          init_point: mpData.init_point,
          sandbox_init_point: mpData.sandbox_init_point,
        },
      }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const [
      categoriasRes,
      secoesRes,
      pratosRes,
      tamanhosRes,
      gruposRes,
      opcionaisRes,
      cuponsRes,
      pratoCuponsRes,
    ] = await Promise.all([
      supabase.from("categorias").select("*").eq("ativo", true).order("ordem").order("nome"),
      supabase.from("cardapio_secoes").select("*").eq("ativo", true).order("ordem").order("titulo"),
      supabase.from("pratos").select("*").eq("ativo", true).order("ordem").order("nome"),
      supabase.from("pratos_tamanhos").select("*").eq("ativo", true).order("ordem").order("nome"),
      supabase.from("grupos_opcionais").select("*").eq("ativo", true).order("ordem").order("nome"),
      supabase.from("opcionais").select("*").eq("ativo", true).order("ordem").order("nome"),
      supabase.from("cupons").select("*").eq("ativo", true).order("criado_em", { ascending: false }),
      supabase.from("prato_cupons").select("*, cupons(*)").eq("ativo", true).order("ordem"),
    ]);

    for (const res of [categoriasRes, secoesRes, pratosRes, tamanhosRes, gruposRes, opcionaisRes, cuponsRes, pratoCuponsRes]) {
      if (res.error) throw res.error;
    }

    const tamanhosByPrato = groupBy(tamanhosRes.data ?? [], "prato_id");
    const gruposByPrato = groupBy(gruposRes.data ?? [], "prato_id");
    const opcionaisByGrupo = groupBy(opcionaisRes.data ?? [], "grupo_id");
    const cuponsByPrato = groupBy(pratoCuponsRes.data ?? [], "prato_id");

    const pratos = (pratosRes.data ?? []).map((prato) => ({
      ...prato,
      foto: prato.foto_url ?? "",
      descricao: prato.descricao_curta ?? prato.descricao_completa ?? "",
      badge: prato.badge_destaque ?? prato.selo_experiencia ?? "",
      preco: toNumber(prato.preco_promocional ?? prato.preco_base, 0),
      tamanhos: (tamanhosByPrato[String(prato.id)] ?? []).map((tam) => ({
        ...tam,
        preco_delta: toNumber(tam.preco_delta, 0),
      })),
      grupos: (gruposByPrato[String(prato.id)] ?? []).map((grupo) => ({
        ...grupo,
        opcionais: (opcionaisByGrupo[String(grupo.id)] ?? []).map((op) => ({
          ...op,
          foto: op.foto_url ?? "",
          preco_delta: toNumber(op.preco_delta, 0),
        })),
      })),
      cupons: (cuponsByPrato[String(prato.id)] ?? []).map((rel) => rel.cupons).filter(Boolean),
    }));

    return new Response(
      JSON.stringify({
        categorias: categoriasRes.data ?? [],
        secoes: secoesRes.data ?? [],
        pratos,
        cupons: cuponsRes.data ?? [],
        config: mapConfig(config as Record<string, unknown> | null),
        microcopy: mapMicrocopy(config as Record<string, unknown> | null),
        chat_config: chatConfig,
      }),
      { headers: { ...cors, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("garcom-responder error:", err);
    const message = String((err as Error)?.message ?? err);
    const status = /Informe|sacola|Pedido sem|Cliente precisa|Endere[cç]o|Prato inv[aá]lido|Tamanho inv[aá]lido|Cupom|Pedido abaixo|Meio de pagamento/i.test(message)
      ? 400
      : 500;
    return new Response(JSON.stringify({ error: String((err as Error)?.message ?? err) }), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});

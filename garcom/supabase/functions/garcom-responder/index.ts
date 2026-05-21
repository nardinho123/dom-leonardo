// Edge Function: garcom-responder
// API publica do cardapio do Garcom:
// apenas entrega cardapio, configuracoes e mensagens automaticas do Marco.

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

function mapConfig(config: Record<string, unknown> | null) {
  const cfg = config ?? {};
  return {
    restaurante_nome: cfg.restaurante_nome ?? "Dom Leonardo",
    restaurante_descricao: cfg.restaurante_descricao ?? "",
    restaurante_logo_url: cfg.restaurante_logo_url ?? null,
    restaurante_capa_url: cfg.restaurante_capa_url ?? null,
    restaurante_capa_tipo: cfg.restaurante_capa_tipo ?? "imagem",
    restaurante_capa_video_url: cfg.restaurante_capa_video_url ?? null,
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

    if (!["listar_pratos", "listar_cardapio", "mensagens_chat"].includes(acao)) {
      return new Response(JSON.stringify({ error: "acao invalida" }), {
        status: 400,
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

    const [
      categoriasRes,
      pratosRes,
      tamanhosRes,
      gruposRes,
      opcionaisRes,
      cuponsRes,
      pratoCuponsRes,
    ] = await Promise.all([
      supabase.from("categorias").select("*").eq("ativo", true).order("ordem").order("nome"),
      supabase.from("pratos").select("*").eq("ativo", true).order("ordem").order("nome"),
      supabase.from("pratos_tamanhos").select("*").eq("ativo", true).order("ordem").order("nome"),
      supabase.from("grupos_opcionais").select("*").eq("ativo", true).order("ordem").order("nome"),
      supabase.from("opcionais").select("*").eq("ativo", true).order("ordem").order("nome"),
      supabase.from("cupons").select("*").eq("ativo", true).order("criado_em", { ascending: false }),
      supabase.from("prato_cupons").select("*, cupons(*)").eq("ativo", true).order("ordem"),
    ]);

    for (const res of [categoriasRes, pratosRes, tamanhosRes, gruposRes, opcionaisRes, cuponsRes, pratoCuponsRes]) {
      if (res.error) throw res.error;
    }

    const tamanhosByPrato = groupBy(tamanhosRes.data ?? [], "prato_id");
    const gruposByPrato = groupBy(gruposRes.data ?? [], "prato_id");
    const opcionaisByGrupo = groupBy(opcionaisRes.data ?? [], "grupo_id");
    const cuponsByPrato = groupBy(pratoCuponsRes.data ?? [], "prato_id");

    const pratos = (pratosRes.data ?? []).map((prato) => ({
      ...prato,
      preco: toNumber(prato.preco_promocional ?? prato.preco_base, 0),
      tamanhos: (tamanhosByPrato[String(prato.id)] ?? []).map((tam) => ({
        ...tam,
        preco_delta: toNumber(tam.preco_delta, 0),
      })),
      grupos: (gruposByPrato[String(prato.id)] ?? []).map((grupo) => ({
        ...grupo,
        opcionais: (opcionaisByGrupo[String(grupo.id)] ?? []).map((op) => ({
          ...op,
          preco_delta: toNumber(op.preco_delta, 0),
        })),
      })),
      cupons: (cuponsByPrato[String(prato.id)] ?? []).map((rel) => rel.cupons).filter(Boolean),
    }));

    return new Response(
      JSON.stringify({
        categorias: categoriasRes.data ?? [],
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
    return new Response(JSON.stringify({ error: String((err as Error)?.message ?? err) }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});

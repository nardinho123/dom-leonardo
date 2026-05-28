// Edge Function: garcom-responder
// API publica do cardapio do Garcom:
// entrega cardapio/configuracoes/mensagens automaticas do Marco
// e cria checkout via Mercado Pago sem expor token secreto no HTML.

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

    if (!["listar_pratos", "listar_cardapio", "mensagens_chat", "registrar_atendimento", "listar_atendimento", "buscar_cliente", "criar_checkout", "processar_pagamento_brick"].includes(acao)) {
      return new Response(JSON.stringify({ error: "acao invalida" }), {
        status: 400,
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
      const payerEmail = cleanText(payer.email);

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
      const total = toNumber(pedidoObj.total, 0);

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

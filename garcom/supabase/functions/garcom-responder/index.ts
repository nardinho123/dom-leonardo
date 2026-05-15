// Edge Function: garcom-responder
// Marco (garcom virtual) responde + opera o carrinho via GPT-4o.
// Fase 3 + 4 do projeto Garcom Digital.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ---------- helpers ----------

function sortearPonderado<T extends { peso: number }>(items: T[]): T | null {
  if (!items || items.length === 0) return null;
  const total = items.reduce((s, i) => s + (i.peso ?? 1), 0);
  let r = Math.random() * total;
  for (const it of items) {
    r -= it.peso ?? 1;
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}

function calcDelay(texto: string, humor: string): number {
  const base = 800 + Math.random() * 2200;
  const lenMult = Math.min(2.5, (texto?.length ?? 0) / 80) * 200;
  const humorMult: Record<string, number> = {
    apressadinho: 0.5,
    filosofo: 1.4,
    sarcastico: 0.9,
    el_bulli: 1.2,
    anfitriao_classico: 1.0,
  };
  return Math.round((base + lenMult) * (humorMult[humor] ?? 1));
}

function nowSP(): string {
  return new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function partOfDay(): string {
  const h = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" })).getHours();
  if (h >= 5 && h < 12) return "manha";
  if (h >= 12 && h < 18) return "tarde";
  if (h >= 18 && h < 23) return "noite";
  return "madrugada";
}

type CartItem = { prato_id: string; nome: string; qtd: number; preco: number; obs?: string };

function calcTotal(carrinho: CartItem[]): number {
  return carrinho.reduce((s, it) => s + (it.preco * it.qtd), 0);
}

function normalizarTelefone(v: string): string {
  return String(v || "").replace(/\D/g, "").slice(0, 14);
}

function parseEndereco(enderecoTexto: string) {
  const raw = String(enderecoTexto || "").trim();
  const partes = raw.split(",").map((p) => p.trim()).filter(Boolean);
  const numeroMatch = raw.match(/\b\d+[a-zA-Z]?\b/);
  const numero = numeroMatch?.[0] || "s/n";
  const logradouro = partes[0] || raw.replace(numero, "").trim() || raw;
  let bairro = partes[2] || partes[1] || "";
  bairro = bairro.replace(numero, "").replace(/^[-\s]+/, "").trim();
  return {
    cep: "",
    logradouro,
    numero,
    complemento: "",
    bairro: bairro || "A confirmar",
    cidade: "Curitiba",
    uf: "PR",
    ponto_referencia: raw,
  };
}

function textoNormalizado(v: string): string {
  return String(v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function querFecharPedido(v: string): boolean {
  const t = textoNormalizado(v);
  return /\b(fechar|finalizar|enviar|manda pro dom|mandar pro dom|pode enviar|concluir)\b/.test(t);
}

function pareceTelefone(v: string): boolean {
  return normalizarTelefone(v).length >= 10;
}

function pareceEndereco(v: string): boolean {
  const t = textoNormalizado(v);
  if (/\b(quero|manda|pede|pedir|adiciona|coloca|risoto|carbonara|nhoque|spaghetti|pao|pedido|fechar)\b/.test(t)) {
    return false;
  }
  return /\d/.test(t) && (t.includes("rua") || t.includes("avenida") || t.includes("av ") || t.includes("av.") || t.includes("bairro") || /^[^,]+,\s*\d+/.test(t));
}

function extrairNomeInformado(v: string): string {
  const raw = String(v || "").trim();
  const match = raw.match(/\b(?:sou|me chamo|meu nome e|meu nome é)\s+(?:o|a)?\s*([^,.]+)/i);
  if (!match) return "";
  return match[1].replace(/\b(quero|manda|pede|pedir|adiciona|coloca)\b.*$/i, "").trim().slice(0, 60);
}

function querTempoExato(v: string): boolean {
  const t = textoNormalizado(v);
  return t.includes("tempo exato") || t.includes("saber o tempo") || t.includes("vai demorar") || t.includes("entrega");
}

function querSaberFome(v: string): boolean {
  const t = textoNormalizado(v);
  return t.includes("matar minha fome") || t.includes("mata minha fome") || t.includes("tamanho") || t.includes("serve duas") || t.includes("serve 2");
}

function respondeuPizza(v: string): boolean {
  const t = textoNormalizado(v);
  return /\b(brotinho|pequena|media|média|grande|familia|família|gigante)\b/.test(t);
}

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function fraseContextual(tipo: string, pratoNome = "", carrinhoTotal = 0): string {
  const nome = pratoNome || "esse prato";
  const partesNome = nome.split(" ").slice(0, 4);
  while (partesNome.length > 1 && /^(de|da|do|das|dos|e)$/i.test(partesNome[partesNome.length - 1])) {
    partesNome.pop();
  }
  const nomeCurto = partesNome.join(" ");

  if (tipo === "prato_hesitacao") {
    return pick([
      `Ta namorando o ${nomeCurto}? Se a duvida for fome, eu te ajudo a escolher sem erro.`,
      `Olha, ${nomeCurto} e daqueles que parecem simples na foto, mas chegam com presenca. Quer que eu te explique o tamanho?`,
      `Boa parada nesse aqui. Se quiser, eu te conto rapidinho se ele e mais leve ou mais jantar de respeito.`,
    ]);
  }

  if (tipo === "prato_passou") {
    return pick([
      `Passou pelo ${nomeCurto} rapidinho... esse ai merecia pelo menos uma olhada torta, viu.`,
      `So avisando: o ${nomeCurto} costuma decidir pedido de gente indecisa.`,
    ]);
  }

  if (tipo === "carrinho_idle" && carrinhoTotal > 0) {
    return pick([
      `Quer que eu revise essa sacola antes de mandar pro Dom? Prometo ser rapido.`,
      `Sua sacola ja ta com cara de jantar. Quer fechar ou quer que eu sugira um ultimo complemento?`,
      `Se quiser, eu confiro tamanho, observacao e tempo antes de voce mandar.`,
    ]);
  }

  return pick([
    "To por aqui. Se bater duvida, me chama que eu traduzo o cardapio sem enrolar.",
    "Se quiser uma recomendacao sincera, eu tenho opiniao forte hoje.",
  ]);
}

const ALERTAS_HUMANOS = [
  "chat_aberto",
  "chat_assobio",
  "mensagem_cliente",
  "cardapio_2min",
  "cliente_quer_fechar",
];

// ---------- handler ----------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "use POST" }), {
      status: 405,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const { acao, sessao_id, mensagem, cliente_nome_provisorio, device_id } = body ?? {};

    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Dois clients: garcom (escrita) e public (leitura dos pratos)
    const sb = createClient(url, serviceKey, { db: { schema: "garcom" } });
    const sbPub = createClient(url, serviceKey);

    async function adminAutorizado() {
      const auth = req.headers.get("Authorization") ?? "";
      const token = auth.replace(/^Bearer\s+/i, "").trim();
      if (!token || token.startsWith("sb_publishable_") || token.split(".").length < 3) return false;
      const { data, error } = await sbPub.auth.getUser(token);
      return !error && !!data?.user;
    }

    async function carregarOuCriarSessaoLeve() {
      let sessaoLeve: any = null;
      if (sessao_id) {
        const { data } = await sb.from("sessoes").select("*").eq("id", sessao_id).maybeSingle();
        sessaoLeve = data;
      }
      if (!sessaoLeve) {
        const { data, error } = await sb.from("sessoes").insert({
          cliente_nome: cliente_nome_provisorio ?? null,
          device_id: device_id ?? null,
          memoria: {},
          carrinho: [],
        }).select().single();
        if (error) throw error;
        sessaoLeve = data;
      }
      return sessaoLeve;
    }

    if (acao === "registrar_evento") {
      const sessaoEvento = await carregarOuCriarSessaoLeve();
      const evento = body?.evento ?? {};
      await sb.from("interaction_logs").insert({
        sessao_id: sessaoEvento.id,
        papel: "evento",
        fala: String(evento?.tipo ?? "evento_cardapio"),
        contexto: { evento },
      });
      return new Response(JSON.stringify({ ok: true, sessao_id: sessaoEvento.id }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    if (acao === "listar_alertas_humanos") {
      if (!(await adminAutorizado())) {
        return new Response(JSON.stringify({ error: "admin nao autorizado" }), {
          status: 401,
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }

      const sinceId = Number(body?.since_id ?? 0);
      let query = sb.from("interaction_logs")
        .select("id,sessao_id,momento,fala,contexto")
        .eq("papel", "evento")
        .in("fala", ALERTAS_HUMANOS)
        .order("id", { ascending: sinceId > 0 })
        .limit(30);

      if (sinceId > 0) query = query.gt("id", sinceId);
      const { data, error } = await query;
      if (error) throw error;

      const alertas = (data ?? []).map((row: any) => ({
        id: row.id,
        sessao_id: row.sessao_id,
        tipo: row.fala,
        momento: row.momento,
        contexto: row.contexto?.evento ?? row.contexto ?? {},
      }));

      return new Response(JSON.stringify({ alertas }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    if (acao === "sugestao_contextual") {
      const sessaoSugestao = await carregarOuCriarSessaoLeve();
      const tipo = String(body?.tipo ?? "geral");
      const pratoNome = String(body?.prato_nome ?? "");
      const carrinhoTotal = Number(body?.carrinho_total ?? 0);
      const texto = fraseContextual(tipo, pratoNome, carrinhoTotal);
      await sb.from("interaction_logs").insert({
        sessao_id: sessaoSugestao.id,
        papel: "evento",
        fala: `sugestao_contextual:${tipo}`,
        contexto: { tipo, prato_nome: pratoNome, carrinho_total: carrinhoTotal, texto },
      });
      return new Response(JSON.stringify({
        sessao_id: sessaoSugestao.id,
        falas: [{ texto, delay_ms: calcDelay(texto, "anfitriao_classico") }],
      }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    if (acao === "listar_pratos") {
      const { data, error } = await sbPub.from("pratos")
        .select("id, nome, descricao_curta, descricao_completa, preco_base, preco_promocional, foto_url, badge_destaque, ordem, ativo")
        .eq("ativo", true)
        .order("ordem", { ascending: true });
      if (error) throw error;
      const { data: config } = await sbPub.from("configuracoes")
        .select("garcom_entrega_texto, garcom_entrega_botao_texto, garcom_tamanhos_texto, garcom_fome_botao_texto")
        .eq("id", 1)
        .maybeSingle();
      return new Response(JSON.stringify({
        pratos: (data ?? []).map((p: any) => ({
          id: p.id,
          nome: p.nome,
          descricao: p.descricao_curta ?? p.descricao_completa ?? "",
          preco: parseFloat(p.preco_promocional ?? p.preco_base ?? 0),
          foto: p.foto_url,
          badge: p.badge_destaque,
        })),
        microcopy: {
          entrega_texto: config?.garcom_entrega_texto ?? "tempo em media para chegar na sua casa 20 a 30 min",
          entrega_botao_texto: config?.garcom_entrega_botao_texto ?? "quero saber o tempo exato",
          tamanhos_texto: config?.garcom_tamanhos_texto ?? "400g individual | 800g serve 2",
          fome_botao_texto: config?.garcom_fome_botao_texto ?? "quero saber se vai matar minha fome",
        },
      }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    if (!mensagem || typeof mensagem !== "string" || !mensagem.trim()) {
      return new Response(JSON.stringify({ error: "mensagem obrigatoria" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // LLM desligada: o Marco agora apenas registra eventos e chama atendimento humano.

    // 1) Carrega ou cria sessao
    let sessao: any = null;
    if (sessao_id) {
      const { data } = await sb.from("sessoes").select("*").eq("id", sessao_id).maybeSingle();
      sessao = data;
    }
    if (!sessao) {
      const { data, error } = await sb.from("sessoes").insert({
        cliente_nome: cliente_nome_provisorio ?? null,
        device_id: device_id ?? null,
        memoria: {},
        carrinho: [],
      }).select().single();
      if (error) throw error;
      sessao = data;
    }

    // 2) Carrega pratos ativos
    const { data: pratosRaw } = await sbPub
      .from("pratos")
      .select("id, nome, descricao_curta, descricao_completa, preco_base, preco_promocional, badge_destaque, tempo_preparo_min")
      .eq("ativo", true);
    const pratos = (pratosRaw ?? []).map((p: any) => ({
      id: p.id,
      nome: p.nome,
      descricao: p.descricao_curta ?? p.descricao_completa ?? "",
      preco: parseFloat(p.preco_promocional ?? p.preco_base ?? 0),
      badge: p.badge_destaque,
      tempo: p.tempo_preparo_min,
    }));

    // 3) Sorteia humor do Marco
    const { data: humoresRaw } = await sb.from("persona_humores")
      .select("*").eq("personagem_id", "marco").eq("ativo", true);
    const humor = sortearPonderado(humoresRaw ?? []) ?? { humor_nome: "anfitriao_classico", prompt_modifier: "" };

    // 4) Curiosidades ainda nao usadas nesta sessao
    const { data: usadas } = await sb.from("interaction_logs")
      .select("curiosidade_usada_id")
      .eq("sessao_id", sessao.id)
      .not("curiosidade_usada_id", "is", null);
    const usadasIds = (usadas ?? []).map((u: any) => u.curiosidade_usada_id).filter(Boolean);

    let curQuery = sb.from("curiosidades").select("id, categoria, texto, tom").eq("ativo", true);
    if (usadasIds.length > 0) {
      curQuery = curQuery.not("id", "in", `(${usadasIds.join(",")})`);
    }
    const { data: curiosidadesDisp } = await curQuery.limit(10);

    // 5) Fato do dia
    const hoje = new Date().toISOString().split("T")[0];
    const { data: fato } = await sb.from("fato_do_dia")
      .select("texto").eq("dia", hoje).maybeSingle();

    // 6) Historico + carrinho atual
    const memoria = (sessao.memoria as any) ?? {};
    const historico: Array<{ role: "user" | "assistant"; content: string }> = memoria.mensagens ?? [];
    let carrinho: CartItem[] = (sessao.carrinho as any) ?? [];
    const clienteMem = memoria.cliente ?? {};
    let cliente_nome = sessao.cliente_nome ?? clienteMem.nome ?? null;
    const enderecoMem = clienteMem.endereco_texto ?? null;
    const telefoneMem = clienteMem.telefone ?? null;

    async function criarPedidoNoAdmin() {
      const nomeFinal = String(sessao.cliente_nome ?? memoria?.cliente?.nome ?? "").trim();
      const enderecoSalvo = String(memoria?.cliente?.endereco_texto ?? "").trim();
      const enderecoFinal = pareceEndereco(enderecoSalvo) ? enderecoSalvo : "";
      const telefoneFinal = normalizarTelefone(memoria?.cliente?.telefone ?? "");
      if (!nomeFinal || !enderecoFinal || !telefoneFinal || !carrinho.length) return null;

      const itens = [];
      for (const item of carrinho) {
        const { data: tamanhoPadrao } = await sbPub.from("pratos_tamanhos")
          .select("id")
          .eq("prato_id", item.prato_id)
          .eq("ativo", true)
          .order("padrao", { ascending: false })
          .order("ordem", { ascending: true })
          .limit(1)
          .maybeSingle();
        itens.push({
          prato_id: item.prato_id,
          tamanho_id: tamanhoPadrao?.id ?? null,
          opcionais_ids: [],
          quantidade: item.qtd,
          observacoes: item.obs ?? null,
        });
      }

      const { data: pedido, error } = await sbPub.rpc("criar_pedido", {
        p_cliente: { nome: nomeFinal, whatsapp: telefoneFinal },
        p_endereco: parseEndereco(enderecoFinal),
        p_itens: itens,
        p_forma_pagamento: "nao_definido",
        p_troco_para: null,
        p_cupom_codigo: null,
        p_observacoes: "Pedido enviado pelo Marco antigo",
        p_origem: "garcom_marco_antigo",
      });
      if (error) throw error;
      memoria.ultimo_pedido_admin = pedido;
      carrinho = [];
      return pedido;
    }

    async function responderDireto(texto: string, eventosDiretos: any[] = [], pedidoDireto: any = null) {
      const novoHistorico = [
        ...historico,
        { role: "user" as const, content: mensagemTexto },
        { role: "assistant" as const, content: texto },
      ].slice(-20);

      await sb.from("sessoes").update({
        cliente_nome: cliente_nome || sessao.cliente_nome || null,
        memoria: { ...memoria, mensagens: novoHistorico },
        carrinho,
        ultima_interacao_em: new Date().toISOString(),
      }).eq("id", sessao.id);

      return new Response(JSON.stringify({
        sessao_id: sessao.id,
        cliente_nome: cliente_nome || sessao.cliente_nome || null,
        humor: "anfitriao_classico",
        falas: [{ texto, delay_ms: calcDelay(texto, "anfitriao_classico") }],
        carrinho,
        total: calcTotal(carrinho),
        eventos: eventosDiretos,
        pedido: pedidoDireto,
      }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    const mensagemTexto = String(mensagem || "");
    let salvouDadoDeFechamento = false;
    const nomeDetectado = extrairNomeInformado(mensagemTexto);
    if (nomeDetectado && !cliente_nome) {
      cliente_nome = nomeDetectado;
      memoria.cliente = { ...(memoria.cliente ?? {}), nome: nomeDetectado };
      salvouDadoDeFechamento = true;
    }
    if (pareceEndereco(mensagemTexto)) {
      memoria.cliente = { ...(memoria.cliente ?? {}), endereco_texto: mensagemTexto.trim() };
      salvouDadoDeFechamento = true;
    }
    if (pareceTelefone(mensagemTexto)) {
      memoria.cliente = { ...(memoria.cliente ?? {}), telefone: normalizarTelefone(mensagemTexto) };
      salvouDadoDeFechamento = true;
    }

    if (memoria.acao_pendente === "tempo_entrega" && !cliente_nome && !pareceEndereco(mensagemTexto) && !pareceTelefone(mensagemTexto) && !querTempoExato(mensagemTexto)) {
      cliente_nome = mensagemTexto.trim().slice(0, 60);
      memoria.cliente = { ...(memoria.cliente ?? {}), nome: cliente_nome };
      salvouDadoDeFechamento = true;
    }

    if (querTempoExato(mensagemTexto) || memoria.acao_pendente === "tempo_entrega") {
      const nomeAtual = String(cliente_nome ?? memoria?.cliente?.nome ?? sessao.cliente_nome ?? "").trim();
      const enderecoSalvo = String(memoria?.cliente?.endereco_texto ?? "").trim();
      if (!nomeAtual) {
        memoria.acao_pendente = "tempo_entrega";
        return await responderDireto("Claro. Antes de calcular certinho, como posso te chamar?");
      }
      if (!pareceEndereco(enderecoSalvo)) {
        memoria.acao_pendente = "tempo_entrega";
        return await responderDireto(`Boa, ${nomeAtual}. Me passa rua, numero e bairro que eu calculo uma estimativa honesta pra voce.`);
      }

      const { data: configEntrega } = await sbPub.from("configuracoes")
        .select("tempo_entrega_min, tempo_entrega_max")
        .eq("id", 1)
        .maybeSingle();
      const min = Number(configEntrega?.tempo_entrega_min ?? 20);
      const max = Number(configEntrega?.tempo_entrega_max ?? 30);
      memoria.acao_pendente = null;
      return await responderDireto(`Para esse endereco, eu trabalharia com ${min} a ${max} min. Nao vou te vender milagre: se o movimento ou a rua complicar, eu te aviso antes de prometer bonito.`);
    }

    if (memoria.acao_pendente === "duvida_fome" && respondeuPizza(mensagemTexto)) {
      memoria.acao_pendente = null;
      const t = textoNormalizado(mensagemTexto);
      const textoFome = (t.includes("grande") || t.includes("familia") || t.includes("gigante"))
        ? "Entao eu iria no 800g sem medo. Ele engana no pote porque risoto parece comportado, mas e bem mais encorpado que pizza: arroz cremoso, carne, molho, queijo... pesa gostoso."
        : "Entao o 400g deve te atender bem se for uma fome normal. Se voce estiver naquela fome de jantar serio, ou for dividir beliscando, o 800g fica mais seguro.";
      return await responderDireto(textoFome);
    }

    if (querSaberFome(mensagemTexto)) {
      memoria.acao_pendente = "duvida_fome";
      return await responderDireto("Boa pergunta. Deixa eu traduzir de um jeito facil: se fossem duas pessoas pedindo pizza, voce pediria pequena, media ou grande?");
    }

    if (carrinho.length && (querFecharPedido(mensagemTexto) || salvouDadoDeFechamento)) {
      const nomeFinal = String(sessao.cliente_nome ?? memoria?.cliente?.nome ?? "").trim();
      const enderecoSalvo = String(memoria?.cliente?.endereco_texto ?? "").trim();
      const enderecoFinal = pareceEndereco(enderecoSalvo) ? enderecoSalvo : "";
      const telefoneFinal = normalizarTelefone(memoria?.cliente?.telefone ?? "");
      let textoFechamento = "";
      let pedidoFechamento = null;

      if (!nomeFinal) {
        textoFechamento = "Claro. Antes de levar pro Dom, como posso te chamar?";
      } else if (!enderecoFinal) {
        textoFechamento = `Boa, ${nomeFinal}. Me passa rua, numero e bairro que eu anoto certinho.`;
      } else if (!telefoneFinal) {
        textoFechamento = "Agora seu telefone, por favor. E so pro motoboy te ligar se nao achar a casa.";
      } else {
        pedidoFechamento = await criarPedidoNoAdmin();
        const numero = pedidoFechamento?.numero_pedido ? ` #${pedidoFechamento.numero_pedido}` : "";
        textoFechamento = `Perfeito, ${nomeFinal}. Enviei seu pedido${numero} para o painel do Dom. Agora e com ele aceitar e a cozinha comecar.`;
      }

      const novoHistorico = [
        ...historico,
        { role: "user" as const, content: mensagemTexto },
        { role: "assistant" as const, content: textoFechamento },
      ].slice(-20);

      await sb.from("sessoes").update({
        cliente_nome: nomeFinal || cliente_nome || null,
        memoria: { ...memoria, mensagens: novoHistorico },
        carrinho,
        ultima_interacao_em: new Date().toISOString(),
      }).eq("id", sessao.id);

      return new Response(JSON.stringify({
        sessao_id: sessao.id,
        cliente_nome: nomeFinal || null,
        humor: "anfitriao_classico",
        falas: [{ texto: textoFechamento, delay_ms: calcDelay(textoFechamento, "anfitriao_classico") }],
        carrinho,
        total: calcTotal(carrinho),
        eventos: pedidoFechamento ? [{ tipo: "pedido_enviado_admin", payload: pedidoFechamento }] : [],
        pedido: pedidoFechamento,
      }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    await sb.from("interaction_logs").insert({
      sessao_id: sessao.id,
      papel: "evento",
      fala: "mensagem_cliente",
      contexto: {
        evento: {
          tipo: "mensagem_cliente",
          mensagem: mensagemTexto,
          descricao: "Cliente mandou mensagem no atendimento humano do Marco",
          carrinho_total: calcTotal(carrinho),
        },
      },
    });

    const respostaAtendimento = pick([
      "Perfeito, mandei sua mensagem pro atendimento. Fica de olho aqui.",
      "Boa, ja avisei o pessoal do Dom. Se quiser complementar, manda mais uma mensagem.",
      "Anotado. O atendimento ja vai ver isso com carinho.",
      "Chegou aqui. Vou deixar isso destacado pro pessoal te responder.",
    ]);

    return await responderDireto(respostaAtendimento, [{
      tipo: "mensagem_cliente",
      payload: { atendimento_humano: true },
    }]);

    // LLM removida: atendimento humano usa respostas locais e eventos para o admin.

  } catch (err) {
    console.error("garcom-responder error:", err);
    return new Response(
      JSON.stringify({ error: String((err as any)?.message ?? err) }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }
});

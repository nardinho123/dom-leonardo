// Edge Function: garcom-responder
// Marco (garcom virtual) responde + opera o carrinho via GPT-4o.
// Fase 3 + 4 do projeto Garcom Digital.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import OpenAI from "https://esm.sh/openai@4.68.0";

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

    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
      return new Response(JSON.stringify({ error: "OPENAI_API_KEY nao configurada" }), {
        status: 500,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    const openai = new OpenAI({ apiKey: openaiKey });

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

    // 7) System prompt
    const carrinhoStr = carrinho.length === 0
      ? "(vazio)"
      : carrinho.map((it, i) =>
          `  [${i}] ${it.qtd}x ${it.nome} (R$ ${it.preco.toFixed(2)}${it.obs ? `, obs: ${it.obs}` : ""})`
        ).join("\n");
    const totalAtual = calcTotal(carrinho);

    const systemPrompt = `Voce e o Marco, garcom virtual do restaurante Dom Leonardo (trattoria italiana de delivery). Brasileiro com sotaque italiano leve. Tem opiniao, paixao pela cozinha do chef Leo, atende como anfitriao real.

==============================
PERSONALIDADE DE HOJE (humor sorteado): ${humor.humor_nome}
${humor.prompt_modifier ?? ""}
==============================

CONTEXTO:
- Cliente: ${cliente_nome ? `chamado(a) ${cliente_nome}` : "ainda nao sei o nome"}
- Endereco salvo: ${enderecoMem ? "sim" : "nao"}
- Telefone salvo: ${telefoneMem ? "sim" : "nao"}
- Periodo do dia: ${partOfDay()} (${nowSP()})
- Fato do dia (use se vier a calhar): ${fato?.texto ?? "(sem fato hoje)"}

CARRINHO ATUAL (total R$ ${totalAtual.toFixed(2)}):
${carrinhoStr}

CURIOSIDADES DO LEO DISPONIVEIS (cada uma pode aparecer no maximo uma vez; cite no maximo UMA por mensagem se realmente couber, marcando o id no final da fala assim: [N]):
${(curiosidadesDisp ?? []).map((c: any) => `[${c.id}] (${c.categoria ?? "geral"}) ${c.texto}`).join("\n")}

PRATOS DO MENU HOJE:
${pratos.map((p: any) => `- ID: ${p.id}\n  Nome: ${p.nome}\n  Preco: R$ ${p.preco.toFixed(2)}\n  Badge: ${p.badge ?? "-"}\n  Descricao: ${p.descricao}`).join("\n\n")}

REGRAS DE COMUNICACAO (nao-negociaveis):
1. NUNCA mencione que e IA, bot, sistema, modelo, GPT, OpenAI. Se perguntarem, fuja com humor leve ("ah, sou so o Marco daqui mesmo, viu?").
2. Frases CURTAS, conversacionais. Nada de listas longas, markdown ou bullet points. Texto corrido.
3. Espelhe o cliente: curto/longo, emoji/sem-emoji, formal/informal.
4. Tenha OPINIAO. Se perguntarem o que recomenda, escolha e defenda.
5. Antecipe duvidas.
6. Se cliente irritado/impaciente, abandone humor e seja empatico+eficiente.
7. NAO de tempo de entrega exato -- diga "ja te confirmo".
8. Se ainda nao sabe o nome, em algum momento pergunte "como posso te chamar?". Use a tool set_cliente_nome quando ele responder.
9. Se o cliente quiser FECHAR o pedido, nao mande formulario. Va como garcom: se faltar nome, pergunte so o nome; se faltar endereco, pergunte rua, numero e bairro; se faltar telefone, pergunte por ultimo dizendo que e so pro motoboy ligar se nao achar a casa.

USO DE TOOLS (importante):
- Quando o cliente CONFIRMAR que quer pedir um prato, use adicionar_ao_carrinho com o ID exato do prato (UUID acima). NAO confirme verbalmente sem chamar a tool.
- Se o cliente pedir pra remover/alterar, use remover_do_carrinho ou alterar_observacao com o INDICE (0, 1, 2...) do item no carrinho atual.
- Use sugerir_harmonizacao quando o cliente ja tiver escolhido prato principal e voce quiser oferecer bebida ou sobremesa.
- Use salvar_endereco quando o cliente mandar rua, numero e bairro.
- Use salvar_telefone quando o cliente mandar telefone/WhatsApp.
- Use enviar_pedido_admin somente quando carrinho nao estiver vazio, nome, endereco e telefone ja estiverem salvos, e o cliente confirmar que quer fechar.
- Apos chamar uma tool de carrinho, na proxima fala CONFIRME pro cliente o que foi feito de forma natural ("anotado: 1 Risoto, vai mais alguma coisa?").

Responda em PORTUGUES BRASILEIRO. Respostas curtas -- 1 a 3 frases idealmente.`;

    // 8) Tools
    const tools = [
      {
        type: "function" as const,
        function: {
          name: "set_cliente_nome",
          description: "Use quando o cliente disser como quer ser chamado. Registra no perfil.",
          parameters: {
            type: "object",
            properties: { nome: { type: "string", description: "Nome ou apelido" } },
            required: ["nome"],
          },
        },
      },
      {
        type: "function" as const,
        function: {
          name: "adicionar_ao_carrinho",
          description: "Adiciona um prato ao carrinho. Use o prato_id (UUID) do menu. Se quantidade nao for dita, assuma 1.",
          parameters: {
            type: "object",
            properties: {
              prato_id: { type: "string", description: "UUID do prato (vem do menu acima)" },
              qtd: { type: "integer", minimum: 1, default: 1 },
              observacoes: { type: "string", description: "Ex: 'sem cebola', 'bem passado'" },
            },
            required: ["prato_id"],
          },
        },
      },
      {
        type: "function" as const,
        function: {
          name: "remover_do_carrinho",
          description: "Remove um item do carrinho pelo indice (0-based, conforme listado em CARRINHO ATUAL).",
          parameters: {
            type: "object",
            properties: { indice: { type: "integer", minimum: 0 } },
            required: ["indice"],
          },
        },
      },
      {
        type: "function" as const,
        function: {
          name: "alterar_observacao",
          description: "Altera a observacao de um item do carrinho.",
          parameters: {
            type: "object",
            properties: {
              indice: { type: "integer", minimum: 0 },
              observacoes: { type: "string" },
            },
            required: ["indice", "observacoes"],
          },
        },
      },
      {
        type: "function" as const,
        function: {
          name: "sugerir_harmonizacao",
          description: "Sugere uma bebida ou sobremesa pra acompanhar o prato principal. NAO adiciona ao carrinho, so retorna sugestao texto que voce pode usar na fala.",
          parameters: {
            type: "object",
            properties: { prato_id: { type: "string", description: "UUID do prato principal" } },
            required: ["prato_id"],
          },
        },
      },
      {
        type: "function" as const,
        function: {
          name: "salvar_endereco",
          description: "Registra o endereco em texto livre quando o cliente informar rua, numero e bairro.",
          parameters: {
            type: "object",
            properties: {
              endereco_texto: { type: "string", description: "Endereco completo em texto livre" },
            },
            required: ["endereco_texto"],
          },
        },
      },
      {
        type: "function" as const,
        function: {
          name: "salvar_telefone",
          description: "Registra telefone/WhatsApp do cliente para o motoboy ligar se nao achar a casa.",
          parameters: {
            type: "object",
            properties: {
              telefone: { type: "string", description: "Telefone ou WhatsApp do cliente" },
            },
            required: ["telefone"],
          },
        },
      },
      {
        type: "function" as const,
        function: {
          name: "enviar_pedido_admin",
          description: "Cria o pedido no painel admin quando nome, endereco, telefone e carrinho ja estiverem prontos.",
          parameters: {
            type: "object",
            properties: {},
          },
        },
      },
    ];

    // 9) Chamada inicial
    const novaMsgUsuario = { role: "user" as const, content: mensagem };
    const messages: any[] = [
      { role: "system", content: systemPrompt },
      ...historico,
      novaMsgUsuario,
    ];

    let completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages,
      tools,
      tool_choice: "auto",
      temperature: 0.9,
      max_tokens: 500,
    });

    let respMsg: any = completion.choices[0].message;
    let nomeRegistrado: string | null = null;
    let pedidoCriado: any = null;
    const toolsUsadas: string[] = [];
    const eventos: Array<{ tipo: string; payload: any }> = [];

    // 10) Tool call loop (max 2 iteracoes pra prevenir loops infinitos)
    let iter = 0;
    while (respMsg.tool_calls && respMsg.tool_calls.length > 0 && iter < 2) {
      iter++;
      messages.push(respMsg);

      for (const tc of respMsg.tool_calls) {
        let args: any = {};
        try { args = JSON.parse(tc.function.arguments ?? "{}"); } catch (_) {}
        let resultado = "ok";
        toolsUsadas.push(tc.function.name);

        switch (tc.function.name) {
          case "set_cliente_nome": {
            if (args.nome) {
              nomeRegistrado = String(args.nome).slice(0, 60);
              memoria.cliente = { ...(memoria.cliente ?? {}), nome: nomeRegistrado };
              await sb.from("sessoes").update({ cliente_nome: nomeRegistrado, memoria }).eq("id", sessao.id);
              resultado = `Nome registrado: ${nomeRegistrado}`;
            } else resultado = "Erro: nome vazio";
            break;
          }
          case "adicionar_ao_carrinho": {
            const prato = pratos.find((p: any) => p.id === args.prato_id);
            if (!prato) {
              resultado = `Erro: prato_id ${args.prato_id} nao existe no menu`;
            } else {
              const qtd = Math.max(1, parseInt(args.qtd ?? 1, 10));
              const obs = (args.observacoes ?? "").trim();
              // Se ja tem o mesmo prato com mesma obs, incrementa
              const idxIgual = carrinho.findIndex(
                (it) => it.prato_id === prato.id && (it.obs ?? "") === obs
              );
              if (idxIgual >= 0) {
                carrinho[idxIgual].qtd += qtd;
              } else {
                carrinho.push({
                  prato_id: prato.id,
                  nome: prato.nome,
                  preco: prato.preco,
                  qtd,
                  obs: obs || undefined,
                });
              }
              eventos.push({ tipo: "carrinho_adicionado", payload: { prato_id: prato.id, nome: prato.nome, qtd } });
              resultado = `OK. Carrinho agora: ${carrinho.length} item(ns), total R$ ${calcTotal(carrinho).toFixed(2)}.`;
            }
            break;
          }
          case "remover_do_carrinho": {
            const idx = parseInt(args.indice ?? -1, 10);
            if (idx >= 0 && idx < carrinho.length) {
              const removido = carrinho[idx];
              carrinho.splice(idx, 1);
              eventos.push({ tipo: "carrinho_removido", payload: removido });
              resultado = `OK. Removido: ${removido.nome}. Carrinho agora: ${carrinho.length} item(ns).`;
            } else {
              resultado = `Erro: indice ${idx} invalido (carrinho tem ${carrinho.length} itens).`;
            }
            break;
          }
          case "alterar_observacao": {
            const idx = parseInt(args.indice ?? -1, 10);
            if (idx >= 0 && idx < carrinho.length) {
              carrinho[idx].obs = String(args.observacoes ?? "").trim() || undefined;
              eventos.push({ tipo: "carrinho_alterado", payload: { indice: idx, obs: carrinho[idx].obs } });
              resultado = `OK. Observacao atualizada no item ${idx}.`;
            } else {
              resultado = `Erro: indice ${idx} invalido.`;
            }
            break;
          }
          case "sugerir_harmonizacao": {
            const prato = pratos.find((p: any) => p.id === args.prato_id);
            // Implementacao simples por categoria do nome - depois pode virar logica mais rica
            const nome = (prato?.nome ?? "").toLowerCase();
            let sugestao = "agua com gas e uma sobremesa leve";
            if (nome.includes("risot") || nome.includes("carbonara") || nome.includes("nhoque")) {
              sugestao = "um vinho branco seco ou suco de uva integral; e o Tiramisu pra fechar.";
            } else if (nome.includes("pao") || nome.includes("costela")) {
              sugestao = "vinho tinto encorpado ou cerveja artesanal; sobremesa pode ser leve.";
            }
            resultado = `Sugestao de harmonizacao para ${prato?.nome ?? "esse prato"}: ${sugestao}`;
            break;
          }
          case "salvar_endereco": {
            const endereco = String(args.endereco_texto ?? "").trim();
            if (endereco && pareceEndereco(endereco)) {
              memoria.cliente = { ...(memoria.cliente ?? {}), endereco_texto: endereco };
              await sb.from("sessoes").update({ memoria }).eq("id", sessao.id);
              resultado = "Endereco registrado.";
            } else {
              resultado = "Erro: endereco invalido. Peca rua, numero e bairro.";
            }
            break;
          }
          case "salvar_telefone": {
            const tel = normalizarTelefone(args.telefone ?? "");
            if (tel) {
              memoria.cliente = { ...(memoria.cliente ?? {}), telefone: tel };
              await sb.from("sessoes").update({ memoria }).eq("id", sessao.id);
              resultado = "Telefone registrado.";
            } else {
              resultado = "Erro: telefone vazio.";
            }
            break;
          }
          case "enviar_pedido_admin": {
            const nomeFinal = String(nomeRegistrado ?? sessao.cliente_nome ?? memoria?.cliente?.nome ?? "").trim();
            const enderecoSalvo = String(memoria?.cliente?.endereco_texto ?? "").trim();
            const enderecoFinal = pareceEndereco(enderecoSalvo) ? enderecoSalvo : "";
            const telefoneFinal = normalizarTelefone(memoria?.cliente?.telefone ?? "");
            if (!carrinho.length) {
              resultado = "Erro: carrinho vazio. Antes de enviar, ajude o cliente a escolher pelo menos um prato.";
              break;
            }
            if (!nomeFinal || !enderecoFinal || !telefoneFinal) {
              resultado = `Erro: dados faltando. nome=${!!nomeFinal}, endereco=${!!enderecoFinal}, telefone=${!!telefoneFinal}. Pergunte apenas o proximo dado faltante.`;
              break;
            }

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
            pedidoCriado = pedido;
            eventos.push({ tipo: "pedido_enviado_admin", payload: pedido });
            carrinho = [];
            memoria.ultimo_pedido_admin = pedido;
            resultado = `Pedido enviado ao painel. Numero: ${pedido?.numero_pedido ?? "a confirmar"}.`;
            break;
          }
        }

        messages.push({ role: "tool", tool_call_id: tc.id, content: resultado });
      }

      // Apos as tools, pede uma fala final
      completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages,
        tools,
        tool_choice: "auto",
        temperature: 0.9,
        max_tokens: 400,
      });
      respMsg = completion.choices[0].message;
    }

    const falaBruta = (respMsg.content ?? "").trim();

    // 11) Extrai marca de curiosidade [N]
    let curiosidadeUsadaId: number | null = null;
    let fala = falaBruta;
    const m = falaBruta.match(/\[(\d+)\]/);
    if (m) {
      curiosidadeUsadaId = parseInt(m[1], 10);
      fala = falaBruta.replace(/\s*\[\d+\]\s*/g, " ").trim();
    }

    // 12) Atualiza memoria + carrinho no banco
    const novoHistorico = [
      ...historico,
      novaMsgUsuario,
      { role: "assistant" as const, content: fala },
    ].slice(-20);

    await sb.from("sessoes").update({
      cliente_nome: cliente_nome ?? sessao.cliente_nome ?? null,
      memoria: { ...memoria, mensagens: novoHistorico, ultimo_humor: humor.humor_nome },
      carrinho,
      ultima_interacao_em: new Date().toISOString(),
    }).eq("id", sessao.id);

    // 13) Loga interacoes
    await sb.from("interaction_logs").insert([
      { sessao_id: sessao.id, papel: "cliente", fala: mensagem },
      {
        sessao_id: sessao.id,
        personagem_id: "marco",
        papel: "garcom",
        fala,
        humor_sorteado: humor.humor_nome,
        curiosidade_usada_id: curiosidadeUsadaId,
        tool_usada: toolsUsadas.length > 0 ? toolsUsadas.join(",") : null,
        contexto: { eventos },
      },
    ]);

    return new Response(
      JSON.stringify({
        sessao_id: sessao.id,
        cliente_nome: nomeRegistrado ?? cliente_nome ?? sessao.cliente_nome,
        humor: humor.humor_nome,
        falas: [{ texto: fala, delay_ms: calcDelay(fala, humor.humor_nome) }],
        carrinho,
        total: calcTotal(carrinho),
        eventos,
        pedido: pedidoCriado,
      }),
      { headers: { ...cors, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("garcom-responder error:", err);
    return new Response(
      JSON.stringify({ error: String((err as any)?.message ?? err) }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }
});

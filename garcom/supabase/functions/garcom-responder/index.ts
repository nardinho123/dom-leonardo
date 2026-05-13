// Edge Function: garcom-responder
// Marco conversa com o cliente, salva dados de sessao e envia pedidos ao admin.
// O cardapio visual monta a sacola; o Marco guia nome, endereco e telefone.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import OpenAI from "https://esm.sh/openai@4.68.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Humor = { humor_nome: string; prompt_modifier?: string; peso: number };
type Fala = { autor: "marco"; destinatario: "cliente"; texto: string; delay_ms: number; tipo: "salao" };
type MemoryMessage = { role: "user" | "assistant"; content: string };

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function sortearPonderado<T extends { peso: number }>(items: T[]): T | null {
  if (!items?.length) return null;
  const total = items.reduce((s, i) => s + (i.peso ?? 1), 0);
  let r = Math.random() * total;
  for (const item of items) {
    r -= item.peso ?? 1;
    if (r <= 0) return item;
  }
  return items[items.length - 1];
}

function calcDelay(texto: string, humor: string): number {
  const base = 800 + Math.random() * 1900;
  const lenMult = Math.min(2.3, (texto?.length ?? 0) / 90) * 190;
  const humorMult: Record<string, number> = {
    apressadinho: 0.55,
    filosofo: 1.35,
    sarcastico: 0.88,
    el_bulli: 1.12,
    anfitriao_classico: 1,
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

function fala(texto: string, humor = "anfitriao_classico"): Fala {
  return { autor: "marco", destinatario: "cliente", texto, delay_ms: calcDelay(texto, humor), tipo: "salao" };
}

function msg(role: "user" | "assistant", content: string): MemoryMessage | null {
  const text = String(content || "").trim();
  if (!text) return null;
  return { role, content: text.slice(0, 1400) };
}

function withMemory(memoria: Record<string, any>, entries: Array<MemoryMessage | null>) {
  const current = Array.isArray(memoria.mensagens) ? memoria.mensagens : [];
  const cleanEntries = entries.filter(Boolean) as MemoryMessage[];
  return { ...memoria, mensagens: [...current, ...cleanEntries].slice(-20) };
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
  bairro = bairro.replace(numero, "").replace(/^[-–—\s]+/, "").trim();
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

function compactCartForMemory(carrinho: any[]) {
  return (carrinho || []).map((it) => ({
    nome: it?.prato?.nome ?? it?.nome,
    quantidade: Number(it?.quantidade ?? it?.qtd ?? 1),
    tamanho: it?.tamanho?.nome ?? null,
    opcionais: (it?.opcionais ?? []).map((o: any) => o.nome),
    observacoes: it?.observacoes ?? it?.obs ?? null,
    preco_unitario: Number(it?.preco_unitario ?? it?.preco ?? 0),
  }));
}

function cartToPedidoItens(carrinho: any[]) {
  return (carrinho || []).map((it) => ({
    prato_id: it?.prato?.id ?? it?.prato_id,
    tamanho_id: it?.tamanho?.id ?? it?.tamanho_id ?? null,
    opcionais_ids: (it?.opcionais ?? []).map((o: any) => o.id).filter(Boolean),
    quantidade: Number(it?.quantidade ?? it?.qtd ?? 1),
    observacoes: it?.observacoes || it?.obs || null,
  })).filter((it) => it.prato_id && it.quantidade > 0);
}

function cartTotal(carrinho: any[]) {
  return (carrinho || []).reduce((sum, it) => {
    const qtd = Number(it?.quantidade ?? it?.qtd ?? 1);
    const unit = Number(it?.preco_unitario ?? it?.preco ?? 0);
    return sum + qtd * unit;
  }, 0);
}

function carrinhoResumo(carrinho: any[]) {
  if (!(carrinho || []).length) return "(vazio)";
  return carrinho.map((it: any, i: number) => {
    const nome = it?.prato?.nome ?? it?.nome ?? "item";
    const qtd = Number(it?.quantidade ?? it?.qtd ?? 1);
    const tamanho = it?.tamanho?.nome ? ` (${it.tamanho.nome})` : "";
    const obs = it?.observacoes || it?.obs ? `, obs: ${it.observacoes || it.obs}` : "";
    const unit = Number(it?.preco_unitario ?? it?.preco ?? 0);
    return `[${i}] ${qtd}x ${nome}${tamanho} - R$ ${unit.toFixed(2)}${obs}`;
  }).join("\n");
}

function makeUid() {
  return crypto.randomUUID();
}

function normText(v: string) {
  return String(v || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function parecePedido(texto: string) {
  const t = normText(texto);
  return /\b(quero|manda|mandar|bota|coloca|adiciona|adicionar|pede|pedir|me ve|me vê|vou querer)\b/.test(t);
}

async function ensureSession(sb: any, sessaoId: string | null, clienteNome: string | null, deviceId: string | null) {
  if (sessaoId) {
    const { data } = await sb.from("sessoes").select("*").eq("id", sessaoId).maybeSingle();
    if (data) return data;
  }

  const { data, error } = await sb.from("sessoes").insert({
    cliente_nome: clienteNome ?? null,
    device_id: deviceId ?? null,
    memoria: {},
    carrinho: [],
  }).select().single();

  if (error) throw error;
  return data;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "use POST" }, 405);

  try {
    const body = await req.json();
    const {
      acao,
      sessao_id,
      mensagem,
      cliente_nome_provisorio,
      device_id,
      nome,
      endereco_texto,
      telefone,
      cliente,
      carrinho,
      observacoes,
    } = body ?? {};

    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(url, serviceKey, { db: { schema: "garcom" } });
    const sbPub = createClient(url, serviceKey);

    if (acao === "listar_pratos") {
      const { data, error } = await sbPub.from("pratos")
        .select("id, nome, descricao_curta, descricao_completa, preco_base, preco_promocional, foto_url, badge_destaque, ordem, ativo")
        .eq("ativo", true)
        .order("ordem", { ascending: true });
      if (error) throw error;
      return json({
        pratos: (data ?? []).map((p: any) => ({
          id: p.id,
          nome: p.nome,
          descricao: p.descricao_curta ?? p.descricao_completa ?? "",
          preco: parseFloat(p.preco_promocional ?? p.preco_base ?? 0),
          foto: p.foto_url,
          badge: p.badge_destaque,
        })),
      });
    }

    const sessao = await ensureSession(
      sb,
      sessao_id ?? null,
      cliente_nome_provisorio ?? cliente?.nome ?? null,
      device_id ?? null,
    );
    const memoria = (sessao.memoria as Record<string, any>) ?? {};

    if (acao === "salvar_nome") {
      const nomeFinal = String(nome || cliente?.nome || "").trim().slice(0, 80);
      if (!nomeFinal) return json({ error: "nome obrigatorio" }, 400);
      const resposta = `Prazer, ${nomeFinal}. Agora ficou mais bonito de atender.`;
      const nextMemoria = withMemory(
        { ...memoria, cliente: { ...(memoria.cliente ?? {}), nome: nomeFinal } },
        [msg("user", `Meu nome e ${nomeFinal}`), msg("assistant", resposta)],
      );
      await sb.from("sessoes").update({ cliente_nome: nomeFinal, memoria: nextMemoria }).eq("id", sessao.id);
      return json({ sessao_id: sessao.id, cliente_nome: nomeFinal, falas: [fala(resposta)] });
    }

    if (acao === "salvar_endereco") {
      const enderecoFinal = String(endereco_texto || cliente?.endereco_texto || "").trim();
      if (!enderecoFinal) return json({ error: "endereco obrigatorio" }, 400);
      const resposta = "Anotei o endereco. Ja da pra trabalhar com uma estimativa mais honesta.";
      const nextMemoria = withMemory(
        { ...memoria, cliente: { ...(memoria.cliente ?? {}), endereco_texto: enderecoFinal } },
        [msg("user", `Meu endereco e ${enderecoFinal}`), msg("assistant", resposta)],
      );
      await sb.from("sessoes").update({ memoria: nextMemoria }).eq("id", sessao.id);
      return json({ sessao_id: sessao.id, falas: [fala(resposta)] });
    }

    if (acao === "salvar_telefone") {
      const telefoneFinal = normalizarTelefone(telefone || cliente?.telefone || "");
      if (!telefoneFinal) return json({ error: "telefone obrigatorio" }, 400);
      const resposta = "Telefone anotado. So uso pra entrega nao virar caca ao tesouro, prometo.";
      const nextMemoria = withMemory(
        { ...memoria, cliente: { ...(memoria.cliente ?? {}), telefone: telefoneFinal } },
        [msg("user", `Meu telefone e ${telefoneFinal}`), msg("assistant", resposta)],
      );
      await sb.from("sessoes").update({ memoria: nextMemoria }).eq("id", sessao.id);
      return json({ sessao_id: sessao.id, falas: [fala(resposta)] });
    }

    if (acao === "estimar_entrega") {
      const enderecoFinal = String(endereco_texto || cliente?.endereco_texto || memoria?.cliente?.endereco_texto || "").trim();
      const { data: config } = await sbPub.from("configuracoes").select("*").eq("id", 1).maybeSingle();
      const min = Number(config?.tempo_entrega_min ?? 35);
      const max = Number(config?.tempo_entrega_max ?? 50);
      const texto = enderecoFinal
        ? `Pra ${enderecoFinal}, eu trabalharia com algo perto de ${min}-${max} min agora. Não vou te vender milagre: se a rua travar ou o movimento subir, eu te aviso.`
        : `Sem endereço eu fico no chute bonito: hoje a base está perto de ${min}-${max} min. Me passa rua, número e bairro que eu afino isso.`;
      const nextMemoria = withMemory(
        enderecoFinal
          ? { ...memoria, cliente: { ...(memoria.cliente ?? {}), endereco_texto: enderecoFinal }, ultima_estimativa: { min, max, em: new Date().toISOString() } }
          : { ...memoria, ultima_estimativa: { min, max, em: new Date().toISOString() } },
        [msg("user", enderecoFinal ? `Quero saber o tempo para ${enderecoFinal}` : "Quero saber o tempo de entrega"), msg("assistant", texto)],
      );
      await sb.from("sessoes").update({ memoria: nextMemoria }).eq("id", sessao.id);
      return json({ sessao_id: sessao.id, estimativa: { min, max }, falas: [fala(texto)] });
    }

    if (acao === "enviar_pedido_admin") {
      const nomeFinal = String(cliente?.nome || sessao.cliente_nome || memoria?.cliente?.nome || "").trim();
      const telefoneFinal = normalizarTelefone(cliente?.telefone || memoria?.cliente?.telefone || "");
      const enderecoTextoFinal = String(cliente?.endereco_texto || memoria?.cliente?.endereco_texto || "").trim();
      const itens = cartToPedidoItens(carrinho || []);

      if (!nomeFinal) return json({ error: "nome obrigatorio para enviar pedido" }, 400);
      if (!enderecoTextoFinal) return json({ error: "endereco obrigatorio para enviar pedido" }, 400);
      if (!telefoneFinal) return json({ error: "telefone obrigatorio para enviar pedido" }, 400);
      if (!itens.length) return json({ error: "sacola vazia" }, 400);

      for (const item of itens) {
        if (!item.tamanho_id) {
          const { data: tamanhoPadrao } = await sbPub.from("pratos_tamanhos")
            .select("id")
            .eq("prato_id", item.prato_id)
            .eq("ativo", true)
            .order("padrao", { ascending: false })
            .order("ordem", { ascending: true })
            .limit(1)
            .maybeSingle();
          item.tamanho_id = tamanhoPadrao?.id ?? null;
        }
      }

      const payload = {
        p_cliente: { nome: nomeFinal, whatsapp: telefoneFinal },
        p_endereco: parseEndereco(enderecoTextoFinal),
        p_itens: itens,
        p_forma_pagamento: "nao_definido",
        p_troco_para: null,
        p_cupom_codigo: null,
        p_observacoes: observacoes || "Pedido enviado pelo Cardapio Garcom Hibrido",
        p_origem: "cardapio_garcom_hibrido",
      };

      const { data: pedido, error } = await sbPub.rpc("criar_pedido", payload);
      if (error) throw error;

      const numero = pedido?.numero_pedido ? ` #${pedido.numero_pedido}` : "";
      const respostaPedido = `Perfeito, ${nomeFinal}. Enviei seu pedido${numero} para o Dom analisar. Agora ele aceita ou recusa no painel antes da cozinha comecar.`;
      const nextMemoria = withMemory(
        {
          ...memoria,
          cliente: { ...(memoria.cliente ?? {}), nome: nomeFinal, telefone: telefoneFinal, endereco_texto: enderecoTextoFinal },
          ultimo_pedido_draft: compactCartForMemory(carrinho || []),
          ultimo_pedido_admin: pedido,
        },
        [msg("user", `Finalizar pedido: ${compactCartForMemory(carrinho || []).map((it) => `${it.quantidade}x ${it.nome}`).join(", ")}`), msg("assistant", respostaPedido)],
      );
      await sb.from("sessoes").update({
        cliente_nome: nomeFinal,
        memoria: nextMemoria,
        carrinho: [],
        ultima_interacao_em: new Date().toISOString(),
      }).eq("id", sessao.id);

      await sb.from("interaction_logs").insert({
        sessao_id: sessao.id,
        personagem_id: "marco",
        papel: "garcom",
        fala: "Pedido enviado ao admin",
        tool_usada: "enviar_pedido_admin",
        contexto: { pedido, total_estimado: cartTotal(carrinho || []) },
      });

      return json({
        sessao_id: sessao.id,
        cliente_nome: nomeFinal,
        pedido,
        carrinho: [],
        total: cartTotal(carrinho || []),
        eventos: [{ tipo: "pedido_enviado_admin", payload: pedido }],
        falas: [fala(respostaPedido)],
      });
    }

    if (!mensagem || typeof mensagem !== "string" || !mensagem.trim()) {
      return json({ error: "mensagem obrigatoria" }, 400);
    }

    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) return json({ error: "OPENAI_API_KEY nao configurada" }, 500);

    const openai = new OpenAI({ apiKey: openaiKey });

    const { data: humoresRaw } = await sb.from("persona_humores")
      .select("*")
      .eq("personagem_id", "marco")
      .eq("ativo", true);
    const humor = sortearPonderado((humoresRaw ?? []) as Humor[]) ?? { humor_nome: "anfitriao_classico", prompt_modifier: "", peso: 1 };

    const { data: curiosidadesDisp } = await sb.from("curiosidades")
      .select("id, categoria, texto, tom")
      .eq("ativo", true)
      .limit(8);

    const { data: pratosRaw } = await sbPub.from("pratos")
      .select("id, nome, descricao_curta, descricao_completa, preco_base, preco_promocional, foto_url, badge_destaque")
      .eq("ativo", true)
      .limit(20);

    const { data: fato } = await sb.from("fato_do_dia")
      .select("texto")
      .eq("dia", new Date().toISOString().split("T")[0])
      .maybeSingle();

    const historico: Array<{ role: "user" | "assistant"; content: string }> = Array.isArray(memoria.mensagens)
      ? memoria.mensagens.slice(-20)
      : [];
    const clienteMem = memoria.cliente ?? {};
    const clienteNome = sessao.cliente_nome || clienteMem.nome || null;
    const enderecoMem = clienteMem.endereco_texto || null;
    const telefoneMem = clienteMem.telefone || null;
    let carrinhoAtual: any[] = Array.isArray(sessao.carrinho) ? sessao.carrinho : [];
    const eventos: Array<{ tipo: string; payload: any }> = [];

    async function adicionarPratoAoCarrinho(prato: any, qtdRaw = 1, observacoesRaw = "") {
      const { data: tamanhoPadrao } = await sbPub.from("pratos_tamanhos")
        .select("id, prato_id, nome, preco_delta, padrao, ordem")
        .eq("prato_id", prato.id)
        .eq("ativo", true)
        .order("padrao", { ascending: false })
        .order("ordem", { ascending: true })
        .limit(1)
        .maybeSingle();

      let precoUnitario = Number(prato.preco_promocional ?? prato.preco_base ?? 0) + Number(tamanhoPadrao?.preco_delta ?? 0);
      const { data: precoCalc, error: precoError } = await sbPub.rpc("calcular_preco_item", {
        p_prato_id: prato.id,
        p_tamanho_id: tamanhoPadrao?.id ?? null,
        p_opcionais_ids: [],
      });
      if (!precoError && precoCalc !== null && precoCalc !== undefined) {
        precoUnitario = Number(precoCalc);
      }

      const qtd = Math.max(1, Number(qtdRaw || 1));
      const obs = String(observacoesRaw || "").trim();
      const novoItem = {
        uid: makeUid(),
        prato: {
          id: prato.id,
          nome: prato.nome,
          descricao_curta: prato.descricao_curta,
          descricao_completa: prato.descricao_completa,
          foto_url: prato.foto_url,
          preco_base: prato.preco_base,
          preco_promocional: prato.preco_promocional,
          badge_destaque: prato.badge_destaque,
        },
        tamanho: tamanhoPadrao ? {
          id: tamanhoPadrao.id,
          nome: tamanhoPadrao.nome,
          preco_delta: tamanhoPadrao.preco_delta,
        } : null,
        opcionais: [],
        quantidade: qtd,
        observacoes: obs,
        preco_unitario: precoUnitario,
      };
      carrinhoAtual = [...carrinhoAtual, novoItem];
      eventos.push({ tipo: "carrinho_adicionado", payload: { nome: prato.nome, qtd, preco_unitario: precoUnitario } });
      return novoItem;
    }

    const systemPrompt = `Voce e o Marco, garcom virtual do restaurante Dom Leonardo, uma trattoria italiana de delivery. Voce nao e um formulario: voce e o garcom da casa. Tem opiniao propria, paixao pela comida do Leo, humor leve e a missao de transformar duvida em fome e fome em pedido, sem pressionar.

HUMOR SORTEADO: ${humor.humor_nome}
${humor.prompt_modifier ?? ""}

CONTEXTO:
- Cliente: ${clienteNome ? clienteNome : "ainda nao sei o nome"}
- Endereco salvo: ${enderecoMem ? "sim" : "nao"}
- Telefone salvo: ${telefoneMem ? "sim" : "nao"}
- Periodo: ${partOfDay()} (${nowSP()})
- Fato do dia: ${fato?.texto ?? "(sem fato hoje)"}

CARRINHO ATUAL (total R$ ${cartTotal(carrinhoAtual).toFixed(2)}):
${carrinhoResumo(carrinhoAtual)}

PRATOS ATIVOS:
${(pratosRaw ?? []).map((p: any) => `- ID: ${p.id}\n  Nome: ${p.nome}\n  Preco base: R$ ${Number(p.preco_promocional ?? p.preco_base ?? 0).toFixed(2)}\n  Etiqueta: ${p.badge_destaque ?? "sem etiqueta"}\n  Descricao: ${p.descricao_curta ?? p.descricao_completa ?? ""}`).join("\n\n")}

CURIOSIDADES DO LEO (use no maximo uma se encaixar):
${(curiosidadesDisp ?? []).map((c: any) => `- ${c.texto}`).join("\n")}

REGRAS DE HUMANIZACAO:
1. Nunca diga que e IA, bot, GPT, OpenAI ou sistema.
2. Nada de conversa entre Marco e Leo. Quem fala com o cliente e so Marco.
3. Responda curto, natural, sem listas longas. Normalmente 1 a 3 frases.
4. Espelhe o cliente: curto com cliente curto, mais explicativo com cliente detalhista, informal se ele for informal.
5. Todo turno precisa avancar um passo: escolher prato, tirar duvida, customizar, colocar na sacola, pedir nome, pedir endereco, pedir telefone ou enviar ao Dom.
6. Quando perguntarem de um prato, nao entregue ficha tecnica fria. Faca a pessoa sentir: textura, aroma, molho, calor, cremosidade, crocancia, tamanho real. Depois feche com um proximo passo.
7. Tenha opiniao. Garcom bom nao lista tudo; ele compara e recomenda. Ex: "se sua fome e conforto, vai de carbonara; se quer algo mais serio, risoto".
8. Se o cliente hesitar, reduza a decisao para A/B e pergunte preferencia.
9. Use curiosidades do Leo com parcimonia, como bastidor de restaurante, nao como palestra.
10. Se o cliente pedir tempo de entrega, peca nome antes se nao souber, depois rua, numero e bairro.
11. Se estiver fechando pedido, colete aos poucos: nome -> endereco -> telefone. Telefone sempre com a justificativa: "so pro motoboy te ligar se nao achar a casa".
12. Nao invente disponibilidade, pagamento ou tempo exato. Preco do cardapio vem das tools/dados.
13. Se o cliente quiser fazer sozinho, respeite e guie: "abre o prato e toca em Adicionar; eu fico aqui se travar".

USO DE TOOLS:
- Se o cliente disser "quero", "manda", "bota", "adiciona", "pede", "coloca", ou confirmar um prato pelo chat, use adicionar_ao_carrinho com o ID exato.
- Se ele pedir para tirar item, use remover_do_carrinho pelo indice do carrinho.
- Se ele pedir observacao ("sem cebola", "mais bacon", "capricha"), use alterar_observacao quando o item ja estiver no carrinho.
- Depois de tool de carrinho, confirme naturalmente e convide para o proximo passo: "anotei; quer sobremesa, bebida ou ja fechamos?".`;

    const tools = [
      {
        type: "function" as const,
        function: {
          name: "salvar_nome",
          description: "Registra nome ou apelido quando o cliente se apresenta.",
          parameters: { type: "object", properties: { nome: { type: "string" } }, required: ["nome"] },
        },
      },
      {
        type: "function" as const,
        function: {
          name: "salvar_endereco",
          description: "Registra endereco em texto livre: rua, numero e bairro.",
          parameters: { type: "object", properties: { endereco_texto: { type: "string" } }, required: ["endereco_texto"] },
        },
      },
      {
        type: "function" as const,
        function: {
          name: "salvar_telefone",
          description: "Registra telefone do cliente para entrega.",
          parameters: { type: "object", properties: { telefone: { type: "string" } }, required: ["telefone"] },
        },
      },
      {
        type: "function" as const,
        function: {
          name: "adicionar_ao_carrinho",
          description: "Adiciona um prato ao carrinho quando o cliente confirma pelo chat.",
          parameters: {
            type: "object",
            properties: {
              prato_id: { type: "string", description: "UUID exato do prato listado no menu" },
              qtd: { type: "integer", minimum: 1, default: 1 },
              observacoes: { type: "string", description: "Observacoes do cliente, se houver" },
            },
            required: ["prato_id"],
          },
        },
      },
      {
        type: "function" as const,
        function: {
          name: "remover_do_carrinho",
          description: "Remove item do carrinho pelo indice mostrado em CARRINHO ATUAL.",
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
          description: "Atualiza observacao de um item que ja esta no carrinho.",
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
    ];

    const messages: any[] = [
      { role: "system", content: systemPrompt },
      ...historico,
      { role: "user", content: mensagem },
    ];

    let completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages,
      tools,
      tool_choice: "auto",
      temperature: 0.9,
      max_tokens: 360,
    });

    let respMsg: any = completion.choices[0].message;
    const toolsUsadas: string[] = [];
    let nextMemoria: Record<string, any> = memoria;
    let nomeRegistrado: string | null = null;

    if (respMsg.tool_calls?.length) {
      messages.push(respMsg);
      for (const tc of respMsg.tool_calls) {
        let args: any = {};
        try { args = JSON.parse(tc.function.arguments ?? "{}"); } catch (_) {}
        toolsUsadas.push(tc.function.name);
        let result = "ok";
        if (tc.function.name === "salvar_nome" && args.nome) {
          nomeRegistrado = String(args.nome).trim().slice(0, 80);
          nextMemoria = { ...nextMemoria, cliente: { ...(nextMemoria.cliente ?? {}), nome: nomeRegistrado } };
          await sb.from("sessoes").update({ cliente_nome: nomeRegistrado, memoria: nextMemoria }).eq("id", sessao.id);
          result = `Nome salvo: ${nomeRegistrado}`;
        }
        if (tc.function.name === "salvar_endereco" && args.endereco_texto) {
          nextMemoria = { ...nextMemoria, cliente: { ...(nextMemoria.cliente ?? {}), endereco_texto: String(args.endereco_texto).trim() } };
          await sb.from("sessoes").update({ memoria: nextMemoria }).eq("id", sessao.id);
          result = "Endereco salvo";
        }
        if (tc.function.name === "salvar_telefone" && args.telefone) {
          nextMemoria = { ...nextMemoria, cliente: { ...(nextMemoria.cliente ?? {}), telefone: normalizarTelefone(args.telefone) } };
          await sb.from("sessoes").update({ memoria: nextMemoria }).eq("id", sessao.id);
          result = "Telefone salvo";
        }
        if (tc.function.name === "adicionar_ao_carrinho" && args.prato_id) {
          const prato = (pratosRaw ?? []).find((p: any) => p.id === args.prato_id);
          if (!prato) {
            result = `Prato nao encontrado para o ID ${args.prato_id}`;
          } else {
            const { data: tamanhoPadrao } = await sbPub.from("pratos_tamanhos")
              .select("id, prato_id, nome, preco_delta, padrao, ordem")
              .eq("prato_id", prato.id)
              .eq("ativo", true)
              .order("padrao", { ascending: false })
              .order("ordem", { ascending: true })
              .limit(1)
              .maybeSingle();

            let precoUnitario = Number(prato.preco_promocional ?? prato.preco_base ?? 0) + Number(tamanhoPadrao?.preco_delta ?? 0);
            const { data: precoCalc, error: precoError } = await sbPub.rpc("calcular_preco_item", {
              p_prato_id: prato.id,
              p_tamanho_id: tamanhoPadrao?.id ?? null,
              p_opcionais_ids: [],
            });
            if (!precoError && precoCalc !== null && precoCalc !== undefined) {
              precoUnitario = Number(precoCalc);
            }

            const qtd = Math.max(1, Number(args.qtd ?? 1));
            const obs = String(args.observacoes ?? "").trim();
            const novoItem = {
              uid: makeUid(),
              prato: {
                id: prato.id,
                nome: prato.nome,
                descricao_curta: prato.descricao_curta,
                descricao_completa: prato.descricao_completa,
                foto_url: prato.foto_url,
                preco_base: prato.preco_base,
                preco_promocional: prato.preco_promocional,
                badge_destaque: prato.badge_destaque,
              },
              tamanho: tamanhoPadrao ? {
                id: tamanhoPadrao.id,
                nome: tamanhoPadrao.nome,
                preco_delta: tamanhoPadrao.preco_delta,
              } : null,
              opcionais: [],
              quantidade: qtd,
              observacoes: obs,
              preco_unitario: precoUnitario,
            };
            carrinhoAtual = [...carrinhoAtual, novoItem];
            eventos.push({ tipo: "carrinho_adicionado", payload: { nome: prato.nome, qtd, preco_unitario: precoUnitario } });
            result = `Adicionado: ${qtd}x ${prato.nome}. Total atual R$ ${cartTotal(carrinhoAtual).toFixed(2)}.`;
          }
        }
        if (tc.function.name === "remover_do_carrinho") {
          const idx = Number(args.indice);
          if (Number.isInteger(idx) && idx >= 0 && idx < carrinhoAtual.length) {
            const removido = carrinhoAtual[idx];
            carrinhoAtual = carrinhoAtual.filter((_, i) => i !== idx);
            eventos.push({ tipo: "carrinho_removido", payload: { indice: idx, nome: removido?.prato?.nome ?? removido?.nome } });
            result = `Removido. Total atual R$ ${cartTotal(carrinhoAtual).toFixed(2)}.`;
          } else {
            result = "Indice invalido para remover.";
          }
        }
        if (tc.function.name === "alterar_observacao" && args.observacoes) {
          const idx = Number(args.indice);
          if (Number.isInteger(idx) && idx >= 0 && idx < carrinhoAtual.length) {
            carrinhoAtual = carrinhoAtual.map((it, i) => i === idx ? { ...it, observacoes: String(args.observacoes).trim() } : it);
            eventos.push({ tipo: "carrinho_alterado", payload: { indice: idx, observacoes: String(args.observacoes).trim() } });
            result = "Observacao atualizada.";
          } else {
            result = "Indice invalido para alterar observacao.";
          }
        }
        messages.push({ role: "tool", tool_call_id: tc.id, content: result });
      }

      completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages,
        temperature: 0.9,
        max_tokens: 300,
      });
      respMsg = completion.choices[0].message;
    }

    let texto = String(respMsg.content ?? "").trim() || "To aqui, pode mandar.";
    const jaMexeuCarrinho = eventos.some((e) => String(e.tipo || "").startsWith("carrinho_"));
    if (!jaMexeuCarrinho && parecePedido(mensagem)) {
      const pedidoTxt = normText(mensagem);
      const candidatos = (pratosRaw ?? [])
        .map((p: any) => {
          const nome = normText(p.nome);
          const tokens = nome.split(/[^a-z0-9]+/).filter((t) => t.length >= 4);
          const score = (pedidoTxt.includes(nome) ? 6 : 0) + tokens.reduce((s, token) => s + (pedidoTxt.includes(token) ? 1 : 0), 0);
          return { prato: p, score };
        })
        .filter((x: any) => x.score > 0)
        .sort((a: any, b: any) => b.score - a.score);
      if (candidatos.length) {
        const item = await adicionarPratoAoCarrinho(candidatos[0].prato, 1, "");
        if (!/anot|sacola|adic|carrinho/i.test(normText(texto))) {
          texto = `Anotado: ${item.prato.nome}. ${texto}`;
        }
      }
    }
    const memoriaComHistorico = withMemory(
      nextMemoria,
      [msg("user", mensagem), msg("assistant", texto)],
    );

    await sb.from("sessoes").update({
      memoria: { ...memoriaComHistorico, ultimo_humor: humor.humor_nome },
      carrinho: carrinhoAtual,
      ultima_interacao_em: new Date().toISOString(),
    }).eq("id", sessao.id);

    await sb.from("interaction_logs").insert([
      { sessao_id: sessao.id, papel: "cliente", fala: mensagem },
      {
        sessao_id: sessao.id,
        personagem_id: "marco",
        papel: "garcom",
        fala: texto,
        humor_sorteado: humor.humor_nome,
        tool_usada: toolsUsadas.length ? toolsUsadas.join(",") : null,
      },
    ]);

    return json({
      sessao_id: sessao.id,
      cliente_nome: nomeRegistrado ?? sessao.cliente_nome ?? nextMemoria?.cliente?.nome ?? null,
      humor: humor.humor_nome,
      falas: [fala(texto, humor.humor_nome)],
      carrinho: carrinhoAtual,
      total: cartTotal(carrinhoAtual),
      eventos: eventos.length ? eventos : toolsUsadas.map((t) => ({ tipo: t, payload: {} })),
      pedido: null,
    });
  } catch (err) {
    console.error("garcom-responder error:", err);
    return json({ error: String((err as any)?.message ?? err) }, 500);
  }
});

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
      const nextMemoria = { ...memoria, cliente: { ...(memoria.cliente ?? {}), nome: nomeFinal } };
      await sb.from("sessoes").update({ cliente_nome: nomeFinal, memoria: nextMemoria }).eq("id", sessao.id);
      return json({ sessao_id: sessao.id, cliente_nome: nomeFinal, falas: [fala(`Prazer, ${nomeFinal}. Agora ficou mais bonito de atender.`)] });
    }

    if (acao === "salvar_endereco") {
      const enderecoFinal = String(endereco_texto || cliente?.endereco_texto || "").trim();
      if (!enderecoFinal) return json({ error: "endereco obrigatorio" }, 400);
      const nextMemoria = { ...memoria, cliente: { ...(memoria.cliente ?? {}), endereco_texto: enderecoFinal } };
      await sb.from("sessoes").update({ memoria: nextMemoria }).eq("id", sessao.id);
      return json({ sessao_id: sessao.id, falas: [fala("Anotei o endereço. Já dá pra trabalhar com uma estimativa mais honesta.")] });
    }

    if (acao === "salvar_telefone") {
      const telefoneFinal = normalizarTelefone(telefone || cliente?.telefone || "");
      if (!telefoneFinal) return json({ error: "telefone obrigatorio" }, 400);
      const nextMemoria = { ...memoria, cliente: { ...(memoria.cliente ?? {}), telefone: telefoneFinal } };
      await sb.from("sessoes").update({ memoria: nextMemoria }).eq("id", sessao.id);
      return json({ sessao_id: sessao.id, falas: [fala("Telefone anotado. Só uso pra entrega não virar caça ao tesouro, prometo.")] });
    }

    if (acao === "estimar_entrega") {
      const enderecoFinal = String(endereco_texto || cliente?.endereco_texto || memoria?.cliente?.endereco_texto || "").trim();
      const { data: config } = await sbPub.from("configuracoes").select("*").eq("id", 1).maybeSingle();
      const min = Number(config?.tempo_entrega_min ?? 35);
      const max = Number(config?.tempo_entrega_max ?? 50);
      const texto = enderecoFinal
        ? `Pra ${enderecoFinal}, eu trabalharia com algo perto de ${min}-${max} min agora. Não vou te vender milagre: se a rua travar ou o movimento subir, eu te aviso.`
        : `Sem endereço eu fico no chute bonito: hoje a base está perto de ${min}-${max} min. Me passa rua, número e bairro que eu afino isso.`;
      const nextMemoria = enderecoFinal
        ? { ...memoria, cliente: { ...(memoria.cliente ?? {}), endereco_texto: enderecoFinal }, ultima_estimativa: { min, max, em: new Date().toISOString() } }
        : memoria;
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

      const nextMemoria = {
        ...memoria,
        cliente: { ...(memoria.cliente ?? {}), nome: nomeFinal, telefone: telefoneFinal, endereco_texto: enderecoTextoFinal },
        ultimo_pedido_draft: compactCartForMemory(carrinho || []),
        ultimo_pedido_admin: pedido,
      };
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

      const numero = pedido?.numero_pedido ? ` #${pedido.numero_pedido}` : "";
      return json({
        sessao_id: sessao.id,
        cliente_nome: nomeFinal,
        pedido,
        carrinho: [],
        total: cartTotal(carrinho || []),
        eventos: [{ tipo: "pedido_enviado_admin", payload: pedido }],
        falas: [fala(`Perfeito, ${nomeFinal}. Enviei seu pedido${numero} para o Dom analisar. Agora ele aceita ou recusa no painel antes da cozinha começar.`)],
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
      .select("id, nome, descricao_curta, descricao_completa, preco_base, preco_promocional, badge_destaque")
      .eq("ativo", true)
      .limit(20);

    const { data: fato } = await sb.from("fato_do_dia")
      .select("texto")
      .eq("dia", new Date().toISOString().split("T")[0])
      .maybeSingle();

    const historico: Array<{ role: "user" | "assistant"; content: string }> = memoria.mensagens ?? [];
    const clienteMem = memoria.cliente ?? {};
    const clienteNome = sessao.cliente_nome || clienteMem.nome || null;
    const enderecoMem = clienteMem.endereco_texto || null;
    const telefoneMem = clienteMem.telefone || null;

    const systemPrompt = `Voce e o Marco, garcom virtual do Dom Leonardo. Mantenha o tom atual: humano, rapido quando precisa, brincalhao leve, com hospitalidade italiana-brasileira.

HUMOR SORTEADO: ${humor.humor_nome}
${humor.prompt_modifier ?? ""}

CONTEXTO:
- Cliente: ${clienteNome ? clienteNome : "ainda nao sei o nome"}
- Endereco salvo: ${enderecoMem ? "sim" : "nao"}
- Telefone salvo: ${telefoneMem ? "sim" : "nao"}
- Periodo: ${partOfDay()} (${nowSP()})
- Fato do dia: ${fato?.texto ?? "(sem fato hoje)"}

PRATOS ATIVOS:
${(pratosRaw ?? []).map((p: any) => `- ${p.nome}: ${p.descricao_curta ?? p.descricao_completa ?? ""} (${p.badge_destaque ?? "sem etiqueta"})`).join("\n")}

CURIOSIDADES DO LEO (use no maximo uma se encaixar):
${(curiosidadesDisp ?? []).map((c: any) => `- ${c.texto}`).join("\n")}

REGRAS:
1. Nunca diga que e IA, bot, GPT, OpenAI ou sistema.
2. Nada de conversa entre Marco e Leo. Quem fala com o cliente e so Marco.
3. Responda curto, natural, sem listas longas.
4. Se o cliente pedir tempo de entrega, peca nome antes se nao souber, depois rua, numero e bairro.
5. Se o cliente estiver fechando pedido, explique que voce precisa de nome, endereco e telefone, nessa ordem.
6. Telefone sempre com justificativa: "so pro motoboy te ligar se nao achar a casa".
7. Nao invente preco, disponibilidade, pagamento ou tempo exato. Quando faltar dado, diga que confere.
8. Se o cliente quiser fazer sozinho, respeite: "vai pela sacola embaixo que e mais rapido".
9. Preserve o jeito que ficou bom: calor humano, opiniao propria e humor do Dom, sem forcar piada.`;

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

    const texto = String(respMsg.content ?? "").trim() || "Tô aqui, pode mandar.";
    const novoHistorico = [
      ...historico,
      { role: "user" as const, content: mensagem },
      { role: "assistant" as const, content: texto },
    ].slice(-20);

    await sb.from("sessoes").update({
      memoria: { ...nextMemoria, mensagens: novoHistorico, ultimo_humor: humor.humor_nome },
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
      carrinho: sessao.carrinho ?? [],
      total: 0,
      eventos: toolsUsadas.map((t) => ({ tipo: t, payload: {} })),
      pedido: null,
    });
  } catch (err) {
    console.error("garcom-responder error:", err);
    return json({ error: String((err as any)?.message ?? err) }, 500);
  }
});

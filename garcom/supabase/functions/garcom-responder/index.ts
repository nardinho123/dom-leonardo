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
type Fala = { autor: string; destinatario: string; texto: string; delay_ms: number; tipo: "salao" | "cozinha" };

function calcTotal(carrinho: CartItem[]): number {
  return carrinho.reduce((s, it) => s + (it.preco * it.qtd), 0);
}

function ingredienteDestaque(nomePrato: string): string {
  const n = (nomePrato ?? "").toLowerCase();
  if (n.includes("risot") || n.includes("alcatra")) return "a alcatra na manteiga";
  if (n.includes("carbonara")) return "o bacon crocante";
  if (n.includes("pao") || n.includes("costela")) return "a costela suina";
  if (n.includes("nhoque")) return "o nhoque feito na hora";
  return "o tempero da casa";
}

function preencherTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
}

function querFecharPedido(texto: string): boolean {
  const t = (texto ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");

  return /\b(pode fechar|fechar|finalizar|confirma|confirmar|manda ver|pode mandar|pix|qr code|pagar)\b/.test(t);
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
    const sbPub = createClient(url, serviceKey);

    if (acao === "listar_pratos") {
      const { data, error } = await sbPub
        .from("pratos")
        .select("id, nome, descricao_curta, descricao_completa, preco_base, preco_promocional, foto_url, badge_destaque, ordem, ativo")
        .eq("ativo", true)
        .order("ordem", { ascending: true });

      if (error) throw error;

      return new Response(JSON.stringify({
        pratos: (data ?? []).map((p: any) => ({
          id: p.id,
          nome: p.nome,
          descricao: p.descricao_curta ?? p.descricao_completa ?? "",
          preco: parseFloat(p.preco_promocional ?? p.preco_base ?? 0),
          foto: p.foto_url,
          badge: p.badge_destaque,
        })),
      }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    if (!mensagem || typeof mensagem !== "string" || !mensagem.trim()) {
      return new Response(JSON.stringify({ error: "mensagem obrigatoria" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // Dois clients: garcom (escrita) e public (leitura dos pratos)
    const sb = createClient(url, serviceKey, { db: { schema: "garcom" } });

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
    const cliente_nome = sessao.cliente_nome;

    // Fechamento nao pode depender da "vontade" do modelo: se o cliente fechou,
    // tem nome e carrinho, criamos o pedido e abrimos a cozinha direto.
    if (querFecharPedido(mensagem) && carrinho.length > 0 && cliente_nome) {
      const total = calcTotal(carrinho);
      const { data: ped, error: pedErr } = await sb.from("pedidos").insert({
        sessao_id: sessao.id,
        cliente_perfil_id: null,
        status: "aguardando_pix",
        itens: carrinho,
        subtotal: total,
        desconto: 0,
        total,
      }).select("id, status").single();

      if (pedErr) throw pedErr;

      const { data: tpls } = await sb
        .from("cross_dialogs")
        .select("*")
        .eq("cenario", "pedido_confirmado")
        .eq("ativo", true)
        .order("ordem", { ascending: true });

      const primeiro = carrinho[0];
      const vars: Record<string, string> = {
        cliente_nome,
        pratos: carrinho.map((it) => `${it.qtd}x ${it.nome}`).join(", "),
        primeiro_prato: primeiro.nome,
        ingrediente_destaque: ingredienteDestaque(primeiro.nome),
        total: `R$ ${total.toFixed(2)}`,
      };

      const falas: Fala[] = (tpls ?? []).map((t: any) => ({
        autor: t.de_personagem,
        destinatario: t.para_personagem,
        texto: preencherTemplate(t.template, vars),
        delay_ms: t.delay_ms ?? 1500,
        tipo: t.para_personagem === "cliente" ? "salao" : "cozinha",
      }));

      if (falas.length === 0) {
        falas.push({
          autor: "marco",
          destinatario: "cliente",
          texto: `Fechado, ${cliente_nome}! Vou chamar o Leo na cozinha e ja te passo o PIX.`,
          delay_ms: 1200,
          tipo: "salao",
        });
      }

      const eventos = [{ tipo: "pedido_confirmado", payload: { pedido_id: ped.id, total } }];
      const falaMemoria = falas.map((f) => `${f.autor}: ${f.texto}`).join("\n");
      const novoHistorico = [
        ...historico,
        { role: "user" as const, content: mensagem },
        { role: "assistant" as const, content: falaMemoria },
      ].slice(-20);

      await sb.from("sessoes").update({
        memoria: { ...memoria, mensagens: novoHistorico, ultimo_humor: "fechamento_deterministico" },
        carrinho,
        ultima_interacao_em: new Date().toISOString(),
      }).eq("id", sessao.id);

      await sb.from("interaction_logs").insert([
        { sessao_id: sessao.id, papel: "cliente", fala: mensagem },
        {
          sessao_id: sessao.id,
          personagem_id: "marco",
          papel: "garcom",
          fala: falaMemoria,
          humor_sorteado: "fechamento_deterministico",
          tool_usada: "confirmar_pedido",
          contexto: { eventos, deterministic: true },
        },
      ]);

      return new Response(
        JSON.stringify({
          sessao_id: sessao.id,
          cliente_nome,
          humor: "fechamento_deterministico",
          falas,
          carrinho,
          total,
          eventos,
          pedido: ped,
        }),
        { headers: { ...cors, "Content-Type": "application/json" } }
      );
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

USO DE TOOLS (importante):
- Quando o cliente CONFIRMAR que quer pedir um prato, use adicionar_ao_carrinho com o ID exato do prato (UUID acima). NAO confirme verbalmente sem chamar a tool.
- Se o cliente pedir pra remover/alterar, use remover_do_carrinho ou alterar_observacao com o INDICE (0, 1, 2...) do item no carrinho atual.
- Use sugerir_harmonizacao quando o cliente ja tiver escolhido prato principal e voce quiser oferecer bebida ou sobremesa.
- Use confirmar_pedido quando o cliente disser que quer fechar a conta ou confirmar o pedido. Se ainda nao souber o nome, pergunte o nome antes.
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
          name: "confirmar_pedido",
          description: "Use quando o cliente confirmar que quer fechar o pedido. Cria o pedido, dispara o Leo na cozinha e mostra uma conversa entre Marco e Leo para o cliente ver. Exige carrinho nao vazio e cliente_nome registrado.",
          parameters: { type: "object", properties: {}, required: [] },
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
    const toolsUsadas: string[] = [];
    const eventos: Array<{ tipo: string; payload: any }> = [];
    let crossFalas: Fala[] = [];
    let pedidoCriado: { id: string; status: string } | null = null;

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
              await sb.from("sessoes").update({ cliente_nome: nomeRegistrado }).eq("id", sessao.id);
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
              sugestao = "um vinho branco seco ou suco de uva integral pra acompanhar.";
            } else if (nome.includes("pao") || nome.includes("costela")) {
              sugestao = "vinho tinto encorpado ou cerveja artesanal pra acompanhar.";
            }
            resultado = `Sugestao de harmonizacao para ${prato?.nome ?? "esse prato"}: ${sugestao}`;
            break;
          }
          case "confirmar_pedido": {
            if (!carrinho || carrinho.length === 0) {
              resultado = "Erro: carrinho vazio. Nao da pra confirmar pedido sem itens.";
              break;
            }
            if (!cliente_nome && !nomeRegistrado) {
              resultado = "Erro: cliente ainda nao se identificou. Pergunte o nome antes de confirmar.";
              break;
            }

            const nomeCli = (nomeRegistrado ?? cliente_nome ?? "amigo(a)") as string;
            const total = calcTotal(carrinho);
            const { data: ped, error: pedErr } = await sb.from("pedidos").insert({
              sessao_id: sessao.id,
              cliente_perfil_id: null,
              status: "aguardando_pix",
              itens: carrinho,
              subtotal: total,
              desconto: 0,
              total,
            }).select("id, status").single();

            if (pedErr) {
              resultado = `Erro ao criar pedido: ${pedErr.message}`;
              break;
            }
            pedidoCriado = ped;

            const { data: tpls } = await sb
              .from("cross_dialogs")
              .select("*")
              .eq("cenario", "pedido_confirmado")
              .eq("ativo", true)
              .order("ordem", { ascending: true });

            const primeiro = carrinho[0];
            const vars: Record<string, string> = {
              cliente_nome: nomeCli,
              pratos: carrinho.map((it) => `${it.qtd}x ${it.nome}`).join(", "),
              primeiro_prato: primeiro.nome,
              ingrediente_destaque: ingredienteDestaque(primeiro.nome),
              total: `R$ ${total.toFixed(2)}`,
            };

            crossFalas = (tpls ?? []).map((t: any) => ({
              autor: t.de_personagem,
              destinatario: t.para_personagem,
              texto: preencherTemplate(t.template, vars),
              delay_ms: t.delay_ms ?? 1500,
              tipo: t.para_personagem === "cliente" ? "salao" : "cozinha",
            }));

            eventos.push({ tipo: "pedido_confirmado", payload: { pedido_id: ped?.id, total } });
            resultado = `Pedido criado (id ${ped?.id}, total R$ ${total.toFixed(2)}). Cross-dialog com Leo gerado em ${crossFalas.length} falas. Nao gere fala final extra se o cross-dialog ja terminou avisando o cliente.`;
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

    const falas: Fala[] = crossFalas.length > 0
      ? crossFalas
      : [{
          autor: "marco",
          destinatario: "cliente",
          texto: fala,
          delay_ms: calcDelay(fala, humor.humor_nome),
          tipo: "salao",
        }];

    return new Response(
      JSON.stringify({
        sessao_id: sessao.id,
        cliente_nome: nomeRegistrado ?? sessao.cliente_nome,
        humor: humor.humor_nome,
        falas,
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

// Edge Function: garcom-responder
// Marco (garcom virtual) responde mensagem do cliente via GPT-4o.
// Fase 3 do projeto Garcom Digital - conversacional, com humor sorteado,
// memoria de sessao e 1 tool (set_cliente_nome).

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
    const { sessao_id, mensagem, cliente_nome_provisorio, device_id } = body ?? {};

    if (!mensagem || typeof mensagem !== "string" || !mensagem.trim()) {
      return new Response(JSON.stringify({ error: "mensagem obrigatoria" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { db: { schema: "garcom" } }
    );

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
      const { data } = await supabase.from("sessoes").select("*").eq("id", sessao_id).maybeSingle();
      sessao = data;
    }
    if (!sessao) {
      const { data, error } = await supabase
        .from("sessoes")
        .insert({
          cliente_nome: cliente_nome_provisorio ?? null,
          device_id: device_id ?? null,
          memoria: {},
          carrinho: [],
        })
        .select()
        .single();
      if (error) throw error;
      sessao = data;
    }

    // 2) Sorteia humor do Marco
    const { data: humoresRaw } = await supabase
      .from("persona_humores")
      .select("*")
      .eq("personagem_id", "marco")
      .eq("ativo", true);
    const humor = sortearPonderado(humoresRaw ?? []) ?? { humor_nome: "anfitriao_classico", prompt_modifier: "" };

    // 3) Curiosidades ainda nao usadas nesta sessao
    const { data: usadas } = await supabase
      .from("interaction_logs")
      .select("curiosidade_usada_id")
      .eq("sessao_id", sessao.id)
      .not("curiosidade_usada_id", "is", null);
    const usadasIds = (usadas ?? []).map((u: any) => u.curiosidade_usada_id).filter(Boolean);

    let curQuery = supabase.from("curiosidades").select("id, categoria, texto, tom").eq("ativo", true);
    if (usadasIds.length > 0) {
      curQuery = curQuery.not("id", "in", `(${usadasIds.join(",")})`);
    }
    const { data: curiosidadesDisp } = await curQuery.limit(10);

    // 4) Fato do dia
    const hoje = new Date().toISOString().split("T")[0];
    const { data: fato } = await supabase
      .from("fato_do_dia")
      .select("texto")
      .eq("dia", hoje)
      .maybeSingle();

    // 5) Historico
    const memoria = (sessao.memoria as any) ?? {};
    const historico: Array<{ role: "user" | "assistant"; content: string }> = memoria.mensagens ?? [];
    const cliente_nome = sessao.cliente_nome;

    // 6) System prompt
    const systemPrompt = `Voce e o Marco, garcom virtual do restaurante Dom Leonardo (trattoria italiana de delivery). Voce e brasileiro com sotaque italiano leve. Tem opiniao propria, paixao pela cozinha do chef Leo, e atende como um anfitriao real.

==============================
PERSONALIDADE DE HOJE (humor sorteado): ${humor.humor_nome}
${humor.prompt_modifier ?? ""}
==============================

CONTEXTO:
- Cliente: ${cliente_nome ? `chamado(a) ${cliente_nome}` : "ainda nao sei o nome"}
- Periodo do dia: ${partOfDay()} (${nowSP()})
- Fato do dia (use se vier a calhar, sem forcar): ${fato?.texto ?? "(sem fato hoje)"}

CURIOSIDADES DO LEO DISPONIVEIS (cada uma pode aparecer no maximo uma vez; cite no maximo UMA por mensagem se realmente couber, marcando o id no final da fala assim: [N]; se nao usar nenhuma, nao marque nada):
${(curiosidadesDisp ?? []).map((c: any) => `[${c.id}] (${c.categoria ?? "geral"}) ${c.texto}`).join("\n")}

PRATOS DO MENU HOJE:
- Risoto Cremoso de Alcatra na Manteiga (R$ 49,90, "mais pedido"): alcatra selada na manteiga, arroz arboreo cozido no caldo da casa, cremoso.
- Spaghetti a Carbonara (R$ 49,90, "o mais elogiado"): emulsao de ovos, parmesao, pimenta-do-reino, bacon. SEM creme de leite (Carbonara de verdade).
- Pao Italiano Recheado (R$ 88,90, "premium"): gorgonzola+vinho branco+creme servido no pao artesanal. Acompanha alcatra, linguica Blumenau e costela suina. Serve 3 a 4.
- Nhoque Rose (R$ 45,90): nhoque artesanal ao molho rose, equilibrado e cremoso.

REGRAS DE COMUNICACAO (nao-negociaveis):
1. NUNCA mencione que e IA, bot, assistente virtual, sistema, modelo, GPT, OpenAI ou qualquer termo do tipo. Se perguntarem, fuja com humor leve ("ah, sou so o Marco daqui mesmo, viu?").
2. Frases curtas, conversacionais. Nada de listas longas, nada de markdown, nada de bullet points. Texto corrido.
3. Espelhe o cliente: se ele e curto, voce e curto. Se ele usa emoji, voce pode. Se ele e formal, voce e formal.
4. Tenha OPINIAO propria. Se perguntarem "qual voce recomenda?", escolha e defenda. Marco nao e neutro.
5. Antecipe duvidas. Se o cliente parece em duvida, sugira.
6. Se cliente ficar irritado/impaciente, abandone humor e seja empatico+eficiente.
7. NAO de precos exatos de coisas que voce nao tem certeza, NAO prometa tempo de entrega -- diga "ja te confirmo".
8. Se o cliente ainda NAO se apresentou, EM ALGUM momento natural da conversa pergunte: "Como posso te chamar?". Quando ele responder, use a tool set_cliente_nome. NAO pergunte na primeira frase se voce ja esta saudando.

Responda SEMPRE em portugues brasileiro. Resposta curta -- 1 a 3 frases idealmente.`;

    // 7) Tools
    const tools = [
      {
        type: "function" as const,
        function: {
          name: "set_cliente_nome",
          description: "Use quando o cliente disser como quer ser chamado. Registra no perfil.",
          parameters: {
            type: "object",
            properties: {
              nome: { type: "string", description: "Nome ou apelido do cliente" },
            },
            required: ["nome"],
          },
        },
      },
    ];

    // 8) Chamada inicial
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
      max_tokens: 400,
    });

    let respMsg: any = completion.choices[0].message;
    let nomeRegistrado: string | null = null;

    // 9) Tool call loop (uma volta basta para fase 3)
    if (respMsg.tool_calls && respMsg.tool_calls.length > 0) {
      messages.push(respMsg);
      for (const tc of respMsg.tool_calls) {
        let args: any = {};
        try { args = JSON.parse(tc.function.arguments ?? "{}"); } catch (_) {}
        let resultado = "ok";
        if (tc.function.name === "set_cliente_nome" && args.nome) {
          nomeRegistrado = String(args.nome).slice(0, 60);
          await supabase
            .from("sessoes")
            .update({ cliente_nome: nomeRegistrado })
            .eq("id", sessao.id);
          resultado = `Nome registrado: ${nomeRegistrado}`;
        }
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: resultado,
        });
      }
      completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages,
        temperature: 0.9,
        max_tokens: 400,
      });
      respMsg = completion.choices[0].message;
    }

    const falaBruta = (respMsg.content ?? "").trim();

    // 10) Extrai marca de curiosidade [N]
    let curiosidadeUsadaId: number | null = null;
    let fala = falaBruta;
    const m = falaBruta.match(/\[(\d+)\]/);
    if (m) {
      curiosidadeUsadaId = parseInt(m[1], 10);
      fala = falaBruta.replace(/\s*\[\d+\]\s*/g, " ").trim();
    }

    // 11) Atualiza memoria de sessao (mantem ultimas 20 mensagens)
    const novoHistorico = [
      ...historico,
      novaMsgUsuario,
      { role: "assistant" as const, content: fala },
    ].slice(-20);

    await supabase
      .from("sessoes")
      .update({
        memoria: { ...memoria, mensagens: novoHistorico, ultimo_humor: humor.humor_nome },
        ultima_interacao_em: new Date().toISOString(),
      })
      .eq("id", sessao.id);

    // 12) Loga interacoes
    await supabase.from("interaction_logs").insert([
      {
        sessao_id: sessao.id,
        papel: "cliente",
        fala: mensagem,
      },
      {
        sessao_id: sessao.id,
        personagem_id: "marco",
        papel: "garcom",
        fala,
        humor_sorteado: humor.humor_nome,
        curiosidade_usada_id: curiosidadeUsadaId,
        tool_usada: nomeRegistrado ? "set_cliente_nome" : null,
      },
    ]);

    return new Response(
      JSON.stringify({
        sessao_id: sessao.id,
        cliente_nome: nomeRegistrado ?? sessao.cliente_nome,
        humor: humor.humor_nome,
        falas: [
          {
            texto: fala,
            delay_ms: calcDelay(fala, humor.humor_nome),
          },
        ],
      }),
      { headers: { ...cors, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("garcom-responder error:", err);
    return new Response(
      JSON.stringify({ error: String((err as any)?.message ?? err) }),
      {
        status: 500,
        headers: { ...cors, "Content-Type": "application/json" },
      }
    );
  }
});

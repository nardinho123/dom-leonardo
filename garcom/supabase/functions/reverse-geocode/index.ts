// Edge Function: reverse-geocode
// Geocodifica via Google usando a CHAVE DE SERVIDOR (sem restricao de referrer):
//  - { lat, lng }      -> reverse  (coordenada -> rua/bairro)   [botao "usar minha localizacao"]
//  - { endereco: {...} } -> forward (endereco  -> coordenada)   [calculo automatico de entrega]
// Nao grava nada no banco.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function serverKey(): string {
  return Deno.env.get("GOOGLE_MAPS_SERVER_KEY")
    || Deno.env.get("DOM_LEONARDO_MAPS_SERVER")
    || Deno.env.get("GOOGLE_MAPS_API_KEY")
    || "";
}

function pick(components: Array<Record<string, unknown>>, types: string[]): string {
  for (const c of components || []) {
    const ts = (c.types as string[]) || [];
    if (ts.some((t) => types.includes(t))) return String(c.long_name || "").trim();
  }
  return "";
}

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "use POST" }, 405);

  try {
    const key = serverKey();
    if (!key) return json({ ok: false, error: "maps_key_ausente" });

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const lat = Number(body?.lat);
    const lng = Number(body?.lng);
    const endereco = (body?.endereco && typeof body.endereco === "object")
      ? body.endereco as Record<string, unknown>
      : null;

    const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    url.searchParams.set("language", "pt-BR");
    url.searchParams.set("region", "br");
    url.searchParams.set("key", key);

    let modo: "reverse" | "forward";
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      modo = "reverse";
      url.searchParams.set("latlng", `${lat},${lng}`);
    } else if (endereco) {
      modo = "forward";
      const partes = [
        clean(endereco.logradouro),
        clean(endereco.numero),
        clean(endereco.bairro),
        clean(endereco.cidade) || "Curitiba",
        clean(endereco.uf) || "PR",
      ].filter(Boolean).join(", ");
      if (!partes) return json({ ok: false, error: "endereco_vazio" }, 400);
      url.searchParams.set("address", partes);
      url.searchParams.set("components", "country:BR");
    } else {
      return json({ ok: false, error: "parametros_invalidos" }, 400);
    }

    const resp = await fetch(url.toString());
    const data = await resp.json().catch(() => ({})) as Record<string, unknown>;
    const status = String(data.status || "");
    const results = data.results as Array<Record<string, unknown>> | undefined;

    if (status !== "OK" || !Array.isArray(results) || !results.length) {
      return json({ ok: false, error: `geocode_${status || resp.status}` });
    }

    const hasRoute = (r: Record<string, unknown>) =>
      ((r.address_components as Array<Record<string, unknown>>) || [])
        .some((c) => ((c.types as string[]) || []).includes("route"));

    const best = results.find((r) => ((r.types as string[]) || []).includes("street_address"))
      || results.find(hasRoute)
      || results[0];
    const comps = (best.address_components as Array<Record<string, unknown>>) || [];
    const loc = ((best.geometry as Record<string, unknown> | undefined)?.location) as Record<string, unknown> | undefined;

    return json({
      ok: true,
      modo,
      lat: modo === "reverse" ? lat : Number(loc?.lat),
      lng: modo === "reverse" ? lng : Number(loc?.lng),
      logradouro: pick(comps, ["route"]),
      bairro: pick(comps, ["sublocality_level_1", "sublocality", "neighborhood"]),
      cidade: pick(comps, ["administrative_area_level_2", "locality"]),
      uf: pick(comps, ["administrative_area_level_1"]),
      endereco_formatado: String(best.formatted_address || ""),
    });
  } catch (err) {
    return json({ ok: false, error: String((err as Error)?.message ?? err) });
  }
});

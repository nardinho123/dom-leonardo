import { createClient } from 'jsr:@supabase/supabase-js@2';

const META_GRAPH_VERSION = 'v25.0';
const DEFAULT_PIXEL_ID = '2687533954980204';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

const allowedEvents = new Set([
  'PageView',
  'ViewContent',
  'AddToCart',
  'InitiateCheckout',
  'AddPaymentInfo',
  'Purchase',
  'Contact',
  'Search',
  'Lead',
  'DomButtonClick',
  'CartOpen',
  'ChatOpen',
  'CouponApply',
  'CouponRemove',
  'MenuCategory',
  'PhotoView',
  'GameStart',
  'GameComplete',
  'GameShare',
  // Jornada granular (custom events)
  'DigitouNome',
  'DigitouWhatsApp',
  'ClicouDestrancarMenu',
  'RecuperouChave',
  'WebviewAberto',
  'EscolheuTamanho',
  'AdicionouAdicional',
  'RemoveuAdicional',
  'RemoveuItemSacola',
  'AbandonouSacola',
  'ChefCortouFrete',
  'MarcoMensagem',
  'ClicouPermitirLocalizacao',
  'ClicouMarco',
  'ChegouNoPix',
  'ClicouJaPaguei',
  'ClicouFinalizarWhatsApp',
]);

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function cleanText(value: unknown, max = 160) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function cleanUrl(value: unknown) {
  const text = cleanText(value, 900);
  if (!text) return undefined;
  try {
    const url = new URL(text);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return url.toString().slice(0, 900);
  } catch {
    return undefined;
  }
}

function cleanNumber(value: unknown, min = 0, max = 999999) {
  const num = Number(value);
  if (!Number.isFinite(num)) return undefined;
  return Math.max(min, Math.min(max, num));
}

function cleanCustomData(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const [rawKey, rawValue] of Object.entries(source).slice(0, 28)) {
    const key = rawKey.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 40);
    if (!key) continue;

    if (typeof rawValue === 'number') {
      const num = cleanNumber(rawValue, -999999, 999999);
      if (num !== undefined) out[key] = num;
      continue;
    }

    if (typeof rawValue === 'boolean') {
      out[key] = rawValue;
      continue;
    }

    if (Array.isArray(rawValue)) {
      out[key] = rawValue
        .slice(0, 12)
        .map(item => cleanText(item, 80))
        .filter(Boolean);
      continue;
    }

    out[key] = cleanText(rawValue, 180);
  }

  return out;
}

function firstIp(req: Request) {
  const raw = req.headers.get('cf-connecting-ip')
    || req.headers.get('x-real-ip')
    || req.headers.get('x-forwarded-for')
    || '';
  const ip = raw.split(',')[0]?.trim();
  return ip || undefined;
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value.trim().toLowerCase());
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

// ===== Advanced Matching (normalizacao EXATA da doc de Customer Information Parameters) =====
// ph: so digitos, COM codigo do pais (55...). fn/ln/ct: minusculas sem pontuacao/espacos.
// st: 2 letras minusculas. zp: so digitos. country: ISO-2 minusculas. Tudo hasheado SHA-256.
function soDigitos(v: unknown) {
  return String(v ?? '').replace(/\D/g, '');
}

function normPhoneBr(v: unknown) {
  let d = soDigitos(v);
  if (!d) return '';
  if ((d.length === 10 || d.length === 11) && !d.startsWith('55')) d = '55' + d;
  return d.length >= 12 && d.length <= 14 ? d : '';
}

function normNomeParte(v: unknown) {
  return String(v ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '')
    .slice(0, 60);
}

function normCidade(v: unknown) {
  return String(v ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '')
    .slice(0, 60);
}

async function buildAdvancedMatching(raw: unknown): Promise<Record<string, string>> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const u = raw as Record<string, unknown>;
  const out: Record<string, string> = {};

  const ph = normPhoneBr(u.ph);
  if (ph) out.ph = await sha256(ph);

  const em = cleanText(u.em, 160).toLowerCase();
  if (em && em.includes('@')) out.em = await sha256(em);

  const fn = normNomeParte(u.fn);
  if (fn) out.fn = await sha256(fn);

  const ln = normNomeParte(u.ln);
  if (ln) out.ln = await sha256(ln);

  const ct = normCidade(u.ct);
  if (ct) out.ct = await sha256(ct);

  const st = String(u.st ?? '').toLowerCase().replace(/[^a-z]/g, '').slice(0, 2);
  if (st.length === 2) out.st = await sha256(st);

  const zp = soDigitos(u.zp).slice(0, 8);
  if (zp) out.zp = await sha256(zp);

  const country = String(u.country ?? 'br').toLowerCase().replace(/[^a-z]/g, '').slice(0, 2);
  if (country.length === 2) out.country = await sha256(country);

  return out;
}

// ===== Jornada: grava o MESMO evento na tabela jornada_eventos (uma tabela so) =====
async function gravarJornada(input: Record<string, unknown>, eventName: string, customData: Record<string, unknown>, sourceUrl?: string) {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    if (!supabaseUrl || !serviceKey) return;
    const sb = createClient(supabaseUrl, serviceKey);
    const user = (input.user && typeof input.user === 'object' && !Array.isArray(input.user))
      ? input.user as Record<string, unknown>
      : {};
    // device_id do chat (dom_marco_device_id) casa a jornada com os atendimentos do painel
    const deviceId = cleanText(input.device_id, 160) || cleanText(input.external_id, 160) || 'anon';
    await sb.from('jornada_eventos').insert({
      device_id: deviceId,
      whatsapp: normPhoneBr(user.ph) || null,
      cliente_nome: cleanText(user.nome_completo, 120) || null,
      evento: eventName,
      detalhe: customData,
      pagina: sourceUrl ? cleanText(sourceUrl, 300) : null,
    });
  } catch (err) {
    console.warn('jornada insert falhou (nao bloqueia o evento Meta):', err);
  }
}

function validEventId(value: unknown) {
  const text = cleanText(value, 120);
  if (!/^[a-zA-Z0-9_.:-]{8,120}$/.test(text)) return crypto.randomUUID();
  return text;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  const token = Deno.env.get('META_CAPI_ACCESS_TOKEN');
  const pixelId = Deno.env.get('META_PIXEL_ID') || DEFAULT_PIXEL_ID;
  const testEventCode = Deno.env.get('META_TEST_EVENT_CODE');

  if (!token) {
    console.error('META_CAPI_ACCESS_TOKEN is not configured.');
    return jsonResponse({ error: 'Meta token not configured' }, 500);
  }

  let input: Record<string, unknown>;
  try {
    input = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const eventName = cleanText(input.event_name, 64);
  if (!allowedEvents.has(eventName)) {
    return jsonResponse({ error: 'Event not allowed' }, 400);
  }

  const now = Math.floor(Date.now() / 1000);
  const rawEventTime = Math.floor(Number(input.event_time || now));
  const eventTime = rawEventTime > now - 7 * 24 * 60 * 60 && rawEventTime <= now + 120
    ? rawEventTime
    : now;

  const customData = cleanCustomData(input.custom_data);
  const sourceUrl = cleanUrl(input.event_source_url)
    || cleanUrl(req.headers.get('referer'))
    || cleanUrl(req.headers.get('origin'));
  const userAgent = cleanText(input.client_user_agent || req.headers.get('user-agent'), 500);
  const fbp = cleanText(input.fbp, 120);
  const fbc = cleanText(input.fbc, 160);
  const externalId = cleanText(input.external_id, 160);

  const userData: Record<string, unknown> = {};
  if (fbp) userData.fbp = fbp;
  if (fbc) userData.fbc = fbc;
  if (userAgent) userData.client_user_agent = userAgent;
  const ip = firstIp(req);
  if (ip) userData.client_ip_address = ip;
  if (externalId) userData.external_id = await sha256(externalId);

  // Advanced Matching: telefone/nome/cidade/etc hasheados (quanto mais, melhor o match)
  Object.assign(userData, await buildAdvancedMatching(input.user));

  const serverEvent: Record<string, unknown> = {
    event_name: eventName,
    event_time: eventTime,
    event_id: validEventId(input.event_id),
    action_source: 'website',
    user_data: userData,
    custom_data: customData,
  };
  if (sourceUrl) serverEvent.event_source_url = sourceUrl;

  const requestBody: Record<string, unknown> = { data: [serverEvent] };
  if (testEventCode) requestBody.test_event_code = testEventCode;

  // Grava a jornada em paralelo (nunca bloqueia o envio a Meta)
  const jornadaPromise = gravarJornada(input, eventName, customData, sourceUrl);

  const endpoint = `https://graph.facebook.com/${META_GRAPH_VERSION}/${pixelId}/events?access_token=${encodeURIComponent(token)}`;

  try {
    const metaResponse = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
    const metaBody = await metaResponse.json().catch(() => ({}));
    await jornadaPromise;

    if (!metaResponse.ok) {
      console.error('Meta CAPI rejected event', {
        status: metaResponse.status,
        event_name: eventName,
        error: metaBody?.error?.message || metaBody,
      });
      return jsonResponse({ ok: false, error: metaBody?.error?.message || 'Meta request failed' }, 502);
    }

    return jsonResponse({
      ok: true,
      events_received: metaBody?.events_received ?? 1,
      messages: metaBody?.messages ?? [],
    });
  } catch (error) {
    console.error('Meta CAPI request failed', error);
    await jornadaPromise.catch(() => {});
    return jsonResponse({ ok: false, error: 'Meta request failed' }, 502);
  }
});

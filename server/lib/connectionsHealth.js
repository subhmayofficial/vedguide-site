import { supabaseRequest } from './supabase.js';

const CRITICAL = [
  { id: 'supabaseUrl', label: 'Supabase project URL', get: (c) => Boolean(c.supabaseUrl) },
  { id: 'serviceRoleKey', label: 'Supabase service role key', get: (c) => Boolean(c.serviceRoleKey) },
  { id: 'anonKey', label: 'Supabase anon key', get: (c) => Boolean(c.anonKey) },
  { id: 'razorpayKeyId', label: 'Razorpay key ID', get: (c) => Boolean(c.razorpayKeyId) },
  { id: 'razorpayKeySecret', label: 'Razorpay key secret', get: (c) => Boolean(c.razorpayKeySecret) },
];

const RECOMMENDED = [
  { id: 'razorpayWebhookSecret', label: 'Razorpay webhook secret', get: (c) => Boolean(c.razorpayWebhookSecret) },
  { id: 'googleMapsBrowserKey', label: 'Google Maps browser key', get: (c) => Boolean(c.googleMapsBrowserKey) },
];

function basicAuthRz(keyId, keySecret) {
  return Buffer.from(`${keyId}:${keySecret}`).toString('base64');
}

export function getConnectionsSnapshot(cfg) {
  const missingCritical = [];
  const missingRecommended = [];
  for (const x of CRITICAL) {
    if (!x.get(cfg)) missingCritical.push({ id: x.id, label: x.label });
  }
  for (const x of RECOMMENDED) {
    if (!x.get(cfg)) missingRecommended.push({ id: x.id, label: x.label });
  }
  const kundliOk =
    typeof cfg.kundliAmountPaise === 'number' && !Number.isNaN(cfg.kundliAmountPaise) && cfg.kundliAmountPaise > 0;
  if (!kundliOk) {
    missingRecommended.push({ id: 'kundliAmountPaise', label: 'Kundli amount (paise)' });
  }
  const currencyOk = Boolean(String(cfg.currency || '').trim());
  if (!currencyOk) {
    missingRecommended.push({ id: 'currency', label: 'Currency' });
  }
  return {
    schema: cfg.schema || 'v2',
    configured: {
      supabaseUrl: Boolean(cfg.supabaseUrl),
      serviceRoleKey: Boolean(cfg.serviceRoleKey),
      anonKey: Boolean(cfg.anonKey),
      razorpayKeyId: Boolean(cfg.razorpayKeyId),
      razorpayKeySecret: Boolean(cfg.razorpayKeySecret),
      razorpayWebhookSecret: Boolean(cfg.razorpayWebhookSecret),
      kundliAmountPaise: kundliOk,
      currency: currencyOk,
      googleMapsBrowserKey: Boolean(cfg.googleMapsBrowserKey),
    },
    missingCritical,
    missingRecommended,
    readyForOrders: Boolean(cfg.supabaseUrl && cfg.serviceRoleKey && cfg.razorpayKeyId && cfg.razorpayKeySecret),
    readyForWebhook: Boolean(cfg.razorpayWebhookSecret),
  };
}

async function testSupabaseService(cfg) {
  if (!cfg.supabaseUrl || !cfg.serviceRoleKey) {
    return { ok: false, skipped: true, detail: 'URL or service role key not set' };
  }
  try {
    const r = await supabaseRequest(cfg, 'GET', 'orders?select=id&limit=1');
    if (r.code >= 200 && r.code < 300) {
      return { ok: true, detail: `HTTP ${r.code}` };
    }
    let msg = `HTTP ${r.code}`;
    try {
      const j = JSON.parse(r.body || '{}');
      if (j.message) msg = `${msg}: ${j.message}`;
    } catch {
      if (r.body && r.body.length < 200) msg = `${msg}: ${r.body}`;
    }
    return { ok: false, detail: msg };
  } catch (e) {
    return { ok: false, detail: e.message || 'Network error' };
  }
}

async function testSupabaseAnon(cfg) {
  if (!cfg.supabaseUrl || !cfg.anonKey) {
    return { ok: false, skipped: true, detail: 'URL or anon key not set' };
  }
  const base = cfg.supabaseUrl.replace(/\/$/, '');
  const schema = cfg.schema || 'v2';
  const url = `${base}/rest/v1/orders?select=id&limit=1`;
  const key = cfg.anonKey;
  const h = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };
  if (schema && schema !== 'public') {
    h['Accept-Profile'] = schema;
  }
  try {
    const res = await fetch(url, { method: 'GET', headers: h, signal: AbortSignal.timeout(25_000) });
    const body = await res.text();
    if (res.status >= 200 && res.status < 300) {
      return { ok: true, detail: `HTTP ${res.status}` };
    }
    if (res.status === 401) {
      return { ok: false, detail: 'HTTP 401 — invalid anon key' };
    }
    if (res.status === 403) {
      return { ok: true, warning: true, detail: 'HTTP 403 — key accepted; RLS may block reads (expected for some setups)' };
    }
    let msg = `HTTP ${res.status}`;
    try {
      const j = JSON.parse(body || '{}');
      if (j.message) msg = `${msg}: ${j.message}`;
    } catch {
      /* ignore */
    }
    return { ok: false, detail: msg };
  } catch (e) {
    return { ok: false, detail: e.message || 'Network error' };
  }
}

async function testRazorpay(cfg) {
  if (!cfg.razorpayKeyId || !cfg.razorpayKeySecret) {
    return { ok: false, skipped: true, detail: 'Key id or secret not set' };
  }
  try {
    const res = await fetch('https://api.razorpay.com/v1/orders?count=1', {
      headers: {
        Authorization: `Basic ${basicAuthRz(cfg.razorpayKeyId, cfg.razorpayKeySecret)}`,
      },
      signal: AbortSignal.timeout(25_000),
    });
    if (res.status >= 200 && res.status < 300) {
      return { ok: true, detail: `HTTP ${res.status}` };
    }
    const data = await res.json().catch(() => ({}));
    const msg =
      data?.error?.description || data?.error?.reason || data?.message || `HTTP ${res.status}`;
    return { ok: false, detail: typeof msg === 'string' ? msg : `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, detail: e.message || 'Network error' };
  }
}

async function testGoogleMaps(cfg) {
  if (!cfg.googleMapsBrowserKey) {
    return { ok: false, skipped: true, detail: 'Not configured' };
  }
  try {
    const u = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    u.searchParams.set('address', 'Mumbai');
    u.searchParams.set('key', cfg.googleMapsBrowserKey);
    const res = await fetch(u.toString(), { signal: AbortSignal.timeout(15_000) });
    const data = await res.json().catch(() => ({}));
    const st = data.status;
    if (st === 'OK' || st === 'ZERO_RESULTS') {
      return { ok: true, detail: `Geocoding API: ${st}` };
    }
    if (st === 'REQUEST_DENIED' || st === 'INVALID_REQUEST') {
      return { ok: false, detail: `Geocoding API: ${st}${data.error_message ? ` — ${data.error_message}` : ''}` };
    }
    return { ok: false, detail: st || `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, detail: e.message || 'Network error' };
  }
}

export async function runAllConnectionTests(cfg) {
  const [supabaseService, supabaseAnon, razorpay, googleMaps] = await Promise.all([
    testSupabaseService(cfg),
    testSupabaseAnon(cfg),
    testRazorpay(cfg),
    testGoogleMaps(cfg),
  ]);
  return {
    at: new Date().toISOString(),
    supabaseService,
    supabaseAnon,
    razorpay,
    googleMaps,
    razorpayWebhook: {
      ok: Boolean(cfg.razorpayWebhookSecret),
      skipped: !cfg.razorpayWebhookSecret,
      detail: cfg.razorpayWebhookSecret
        ? 'Secret is set — live signature test needs a real webhook payload from Razorpay'
        : 'Not set — payment.captured webhooks will fail until configured',
    },
  };
}

/** @param {string} [which] — supabaseService | supabaseAnon | razorpay | googleMaps | webhook | all */
export async function runConnectionTests(cfg, which) {
  const w = which === 'all' || !which ? 'all' : String(which);
  if (w === 'all') return runAllConnectionTests(cfg);
  const at = new Date().toISOString();
  if (w === 'supabaseService') return { at, supabaseService: await testSupabaseService(cfg) };
  if (w === 'supabaseAnon') return { at, supabaseAnon: await testSupabaseAnon(cfg) };
  if (w === 'razorpay') return { at, razorpay: await testRazorpay(cfg) };
  if (w === 'googleMaps') return { at, googleMaps: await testGoogleMaps(cfg) };
  if (w === 'webhook') {
    return {
      at,
      razorpayWebhook: {
        ok: Boolean(cfg.razorpayWebhookSecret),
        skipped: !cfg.razorpayWebhookSecret,
        detail: cfg.razorpayWebhookSecret
          ? 'Secret is set — verify signing in Razorpay dashboard after a payment'
          : 'Not set — payment.captured webhooks will fail until configured',
      },
    };
  }
  return { at, error: 'Unknown test id' };
}

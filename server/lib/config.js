import dotenv from 'dotenv';
import { loadRuntimeSettings } from './runtimeSettings.js';

dotenv.config();

let cache = null;

function fromEnv() {
  return {
    supabaseUrl: (process.env.SUPABASE_URL || '').replace(/\/$/, ''),
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    anonKey: process.env.SUPABASE_ANON_KEY || '',
    schema: process.env.SUPABASE_SCHEMA || 'v2',
    razorpayKeyId: process.env.RAZORPAY_KEY_ID || '',
    razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET || '',
    razorpayWebhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || '',
    kundliAmountPaise: parseInt(process.env.KUNDLI_AMOUNT_PAISE || '49900', 10),
    currency: process.env.CURRENCY || 'INR',
    googleMapsBrowserKey: process.env.GOOGLE_MAPS_BROWSER_KEY || '',
    adminSecret: process.env.ADMIN_SECRET || '',
    port: parseInt(process.env.PORT || '3000', 10),
  };
}

function mergeRuntime(base, rt) {
  if (!rt || typeof rt !== 'object') return base;
  const out = { ...base };
  const keys = [
    'supabaseUrl',
    'serviceRoleKey',
    'anonKey',
    'schema',
    'razorpayKeyId',
    'razorpayKeySecret',
    'razorpayWebhookSecret',
    'kundliAmountPaise',
    'currency',
    'googleMapsBrowserKey',
    'adminSecret',
  ];
  for (const k of keys) {
    if (rt[k] === undefined || rt[k] === null) continue;
    if (k === 'kundliAmountPaise') {
      const n = parseInt(String(rt[k]), 10);
      if (!Number.isNaN(n)) out[k] = n;
      continue;
    }
    if (typeof rt[k] === 'string' && rt[k].trim() === '') continue;
    out[k] = rt[k];
  }
  return out;
}

/** Merged env + encrypted runtime settings (runtime wins when set). */
export function getConfig() {
  if (cache) return cache;
  const base = fromEnv();
  const rt = loadRuntimeSettings();
  cache = mergeRuntime(base, rt);
  return cache;
}

export function invalidateConfigCache() {
  cache = null;
}

/** @deprecated use getConfig() */
export function loadConfig() {
  return getConfig();
}

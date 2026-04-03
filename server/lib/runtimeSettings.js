import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const KEY_FILE = path.join(DATA_DIR, '.encryption-key');
const SETTINGS_FILE = path.join(DATA_DIR, 'runtime-settings.enc.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { mode: 0o700 });
  }
}

/** 32-byte key: env CONFIG_ENCRYPTION_KEY (64 hex chars) or auto file. */
export function getOrCreateEncryptionKey() {
  const fromEnv = String(process.env.CONFIG_ENCRYPTION_KEY || '').trim();
  if (/^[0-9a-fA-F]{64}$/.test(fromEnv)) {
    return Buffer.from(fromEnv, 'hex');
  }
  ensureDataDir();
  if (fs.existsSync(KEY_FILE)) {
    const b = fs.readFileSync(KEY_FILE);
    if (b.length === 32) return b;
  }
  const key = randomBytes(32);
  fs.writeFileSync(KEY_FILE, key, { mode: 0o600 });
  return key;
}

export function encryptSettingsPayload(obj) {
  const key = getOrCreateEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plain = Buffer.from(JSON.stringify(obj), 'utf8');
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: 1,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: enc.toString('base64'),
  };
}

export function decryptSettingsPayload(wrapped) {
  if (!wrapped || wrapped.v !== 1 || !wrapped.iv || !wrapped.tag || !wrapped.data) return null;
  try {
    const key = getOrCreateEncryptionKey();
    const iv = Buffer.from(wrapped.iv, 'base64');
    const tag = Buffer.from(wrapped.tag, 'base64');
    const data = Buffer.from(wrapped.data, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(data), decipher.final()]);
    return JSON.parse(dec.toString('utf8'));
  } catch {
    return null;
  }
}

export function saveRuntimeSettings(obj) {
  ensureDataDir();
  const wrapped = encryptSettingsPayload(obj);
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(wrapped, null, 0), { mode: 0o600 });
}

export function loadRuntimeSettings() {
  if (!fs.existsSync(SETTINGS_FILE)) return null;
  try {
    const raw = fs.readFileSync(SETTINGS_FILE, 'utf8');
    const wrapped = JSON.parse(raw);
    return decryptSettingsPayload(wrapped);
  } catch {
    return null;
  }
}

export function hasRuntimeSettingsFile() {
  return fs.existsSync(SETTINGS_FILE);
}

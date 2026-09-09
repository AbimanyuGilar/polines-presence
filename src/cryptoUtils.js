import crypto from 'crypto';
import config from './config.js';

const ALGORITHM = 'aes-256-cbc';
const SECRET = config.encryptionKey || config.sessionSecret || 'polines-default-secret-key-32ch';

// Ensure 32-byte key buffer
function getKey() {
  return crypto.createHash('sha256').update(String(SECRET)).digest();
}

export function encryptPassword(text) {
  if (!text) return '';
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return `${iv.toString('hex')}:${encrypted}`;
}

export function decryptPassword(encryptedText) {
  if (!encryptedText || !encryptedText.includes(':')) return '';
  const [ivHex, encrypted] = encryptedText.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

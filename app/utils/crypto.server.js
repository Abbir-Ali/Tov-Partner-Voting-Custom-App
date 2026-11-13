import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

/**
 * Returns the 32-byte encryption key from env, or null if missing/invalid.
 */
export function getEncryptionKey() {
  const b64 = process.env.APP_ENCRYPTION_KEY;
  if (!b64) return null;

  try {
    const buf = Buffer.from(b64, "base64");
    if (buf.length !== 32) return null;
    return buf;
  } catch {
    return null;
  }
}

/**
 * Encrypts plaintext with AES-256-GCM.
 * Returns base64 string: iv (12 bytes) + ciphertext + authTag (16 bytes).
 * Returns null if encryption key is missing.
 */
export function encrypt(plaintext) {
  const key = getEncryptionKey();
  if (!key) return null;

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  // iv + ciphertext + tag
  return Buffer.concat([iv, encrypted, tag]).toString("base64");
}

/**
 * Decrypts a value encrypted by encrypt().
 * Returns plaintext string, or null if decryption fails or key is missing.
 */
export function decrypt(ciphertext) {
  const key = getEncryptionKey();
  if (!key || !ciphertext) return null;

  try {
    const data = Buffer.from(ciphertext, "base64");
    if (data.length < IV_LENGTH + TAG_LENGTH) return null;

    const iv = data.subarray(0, IV_LENGTH);
    const tag = data.subarray(data.length - TAG_LENGTH);
    const encrypted = data.subarray(IV_LENGTH, data.length - TAG_LENGTH);

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

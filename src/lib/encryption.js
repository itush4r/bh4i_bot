import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_HEX   = process.env.ENCRYPTION_KEY;

if (!KEY_HEX || KEY_HEX.length !== 64) {
  throw new Error(
    "ENCRYPTION_KEY must be a 64-character hex string (32 bytes). " +
    'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
  );
}

const KEY = Buffer.from(KEY_HEX, "hex");

/**
 * Encrypt a plain text string using AES-256-GCM.
 * Returns a string in format: iv:authTag:ciphertext (all hex, colon-separated).
 * Returns null if input is null/undefined/empty.
 */
export function encrypt(plainText) {
  if (!plainText) return null;

  const iv        = randomBytes(12); // 96-bit IV recommended for GCM
  const cipher    = createCipheriv(ALGORITHM, KEY, iv);
  const encrypted = Buffer.concat([
    cipher.update(plainText, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    iv.toString("hex"),
    authTag.toString("hex"),
    encrypted.toString("hex"),
  ].join(":");
}

/**
 * Decrypt a string produced by encrypt().
 * Returns the original plain text.
 * Returns null if input is null/undefined/empty.
 * Handles legacy plain-text values gracefully (returns them as-is).
 */
export function decrypt(encryptedText) {
  if (!encryptedText) return null;

  // Legacy plain-text check — encrypted values always have exactly 2 colons
  if ((encryptedText.match(/:/g) || []).length !== 2) {
    return encryptedText; // not yet encrypted — return as-is
  }

  const [ivHex, authTagHex, cipherHex] = encryptedText.split(":");

  const iv         = Buffer.from(ivHex,      "hex");
  const authTag    = Buffer.from(authTagHex,  "hex");
  const cipherText = Buffer.from(cipherHex,   "hex");

  const decipher = createDecipheriv(ALGORITHM, KEY, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(cipherText),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

/**
 * Check whether a value is already encrypted by this library.
 */
export function isEncrypted(value) {
  if (!value || typeof value !== "string") return false;
  return (value.match(/:/g) || []).length === 2;
}

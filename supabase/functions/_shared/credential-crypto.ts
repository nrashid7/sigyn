import { AppError } from "./errors.ts";

function bytesFromBase64(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}
function base64FromBytes(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value));
}
async function encryptionKey(): Promise<CryptoKey> {
  const encoded = Deno.env.get("INTEGRATION_ENCRYPTION_KEY");
  if (!encoded) throw new AppError("Missing integration encryption key", 500, "CONFIG_ERROR");
  const raw = bytesFromBase64(encoded);
  if (raw.byteLength !== 32) throw new AppError("Integration encryption key must be 32 bytes", 500, "CONFIG_ERROR");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
export async function decryptCredential(value?: string | null): Promise<string | null> {
  if (!value) return null;
  const [version, ivEncoded, ciphertextEncoded] = value.split(".");
  if (version !== "v1" || !ivEncoded || !ciphertextEncoded) throw new AppError("Invalid encrypted credential", 500);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bytesFromBase64(ivEncoded) },
    await encryptionKey(),
    bytesFromBase64(ciphertextEncoded),
  );
  return new TextDecoder().decode(plaintext);
}
export async function encryptCredential(value: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv }, await encryptionKey(), new TextEncoder().encode(value),
  );
  return `v1.${base64FromBytes(iv)}.${base64FromBytes(new Uint8Array(ciphertext))}`;
}

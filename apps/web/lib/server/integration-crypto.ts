const VERSION = "v1";

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function encodeBase64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return decodeBase64(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  return Uint8Array.from(value).buffer;
}

async function importKey(encodedKey: string): Promise<CryptoKey> {
  const raw = decodeBase64(encodedKey);
  if (raw.byteLength !== 32) {
    throw new Error("INTEGRATION_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  }
  return await crypto.subtle.importKey("raw", toArrayBuffer(raw), "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptIntegrationSecret(value: string, encodedKey: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    await importKey(encodedKey),
    new TextEncoder().encode(value),
  );
  return `${VERSION}.${encodeBase64Url(iv)}.${encodeBase64Url(new Uint8Array(encrypted))}`;
}

export async function decryptIntegrationSecret(value: string, encodedKey: string): Promise<string> {
  const [version, ivPart, encryptedPart, extra] = value.split(".");
  if (version !== VERSION || !ivPart || !encryptedPart || extra) {
    throw new Error("Invalid encrypted integration credential");
  }
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(decodeBase64Url(ivPart)) },
    await importKey(encodedKey),
    toArrayBuffer(decodeBase64Url(encryptedPart)),
  );
  return new TextDecoder().decode(decrypted);
}

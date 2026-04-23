import { decodeBase64, encodeBase64 } from "@std/encoding";
import { config } from "../config.ts";

const encoder = new TextEncoder();

function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }

  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left[index] ^ right[index];
  }

  return mismatch === 0;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function getSecretKey(): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(config.appSecret),
  );
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function hashPassword(password: string): Promise<{
  hash: string;
  salt: string;
}> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: 210_000,
      hash: "SHA-256",
    },
    keyMaterial,
    256,
  );

  return {
    hash: encodeBase64(new Uint8Array(derivedBits)),
    salt: encodeBase64(salt),
  };
}

export async function verifyPassword(
  password: string,
  expectedHash: string,
  expectedSalt: string,
): Promise<boolean> {
  const salt = decodeBase64(expectedSalt);
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: 210_000,
      hash: "SHA-256",
    },
    keyMaterial,
    256,
  );

  return timingSafeEqual(
    new Uint8Array(derivedBits),
    decodeBase64(expectedHash),
  );
}

export async function encryptSecret(value: string): Promise<string> {
  if (!value) {
    return "";
  }

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await getSecretKey();
  const cipherText = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(value),
  );

  return `${encodeBase64(iv)}.${encodeBase64(new Uint8Array(cipherText))}`;
}

export async function decryptSecret(value: string): Promise<string> {
  if (!value) {
    return "";
  }

  const [ivPart, cipherPart] = value.split(".");
  if (!ivPart || !cipherPart) {
    return "";
  }

  const key = await getSecretKey();
  const plainText = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: decodeBase64(ivPart) },
    key,
    decodeBase64(cipherPart),
  );

  return new TextDecoder().decode(plainText);
}

export async function generateSessionToken(): Promise<{
  token: string;
  tokenHash: string;
}> {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const token = encodeBase64(bytes).replaceAll("=", "");
  return {
    token,
    tokenHash: await sha256Hex(token),
  };
}

export async function generateProxyKeySecret(): Promise<{
  plainText: string;
  keyHash: string;
  prefix: string;
  lastFour: string;
}> {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const suffix = encodeBase64(bytes).replaceAll("=", "").replaceAll("/", "")
    .replaceAll("+", "");
  const plainText = `llmpx_${suffix}`;
  return {
    plainText,
    keyHash: await sha256Hex(plainText),
    prefix: plainText.slice(0, 8),
    lastFour: plainText.slice(-4),
  };
}

export function cacheKeyForParts(parts: string[]): Promise<string> {
  return sha256Hex(parts.join("::"));
}

export function parseCookieHeader(
  headerValue?: string | null,
): Record<string, string> {
  if (!headerValue) {
    return {};
  }

  return Object.fromEntries(
    headerValue
      .split(";")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const separatorIndex = entry.indexOf("=");
        if (separatorIndex === -1) {
          return [entry, ""];
        }
        return [
          entry.slice(0, separatorIndex),
          decodeURIComponent(entry.slice(separatorIndex + 1)),
        ];
      }),
  );
}

export function buildSessionCookie(
  value: string,
  maxAgeSeconds: number,
): string {
  return `${config.sessionCookieName}=${
    encodeURIComponent(value)
  }; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export function buildExpiredSessionCookie(): string {
  return `${config.sessionCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

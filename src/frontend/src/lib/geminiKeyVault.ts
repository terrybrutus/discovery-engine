import { useSyncExternalStore } from "react";

const STORAGE_KEY = "trading-discovery.gemini-key.v1";
const ITERATIONS = 250_000;

interface EncryptedGeminiKey {
  version: 1;
  salt: string;
  iv: string;
  ciphertext: string;
  iterations: number;
}

let memoryKey = "";
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

function storageAvailable(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function readVault(): EncryptedGeminiKey | null {
  if (!storageAvailable()) return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const decoded = JSON.parse(raw) as Partial<EncryptedGeminiKey>;
    if (
      decoded.version !== 1 ||
      typeof decoded.salt !== "string" ||
      typeof decoded.iv !== "string" ||
      typeof decoded.ciphertext !== "string"
    ) {
      return null;
    }
    return {
      version: 1,
      salt: decoded.salt,
      iv: decoded.iv,
      ciphertext: decoded.ciphertext,
      iterations: decoded.iterations ?? ITERATIONS,
    };
  } catch {
    return null;
  }
}

async function deriveKey(
  pin: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: asArrayBuffer(salt),
      iterations,
      hash: "SHA-256",
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function validatePin(pin: string): string {
  const normalized = pin.trim();
  if (!/^\d{4,12}$/.test(normalized)) {
    throw new Error("Use a 4–12 digit PIN.");
  }
  return normalized;
}

export function getGeminiKey(): string {
  return memoryKey;
}

export function setGeminiKey(apiKey: string): void {
  memoryKey = apiKey.trim();
  notify();
}

export function lockGeminiKey(): void {
  memoryKey = "";
  notify();
}

export function hasEncryptedGeminiKey(): boolean {
  return readVault() !== null;
}

export async function saveGeminiKeyWithPin(
  apiKey: string,
  pin: string,
): Promise<void> {
  const normalizedKey = apiKey.trim();
  if (normalizedKey.length < 20) {
    throw new Error("Enter a valid Gemini API key before saving it.");
  }
  if (!storageAvailable() || !globalThis.crypto?.subtle) {
    throw new Error("Encrypted key storage is unavailable in this browser.");
  }
  const normalizedPin = validatePin(pin);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(normalizedPin, salt, ITERATIONS);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: asArrayBuffer(iv) },
      key,
      new TextEncoder().encode(normalizedKey),
    ),
  );
  const record: EncryptedGeminiKey = {
    version: 1,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(ciphertext),
    iterations: ITERATIONS,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  setGeminiKey(normalizedKey);
}

export async function unlockGeminiKey(pin: string): Promise<string> {
  const record = readVault();
  if (!record) throw new Error("No encrypted Gemini key is saved here.");
  if (!globalThis.crypto?.subtle) {
    throw new Error("Encrypted key storage is unavailable in this browser.");
  }
  try {
    const key = await deriveKey(
      validatePin(pin),
      base64ToBytes(record.salt),
      record.iterations,
    );
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: asArrayBuffer(base64ToBytes(record.iv)) },
      key,
      asArrayBuffer(base64ToBytes(record.ciphertext)),
    );
    const apiKey = new TextDecoder().decode(plaintext);
    if (apiKey.length < 20) throw new Error("Invalid decrypted key.");
    setGeminiKey(apiKey);
    return apiKey;
  } catch {
    throw new Error("That PIN could not unlock the saved Gemini key.");
  }
}

export function removeEncryptedGeminiKey(): void {
  if (storageAvailable()) localStorage.removeItem(STORAGE_KEY);
  lockGeminiKey();
}

export function useGeminiKey(): string {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getGeminiKey,
    () => "",
  );
}

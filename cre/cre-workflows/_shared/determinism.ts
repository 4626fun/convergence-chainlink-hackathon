import { sha256 } from "@noble/hashes/sha2"
import { bytesToHex } from "@noble/hashes/utils"

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function stableClone(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => stableClone(entry))
  }

  if (!isRecord(value)) return value

  const output: Record<string, unknown> = {}
  for (const key of Object.keys(value).sort()) {
    output[key] = stableClone(value[key])
  }
  return output
}

export function stableJsonStringify(value: unknown): string {
  return JSON.stringify(stableClone(value))
}

export function sha256Hex(value: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(value)))
}

export function stableSortStrings(values: string[]): string[] {
  return [...values].sort((a, b) => a.localeCompare(b))
}

export function stableSortBy<T>(values: T[], key: (value: T) => string): T[] {
  return [...values].sort((left, right) => key(left).localeCompare(key(right)))
}

export function bytesToBase64(bytes: Uint8Array): string {
  let output = ""
  let i = 0

  while (i < bytes.length) {
    const a = bytes[i] ?? 0
    const b = bytes[i + 1] ?? 0
    const c = bytes[i + 2] ?? 0

    const chunk = (a << 16) | (b << 8) | c

    output += BASE64_ALPHABET[(chunk >>> 18) & 63]
    output += BASE64_ALPHABET[(chunk >>> 12) & 63]
    output += i + 1 < bytes.length ? BASE64_ALPHABET[(chunk >>> 6) & 63] : "="
    output += i + 2 < bytes.length ? BASE64_ALPHABET[chunk & 63] : "="

    i += 3
  }

  return output
}

export function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/\s+/g, "")
  if (clean.length % 4 !== 0) {
    throw new Error("invalid_base64_length")
  }

  const output: number[] = []
  let i = 0

  while (i < clean.length) {
    const c1 = clean[i] ?? ""
    const c2 = clean[i + 1] ?? ""
    const c3 = clean[i + 2] ?? ""
    const c4 = clean[i + 3] ?? ""

    const v1 = BASE64_ALPHABET.indexOf(c1)
    const v2 = BASE64_ALPHABET.indexOf(c2)
    const v3 = c3 === "=" ? -1 : BASE64_ALPHABET.indexOf(c3)
    const v4 = c4 === "=" ? -1 : BASE64_ALPHABET.indexOf(c4)

    if (v1 < 0 || v2 < 0 || (v3 < 0 && c3 !== "=") || (v4 < 0 && c4 !== "=")) {
      throw new Error("invalid_base64_character")
    }

    const chunk = (v1 << 18) | (v2 << 12) | ((v3 < 0 ? 0 : v3) << 6) | (v4 < 0 ? 0 : v4)
    output.push((chunk >>> 16) & 255)
    if (c3 !== "=") output.push((chunk >>> 8) & 255)
    if (c4 !== "=") output.push(chunk & 255)

    i += 4
  }

  return new Uint8Array(output)
}

export function encodeJsonBody(payload: unknown): string {
  const json = JSON.stringify(payload)
  return bytesToBase64(new TextEncoder().encode(json))
}

export function decodeJsonBody<T>(body: Uint8Array): T {
  return JSON.parse(new TextDecoder().decode(body)) as T
}

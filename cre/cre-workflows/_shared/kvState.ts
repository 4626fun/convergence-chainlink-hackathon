import { hmac } from "@noble/hashes/hmac"
import { sha256 } from "@noble/hashes/sha2"
import { bytesToHex } from "@noble/hashes/utils"
import { HTTPClient, type NodeRuntime } from "@chainlink/cre-sdk"
import { bytesToBase64, decodeJsonBody } from "./determinism"

const EMPTY_PAYLOAD_HASH = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

export type KvRuntimeConfig = {
  aws_region: string
  s3_bucket: string
  s3_key: string
}

export type AwsCredentials = {
  accessKeyId: string
  secretAccessKey: string
}

function sha256Hex(data: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(data)))
}

function sha256HexBytes(data: Uint8Array): string {
  return bytesToHex(sha256(data))
}

function hmacSha256(key: Uint8Array, data: string): Uint8Array {
  return hmac(sha256, key, new TextEncoder().encode(data))
}

function deriveSigningKey(secretKey: string, dateStamp: string, region: string, service: string): Uint8Array {
  const kDate = hmacSha256(new TextEncoder().encode(`AWS4${secretKey}`), dateStamp)
  const kRegion = hmacSha256(kDate, region)
  const kService = hmacSha256(kRegion, service)
  return hmacSha256(kService, "aws4_request")
}

function formatTimestamp(date: Date): { amzDate: string; dateStamp: string } {
  const iso = date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")
  return {
    amzDate: iso,
    dateStamp: iso.slice(0, 8),
  }
}

function s3Endpoint(config: KvRuntimeConfig): { host: string; path: string } {
  let escapedPath = encodeURI(config.s3_key)
  if (!escapedPath.startsWith("/")) {
    escapedPath = `/${escapedPath}`
  }

  if (config.s3_bucket.includes(".")) {
    return {
      host: `s3.${config.aws_region}.amazonaws.com`,
      path: `/${config.s3_bucket}${escapedPath}`,
    }
  }

  return {
    host: `${config.s3_bucket}.s3.${config.aws_region}.amazonaws.com`,
    path: escapedPath,
  }
}

function signRequest(params: {
  method: "GET" | "PUT"
  host: string
  path: string
  queryString: string
  headers: Record<string, string>
  payloadHash: string
  credentials: AwsCredentials
  region: string
  timestamp: Date
}): Record<string, string> {
  const { method, host, path, queryString, payloadHash, credentials, region, timestamp } = params
  const { amzDate, dateStamp } = formatTimestamp(timestamp)
  const service = "s3"
  const scope = `${dateStamp}/${region}/${service}/aws4_request`

  const signedHeaderEntries: [string, string][] = [
    ["host", host],
    ["x-amz-content-sha256", payloadHash],
    ["x-amz-date", amzDate],
  ]

  for (const [key, value] of Object.entries(params.headers)) {
    const lower = key.toLowerCase()
    if (lower !== "host" && lower !== "x-amz-content-sha256" && lower !== "x-amz-date") {
      signedHeaderEntries.push([lower, value])
    }
  }

  signedHeaderEntries.sort((a, b) => a[0].localeCompare(b[0]))

  const canonicalHeaders = signedHeaderEntries.map(([k, v]) => `${k}:${v.trim()}\n`).join("")
  const signedHeaders = signedHeaderEntries.map(([k]) => k).join(";")
  const canonicalRequest = [
    method,
    path,
    queryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n")

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n")

  const signingKey = deriveSigningKey(credentials.secretAccessKey, dateStamp, region, service)
  const signature = bytesToHex(hmacSha256(signingKey, stringToSign))

  const authorization = `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`

  return {
    ...params.headers,
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    Authorization: authorization,
  }
}

function readBodyText(body: Uint8Array): string {
  return new TextDecoder().decode(body)
}

export function readKvText<Config extends KvRuntimeConfig>(
  nodeRuntime: NodeRuntime<Config>,
  httpClient: HTTPClient,
  creds: AwsCredentials,
  timestamp: Date,
): string | null {
  const { host, path } = s3Endpoint(nodeRuntime.config)
  const fullURL = `https://${host}${path}`

  const headers = signRequest({
    method: "GET",
    host,
    path,
    queryString: "",
    headers: {},
    payloadHash: EMPTY_PAYLOAD_HASH,
    credentials: creds,
    region: nodeRuntime.config.aws_region,
    timestamp,
  })

  const response = httpClient.sendRequest(nodeRuntime, {
    url: fullURL,
    method: "GET",
    headers,
    cacheSettings: { store: true, maxAge: "60s" },
  }).result()

  if (response.statusCode === 404) {
    return null
  }
  if (response.statusCode >= 300) {
    throw new Error(`s3_get_failed_${response.statusCode}`)
  }

  return readBodyText(response.body).trim()
}

export function readKvNumber<Config extends KvRuntimeConfig>(
  nodeRuntime: NodeRuntime<Config>,
  httpClient: HTTPClient,
  creds: AwsCredentials,
  timestamp: Date,
): number {
  const value = readKvText(nodeRuntime, httpClient, creds, timestamp)
  if (!value) return 0
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function readKvJson<Config extends KvRuntimeConfig, T>(
  nodeRuntime: NodeRuntime<Config>,
  httpClient: HTTPClient,
  creds: AwsCredentials,
  timestamp: Date,
  fallback: T,
): T {
  const value = readKvText(nodeRuntime, httpClient, creds, timestamp)
  if (!value) return fallback
  try {
    const bytes = new TextEncoder().encode(value)
    return decodeJsonBody<T>(bytes)
  } catch {
    return fallback
  }
}

export function writeKvText<Config extends KvRuntimeConfig>(
  nodeRuntime: NodeRuntime<Config>,
  httpClient: HTTPClient,
  creds: AwsCredentials,
  value: string,
  timestamp: Date,
): string {
  const { host, path } = s3Endpoint(nodeRuntime.config)
  const fullURL = `https://${host}${path}`
  const bodyBytes = new TextEncoder().encode(value)
  const payloadHash = sha256HexBytes(bodyBytes)

  const headers = signRequest({
    method: "PUT",
    host,
    path,
    queryString: "",
    headers: {
      "content-type": "text/plain",
      "content-length": String(bodyBytes.length),
    },
    payloadHash,
    credentials: creds,
    region: nodeRuntime.config.aws_region,
    timestamp,
  })

  const response = httpClient.sendRequest(nodeRuntime, {
    url: fullURL,
    method: "PUT",
    headers,
    body: bytesToBase64(bodyBytes),
    cacheSettings: { store: true, maxAge: "60s" },
  }).result()

  if (response.statusCode >= 300) {
    throw new Error(`s3_put_failed_${response.statusCode}`)
  }

  return value
}

export function writeKvJson<Config extends KvRuntimeConfig>(
  nodeRuntime: NodeRuntime<Config>,
  httpClient: HTTPClient,
  creds: AwsCredentials,
  value: unknown,
  timestamp: Date,
): string {
  return writeKvText(nodeRuntime, httpClient, creds, JSON.stringify(value), timestamp)
}

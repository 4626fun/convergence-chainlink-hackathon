import { HTTPClient, type NodeRuntime } from "@chainlink/cre-sdk"
import { decodeJsonBody, encodeJsonBody as encodeJsonBodyInternal } from "./determinism"

export type ApiRuntimeConfig = {
  apiBaseUrl: string
}

export const encodeJsonBody = encodeJsonBodyInternal

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE"

type JsonRequestOptions = {
  method: HttpMethod
  path: string
  payload?: unknown
}

function withLeadingSlash(path: string): string {
  if (path.startsWith("/")) return path
  return `/${path}`
}

function requestHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  }
}

export function sendJsonRequest<Config extends ApiRuntimeConfig, T>(
  nodeRuntime: NodeRuntime<Config>,
  httpClient: HTTPClient,
  apiKey: string,
  options: JsonRequestOptions,
): T {
  const url = `${nodeRuntime.config.apiBaseUrl}${withLeadingSlash(options.path)}`
  const request = {
    url,
    method: options.method,
    headers: requestHeaders(apiKey),
    ...(options.payload === undefined ? {} : { body: encodeJsonBodyInternal(options.payload) }),
  }

  const response = httpClient.sendRequest(nodeRuntime, request).result()
  if (response.statusCode >= 400) {
    throw new Error(`http_${options.method.toLowerCase()}_${response.statusCode}_${options.path}`)
  }

  return decodeJsonBody<T>(response.body)
}

export function getJson<Config extends ApiRuntimeConfig, T>(
  nodeRuntime: NodeRuntime<Config>,
  httpClient: HTTPClient,
  apiKey: string,
  path: string,
): T {
  return sendJsonRequest<Config, T>(nodeRuntime, httpClient, apiKey, {
    method: "GET",
    path,
  })
}

export function postJson<Config extends ApiRuntimeConfig, T>(
  nodeRuntime: NodeRuntime<Config>,
  httpClient: HTTPClient,
  apiKey: string,
  path: string,
  payload: unknown,
): T {
  return sendJsonRequest<Config, T>(nodeRuntime, httpClient, apiKey, {
    method: "POST",
    path,
    payload,
  })
}

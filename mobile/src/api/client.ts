import Constants from 'expo-constants';

import { ApiError } from './types';

const BACKEND_PORT = 8000;

/**
 * Where the backend lives.
 *
 * In development this is derived from the Metro dev server's own address
 * (`hostUri`), so the app follows the Mac wherever it lands — home Wi-Fi,
 * phone hotspot, a different coffee shop — without editing any config. A
 * hardcoded LAN IP goes stale the moment the network changes, and the failure
 * looks like a hang rather than an error, because packets to a non-existent
 * host are dropped rather than refused.
 *
 * EXPO_PUBLIC_API_URL overrides it when set — needed for a deployed backend,
 * where the API is not on the machine serving the bundle.
 */
function resolveApiUrl(): string {
  const explicit = process.env.EXPO_PUBLIC_API_URL;
  if (explicit) return explicit;

  // e.g. "172.20.10.10:8081" — strip Metro's port, use the backend's.
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  if (host) return `http://${host}:${BACKEND_PORT}`;

  return `http://localhost:${BACKEND_PORT}`;
}

export const API_URL = resolveApiUrl();

console.log('[api] base URL:', API_URL);

/** Transcribe + parse is a couple of network hops; the UI shows a spinner meanwhile. */
const TIMEOUT_MS = 30_000;

async function parseError(response: Response): Promise<ApiError> {
  let message = `Request failed (${response.status})`;
  let transcript: string | undefined;

  try {
    const body = await response.json();
    const detail = body?.detail;
    if (typeof detail === 'string') {
      message = detail;
    } else if (detail && typeof detail === 'object') {
      // The /voice endpoint returns {message, transcript} so the app can show
      // what was heard even when the time could not be pinned down.
      message = detail.message ?? message;
      transcript = detail.transcript;
    }
  } catch {
    // Non-JSON body (a proxy error page, say) — keep the status-based message.
  }

  return new ApiError(response.status, message, transcript);
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ApiError(0, 'The server took too long to respond.');
    }
    throw new ApiError(0, `Could not reach the server at ${API_URL}.`);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) throw await parseError(response);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

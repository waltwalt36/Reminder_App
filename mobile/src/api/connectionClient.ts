import { API_URL } from './client';
import { DeviceEventEmitter } from 'react-native';
import { accessToken, clearTokens, refreshAccessToken } from './auth';

export class ConnectionApiError extends Error {
  constructor(message: string, readonly status = 0) { super(message); this.name = 'ConnectionApiError'; }
}

async function decode(response: Response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body);
    throw new ConnectionApiError(detail || `Request failed (${response.status})`, response.status);
  }
  return body;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const run = async (token: string | null) => fetch(`${API_URL}/api${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  let token = await accessToken();
  let response: Response;
  try { response = await run(token); }
  catch { throw new ConnectionApiError(`Can't reach ${API_URL}. Check that the Django API is running.`); }
  if (response.status === 401) {
    const refreshed = await refreshAccessToken();
    if (refreshed) response = await run(refreshed.access);
    if (response.status === 401) { await clearTokens(); DeviceEventEmitter.emit('connection-auth-expired'); }
  }
  return decode(response) as Promise<T>;
}

export async function uploadVoice<T = any>(path: string, audioUri: string, timezone: string): Promise<T> {
  const send = async (token: string | null) => new Promise<{ status: number; body: any }>((resolve, reject) => {
    const form = new FormData();
    form.append('file', { uri: audioUri, name: 'connection-note.m4a', type: 'audio/m4a' } as unknown as Blob);
    form.append('timezone', timezone);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_URL}/api${path}`);
    xhr.timeout = 45000;
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.onload = () => {
      let body: any = {};
      try { body = JSON.parse(xhr.responseText || '{}'); } catch { body = {}; }
      resolve({ status: xhr.status, body });
    };
    xhr.onerror = () => reject(new ConnectionApiError(`Can't reach ${API_URL}.`));
    xhr.ontimeout = () => reject(new ConnectionApiError('Upload timed out. Try again.'));
    xhr.send(form);
  });
  let result = await send(await accessToken());
  if (result.status === 401) {
    const refreshed = await refreshAccessToken();
    if (refreshed) result = await send(refreshed.access);
    if (result.status === 401) { await clearTokens(); DeviceEventEmitter.emit('connection-auth-expired'); }
  }
  if (result.status < 200 || result.status >= 300) {
    throw new ConnectionApiError(typeof result.body.detail === 'string' ? result.body.detail : JSON.stringify(result.body), result.status);
  }
  return result.body as T;
}

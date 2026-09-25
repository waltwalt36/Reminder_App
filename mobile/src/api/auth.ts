import * as SecureStore from 'expo-secure-store';
import { API_URL } from './client';

type TokenPair = { access: string; refresh: string };
const TOKEN_KEY = 'connection-app-auth-v1';
let tokens: TokenPair | null = null;
let refreshPromise: Promise<TokenPair | null> | null = null;

export async function readTokens(): Promise<TokenPair | null> {
  if (tokens) return tokens;
  const raw = await SecureStore.getItemAsync(TOKEN_KEY);
  if (!raw) return null;
  try { tokens = JSON.parse(raw) as TokenPair; return tokens; }
  catch { await SecureStore.deleteItemAsync(TOKEN_KEY); return null; }
}

async function saveTokens(value: TokenPair) {
  tokens = value;
  await SecureStore.setItemAsync(TOKEN_KEY, JSON.stringify(value));
}

export async function login(username: string, password: string): Promise<void> {
  const response = await fetch(`${API_URL}/api/auth/token/`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.detail ?? 'Login failed. Check your username and password.');
  await saveTokens(body as TokenPair);
}

export async function refreshAccessToken(): Promise<TokenPair | null> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const current = await readTokens();
    if (!current?.refresh) return null;
    try {
      const response = await fetch(`${API_URL}/api/auth/refresh/`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh: current.refresh }),
      });
      if (!response.ok) { await clearTokens(); return null; }
      const body = await response.json();
      const next = { access: body.access as string, refresh: (body.refresh as string | undefined) ?? current.refresh };
      await saveTokens(next);
      return next;
    } catch { return null; }
  })();
  try { return await refreshPromise; } finally { refreshPromise = null; }
}

export async function accessToken(): Promise<string | null> {
  return (await readTokens())?.access ?? null;
}

export async function clearTokens(): Promise<void> {
  tokens = null;
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export async function logout(): Promise<void> {
  const current = await readTokens();
  if (current?.refresh) {
    await fetch(`${API_URL}/api/auth/logout/`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh: current.refresh }),
    }).catch(() => undefined);
  }
  await clearTokens();
}

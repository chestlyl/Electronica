/**
 * Placeholder API client for the mobile application.
 * All business logic calls must go through the API server — never directly to Supabase from the app.
 */

const API_URL = process.env['EXPO_PUBLIC_API_URL'] ?? 'http://localhost:4000';

export async function apiGet<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { Authorization: ['Bearer', token].join(' ') },
  });

  if (!res.ok) {
    const body = (await res.json()) as { error?: string };
    throw new Error(body.error ?? `API error ${res.status}`);
  }

  return res.json() as Promise<T>;
}

export async function apiPost<T>(
  path: string,
  token: string,
  body: unknown,
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: ['Bearer', token].join(' '),
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = (await res.json()) as { error?: string };
    throw new Error(errBody.error ?? `API error ${res.status}`);
  }

  return res.json() as Promise<T>;
}

/**
 * auth.ts — Utilidades de autenticación para el cliente
 *
 * Incluye `refreshAccessToken`: renueva el accessToken silenciosamente
 * al arrancar la app si está vencido, para evitar redirigir al login
 * cuando el usuario simplemente regresa después de un tiempo.
 */

import { useAuthStore } from '@/stores/authStore';

const API_URL = process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:4000';
const STORE_KEY = 'gotagota-auth';
const REFRESH_BUFFER_MS = 60_000; // Renovar si vence en menos de 60 segundos

/** Decodifica el payload de un JWT sin verificar la firma */
function decodeJwtPayload(token: string): { exp?: number } | null {
  try {
    const base64 = token.split('.')[1];
    if (!base64) return null;
    return JSON.parse(atob(base64)) as { exp?: number };
  } catch {
    return null;
  }
}

/** Devuelve true si el accessToken está vencido o a punto de vencer */
function isTokenExpiredOrSoon(token: string | null | undefined): boolean {
  if (!token) return true;
  const payload = decodeJwtPayload(token);
  if (!payload?.exp) return true;
  return payload.exp * 1000 < Date.now() + REFRESH_BUFFER_MS;
}

/**
 * Intenta renovar el accessToken de forma silenciosa al arrancar la app.
 * - Si el accessToken todavía es válido: no hace nada.
 * - Si está vencido pero hay refreshToken: llama a /api/auth/refresh.
 * - Si el refresh falla (refreshToken también vencido): no fuerza logout,
 *   deja que el guard del dashboard maneje el redirect al login.
 */
export async function refreshAccessToken(): Promise<void> {
  // Leer directamente del localStorage para evitar problemas de hidratación
  const raw = localStorage.getItem(STORE_KEY);
  if (!raw) return;

  let stored: { state?: { accessToken?: string; refreshToken?: string } };
  try {
    stored = JSON.parse(raw) as typeof stored;
  } catch {
    return;
  }

  const { accessToken, refreshToken } = stored.state ?? {};

  // Sin refreshToken no hay nada que hacer
  if (!refreshToken) return;

  // Si el accessToken está vigente, no necesitamos renovarlo
  if (!isTokenExpiredOrSoon(accessToken)) return;

  try {
    const res = await fetch(`${API_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });

    if (!res.ok) {
      // El refreshToken también está vencido o revocado — el guard manejará esto
      console.warn('[Auth] Silent refresh: refreshToken inválido, el usuario deberá iniciar sesión.');
      return;
    }

    const json = await res.json() as { data?: { accessToken?: string; refreshToken?: string } };
    const newAccess = json.data?.accessToken;
    const newRefresh = json.data?.refreshToken;

    if (newAccess && newRefresh) {
      // Actualizar el store de Zustand con los nuevos tokens
      useAuthStore.getState().setTokens(newAccess, newRefresh);
      console.log('[Auth] ✅ Token renovado silenciosamente — sesión activa.');
    }
  } catch (err) {
    // Error de red u otro — no interrumpir el arranque de la app
    console.warn('[Auth] Silent refresh falló (error de red):', err);
  }
}

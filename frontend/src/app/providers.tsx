'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { useState, useEffect } from 'react';
import { useOfflineStore } from '@/stores/offlineStore';
import { useAuthStore } from '@/stores/authStore';
import { Toaster } from '@/components/ui/Toaster';

const API_URL = process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:4000';

/** Decodifica el exp de un JWT sin verificar firma */
function getTokenExp(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1] ?? '')) as { exp?: number };
    return payload.exp ?? null;
  } catch {
    return null;
  }
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30 * 1000,
            gcTime: 5 * 60 * 1000,
            retry: 2,
            retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10000),
            refetchOnWindowFocus: true,
            refetchOnReconnect: true,
          },
          mutations: {
            retry: 1,
          },
        },
      })
  );

  const setOnline = useOfflineStore((s) => s.setOnline);

  // ─── Silent refresh al montar: renueva el token si está vencido ──
  useEffect(() => {
    const silentRefresh = async () => {
      const { accessToken, refreshToken, setTokens } = useAuthStore.getState();

      // Sin refreshToken no hay sesión que recuperar
      if (!refreshToken) return;

      // Comprobar si el accessToken sigue vigente (margen de 60 s)
      if (accessToken) {
        const exp = getTokenExp(accessToken);
        if (exp && exp * 1000 > Date.now() + 60_000) return; // Aún válido
      }

      // Token vencido o ausente → pedir refresh al backend
      try {
        const res = await fetch(`${API_URL}/api/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });

        if (!res.ok) return; // RefreshToken inválido → el guard del dashboard maneja el redirect

        const json = await res.json() as { data?: { accessToken?: string; refreshToken?: string } };
        if (json.data?.accessToken && json.data?.refreshToken) {
          setTokens(json.data.accessToken, json.data.refreshToken);
          console.log('[Auth] ✅ Sesión renovada silenciosamente.');
        }
      } catch {
        // Error de red — no interrumpir el arranque
      }
    };

    silentRefresh();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Service Worker y estado de red ───────────────────────────
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => console.log('SW registrado:', reg.scope))
        .catch((err) => console.error('SW error:', err));
    }

    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [setOnline]);

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster />
      {process.env.NODE_ENV === 'development' && (
        <ReactQueryDevtools initialIsOpen={false} />
      )}
    </QueryClientProvider>
  );
}

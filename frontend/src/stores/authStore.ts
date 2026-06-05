import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface Usuario {
  id: string;
  nombre: string;
  email: string;
  rol: 'admin' | 'cobrador';
}

interface AuthState {
  usuario: Usuario | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;

  setAuth: (usuario: Usuario, accessToken: string, refreshToken: string) => void;
  setTokens: (accessToken: string, refreshToken: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      usuario: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,

      setAuth: (usuario, accessToken, refreshToken) =>
        set({ usuario, accessToken, refreshToken, isAuthenticated: true }),

      setTokens: (accessToken, refreshToken) =>
        set({ accessToken, refreshToken }),

      logout: () =>
        set({ usuario: null, accessToken: null, refreshToken: null, isAuthenticated: false }),
    }),
    {
      name: 'gotagota-auth',
      storage: createJSONStorage(() => localStorage),
      // Persistir toda la sesión para evitar llamadas de refresh en cada recarga
      partialize: (state) => ({
        usuario: state.usuario,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);

'use client';
import { useAuthStore } from '@/stores/authStore';

export type Rol = 'auditor' | 'admin' | 'cobrador';

/**
 * Permisos de la sesión actual.
 *
 * El auditor está por encima de todo y es el único que puede borrar: el resto
 * de perfiles corrige con "anular" o "cancelar", que dejan rastro. El backend
 * aplica lo mismo, esto sólo evita mostrar botones que iban a fallar.
 */
export function useRol() {
  const rol = (useAuthStore((s) => s.usuario?.rol) ?? 'cobrador') as Rol;

  return {
    rol,
    esAuditor: rol === 'auditor',
    esAdmin: rol === 'admin' || rol === 'auditor',
    esCobrador: rol === 'cobrador',
    /** Sólo el auditor borra registros de forma permanente. */
    puedeEliminar: rol === 'auditor',
  };
}

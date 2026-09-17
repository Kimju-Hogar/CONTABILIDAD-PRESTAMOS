'use client';
import { useRouter, usePathname } from 'next/navigation';
import { ChevronLeft, LogOut, Wifi, WifiOff } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useOfflineStore } from '@/stores/offlineStore';
import { apiClient } from '@/services/api';

const TITLES: Record<string, string> = {
  '/':             'Inicio',
  '/clientes':     'Clientes',
  '/prestamos':    'Préstamos',
  '/cobros':       'Cobros',
  '/gastos':       'Gastos',
  '/reportes':     'Reportes',
  '/caja':         'Caja del día',
  '/caja/historial': 'Cierres de caja',
  '/admin':        'Panel admin',
  '/admin/usuarios': 'Usuarios',
  '/admin/configuracion': 'Parámetros',
};

export function TopBar() {
  const pathname = usePathname();
  const router = useRouter();
  const { usuario, logout } = useAuthStore();
  const { isOnline, cobrosPendientes } = useOfflineStore();

  const isRoot = ['/', '/clientes', '/prestamos', '/cobros', '/gastos', '/caja', '/admin'].includes(pathname);

  const title = (() => {
    for (const [key, val] of Object.entries(TITLES)) {
      if (pathname === key) return val;
    }
    if (pathname.includes('/clientes/nuevo')) return 'Nuevo Cliente';
    if (pathname.includes('/prestamos/nuevo')) return 'Nuevo Préstamo';
    if (pathname.includes('/cobros/registrar')) return 'Registrar Cobro';
    if (pathname.startsWith('/caja')) return 'Caja';
    if (pathname.startsWith('/admin')) return 'Administración';
    if (pathname.includes('/cobros')) return 'Cobros';
    if (pathname.includes('/clientes')) return 'Cliente';
    if (pathname.includes('/prestamos')) return 'Préstamo';
    return 'GotaGota';
  })();

  const handleLogout = async () => {
    try {
      await apiClient.post('/api/auth/logout');
    } catch { /* silent */ }
    logout();
    router.replace('/login');
  };

  return (
    <header className="topbar">
      {/* Izquierda — Back o Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 40 }}>
        {!isRoot ? (
          <button
            className="btn-icon"
            onClick={() => router.back()}
            aria-label="Volver"
            style={{ background: 'transparent', border: 'none' }}
          >
            <ChevronLeft size={24} />
          </button>
        ) : (
          <div style={{
            width: 32, height: 32,
            background: 'var(--brand-500)',
            borderRadius: 8,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{ color: 'white', fontSize: 14, fontWeight: 700 }}>G</span>
          </div>
        )}
      </div>

      {/* Centro — Título */}
      <div style={{ textAlign: 'center', flex: 1 }}>
        <p style={{ margin: 0, fontWeight: 700, fontSize: 16, color: 'var(--text-primary)' }}>
          {title}
        </p>
        {usuario && (
          <p style={{ margin: 0, fontSize: 11, color: 'var(--text-muted)' }}>
            {usuario.nombre.split(' ')[0]}
          </p>
        )}
      </div>

      {/* Derecha — Estado + Logout */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 40, justifyContent: 'flex-end' }}>
        {/* Indicador offline + cobros pendientes */}
        <div style={{ position: 'relative' }}>
          {isOnline
            ? <Wifi size={18} color="var(--success-500)" />
            : <WifiOff size={18} color="var(--warning-500)" />
          }
          {cobrosPendientes.length > 0 && (
            <span style={{
              position: 'absolute', top: -4, right: -4,
              background: 'var(--warning-500)', color: 'white',
              width: 14, height: 14, borderRadius: '50%',
              fontSize: 9, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {cobrosPendientes.length}
            </span>
          )}
        </div>

        {isRoot && (
          <button
            className="btn-icon"
            onClick={handleLogout}
            aria-label="Cerrar sesión"
            style={{ background: 'transparent', border: 'none' }}
          >
            <LogOut size={18} color="var(--text-muted)" />
          </button>
        )}
      </div>
    </header>
  );
}

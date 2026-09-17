'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Wallet, ChevronRight, Lock, Unlock } from 'lucide-react';
import { apiClient } from '@/services/api';
import { formatCOP } from '@/lib/utils';

interface EstadoCajaResumen {
  estado: 'sin_abrir' | 'abierto' | 'cerrado';
  saldoEsperado: number;
  saldoContado: number | null;
  diferencia: number;
  totales: { totalCobrado: number; totalPrestado: number };
}

/**
 * Tira compacta con el estado de la caja del día. Va en el inicio para que el
 * cobrador sepa con cuánto va sin entrar a la sección de caja.
 */
export function ResumenCajaHoy() {
  const { data } = useQuery<EstadoCajaResumen>({
    queryKey: ['caja-estado'],
    queryFn: () => apiClient.get('/api/caja/estado').then((r) => r.data.data),
    refetchInterval: 60_000,
  });

  if (!data) return null;

  const cerrada = data.estado === 'cerrado';
  const sinAbrir = data.estado === 'sin_abrir';
  const saldo = cerrada ? (data.saldoContado ?? data.saldoEsperado) : data.saldoEsperado;

  return (
    <Link href="/caja" style={{ textDecoration: 'none' }}>
      <div
        className="card animate-fade-in"
        style={{
          padding: '13px 16px',
          display: 'flex', alignItems: 'center', gap: 12,
          borderLeft: `3px solid ${sinAbrir ? 'var(--warning-500)' : cerrada ? 'var(--success-500)' : 'var(--brand-500)'}`,
        }}
      >
        <div style={{
          background: 'var(--bg-input)', borderRadius: 10, padding: 8,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {cerrada ? <Lock size={17} color="var(--success-500)" />
            : sinAbrir ? <Unlock size={17} color="var(--warning-500)" />
            : <Wallet size={17} color="var(--brand-500)" />}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {sinAbrir ? 'Caja sin abrir' : cerrada ? 'Cerraste con' : 'Llevas en caja'}
          </p>
          <p style={{ margin: '2px 0 0', fontSize: 17, fontWeight: 800, color: 'var(--text-primary)' }}>
            {formatCOP(saldo)}
          </p>
          <p style={{ margin: '1px 0 0', fontSize: 11.5, color: 'var(--text-muted)' }}>
            Recogido {formatCOP(data.totales.totalCobrado)} · Prestado {formatCOP(data.totales.totalPrestado)}
          </p>
        </div>

        <ChevronRight size={18} color="var(--text-muted)" />
      </div>
    </Link>
  );
}

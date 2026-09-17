'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Loader2, ChevronLeft, ChevronRight, CheckCircle2, AlertTriangle,
  Unlock, Wallet,
} from 'lucide-react';
import { apiClient } from '@/services/api';
import { formatCOP, formatFechaCO } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';
import { StatRow, Sep } from '@/components/shared/Stats';

interface Cierre {
  _id: string;
  fechaKey: string;
  estado: 'abierto' | 'cerrado';
  baseInicial: number;
  totalCobrado: number;
  totalPrestado: number;
  totalGastos: number;
  totalPapeleria: number;
  totalCartones: number;
  otrosIngresos: number;
  otrosEgresos: number;
  saldoEsperado: number;
  saldoContado: number | null;
  diferencia: number;
  observaciones?: string;
  cobrador?: { _id: string; nombre: string };
}

export default function HistorialCajaPage() {
  const queryClient = useQueryClient();
  const { usuario } = useAuthStore();
  const esAdmin = usuario?.rol === 'admin';
  const [pagina, setPagina] = useState(1);
  const [expandido, setExpandido] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['caja-cierres', pagina],
    queryFn: () => apiClient.get(`/api/caja/cierres?page=${pagina}&limit=20`).then((r) => r.data),
  });

  const invalidar = () => {
    queryClient.invalidateQueries({ queryKey: ['caja-cierres'] });
    queryClient.invalidateQueries({ queryKey: ['caja-estado'] });
  };

  const reabrir = useMutation({
    mutationFn: ({ id, motivo }: { id: string; motivo: string }) =>
      apiClient.post(`/api/caja/${id}/reabrir`, { motivo }),
    onSuccess: invalidar,
  });

  // Un día que quedó abierto rompe el arrastre de la base, así que se puede
  // cerrar desde aquí sin tener que esperar a que el admin lo reabra.
  const cerrarPendiente = useMutation({
    mutationFn: ({ fechaKey, saldoContado }: { fechaKey: string; saldoContado: number }) =>
      apiClient.post('/api/caja/cerrar', {
        fechaKey,
        saldoContado,
        observaciones: 'Cerrado en diferido desde el historial',
      }),
    onSuccess: invalidar,
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      window.alert(msg ?? 'No se pudo cerrar el día');
    },
  });

  const cierres: Cierre[] = data?.data ?? [];
  const totalPaginas = data?.pagination?.totalPages ?? 1;

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
        <Loader2 size={28} color="var(--brand-500)" style={{ animation: 'spin 1s linear infinite' }} />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>Cierres de caja</h1>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
          {data?.pagination?.total ?? 0} día{(data?.pagination?.total ?? 0) === 1 ? '' : 's'} registrado
          {(data?.pagination?.total ?? 0) === 1 ? '' : 's'}
        </p>
      </div>

      {cierres.length === 0 && (
        <div className="empty-state">
          <Wallet size={30} color="var(--text-muted)" />
          <p style={{ marginTop: 8, fontSize: 13.5 }}>Todavía no hay cierres registrados.</p>
        </div>
      )}

      {cierres.map((c) => {
        const abierto = expandido === c._id;
        const cuadrado = c.diferencia === 0;
        return (
          <div key={c._id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <button
              onClick={() => setExpandido(abierto ? null : c._id)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                padding: '13px 16px', background: 'transparent', border: 'none',
                cursor: 'pointer', textAlign: 'left',
              }}
            >
              {c.estado === 'abierto'
                ? <Unlock size={17} color="var(--warning-500)" />
                : cuadrado
                  ? <CheckCircle2 size={17} color="var(--success-500)" />
                  : <AlertTriangle size={17} color="var(--danger-500)" />}

              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 13.5, fontWeight: 700 }}>
                  {formatFechaCO(`${c.fechaKey}T12:00:00`)}
                </p>
                <p style={{ margin: 0, fontSize: 11.5, color: 'var(--text-muted)' }}>
                  {esAdmin && c.cobrador ? `${c.cobrador.nombre} · ` : ''}
                  {c.estado === 'abierto' ? 'Sin cerrar · ' : ''}
                  Recogió {formatCOP(c.totalCobrado)}
                </p>
              </div>

              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 800 }}>
                  {formatCOP(c.saldoContado ?? c.saldoEsperado)}
                </p>
                {c.estado === 'cerrado' && !cuadrado && (
                  <p style={{
                    margin: 0, fontSize: 11, fontWeight: 700,
                    color: c.diferencia < 0 ? 'var(--danger-600)' : 'var(--warning-600)',
                  }}>
                    {c.diferencia < 0 ? 'Faltó ' : 'Sobró '}{formatCOP(Math.abs(c.diferencia))}
                  </p>
                )}
              </div>

              <ChevronRight
                size={16}
                color="var(--text-muted)"
                style={{ transform: abierto ? 'rotate(90deg)' : 'none', transition: 'transform 150ms' }}
              />
            </button>

            {abierto && (
              <div style={{ padding: '0 16px 14px', borderTop: '1px solid var(--border)' }}>
                <div style={{ paddingTop: 8 }}>
                  <StatRow label="Base inicial" valor={c.baseInicial} tono="muted" />
                  <StatRow label="Cobros" valor={c.totalCobrado} tono="positivo" />
                  {c.otrosIngresos > 0 && <StatRow label="Otros ingresos" valor={c.otrosIngresos} tono="positivo" />}
                  <StatRow label="Prestado" valor={-c.totalPrestado} tono="negativo" />
                  <StatRow label="Gastos" valor={-c.totalGastos} tono="negativo" />
                  {c.otrosEgresos > 0 && <StatRow label="Otros egresos" valor={-c.otrosEgresos} tono="negativo" />}
                  <Sep />
                  <StatRow label="Esperado" valor={c.saldoEsperado} negrita />
                  {c.estado === 'cerrado' && (
                    <>
                      <StatRow label="Contado" valor={c.saldoContado ?? 0} negrita />
                      <StatRow
                        label="Diferencia"
                        valor={c.diferencia}
                        tono={cuadrado ? 'positivo' : 'negativo'}
                        negrita
                      />
                    </>
                  )}
                  {(c.totalPapeleria > 0 || c.totalCartones > 0) && (
                    <>
                      <Sep />
                      <StatRow
                        label="Papelería y cartones del día"
                        valor={c.totalPapeleria + c.totalCartones}
                        tono="muted"
                      />
                    </>
                  )}
                  {c.observaciones && (
                    <p style={{ margin: '8px 0 0', fontSize: 12.5, color: 'var(--text-muted)' }}>
                      {c.observaciones}
                    </p>
                  )}
                  {c.estado === 'abierto' && (
                    <button
                      className="btn-secondary"
                      style={{ marginTop: 12 }}
                      disabled={cerrarPendiente.isPending}
                      onClick={() => {
                        const respuesta = window.prompt(
                          `¿Con cuánto efectivo quedó el ${c.fechaKey}? Lo esperado es ${formatCOP(c.saldoEsperado)}.`,
                          String(c.saldoEsperado)
                        );
                        if (respuesta === null) return;
                        const saldoContado = Number(respuesta.replace(/\D/g, ''));
                        if (Number.isNaN(saldoContado)) return;
                        cerrarPendiente.mutate({ fechaKey: c.fechaKey, saldoContado });
                      }}
                    >
                      Cerrar este día
                    </button>
                  )}
                  {esAdmin && c.estado === 'cerrado' && (
                    <button
                      className="btn-secondary"
                      style={{ marginTop: 12 }}
                      disabled={reabrir.isPending}
                      onClick={() => {
                        const motivo = window.prompt('¿Por qué necesitas reabrir este cierre?');
                        if (motivo && motivo.trim().length >= 5) {
                          reabrir.mutate({ id: c._id, motivo: motivo.trim() });
                        }
                      }}
                    >
                      Reabrir para corregir
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {totalPaginas > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
          <button
            className="btn-icon"
            disabled={pagina === 1}
            onClick={() => setPagina((p) => p - 1)}
            aria-label="Página anterior"
          >
            <ChevronLeft size={18} />
          </button>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            {pagina} de {totalPaginas}
          </span>
          <button
            className="btn-icon"
            disabled={pagina === totalPaginas}
            onClick={() => setPagina((p) => p + 1)}
            aria-label="Página siguiente"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      )}
    </div>
  );
}

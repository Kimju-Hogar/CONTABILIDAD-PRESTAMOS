'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Wallet, Lock, Unlock, Plus, Trash2, Loader2, TrendingUp, TrendingDown,
  FileText, AlertTriangle, CheckCircle2, History, ArrowRight, Calculator, Receipt,
} from 'lucide-react';
import { apiClient } from '@/services/api';
import { useRol } from '@/hooks/useRol';
import { formatCOP, formatFechaCO } from '@/lib/utils';
import { StatCard, StatRow, SectionCard, Sep, Segmented } from '@/components/shared/Stats';

// ─── Tipos ────────────────────────────────────────────────────
interface Movimiento {
  _id: string;
  tipo: 'ingreso' | 'egreso';
  concepto: string;
  monto: number;
  descripcion?: string;
  createdAt: string;
  registradoPor?: { nombre: string };
}

interface EstadoCaja {
  fechaKey: string;
  estado: 'sin_abrir' | 'abierto' | 'cerrado';
  baseInicial: number;
  saldoEsperado: number;
  saldoContado: number | null;
  diferencia: number;
  baseSugerida: { base: number; origen: string } | null;
  movimientos: Movimiento[];
  caja: { observaciones?: string; cerradoEn?: string } | null;
  totales: {
    totalCobrado: number;
    cantidadCobros: number;
    totalPrestado: number;
    cantidadPrestamos: number;
    cargosCobrados: number;
    totalPapeleria: number;
    totalCartones: number;
    totalGastos: number;
    otrosIngresos: number;
    otrosEgresos: number;
  };
}

const ETIQUETAS_CONCEPTO: Record<string, string> = {
  inyeccion_capital: 'Inyección de capital',
  renovacion_carton: 'Renovación de cartón',
  abono_externo: 'Abono externo',
  otro_ingreso: 'Otro ingreso',
  retiro_utilidad: 'Retiro de utilidad',
  retiro_papeleria: 'Retiro de papelería',
  prestamo_externo: 'Préstamo por fuera del sistema',
  otro_egreso: 'Otro egreso',
  ajuste: 'Ajuste de caja',
};

const CONCEPTOS_INGRESO = ['inyeccion_capital', 'renovacion_carton', 'abono_externo', 'otro_ingreso'];
const CONCEPTOS_EGRESO = ['retiro_utilidad', 'retiro_papeleria', 'prestamo_externo', 'otro_egreso'];

// ─── Input de dinero ──────────────────────────────────────────
function InputDinero({
  valor, onChange, autoFocus, placeholder,
}: {
  valor: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const numero = Number(valor.replace(/\D/g, '')) || 0;
  return (
    <div>
      <input
        className="input-field"
        inputMode="numeric"
        autoFocus={autoFocus}
        placeholder={placeholder ?? '0'}
        value={valor}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
        style={{ fontSize: 20, fontWeight: 800, textAlign: 'right' }}
      />
      <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-muted)', textAlign: 'right' }}>
        {formatCOP(numero)}
      </p>
    </div>
  );
}

// ─── Modal genérico ───────────────────────────────────────────
function Modal({
  titulo, onClose, children,
}: {
  titulo: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      onClick={onClose}
      style={{
        // Por encima de la topbar y la bottom-nav, que viven en z-index 100
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgb(0 0 0 / 0.5)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
    >
      <div
        className="animate-slide-up"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-card)',
          borderRadius: '20px 20px 0 0',
          padding: 20,
          width: '100%', maxWidth: 430,
          maxHeight: '88dvh', overflowY: 'auto',
          paddingBottom: 'calc(20px + var(--safe-area-bottom))',
        }}
      >
        <h2 style={{ margin: '0 0 14px', fontSize: 17, fontWeight: 800 }}>{titulo}</h2>
        {children}
      </div>
    </div>
  );
}

// ─── Página ───────────────────────────────────────────────────
export default function CajaPage() {
  const { puedeEliminar, esAdmin } = useRol();
  const queryClient = useQueryClient();
  // Admin y auditor pueden mirar (y operar) la caja de cualquier cobrador
  const [cobradorId, setCobradorId] = useState('');
  const sufijo = cobradorId ? `?cobradorId=${cobradorId}` : '';
  const [modal, setModal] = useState<'abrir' | 'cerrar' | 'movimiento' | null>(null);
  const [base, setBase] = useState('');
  const [contado, setContado] = useState('');
  const [obsCierre, setObsCierre] = useState('');
  const [movTipo, setMovTipo] = useState<'ingreso' | 'egreso'>('ingreso');
  const [movConcepto, setMovConcepto] = useState('inyeccion_capital');
  const [movMonto, setMovMonto] = useState('');
  const [movDesc, setMovDesc] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: usuarios } = useQuery<Array<{ _id: string; nombre: string; rol: string }>>({
    queryKey: ['admin-usuarios'],
    queryFn: () => apiClient.get('/api/admin/usuarios').then((r) => r.data.data),
    enabled: esAdmin,
    staleTime: 5 * 60 * 1000,
  });

  const { data, isLoading } = useQuery<EstadoCaja>({
    queryKey: ['caja-estado', cobradorId],
    queryFn: () => apiClient.get(`/api/caja/estado${sufijo}`).then((r) => r.data.data),
    refetchInterval: 60_000,
  });

  const refrescar = () => {
    queryClient.invalidateQueries({ queryKey: ['caja-estado'] });
    queryClient.invalidateQueries({ queryKey: ['caja-cierres'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard-kpis'] });
  };

  const manejarError = (e: unknown) => {
    const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
    setError(msg ?? 'No se pudo completar la operación');
  };

  const abrir = useMutation({
    mutationFn: () => apiClient.post(`/api/caja/abrir${sufijo}`, { baseInicial: Number(base) || 0 }),
    onSuccess: () => { refrescar(); setModal(null); setBase(''); setError(null); },
    onError: manejarError,
  });

  const cerrar = useMutation({
    mutationFn: () => apiClient.post(`/api/caja/cerrar${sufijo}`, {
      saldoContado: Number(contado) || 0,
      fechaKey: data?.fechaKey,
      observaciones: obsCierre || undefined,
    }),
    onSuccess: () => { refrescar(); setModal(null); setContado(''); setObsCierre(''); setError(null); },
    onError: manejarError,
  });

  const crearMovimiento = useMutation({
    mutationFn: () => apiClient.post(`/api/caja/movimientos${sufijo}`, {
      tipo: movTipo,
      concepto: movConcepto,
      monto: Number(movMonto) || 0,
      descripcion: movDesc || undefined,
    }),
    onSuccess: () => { refrescar(); setModal(null); setMovMonto(''); setMovDesc(''); setError(null); },
    onError: manejarError,
  });

  const borrarMovimiento = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/api/caja/movimientos/${id}`),
    onSuccess: refrescar,
    onError: manejarError,
  });

  // Diferencia en vivo mientras el cobrador digita el conteo
  const diferenciaEnVivo = useMemo(() => {
    if (!data || !contado) return null;
    return Number(contado) - data.saldoEsperado;
  }, [contado, data]);

  if (isLoading || !data) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
        <Loader2 size={28} color="var(--brand-500)" style={{ animation: 'spin 1s linear infinite' }} />
      </div>
    );
  }

  const t = data.totales;
  const cerrada = data.estado === 'cerrado';
  const abierta = data.estado === 'abierto';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ─── Encabezado ─────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>Caja del día</h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
            {formatFechaCO(`${data.fechaKey}T12:00:00`)}
          </p>
        </div>
        <span className={`badge ${cerrada ? 'badge-success' : abierta ? 'badge-brand' : 'badge-muted'}`}>
          {cerrada ? 'Cerrada' : abierta ? 'Abierta' : 'Sin abrir'}
        </span>
      </div>

      {/* Admin y auditor eligen de quién es la caja que están viendo */}
      {esAdmin && (usuarios ?? []).length > 1 && (
        <div>
          <label className="input-label">Caja de</label>
          <select
            className="input-field"
            value={cobradorId}
            onChange={(e) => setCobradorId(e.target.value)}
          >
            <option value="">La mía</option>
            {(usuarios ?? []).map((u) => (
              <option key={u._id} value={u._id}>
                {u.nombre} · {u.rol}
              </option>
            ))}
          </select>
        </div>
      )}

      {error && (
        <div className="card" style={{
          padding: '10px 14px', borderLeft: '3px solid var(--danger-500)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <AlertTriangle size={16} color="var(--danger-500)" />
          <span style={{ fontSize: 13, color: 'var(--danger-600)' }}>{error}</span>
        </div>
      )}

      {/* ─── Saldo principal ────────────────────────────────── */}
      <StatCard
        label={
          cerrada ? 'Cerraste el día con'
          : abierta ? 'Efectivo que debes tener'
          : 'Movimiento del día (sin base)'
        }
        value={formatCOP(cerrada ? (data.saldoContado ?? data.saldoEsperado) : data.saldoEsperado)}
        sub={
          cerrada
            ? `Esperado ${formatCOP(data.saldoEsperado)} · Diferencia ${formatCOP(data.diferencia)}`
            : abierta
              ? `Base ${formatCOP(data.baseInicial)} + recogido − prestado − gastos`
              : 'Abre la caja con tu base para ver el efectivo real'
        }
        gradient={
          // Ámbar cuando algo pide atención: descuadre al cerrar, o día sin abrir
          (cerrada && data.diferencia !== 0) || !abierta && !cerrada
            ? 'linear-gradient(135deg, #d97706, #f59e0b)'
            : 'linear-gradient(135deg, #059669, #0d9488)'
        }
        icon={Wallet}
      />

      {/* ─── Sin abrir: llamada a abrir ─────────────────────── */}
      {data.estado === 'sin_abrir' && (
        <div className="card" style={{ padding: 16, textAlign: 'center' }}>
          <Unlock size={26} color="var(--brand-500)" />
          <h2 style={{ margin: '8px 0 4px', fontSize: 15, fontWeight: 800 }}>Aún no abres la caja</h2>
          <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--text-muted)' }}>
            {data.baseSugerida
              ? `Vienes con ${formatCOP(data.baseSugerida.base)} del cierre anterior.`
              : 'Registra con cuánto efectivo arrancas el día.'}
          </p>
          <button
            className="btn-primary"
            onClick={() => { setBase(String(data.baseSugerida?.base ?? 0)); setError(null); setModal('abrir'); }}
          >
            Abrir el día
          </button>
        </div>
      )}

      {/* ─── Detalle del movimiento del día ─────────────────── */}
      <SectionCard titulo="Cómo se movió la plata hoy" icon={Calculator}>
        <StatRow label="Base con la que arrancaste" valor={data.baseInicial} tono="muted" />
        <Sep />
        <StatRow
          label="Plata que entró (cobros)"
          sub={`${t.cantidadCobros} cobro${t.cantidadCobros === 1 ? '' : 's'}`}
          valor={t.totalCobrado}
          tono="positivo"
        />
        {t.cargosCobrados > 0 && (
          <StatRow
            label="Cargos de renovación cobrados"
            sub="Papelería y cartón que pagó el cliente al renovar"
            valor={t.cargosCobrados}
            tono="positivo"
          />
        )}
        {t.otrosIngresos > 0 && (
          <StatRow label="Otros ingresos" valor={t.otrosIngresos} tono="positivo" />
        )}
        <StatRow
          label="Plata que salió (préstamos)"
          sub={`${t.cantidadPrestamos} préstamo${t.cantidadPrestamos === 1 ? '' : 's'} desembolsado${t.cantidadPrestamos === 1 ? '' : 's'}`}
          valor={-t.totalPrestado}
          tono="negativo"
        />
        <StatRow label="Gastos del día" valor={-t.totalGastos} tono="negativo" />
        {t.otrosEgresos > 0 && (
          <StatRow label="Otros egresos y retiros" valor={-t.otrosEgresos} tono="negativo" />
        )}
        <Sep />
        <StatRow label="Queda en caja" valor={data.saldoEsperado} negrita />
      </SectionCard>

      {/* ─── Papelería y cartones retenidos ─────────────────── */}
      {(t.totalPapeleria > 0 || t.totalCartones > 0) && (
        <SectionCard titulo="Se quedó en caja de papelería y cartones" icon={FileText}>
          <p style={{ margin: '0 0 6px', fontSize: 12, color: 'var(--text-muted)' }}>
            Ya está descontado del desembolso, así que este efectivo está dentro del saldo de arriba.
          </p>
          <StatRow label="Papelería cobrada hoy" valor={t.totalPapeleria} />
          <StatRow label="Renovación de cartones" valor={t.totalCartones} />
          <Sep />
          <StatRow label="Total del día" valor={t.totalPapeleria + t.totalCartones} negrita />
        </SectionCard>
      )}

      {/* ─── Movimientos manuales ───────────────────────────── */}
      <SectionCard
        titulo="Movimientos registrados a mano"
        icon={History}
        accion={
          !cerrada && (
            <button
              className="btn-icon"
              onClick={() => { setError(null); setModal('movimiento'); }}
              aria-label="Agregar movimiento"
              style={{ background: 'var(--bg-input)', border: 'none' }}
            >
              <Plus size={16} color="var(--brand-500)" />
            </button>
          )
        }
      >
        {data.movimientos.length === 0 ? (
          <p style={{ margin: '6px 0', fontSize: 13, color: 'var(--text-muted)' }}>
            Sin movimientos manuales hoy.
          </p>
        ) : (
          data.movimientos.map((m) => (
            <div key={m._id} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '9px 0', borderBottom: '1px solid var(--border)',
            }}>
              {m.tipo === 'ingreso'
                ? <TrendingUp size={16} color="var(--success-500)" />
                : <TrendingDown size={16} color="var(--danger-500)" />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>
                  {ETIQUETAS_CONCEPTO[m.concepto] ?? m.concepto}
                </p>
                {m.descripcion && (
                  <p style={{
                    margin: 0, fontSize: 11.5, color: 'var(--text-muted)',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {m.descripcion}
                  </p>
                )}
              </div>
              <span style={{
                fontSize: 13.5, fontWeight: 700, whiteSpace: 'nowrap',
                color: m.tipo === 'ingreso' ? 'var(--success-600)' : 'var(--danger-600)',
              }}>
                {m.tipo === 'ingreso' ? '+' : '−'}{formatCOP(m.monto)}
              </span>
              {!cerrada && puedeEliminar && (
                <button
                  className="btn-icon"
                  onClick={() => borrarMovimiento.mutate(m._id)}
                  aria-label="Eliminar movimiento"
                  style={{ background: 'transparent', border: 'none' }}
                >
                  <Trash2 size={15} color="var(--text-muted)" />
                </button>
              )}
            </div>
          ))
        )}
      </SectionCard>

      {/* ─── Cierre ─────────────────────────────────────────── */}
      {abierta && (
        <button
          className="btn-primary"
          onClick={() => { setContado(String(data.saldoEsperado)); setError(null); setModal('cerrar'); }}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
        >
          <Lock size={17} /> Cerrar el día
        </button>
      )}

      {cerrada && (
        <div className="card" style={{ padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <CheckCircle2 size={18} color="var(--success-500)" />
            <h2 style={{ margin: 0, fontSize: 14, fontWeight: 800 }}>Día cerrado</h2>
          </div>
          <StatRow label="Efectivo esperado" valor={data.saldoEsperado} />
          <StatRow label="Efectivo contado" valor={data.saldoContado ?? 0} />
          <StatRow
            label={data.diferencia < 0 ? 'Faltante' : data.diferencia > 0 ? 'Sobrante' : 'Diferencia'}
            valor={data.diferencia}
            tono={data.diferencia === 0 ? 'positivo' : 'negativo'}
            negrita
          />
          <Sep />
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
            Mañana arrancas con <strong>{formatCOP(data.saldoContado ?? data.saldoEsperado)}</strong>.
          </p>
          {data.caja?.observaciones && (
            <p style={{ margin: '8px 0 0', fontSize: 12.5, color: 'var(--text-muted)' }}>
              {data.caja.observaciones}
            </p>
          )}
        </div>
      )}

      {[
        { href: '/caja/dia', icon: FileText, label: 'Reporte del día detallado' },
        { href: '/caja/historial', icon: History, label: 'Ver cierres anteriores' },
        { href: '/gastos', icon: Receipt, label: 'Registrar un gasto' },
      ].map(({ href, icon: Icon, label }) => (
        <Link key={href} href={href} style={{ textDecoration: 'none' }}>
          <div className="card" style={{
            padding: '13px 16px', display: 'flex', alignItems: 'center',
            justifyContent: 'space-between', gap: 8,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon size={16} color="var(--brand-500)" />
              <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)' }}>
                {label}
              </span>
            </div>
            <ArrowRight size={16} color="var(--text-muted)" />
          </div>
        </Link>
      ))}

      {/* ─── Modal: abrir ───────────────────────────────────── */}
      {modal === 'abrir' && (
        <Modal titulo="Abrir la caja del día" onClose={() => setModal(null)}>
          <label className="input-label">¿Con cuánto efectivo arrancas?</label>
          <InputDinero valor={base} onChange={setBase} autoFocus />
          {data.baseSugerida && (
            <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
              Sugerido: {formatCOP(data.baseSugerida.base)} — {data.baseSugerida.origen}
            </p>
          )}
          <button
            className="btn-primary"
            style={{ marginTop: 16 }}
            disabled={abrir.isPending}
            onClick={() => abrir.mutate()}
          >
            {abrir.isPending ? 'Abriendo…' : 'Abrir caja'}
          </button>
        </Modal>
      )}

      {/* ─── Modal: cerrar ──────────────────────────────────── */}
      {modal === 'cerrar' && (
        <Modal titulo="Cerrar el día" onClose={() => setModal(null)}>
          <div className="card" style={{ padding: '10px 14px', marginBottom: 14, background: 'var(--bg-input)' }}>
            <StatRow label="Deberías tener" valor={data.saldoEsperado} negrita />
          </div>

          <label className="input-label">¿Cuánto efectivo contaste?</label>
          <InputDinero valor={contado} onChange={setContado} autoFocus />

          {diferenciaEnVivo !== null && diferenciaEnVivo !== 0 && (
            <div style={{
              marginTop: 10, padding: '10px 14px',
              borderRadius: 'var(--radius-md)',
              background: diferenciaEnVivo < 0 ? 'rgb(239 68 68 / 0.1)' : 'rgb(245 158 11 / 0.1)',
            }}>
              <p style={{
                margin: 0, fontSize: 13, fontWeight: 700,
                color: diferenciaEnVivo < 0 ? 'var(--danger-600)' : 'var(--warning-600)',
              }}>
                {diferenciaEnVivo < 0 ? 'Faltan' : 'Sobran'} {formatCOP(Math.abs(diferenciaEnVivo))}
              </p>
            </div>
          )}

          <label className="input-label" style={{ marginTop: 14 }}>Observaciones (opcional)</label>
          <textarea
            className="input-field"
            rows={2}
            value={obsCierre}
            onChange={(e) => setObsCierre(e.target.value)}
            placeholder="Ej: le fié $20.000 a Don Pedro"
          />

          <button
            className="btn-primary"
            style={{ marginTop: 16 }}
            disabled={cerrar.isPending || !contado}
            onClick={() => cerrar.mutate()}
          >
            {cerrar.isPending ? 'Cerrando…' : 'Confirmar cierre'}
          </button>
        </Modal>
      )}

      {/* ─── Modal: movimiento ──────────────────────────────── */}
      {modal === 'movimiento' && (
        <Modal titulo="Registrar movimiento de caja" onClose={() => setModal(null)}>
          <Segmented
            value={movTipo}
            onChange={(v) => {
              setMovTipo(v);
              setMovConcepto(v === 'ingreso' ? 'inyeccion_capital' : 'retiro_utilidad');
            }}
            options={[
              { id: 'ingreso', label: 'Entra plata' },
              { id: 'egreso', label: 'Sale plata' },
            ]}
          />

          <label className="input-label" style={{ marginTop: 14 }}>Concepto</label>
          <select
            className="input-field"
            value={movConcepto}
            onChange={(e) => setMovConcepto(e.target.value)}
          >
            {(movTipo === 'ingreso' ? CONCEPTOS_INGRESO : CONCEPTOS_EGRESO).map((c) => (
              <option key={c} value={c}>{ETIQUETAS_CONCEPTO[c]}</option>
            ))}
          </select>

          <label className="input-label" style={{ marginTop: 14 }}>Monto</label>
          <InputDinero valor={movMonto} onChange={setMovMonto} />

          <label className="input-label" style={{ marginTop: 14 }}>Descripción (opcional)</label>
          <input
            className="input-field"
            value={movDesc}
            onChange={(e) => setMovDesc(e.target.value)}
            placeholder="¿De qué se trata?"
          />

          <button
            className="btn-primary"
            style={{ marginTop: 16 }}
            disabled={crearMovimiento.isPending || !movMonto}
            onClick={() => crearMovimiento.mutate()}
          >
            {crearMovimiento.isPending ? 'Guardando…' : 'Registrar movimiento'}
          </button>
        </Modal>
      )}
    </div>
  );
}

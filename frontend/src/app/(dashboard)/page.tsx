'use client';
import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import {
  TrendingUp, Users, AlertTriangle, DollarSign, Plus, ArrowRight,
  Loader2, Phone, CheckCircle2, Clock, Zap,
} from 'lucide-react';
import { apiClient } from '@/services/api';
import { formatCOP, formatFechaCO } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';

// ─── KPI Card ─────────────────────────────────────────────────
function KPICard({
  label, value, sub, gradient, icon: Icon,
}: {
  label: string; value: string; sub?: string;
  gradient: string; icon: React.ElementType;
}) {
  return (
    <div className="animate-fade-in" style={{
      background: gradient,
      borderRadius: 'var(--radius-lg)',
      padding: '16px',
      color: 'white',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <p style={{ margin: 0, fontSize: 11, fontWeight: 600, opacity: 0.8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</p>
          <p style={{ margin: '6px 0 0', fontSize: 22, fontWeight: 800 }}>{value}</p>
          {sub && <p style={{ margin: '2px 0 0', fontSize: 12, opacity: 0.75 }}>{sub}</p>}
        </div>
        <div style={{ background: 'rgb(255 255 255 / 0.2)', borderRadius: 10, padding: 8 }}>
          <Icon size={20} />
        </div>
      </div>
    </div>
  );
}

// ─── Tooltip COP ──────────────────────────────────────────────
const COPTooltip = ({ active, payload, label }: Record<string, unknown>) => {
  if (active && Array.isArray(payload) && payload.length) {
    return (
      <div className="card" style={{ padding: '8px 12px', fontSize: 12 }}>
        <p style={{ margin: 0, fontWeight: 600 }}>{String(label)}</p>
        {(payload as Array<{ name: string; value: number }>).map((p) => (
          <p key={p.name} style={{ margin: '2px 0', color: 'var(--brand-500)' }}>
            {p.name}: {formatCOP(p.value)}
          </p>
        ))}
      </div>
    );
  }
  return null;
};

// ─── Tarjeta de cobro del día ─────────────────────────────────
interface ClienteHoy {
  _id: string;
  prestamoId: string;
  clienteId: string;
  clienteNombre: string;
  clienteCelular?: string;
  modalidad: string;
  cuotaDiaria: number;
  saldoPendiente: number;
  cuotasVencidas: number;
  proximaCuota?: { fechaEsperada: string; monto: number; numero: number };
  pagadoHoy: boolean;
  montoCobradoHoy: number;
}

function TarjetaClienteHoy({ cliente }: { cliente: ClienteHoy }) {
  const esMoroso = cliente.cuotasVencidas > 0;
  return (
    <div
      className="animate-fade-in"
      style={{
        borderRadius: 'var(--radius-lg)',
        border: `1.5px solid ${cliente.pagadoHoy
          ? '#10b981'
          : esMoroso ? '#ef4444' : 'var(--border)'}`,
        background: cliente.pagadoHoy
          ? 'rgb(16 185 129 / 0.06)'
          : esMoroso ? 'rgb(239 68 68 / 0.04)' : 'var(--bg-card)',
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        opacity: cliente.pagadoHoy ? 0.75 : 1,
        transition: 'all 0.3s',
      }}
    >
      {/* Cabecera */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {cliente.pagadoHoy && <CheckCircle2 size={14} color="#10b981" />}
            <p style={{
              margin: 0, fontWeight: 700, fontSize: 14,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              color: cliente.pagadoHoy ? '#10b981' : 'var(--text-primary)',
              textDecoration: cliente.pagadoHoy ? 'line-through' : 'none',
            }}>
              {cliente.clienteNombre}
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3 }}>
            <span style={{
              fontSize: 11, fontWeight: 600, padding: '1px 7px', borderRadius: 12,
              background: esMoroso ? 'rgb(239 68 68 / 0.15)' : 'rgb(99 102 241 / 0.12)',
              color: esMoroso ? '#ef4444' : 'var(--brand-500)',
            }}>
              {esMoroso ? `⚠ ${cliente.cuotasVencidas} cuota${cliente.cuotasVencidas !== 1 ? 's' : ''} vencida${cliente.cuotasVencidas !== 1 ? 's' : ''}` : cliente.modalidad}
            </span>
            {cliente.clienteCelular && (
              <a
                href={`tel:${cliente.clienteCelular}`}
                style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 3, textDecoration: 'none', fontSize: 11 }}
                onClick={(e) => e.stopPropagation()}
              >
                <Phone size={12} /> {cliente.clienteCelular}
              </a>
            )}
          </div>
        </div>

        {/* Monto */}
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          {cliente.pagadoHoy ? (
            <div>
              <p style={{ margin: 0, fontSize: 11, color: '#10b981', fontWeight: 600 }}>Cobrado hoy</p>
              <p style={{ margin: 0, fontSize: 15, fontWeight: 800, color: '#10b981' }}>
                {formatCOP(cliente.montoCobradoHoy)}
              </p>
            </div>
          ) : (
            <div>
              <p style={{ margin: 0, fontSize: 11, color: 'var(--text-muted)' }}>Cuota</p>
              <p style={{ margin: 0, fontSize: 15, fontWeight: 800, color: 'var(--text-primary)' }}>
                {formatCOP(cliente.cuotaDiaria)}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Info cuota */}
      {!cliente.pagadoHoy && cliente.proximaCuota && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'var(--bg-input)', borderRadius: 8, padding: '6px 10px', fontSize: 12,
        }}>
          <span style={{ color: 'var(--text-muted)' }}>
            <Clock size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />
            Cuota #{cliente.proximaCuota.numero} · {formatFechaCO(cliente.proximaCuota.fechaEsperada)}
          </span>
          <span style={{ color: 'var(--text-muted)' }}>
            Saldo: <strong style={{ color: 'var(--text-primary)' }}>{formatCOP(cliente.saldoPendiente)}</strong>
          </span>
        </div>
      )}

      {/* Botón cobrar */}
      {!cliente.pagadoHoy && (
        <Link
          href={`/cobros/registrar?prestamoId=${cliente.prestamoId}`}
          style={{ textDecoration: 'none' }}
        >
          <div style={{
            background: 'linear-gradient(135deg, #4f46e5, #7c3aed)',
            borderRadius: 'var(--radius-md)',
            padding: '10px 14px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            gap: 6, color: 'white', fontWeight: 700, fontSize: 13,
            cursor: 'pointer',
            boxShadow: '0 4px 12px rgb(79 70 229 / 0.25)',
          }}>
            <Zap size={14} />
            Cobrar ahora
          </div>
        </Link>
      )}
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────
export default function DashboardPage() {
  const { usuario } = useAuthStore();
  const queryClient = useQueryClient();

  const { data: kpis, isLoading } = useQuery({
    queryKey: ['dashboard-kpis'],
    queryFn: () => apiClient.get('/api/dashboard/kpis').then((r) => r.data.data),
    refetchInterval: 60_000,
  });

  const { data: flujoCaja } = useQuery({
    queryKey: ['flujo-caja'],
    queryFn: () => apiClient.get('/api/dashboard/flujo-caja?dias=14').then((r) => r.data.data),
    staleTime: 5 * 60 * 1000,
  });

  const { data: clientesHoyData, isLoading: loadingHoy } = useQuery({
    queryKey: ['cobrar-hoy'],
    queryFn: () => apiClient.get('/api/dashboard/cobrar-hoy').then((r) => r.data.data),
    refetchInterval: 30_000, // Refresca cada 30s
  });

  const clientesHoy: ClienteHoy[] = clientesHoyData ?? [];
  const pendientes = clientesHoy.filter((c) => !c.pagadoHoy);
  const pagados = clientesHoy.filter((c) => c.pagadoHoy);

  // Refrescar lista al volver a la ventana
  useEffect(() => {
    const handleFocus = () => {
      queryClient.invalidateQueries({ queryKey: ['cobrar-hoy'] });
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [queryClient]);

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
        <Loader2 size={32} className="animate-pulse-soft" color="var(--brand-500)" />
      </div>
    );
  }

  const hoy = new Date().toLocaleDateString('es-CO', {
    weekday: 'long', day: 'numeric', month: 'long',
    timeZone: 'America/Bogota',
  });

  const chartData = (flujoCaja?.cobros ?? []).map((d: { _id: { day: number; month: number }; cobros: number }) => ({
    dia: `${d._id.day}/${d._id.month}`,
    Cobros: d.cobros,
  }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Saludo */}
      <div>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: 'var(--text-primary)' }}>
          Hola, {usuario?.nombre.split(' ')[0]} 👋
        </h1>
        <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--text-muted)', textTransform: 'capitalize' }}>
          {hoy}
        </p>
      </div>

      {/* ── Cobros de HOY ──────────────────────────────── */}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Cabecera con contador */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>
              Cobros de hoy
            </h2>
            {!loadingHoy && clientesHoy.length > 0 && (
              <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
                <span style={{ color: '#10b981', fontWeight: 700 }}>{pagados.length}</span>
                {' '}de{' '}
                <span style={{ fontWeight: 700 }}>{clientesHoy.length}</span>
                {' '}cobrados
              </p>
            )}
          </div>
          {/* Barra de progreso mini */}
          {clientesHoy.length > 0 && (
            <div style={{ textAlign: 'right' }}>
              <div style={{
                width: 60, height: 6, background: 'var(--border)',
                borderRadius: 99, overflow: 'hidden',
              }}>
                <div style={{
                  width: `${Math.round((pagados.length / clientesHoy.length) * 100)}%`,
                  height: '100%', background: '#10b981', borderRadius: 99,
                  transition: 'width 0.5s',
                }} />
              </div>
              <p style={{ margin: '3px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>
                {Math.round((pagados.length / clientesHoy.length) * 100)}%
              </p>
            </div>
          )}
        </div>

        {/* Contenido */}
        {loadingHoy ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 20 }}>
            <Loader2 size={24} className="animate-pulse-soft" color="var(--brand-500)" />
          </div>
        ) : clientesHoy.length === 0 ? (
          <div style={{
            textAlign: 'center', padding: '24px 16px',
            color: 'var(--text-muted)', fontSize: 14,
          }}>
            <p style={{ fontSize: 28, margin: '0 0 8px' }}>🎉</p>
            <p style={{ margin: 0, fontWeight: 600 }}>¡Todos al día!</p>
            <p style={{ margin: '4px 0 0', fontSize: 12 }}>No hay cobros pendientes para hoy</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* Pendientes primero */}
            {pendientes.length > 0 && (
              <>
                {pendientes.length > 0 && pagados.length > 0 && (
                  <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Pendientes ({pendientes.length})
                  </p>
                )}
                {pendientes.map((c) => (
                  <TarjetaClienteHoy key={c.prestamoId} cliente={c} />
                ))}
              </>
            )}

            {/* Ya pagados */}
            {pagados.length > 0 && (
              <>
                <p style={{ margin: '4px 0 0', fontSize: 11, fontWeight: 700, color: '#10b981', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  ✓ Cobrados hoy ({pagados.length})
                </p>
                {pagados.map((c) => (
                  <TarjetaClienteHoy key={c.prestamoId} cliente={c} />
                ))}
              </>
            )}
          </div>
        )}
      </div>

      {/* Acción rápida — Registrar cobro */}
      <Link href="/cobros/registrar" style={{ textDecoration: 'none' }}>
        <div style={{
          background: 'linear-gradient(135deg, #4f46e5, #7c3aed)',
          borderRadius: 'var(--radius-xl)',
          padding: '20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          color: 'white',
          boxShadow: '0 8px 24px rgb(79 70 229 / 0.3)',
        }}>
          <div>
            <p style={{ margin: 0, fontSize: 13, opacity: 0.85 }}>Acción rápida</p>
            <p style={{ margin: '4px 0 0', fontSize: 18, fontWeight: 700 }}>Registrar Cobro</p>
          </div>
          <div style={{
            width: 48, height: 48,
            background: 'rgb(255 255 255 / 0.2)',
            borderRadius: 12,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Plus size={24} />
          </div>
        </div>
      </Link>

      {/* KPIs en grid 2x2 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <KPICard
          label="Cobros hoy"
          value={formatCOP(kpis?.cobros?.dia?.monto ?? 0)}
          sub={`${kpis?.cobros?.dia?.cantidad ?? 0} cobros`}
          gradient="linear-gradient(135deg, #4f46e5, #7c3aed)"
          icon={DollarSign}
        />
        <KPICard
          label="Esta semana"
          value={formatCOP(kpis?.cobros?.semana?.monto ?? 0)}
          sub={`${kpis?.cobros?.semana?.cantidad ?? 0} cobros`}
          gradient="linear-gradient(135deg, #059669, #0d9488)"
          icon={TrendingUp}
        />
        <KPICard
          label="Clientes activos"
          value={String(kpis?.clientes?.activos ?? 0)}
          sub={`${kpis?.clientes?.morosos ?? 0} en mora`}
          gradient="linear-gradient(135deg, #d97706, #f59e0b)"
          icon={Users}
        />
        <KPICard
          label="Saldo pendiente"
          value={formatCOP(kpis?.capital?.saldoPendiente ?? 0)}
          sub={`${kpis?.capital?.prestamosActivos ?? 0} préstamos`}
          gradient="linear-gradient(135deg, #dc2626, #db2777)"
          icon={AlertTriangle}
        />
      </div>

      {/* Resumen financiero */}
      <div className="card">
        <h2 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 700 }}>Resumen del mes</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[
            { label: 'Capital colocado', value: kpis?.capital?.colocado ?? 0, color: 'var(--brand-500)' },
            { label: 'Total cobrado', value: kpis?.capital?.recuperado ?? 0, color: 'var(--success-500)' },
            { label: 'Ganancias', value: kpis?.capital?.ganancias ?? 0, color: 'var(--warning-500)' },
            { label: 'Gastos del mes', value: kpis?.financiero?.gastosMes ?? 0, color: 'var(--danger-500)' },
          ].map(({ label, value, color }) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>{label}</span>
              <span style={{ fontSize: 15, fontWeight: 700, color }}>{formatCOP(value)}</span>
            </div>
          ))}
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>Flujo de caja</span>
            <span style={{
              fontSize: 16, fontWeight: 800,
              color: (kpis?.financiero?.flujoCaja ?? 0) >= 0 ? 'var(--success-500)' : 'var(--danger-500)',
            }}>
              {formatCOP(kpis?.financiero?.flujoCaja ?? 0)}
            </span>
          </div>
        </div>
      </div>

      {/* Gráfica cobros últimos 14 días */}
      {chartData.length > 0 && (
        <div className="card">
          <h2 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 700 }}>Cobros últimos 14 días</h2>
          <ResponsiveContainer width="100%" height={160}>
            <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="colorCobros" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#4f46e5" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="dia" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <YAxis hide />
              <Tooltip content={<COPTooltip />} />
              <Area
                type="monotone"
                dataKey="Cobros"
                stroke="#4f46e5"
                strokeWidth={2}
                fill="url(#colorCobros)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Links rápidos */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {[
          { href: '/clientes/nuevo', label: 'Nuevo Cliente', color: 'var(--success-500)' },
          { href: '/prestamos/nuevo', label: 'Nuevo Préstamo', color: 'var(--brand-500)' },
          { href: '/cobros', label: 'Ver Cobros', color: 'var(--warning-500)' },
          { href: '/reportes', label: 'Exportar', color: 'var(--text-secondary)' },
        ].map(({ href, label, color }) => (
          <Link key={href} href={href} style={{ textDecoration: 'none' }}>
            <div className="card" style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '14px 16px', cursor: 'pointer',
            }}>
              <span style={{ fontSize: 13, fontWeight: 600, color }}>{label}</span>
              <ArrowRight size={16} color={color} />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

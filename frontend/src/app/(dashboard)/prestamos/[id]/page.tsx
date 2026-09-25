'use client';
import { useState, use } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle2, AlertTriangle, XCircle, Loader2, Phone, X, Trash2, Edit2, ChevronDown, ChevronUp, Info, PackageCheck } from 'lucide-react';
import { apiClient } from '@/services/api';
import { useRol } from '@/hooks/useRol';
import { formatCOP, formatFechaCO, formatFechaHoraCO, porcentajeProgreso } from '@/lib/utils';

// Un abono cuenta como día atendido: sólo va en rojo el día que no entró nada
const CUOTA_COLORS: Record<string, string> = {
  pagada: 'var(--success-500)', vencida: 'var(--danger-500)',
  pendiente: 'var(--border)', parcial: 'var(--success-500)',
};

const CUOTA_ETIQUETAS: Record<string, string> = {
  pagada: 'Pagada', vencida: 'Sin pagar', pendiente: 'Pendiente', parcial: 'Abonada',
};

/**
 * Cómo se pinta cada día del mapa.
 *
 * El parcial se ve verde porque el cliente sí pagó, pero con la parte que le
 * falta en un verde más claro, para distinguirlo de un día completo de un vistazo.
 */
function fondoCuota(c: { estado: string; monto: number; montoPagado?: number }): string {
  if (c.estado !== 'parcial') return CUOTA_COLORS[c.estado] ?? 'var(--border)';
  const cubierto = Math.min(100, Math.round(((c.montoPagado ?? 0) / (c.monto || 1)) * 100));
  return `linear-gradient(to right, var(--success-500) ${cubierto}%, rgb(16 185 129 / 0.35) ${cubierto}%)`;
}

const LABEL_MODALIDAD: Record<string, string> = {
  diaria:    'cuota diaria',
  semanal:   'cuota semanal',
  quincenal: 'cuota quincenal',
  mensual:   'cuota mensual',
};

interface CuotaDetalle {
  numero: number; estado: string; fechaEsperada: string;
  monto: number; fechaPago?: string; montoPagado?: number;
}

interface CobroItem {
  _id: string; monto: number; tipo: string; fecha: string;
  anulado: boolean; cuotasAplicadas?: number[];
}

export default function PrestamoDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { puedeEliminar } = useRol();
  const { id } = use(params);
  const router = useRouter();
  const queryClient = useQueryClient();
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showDeleteCobroModal, setShowDeleteCobroModal] = useState<string | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showPapeleriaModal, setShowPapeleriaModal] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [cuotaDetalle, setCuotaDetalle] = useState<CuotaDetalle | null>(null);
  const [cobroExpandido, setCobroExpandido] = useState<string | null>(null);
  
  // Edit form state
  const [editData, setEditData] = useState<any>(null);

  const { data: prestamo, isLoading } = useQuery({
    queryKey: ['prestamo', id],
    queryFn: () => apiClient.get(`/api/prestamos/${id}`).then((r) => r.data.data),
  });

  const { data: cobros } = useQuery({
    queryKey: ['cobros-prestamo', id],
    queryFn: () => apiClient.get(`/api/cobros/prestamo/${id}`).then((r) => r.data.data),
    enabled: !!id,
  });

  const { mutate: cancelar, isPending: cancelando } = useMutation({
    mutationFn: () => apiClient.post(`/api/prestamos/${id}/cancelar`, { motivo }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['prestamos'] });
      queryClient.invalidateQueries({ queryKey: ['prestamo', id] });
      setShowCancelModal(false);
      router.push('/prestamos');
    },
  });

  const { mutate: eliminar, isPending: eliminando } = useMutation({
    mutationFn: () => apiClient.delete(`/api/prestamos/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['prestamos'] });
      queryClient.invalidateQueries({ queryKey: ['cliente-prestamos'] });
      setShowDeleteModal(false);
      router.push('/prestamos');
    },
  });

  const { mutate: editar, isPending: editando } = useMutation({
    mutationFn: (data: any) => apiClient.put(`/api/prestamos/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['prestamo', id] });
      queryClient.invalidateQueries({ queryKey: ['prestamos'] });
      setShowEditModal(false);
    },
    onError: (err: any) => alert(err.response?.data?.message || 'Error al editar'),
  });

  const { mutate: retirarPapeleria, isPending: retirando } = useMutation({
    mutationFn: () => apiClient.post(`/api/prestamos/${id}/retirar-papeleria`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['prestamo', id] });
      queryClient.invalidateQueries({ queryKey: ['prestamos'] });
      setShowPapeleriaModal(false);
    },
    onError: (err: any) => alert(err.response?.data?.message || 'Error al retirar papelería'),
  });


  const { mutate: eliminarCobro, isPending: eliminandoCobro } = useMutation({
    mutationFn: (cobroId: string) => apiClient.delete(`/api/cobros/${cobroId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cobros-prestamo', id] });
      queryClient.invalidateQueries({ queryKey: ['prestamo', id] });
      setShowDeleteCobroModal(null);
    },
    onError: (err: any) => alert(err.response?.data?.message || 'Error al eliminar cobro'),
  });

  const abrirEdicion = () => {
    setEditData({
      capital: prestamo.capital,
      interes: prestamo.interes,
      modalidad: prestamo.modalidad,
      numeroCuotas: prestamo.numeroCuotas,
      fechaInicio: prestamo.fechaInicio.split('T')[0],
      observaciones: prestamo.observaciones || '',
    });
    setShowEditModal(true);
  };

  if (isLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {[1,2,3].map(i => <div key={i} className="skeleton" style={{ height: 90, borderRadius: 'var(--radius-lg)' }} />)}
      </div>
    );
  }

  if (!prestamo) return <div className="empty-state">Préstamo no encontrado</div>;

  const prog = porcentajeProgreso(prestamo.totalCobrado, prestamo.totalPagar);
  const isActivo = prestamo.estado === 'activo';
  const cuotasVencidas = prestamo.cuotas?.filter((c: { estado: string }) => c.estado === 'vencida').length ?? 0;
  const cuotasCompletas = prestamo.cuotas?.filter((c: { estado: string }) => c.estado === 'pagada').length ?? 0;
  const cuotasParciales = prestamo.cuotas?.filter((c: { estado: string }) => c.estado === 'parcial').length ?? 0;
  // Un día con abono cuenta como atendido, aunque haya sido por menos
  const cuotasPagadas = cuotasCompletas + cuotasParciales;
  const labelCuota     = LABEL_MODALIDAD[prestamo.modalidad] ?? 'cuota';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ── Header ── */}
      <div className="card" style={{
        background: isActivo
          ? 'linear-gradient(135deg, #4f46e5, #7c3aed)'
          : 'linear-gradient(135deg, #475569, #64748b)',
        color: 'white', padding: '20px',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            <p style={{ margin: 0, opacity: 0.8, fontSize: 13 }}>Capital prestado</p>
            <p style={{ margin: '4px 0 0', fontSize: 28, fontWeight: 800 }}>{formatCOP(prestamo.capital)}</p>
          </div>
          <span style={{
            background: 'rgb(255 255 255 / 0.2)', padding: '4px 12px',
            borderRadius: 99, fontSize: 12, fontWeight: 700, textTransform: 'uppercase',
          }}>
            {prestamo.estado}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 40, height: 40, borderRadius: '50%',
            background: 'rgb(255 255 255 / 0.2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{ fontWeight: 700 }}>{prestamo.cliente?.nombre?.[0]}</span>
          </div>
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontWeight: 700 }}>{prestamo.cliente?.nombre}</p>
            <p style={{ margin: '2px 0 0', opacity: 0.8, fontSize: 12 }}>{prestamo.cliente?.celular}</p>
          </div>
          {isActivo && prestamo.totalCobrado === 0 && (
            <button
              type="button"
              onClick={abrirEdicion}
              style={{
                background: 'rgb(255 255 255 / 0.2)', border: 'none',
                borderRadius: 'var(--radius-md)', padding: '8px 12px',
                color: 'white', fontWeight: 600, fontSize: 13,
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                marginRight: 10
              }}
            >
              <Edit2 size={15} /> Editar
            </button>
          )}
          <a href={`tel:${prestamo.cliente?.celular}`}>
            <div style={{
              background: 'rgb(255 255 255 / 0.2)', width: 36, height: 36,
              borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Phone size={18} />
            </div>
          </a>
        </div>
      </div>

      {/* ── Progreso ── */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>Cobrado</p>
            <p style={{ margin: '4px 0 0', fontSize: 20, fontWeight: 800, color: 'var(--success-500)' }}>
              {formatCOP(prestamo.totalCobrado)}
            </p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>Saldo pendiente</p>
            <p style={{ margin: '4px 0 0', fontSize: 20, fontWeight: 800, color: 'var(--danger-500)' }}>
              {formatCOP(prestamo.saldoPendiente)}
            </p>
          </div>
        </div>
        <div className="progress-bar">
          <div className={`progress-fill ${prog >= 100 ? 'success' : ''}`} style={{ width: `${prog}%` }} />
        </div>
        <p style={{ margin: '8px 0 0', textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>
          {prog}% cobrado de {formatCOP(prestamo.totalPagar)}
        </p>

        {/* Desglose de ganancia cuando hay papelería retirada */}
        {/* Desglose de ganancia cuando hay papelería retirada */}
        {prestamo.papeleriaRetirada && (
          <div style={{
            marginTop: 14, padding: '12px 14px',
            borderRadius: 'var(--radius-md)',
            background: 'var(--bg-input)',
            border: '1px solid var(--border)',
          }}>
            <p style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Impacto de Papelería Retirada
            </p>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Papelería (tu ahorro como cobrador)</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--success-500)' }}>
                +{formatCOP(prestamo.papeleria ?? 0)}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Ganancia neta del sistema (interés)</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--brand-text)' }}>
                {formatCOP(prestamo.ganancia)}
              </span>
            </div>
            <div style={{
              display: 'flex', justifyContent: 'space-between',
              paddingTop: 8, borderTop: '1px dashed var(--border)',
            }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                * La papelería ya fue descontada de la ganancia final del sistema
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ── Condiciones ── */}
      <div className="card">
        <h2 style={{ margin: '0 0 14px', fontSize: 15, fontWeight: 700 }}>Condiciones del préstamo</h2>
        {[
          { label: `Interés (${prestamo.interes ?? 20}%)`,    value: formatCOP(prestamo.totalInteres) },
          { label: 'Papelería descontada',                    value: formatCOP(prestamo.papeleria ?? 0) },
          ...((prestamo.carton ?? 0) > 0
            ? [{ label: 'Renovación de cartón', value: formatCOP(prestamo.carton ?? 0) }]
            : []),
          { label: 'El cliente recibió',                      value: formatCOP(prestamo.montoDesembolsado ?? 0), hi: true },
          { label: 'Total a pagar',                           value: formatCOP(prestamo.totalPagar), hi: true },
          { label: `${labelCuota.charAt(0).toUpperCase() + labelCuota.slice(1)}`, value: formatCOP(prestamo.cuotaDiaria) },
          { label: 'Fecha inicio',                            value: formatFechaCO(prestamo.fechaInicio) },
          { label: 'Fecha fin estimada',                      value: formatFechaCO(prestamo.fechaFin) },
          { label: 'Cobrador',                                value: prestamo.cobrador?.nombre ?? '' },
        ].map(({ label, value, hi }) => (
          <div key={label} style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '8px 0', borderBottom: '1px solid var(--border)',
          }}>
            <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>{label}</span>
            <span style={{
              fontSize: hi ? 15 : 14,
              fontWeight: hi ? 800 : 600,
              color: hi ? 'var(--brand-text)' : 'var(--text-primary)',
            }}>{value}</span>
          </div>
        ))}

        {/* Estado de papelería */}
        <div style={{
          marginTop: 14, padding: '12px 14px',
          borderRadius: 'var(--radius-md)',
          background: prestamo.papeleriaRetirada
            ? 'rgb(34 197 94 / 0.1)'
            : 'rgb(245 158 11 / 0.08)',
          border: `1.5px solid ${
            prestamo.papeleriaRetirada ? 'rgb(34 197 94 / 0.4)' : 'rgb(245 158 11 / 0.35)'
          }`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <PackageCheck size={18} color={prestamo.papeleriaRetirada ? 'var(--success-500)' : 'rgb(245 158 11)'} />
            <div>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 700,
                color: prestamo.papeleriaRetirada ? 'var(--success-500)' : 'rgb(217 119 6)' }}>
                {prestamo.papeleriaRetirada ? '✓ Papelería retirada' : 'Papelería pendiente de retirar'}
              </p>
              {prestamo.papeleriaRetirada && prestamo.papeleriaRetiradaEn && (
                <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>
                  {formatFechaHoraCO(prestamo.papeleriaRetiradaEn)}
                </p>
              )}
              {!prestamo.papeleriaRetirada && (
                <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>
                  {formatCOP(prestamo.papeleria ?? 0)} disponibles para retirar
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Contadores de cuotas */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginTop: 14 }}>
          {[
            {
              label: 'Pagadas',
              count: cuotasPagadas,
              color: 'var(--success-500)',
              nota: cuotasParciales > 0 ? `${cuotasParciales} por abono` : undefined,
            },
            { label: 'Sin pagar', count: cuotasVencidas, color: 'var(--danger-500)' },
            { label: 'Pendientes',count: (prestamo.numeroCuotas - cuotasPagadas - cuotasVencidas), color: 'var(--text-muted)' },
          ].map(({ label, count, color, nota }) => (
            <div key={label} style={{ textAlign: 'center', padding: '10px 8px',
              background: 'var(--bg-input)', borderRadius: 'var(--radius-md)' }}>
              <p style={{ margin: 0, fontSize: 22, fontWeight: 800, color }}>{count}</p>
              {nota && (
                <p style={{ margin: 0, fontSize: 9.5, color: 'var(--success-600)', fontWeight: 700 }}>{nota}</p>
              )}
              <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Cuadrícula de cuotas ── */}
      <div className="card">
        <h2 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>Estado de cuotas
          <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 400, marginLeft: 8 }}>
            (toca una cuota para ver detalles)
          </span>
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', gap: 4 }}>
          {(prestamo.cuotas ?? []).map((cuota: CuotaDetalle) => (
            <div
              key={cuota.numero}
              title={
                cuota.estado === 'parcial'
                  ? `Cuota ${cuota.numero}: abonó ${formatCOP(cuota.montoPagado ?? 0)} de ${formatCOP(cuota.monto)}`
                  : `Cuota ${cuota.numero}: ${CUOTA_ETIQUETAS[cuota.estado] ?? cuota.estado}`
              }
              onClick={() => setCuotaDetalle(cuota)}
              style={{
                height: 18, borderRadius: 3,
                background: fondoCuota(cuota),
                cursor: 'pointer', position: 'relative',
                transition: 'transform 0.1s, opacity 0.1s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.transform = 'scaleY(1.3)'; e.currentTarget.style.opacity = '0.85'; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = 'scaleY(1)'; e.currentTarget.style.opacity = '1'; }}
            />
          ))}
        </div>
        <div style={{ display: 'flex', gap: 16, marginTop: 10, flexWrap: 'wrap' }}>
          {[
            { label: 'Pagada',        color: 'var(--success-500)' },
            { label: 'Abonó (parcial)', color: 'linear-gradient(to right, var(--success-500) 55%, rgb(16 185 129 / 0.35) 55%)' },
            { label: 'No pagó',       color: 'var(--danger-500)' },
            { label: 'Pendiente',     color: 'var(--border)' },
          ].map(({ label, color }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 14, height: 10, borderRadius: 2, background: color }} />
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Historial de cobros ── */}
      {cobros && cobros.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <h2 style={{ margin: 0, padding: '14px 16px', fontSize: 15, fontWeight: 700,
            borderBottom: '1px solid var(--border)' }}>
            Cobros registrados
          </h2>
          {cobros.slice(0, 20).map((c: CobroItem) => (
            <div key={c._id} style={{ opacity: c.anulado ? 0.5 : 1, borderBottom: '1px solid var(--border)' }}>
              {/* Fila principal */}
              <div
                className="list-item"
                style={{ cursor: 'pointer' }}
                onClick={() => !c.anulado && setCobroExpandido(cobroExpandido === c._id ? null : c._id)}
              >
                <CheckCircle2 size={18} color={c.anulado ? 'var(--text-muted)' : 'var(--success-500)'} />
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 14, fontWeight: 700 }}>{formatCOP(c.monto)}</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: c.anulado ? 'var(--danger-500)' : 'var(--success-600)' }}>
                      {c.anulado ? 'Anulado' : `+${formatCOP(c.monto)}`}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
                    <p style={{ margin: 0, fontSize: 11, color: 'var(--text-muted)' }}>
                      {formatFechaHoraCO(c.fecha)} · {c.tipo}
                    </p>
                    {c.cuotasAplicadas && c.cuotasAplicadas.length > 0 && (
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: '1px 6px',
                        background: 'rgb(99 102 241 / 0.15)', color: 'var(--brand-text)',
                        borderRadius: 10,
                      }}>
                        {c.cuotasAplicadas.length} cuota{c.cuotasAplicadas.length !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {!c.anulado && (
                    <>
                      {c.cuotasAplicadas && c.cuotasAplicadas.length > 0 && (
                        cobroExpandido === c._id
                          ? <ChevronUp size={15} color="var(--text-muted)" />
                          : <ChevronDown size={15} color="var(--text-muted)" />
                      )}
                      <button
                        hidden={!puedeEliminar}
                        onClick={(e) => { e.stopPropagation(); setShowDeleteCobroModal(c._id); }}
                        title="Eliminar cobro"
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer',
                          color: 'var(--danger-500)', padding: '4px', borderRadius: 6,
                          display: 'flex', alignItems: 'center',
                        }}
                      >
                        <Trash2 size={15} />
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Detalle expandido: cuotas aplicadas */}
              {cobroExpandido === c._id && c.cuotasAplicadas && c.cuotasAplicadas.length > 0 && (
                <div style={{
                  background: 'var(--bg-input)', padding: '10px 16px',
                  borderTop: '1px solid var(--border)',
                }} className="animate-fade-in">
                  <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>
                    Cuotas aplicadas en este cobro:
                  </p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {c.cuotasAplicadas.sort((a, b) => a - b).map((num) => {
                      const cuota = prestamo.cuotas?.find((q: CuotaDetalle) => q.numero === num);
                      return (
                        <div
                          key={num}
                          onClick={() => cuota && setCuotaDetalle(cuota)}
                          style={{
                            background: 'var(--bg-card)',
                            border: '1px solid var(--success-500)',
                            borderRadius: 8, padding: '4px 10px',
                            fontSize: 12, fontWeight: 700,
                            color: 'var(--success-600)', cursor: 'pointer',
                          }}
                          title="Ver detalles de cuota"
                        >
                          #{num}
                          {cuota?.fechaPago && (
                            <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 4 }}>
                              {formatFechaCO(cuota.fechaPago)}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Acciones ── */}
      {isActivo && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Link href={`/cobros/registrar?prestamoId=${id}`}>
            <button className="btn-primary">Registrar cobro</button>
          </Link>
          <Link href={`/prestamos/${id}/renovar`}>
            <button className="btn-secondary">Renovar / refinanciar</button>
          </Link>
          {!prestamo.papeleriaRetirada && (prestamo.papeleria ?? 0) > 0 && (
            <button
              type="button"
              onClick={() => setShowPapeleriaModal(true)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                padding: '13px 20px', borderRadius: 'var(--radius-md)',
                border: '1.5px solid rgb(245 158 11 / 0.6)',
                background: 'rgb(245 158 11 / 0.08)',
                color: 'rgb(217 119 6)', fontWeight: 700, fontSize: 15,
                cursor: 'pointer', width: '100%',
              }}
            >
              <PackageCheck size={18} />
              Retirar Papelería ({formatCOP(prestamo.papeleria ?? 0)})
            </button>
          )}
          <button
            className="btn-danger"
            onClick={() => setShowCancelModal(true)}
            style={{ background: 'transparent', color: 'var(--danger-500)', border: '1.5px solid var(--danger-500)' }}
          >
            <XCircle size={18} />
            Cancelar préstamo
          </button>
          {puedeEliminar && (
            <button
              className="btn-danger"
              onClick={() => setShowDeleteModal(true)}
            >
              <Trash2 size={18} />
              Eliminar préstamo
            </button>
          )}
        </div>
      )}

      {/* Botón retirar papelería también en préstamos completados */}
      {!isActivo && prestamo.estado === 'completado' && !prestamo.papeleriaRetirada && (prestamo.papeleria ?? 0) > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button
            type="button"
            onClick={() => setShowPapeleriaModal(true)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              padding: '13px 20px', borderRadius: 'var(--radius-md)',
              border: '1.5px solid rgb(245 158 11 / 0.6)',
              background: 'rgb(245 158 11 / 0.08)',
              color: 'rgb(217 119 6)', fontWeight: 700, fontSize: 15,
              cursor: 'pointer', width: '100%',
            }}
          >
            <PackageCheck size={18} />
            Retirar Papelería ({formatCOP(prestamo.papeleria ?? 0)})
          </button>
        </div>
      )}

      {/* ── Modal detalle de cuota ── */}
      {cuotaDetalle && (
        <div
          style={{
            position: 'fixed', inset: 0,
            background: 'rgb(0 0 0 / 0.65)',
            display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
            // Scroll propio y aire abajo: si el formulario es mas alto que la
            // pantalla, el boton de guardar tiene que seguir siendo alcanzable
            overflowY: 'auto',
            zIndex: 400, padding: '16px 16px calc(28px + var(--bottomnav-height) + var(--safe-area-bottom))',
          }}
          onClick={() => setCuotaDetalle(null)}
        >
          <div
            className="animate-fade-in"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--bg-card)',
              borderRadius: 'var(--radius-xl)',
              padding: '24px 20px',
              width: '100%', maxWidth: 360,
              position: 'relative',
            }}
          >
            <button
              type="button"
              onClick={() => setCuotaDetalle(null)}
              style={{
                position: 'absolute', top: 16, right: 16,
                background: 'var(--bg-input)', border: 'none',
                borderRadius: 'var(--radius-sm)', width: 32, height: 32,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', color: 'var(--text-muted)',
              }}
            >
              <X size={16} />
            </button>

            {/* Color indicator */}
            <div style={{
              width: 48, height: 8, borderRadius: 4,
              background: CUOTA_COLORS[cuotaDetalle.estado] ?? 'var(--border)',
              margin: '0 0 14px',
            }} />

            <h3 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 800 }}>
              Cuota #{cuotaDetalle.numero}
            </h3>
            <span style={{
              fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 20,
              background: (CUOTA_COLORS[cuotaDetalle.estado] ?? 'var(--border)') + '22',
              color: CUOTA_COLORS[cuotaDetalle.estado] ?? 'var(--text-muted)',
              textTransform: 'uppercase', letterSpacing: '0.04em',
            }}>
              {CUOTA_ETIQUETAS[cuotaDetalle.estado] ?? cuotaDetalle.estado}
            </span>

            {/* Explicación del abono: el día cuenta como pagado aunque falte plata */}
            {cuotaDetalle.estado === 'parcial' && (
              <div style={{
                marginTop: 14, padding: '11px 13px',
                borderRadius: 'var(--radius-md)',
                background: 'rgb(16 185 129 / 0.1)',
                borderLeft: '3px solid var(--success-500)',
              }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--success-600)' }}>
                  Este día sí pagó
                </p>
                <p style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  Abonó <strong>{formatCOP(cuotaDetalle.montoPagado ?? 0)}</strong> de los{' '}
                  <strong>{formatCOP(cuotaDetalle.monto)}</strong> de la cuota. Le faltan{' '}
                  <strong>{formatCOP(Math.max(0, cuotaDetalle.monto - (cuotaDetalle.montoPagado ?? 0)))}</strong>,
                  que se cubren con los próximos abonos.
                </p>
              </div>
            )}

            <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[
                { label: 'Fecha esperada', value: formatFechaCO(cuotaDetalle.fechaEsperada) },
                { label: 'Valor de la cuota', value: formatCOP(cuotaDetalle.monto), hi: true },
                ...(cuotaDetalle.montoPagado != null
                  ? [{ label: 'Abonado', value: formatCOP(cuotaDetalle.montoPagado), hi: true }]
                  : []),
                ...(cuotaDetalle.estado === 'parcial'
                  ? [{
                      label: 'Le falta',
                      value: formatCOP(Math.max(0, cuotaDetalle.monto - (cuotaDetalle.montoPagado ?? 0))),
                    }]
                  : []),
                ...(cuotaDetalle.fechaPago ? [{ label: 'Fecha de pago', value: formatFechaCO(cuotaDetalle.fechaPago) }] : []),
              ].map(({ label, value, hi }) => (
                <div key={label} style={{
                  display: 'flex', justifyContent: 'space-between',
                  padding: '8px 0', borderBottom: '1px solid var(--border)',
                }}>
                  <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{label}</span>
                  <span style={{ fontSize: hi ? 15 : 13, fontWeight: hi ? 800 : 600, color: 'var(--text-primary)' }}>
                    {value}
                  </span>
                </div>
              ))}
            </div>

            {/* Si está pagada, ofrecer eliminar el cobro correspondiente */}
            {(cuotaDetalle.estado === 'pagada' || cuotaDetalle.estado === 'parcial') && cobros && (() => {
              const cobroAsociado = cobros.find((c: CobroItem) =>
                !c.anulado && c.cuotasAplicadas?.includes(cuotaDetalle.numero)
              );
              if (!cobroAsociado) return null;
              return (
                <div style={{ marginTop: 20 }}>
                  <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--text-muted)' }}>
                    Esta cuota fue pagada en el cobro del {formatFechaHoraCO(cobroAsociado.fecha)} ({formatCOP(cobroAsociado.monto)} total).
                  </p>
                  {puedeEliminar && (
                    <button
                      className="btn-danger"
                      style={{ width: '100%', fontSize: 13 }}
                      onClick={() => {
                        setCuotaDetalle(null);
                        setShowDeleteCobroModal(cobroAsociado._id);
                      }}
                    >
                      <Trash2 size={15} /> Eliminar este cobro y revertir cuota
                    </button>
                  )}
                </div>
              );
            })()}

            <button
              className="btn-secondary"
              style={{ width: '100%', marginTop: 14, fontSize: 13 }}
              onClick={() => setCuotaDetalle(null)}
            >
              Cerrar
            </button>
          </div>
        </div>
      )}

      {/* ── Modal de cancelación — centrado, scrollable ── */}
      {showCancelModal && (
        <div
          style={{
            position: 'fixed', inset: 0,
            background: 'rgb(0 0 0 / 0.65)',
            display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
            // Scroll propio y aire abajo: si el formulario es mas alto que la
            // pantalla, el boton de guardar tiene que seguir siendo alcanzable
            overflowY: 'auto',
            zIndex: 300, padding: '16px 16px calc(28px + var(--bottomnav-height) + var(--safe-area-bottom))',
          }}
          onClick={() => setShowCancelModal(false)}
        >
          <div
            className="animate-fade-in"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--bg-card)',
              borderRadius: 'var(--radius-xl)',
              padding: '24px 20px',
              width: '100%', maxWidth: 430,
              position: 'relative',
            }}
          >
            {/* Botón cerrar */}
            <button
              type="button"
              onClick={() => setShowCancelModal(false)}
              style={{
                position: 'absolute', top: 16, right: 16,
                background: 'var(--bg-input)', border: 'none',
                borderRadius: 'var(--radius-sm)', width: 32, height: 32,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', color: 'var(--text-muted)',
              }}
            >
              <X size={16} />
            </button>

            {/* Icono de advertencia */}
            <div style={{
              width: 56, height: 56, borderRadius: '50%',
              background: 'rgb(239 68 68 / 0.1)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 16px',
            }}>
              <AlertTriangle size={28} color="var(--danger-500)" />
            </div>

            <h3 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700, textAlign: 'center' }}>
              ¿Cancelar préstamo?
            </h3>
            <p style={{ margin: '0 0 20px', fontSize: 14, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.5 }}>
              Esta acción no se puede deshacer. El saldo de{' '}
              <strong style={{ color: 'var(--danger-500)' }}>{formatCOP(prestamo.saldoPendiente)}</strong>{' '}
              quedará como incobrable.
            </p>
            <div style={{ marginBottom: 20 }}>
              <label className="input-label">Motivo de cancelación *</label>
              <textarea
                className="input-field"
                placeholder="Mínimo 5 caracteres..."
                rows={3}
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                style={{ resize: 'none' }}
                autoFocus
              />
              {motivo.length > 0 && motivo.length < 5 && (
                <p className="input-error">Mínimo 5 caracteres ({5 - motivo.length} restantes)</p>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <button className="btn-secondary" onClick={() => setShowCancelModal(false)}>
                Volver
              </button>
              <button
                className="btn-danger"
                disabled={motivo.length < 5 || cancelando}
                onClick={() => cancelar()}
              >
                {cancelando ? <Loader2 size={16} className="animate-pulse-soft" /> : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal de eliminación ── */}
      {showDeleteModal && (
        <div
          style={{
            position: 'fixed', inset: 0,
            background: 'rgb(0 0 0 / 0.65)',
            display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
            // Scroll propio y aire abajo: si el formulario es mas alto que la
            // pantalla, el boton de guardar tiene que seguir siendo alcanzable
            overflowY: 'auto',
            zIndex: 300, padding: '16px 16px calc(28px + var(--bottomnav-height) + var(--safe-area-bottom))',
          }}
          onClick={() => setShowDeleteModal(false)}
        >
          <div
            className="animate-fade-in"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--bg-card)',
              borderRadius: 'var(--radius-xl)',
              padding: '24px 20px',
              width: '100%', maxWidth: 400,
              position: 'relative',
              textAlign: 'center',
            }}
          >
            <button
              type="button"
              onClick={() => setShowDeleteModal(false)}
              style={{
                position: 'absolute', top: 16, right: 16,
                background: 'var(--bg-input)', border: 'none',
                borderRadius: 'var(--radius-sm)', width: 32, height: 32,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', color: 'var(--text-muted)',
              }}
            >
              <X size={16} />
            </button>

            <div style={{
              width: 56, height: 56, borderRadius: '50%',
              background: 'rgb(239 68 68 / 0.1)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 16px',
            }}>
              <Trash2 size={28} color="var(--danger-500)" />
            </div>

            <h3 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700 }}>¿Eliminar préstamo?</h3>
            <p style={{ margin: '0 0 20px', fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              Se eliminará este préstamo de la base de datos permanentemente. Esta acción es irreversible.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <button className="btn-secondary" onClick={() => setShowDeleteModal(false)}>
                Cancelar
              </button>
              <button
                className="btn-danger"
                disabled={eliminando}
                onClick={() => eliminar()}
              >
                {eliminando ? <Loader2 size={16} className="animate-pulse-soft" /> : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal eliminar cobro ── */}
      {showDeleteCobroModal && (
        <div
          style={{
            position: 'fixed', inset: 0,
            background: 'rgb(0 0 0 / 0.65)',
            display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
            // Scroll propio y aire abajo: si el formulario es mas alto que la
            // pantalla, el boton de guardar tiene que seguir siendo alcanzable
            overflowY: 'auto',
            zIndex: 300, padding: '16px 16px calc(28px + var(--bottomnav-height) + var(--safe-area-bottom))',
          }}
          onClick={() => setShowDeleteCobroModal(null)}
        >
          <div
            className="animate-fade-in"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--bg-card)',
              borderRadius: 'var(--radius-xl)',
              padding: '24px 20px',
              width: '100%', maxWidth: 380,
              textAlign: 'center',
            }}
          >
            <div style={{
              width: 52, height: 52, borderRadius: '50%',
              background: 'rgb(239 68 68 / 0.1)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 14px',
            }}>
              <Trash2 size={24} color="var(--danger-500)" />
            </div>
            <h3 style={{ margin: '0 0 8px', fontSize: 17, fontWeight: 700 }}>¿Eliminar cobro?</h3>
            <p style={{ margin: '0 0 20px', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              Se revertirá el saldo del préstamo. Las cuotas aplicadas volverán a estado pendiente. Esta acción es irreversible.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <button className="btn-secondary" onClick={() => setShowDeleteCobroModal(null)}>Cancelar</button>
              <button
                className="btn-danger"
                disabled={eliminandoCobro}
                onClick={() => eliminarCobro(showDeleteCobroModal)}
              >
                {eliminandoCobro ? <Loader2 size={16} className="animate-pulse-soft" /> : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal de Edición ── */}
      {showEditModal && editData && (
        <div
          style={{
            position: 'fixed', inset: 0,
            background: 'rgb(0 0 0 / 0.65)',
            display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
            // Scroll propio y aire abajo: si el formulario es mas alto que la
            // pantalla, el boton de guardar tiene que seguir siendo alcanzable
            overflowY: 'auto',
            zIndex: 300, padding: '16px 16px calc(28px + var(--bottomnav-height) + var(--safe-area-bottom))',
          }}
          onClick={() => setShowEditModal(false)}
        >
          <div
            className="animate-fade-in"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--bg-card)',
              borderRadius: 'var(--radius-xl)',
              padding: '24px 20px',
              width: '100%', maxWidth: 450,
              position: 'relative',
            }}
          >
            <h3 style={{ margin: '0 0 20px', fontSize: 18, fontWeight: 700 }}>Editar Préstamo</h3>
            
            <div style={{ display: 'grid', gap: 14 }}>
              <div>
                <label className="input-label">Capital</label>
                <input type="number" className="input-field" value={editData.capital}
                  onChange={(e) => setEditData({ ...editData, capital: Number(e.target.value) })} />
              </div>
              <div>
                <label className="input-label">Modalidad</label>
                <select className="input-field" value={editData.modalidad}
                  onChange={(e) => setEditData({ ...editData, modalidad: e.target.value })}>
                  <option value="diaria">Diaria</option>
                  <option value="semanal">Semanal</option>
                  <option value="quincenal">Quincenal</option>
                  <option value="mensual">Mensual</option>
                </select>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <label className="input-label">Interés (%)</label>
                  <input type="number" className="input-field" value={editData.interes}
                    onChange={(e) => setEditData({ ...editData, interes: Number(e.target.value) })} />
                </div>
                <div style={{ flex: 1 }}>
                  <label className="input-label">Número de Cuotas</label>
                  <input type="number" className="input-field" value={editData.numeroCuotas}
                    onChange={(e) => setEditData({ ...editData, numeroCuotas: Number(e.target.value) })} />
                </div>
              </div>
              <div>
                <label className="input-label">Fecha de Inicio</label>
                <input type="date" className="input-field" value={editData.fechaInicio}
                  onChange={(e) => setEditData({ ...editData, fechaInicio: e.target.value })} />
              </div>
              <div>
                <label className="input-label">Observaciones</label>
                <textarea className="input-field" value={editData.observaciones}
                  onChange={(e) => setEditData({ ...editData, observaciones: e.target.value })} />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 20 }}>
              <button className="btn-secondary" onClick={() => setShowEditModal(false)}>Cancelar</button>
              <button className="btn-primary" disabled={editando} onClick={() => editar(editData)}>
                {editando ? <Loader2 size={16} className="animate-pulse-soft" /> : 'Guardar Cambios'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Retirar Papelería ── */}
      {showPapeleriaModal && (
        <div
          style={{
            position: 'fixed', inset: 0,
            background: 'rgb(0 0 0 / 0.65)',
            display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
            // Scroll propio y aire abajo: si el formulario es mas alto que la
            // pantalla, el boton de guardar tiene que seguir siendo alcanzable
            overflowY: 'auto',
            zIndex: 300, padding: '16px 16px calc(28px + var(--bottomnav-height) + var(--safe-area-bottom))',
          }}
          onClick={() => setShowPapeleriaModal(false)}
        >
          <div
            className="animate-fade-in"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--bg-card)',
              borderRadius: 'var(--radius-xl)',
              padding: '28px 24px',
              width: '100%', maxWidth: 400,
              position: 'relative', textAlign: 'center',
            }}
          >
            <button
              type="button"
              onClick={() => setShowPapeleriaModal(false)}
              style={{
                position: 'absolute', top: 16, right: 16,
                background: 'var(--bg-input)', border: 'none',
                borderRadius: 'var(--radius-sm)', width: 32, height: 32,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', color: 'var(--text-muted)',
              }}
            >
              <X size={16} />
            </button>

            {/* Ícono */}
            <div style={{
              width: 64, height: 64, borderRadius: '50%',
              background: 'rgb(245 158 11 / 0.12)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 18px',
            }}>
              <PackageCheck size={32} color="rgb(217 119 6)" />
            </div>

            <h3 style={{ margin: '0 0 6px', fontSize: 20, fontWeight: 800 }}>
              Retirar Papelería
            </h3>
            <p style={{ margin: '0 0 20px', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
              Vas a registrar que retiraste la papelería de este préstamo.
              Este monto es tuyo y queda separado de lo cobrado por el cobrador.
            </p>

            {/* Detalle del monto */}
            <div style={{
              background: 'var(--bg-input)', borderRadius: 'var(--radius-md)',
              padding: '16px', marginBottom: 20,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Préstamo de</span>
                <span style={{ fontSize: 13, fontWeight: 700 }}>{prestamo.cliente?.nombre}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Capital original</span>
                <span style={{ fontSize: 13, fontWeight: 700 }}>{formatCOP(prestamo.capital)}</span>
              </div>
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                paddingTop: 10, borderTop: '1px solid var(--border)',
              }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: 'rgb(217 119 6)' }}>Papelería a retirar</span>
                <span style={{ fontSize: 20, fontWeight: 900, color: 'rgb(217 119 6)' }}>
                  {formatCOP(prestamo.papeleria ?? 0)}
                </span>
              </div>
            </div>

            <p style={{ margin: '0 0 18px', fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>
              ⚠️ Esta acción no se puede deshacer. El saldo del cliente no cambia.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <button className="btn-secondary" onClick={() => setShowPapeleriaModal(false)}>
                Cancelar
              </button>
              <button
                disabled={retirando}
                onClick={() => retirarPapeleria()}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  padding: '12px', borderRadius: 'var(--radius-md)',
                  border: 'none', background: 'rgb(217 119 6)',
                  color: 'white', fontWeight: 700, fontSize: 15,
                  cursor: retirando ? 'not-allowed' : 'pointer',
                  opacity: retirando ? 0.7 : 1,
                }}
              >
                {retirando ? <Loader2 size={16} className="animate-pulse-soft" /> : <><PackageCheck size={16} /> Retirar</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

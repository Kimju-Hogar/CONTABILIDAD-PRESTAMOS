'use client';
import { useState, use } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle2, AlertTriangle, XCircle, Loader2, Phone, X, Trash2, Edit2 } from 'lucide-react';
import { apiClient } from '@/services/api';
import { formatCOP, formatFechaCO, formatFechaHoraCO, porcentajeProgreso } from '@/lib/utils';

const CUOTA_COLORS: Record<string, string> = {
  pagada: 'var(--success-500)', vencida: 'var(--danger-500)',
  pendiente: 'var(--border)', parcial: 'var(--warning-500)',
};

const LABEL_MODALIDAD: Record<string, string> = {
  diaria:    'cuota diaria',
  semanal:   'cuota semanal',
  quincenal: 'cuota quincenal',
  mensual:   'cuota mensual',
};

export default function PrestamoDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const queryClient = useQueryClient();
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [motivo, setMotivo] = useState('');
  
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
  const cuotasPagadas  = prestamo.cuotas?.filter((c: { estado: string }) => c.estado === 'pagada').length  ?? 0;
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
      </div>

      {/* ── Condiciones ── */}
      <div className="card">
        <h2 style={{ margin: '0 0 14px', fontSize: 15, fontWeight: 700 }}>Condiciones del préstamo</h2>
        {[
          { label: `Interés (${prestamo.interes ?? 20}%)`,    value: formatCOP(prestamo.totalInteres) },
          { label: 'Papelería descontada',                    value: formatCOP(prestamo.papeleria ?? 0) },
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

        {/* Contadores de cuotas */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginTop: 14 }}>
          {[
            { label: 'Pagadas',   count: cuotasPagadas,  color: 'var(--success-500)' },
            { label: 'Vencidas',  count: cuotasVencidas, color: 'var(--danger-500)' },
            { label: 'Pendientes',count: (prestamo.numeroCuotas - cuotasPagadas - cuotasVencidas), color: 'var(--text-muted)' },
          ].map(({ label, count, color }) => (
            <div key={label} style={{ textAlign: 'center', padding: '10px 8px',
              background: 'var(--bg-input)', borderRadius: 'var(--radius-md)' }}>
              <p style={{ margin: 0, fontSize: 22, fontWeight: 800, color }}>{count}</p>
              <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Cuadrícula de cuotas ── */}
      <div className="card">
        <h2 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>Estado de cuotas</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', gap: 4 }}>
          {(prestamo.cuotas ?? []).map((cuota: { numero: number; estado: string }) => (
            <div
              key={cuota.numero}
              title={`Cuota ${cuota.numero}: ${cuota.estado}`}
              style={{ height: 14, borderRadius: 2, background: CUOTA_COLORS[cuota.estado] ?? 'var(--border)' }}
            />
          ))}
        </div>
        <div style={{ display: 'flex', gap: 16, marginTop: 8, flexWrap: 'wrap' }}>
          {[
            { label: 'Pagada',   color: 'var(--success-500)' },
            { label: 'Vencida',  color: 'var(--danger-500)' },
            { label: 'Pendiente',color: 'var(--border)' },
            { label: 'Parcial',  color: 'var(--warning-500)' },
          ].map(({ label, color }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: color }} />
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
          {cobros.slice(0, 15).map((c: { _id: string; monto: number; tipo: string; fecha: string; anulado: boolean }) => (
            <div key={c._id} className="list-item" style={{ cursor: 'default', opacity: c.anulado ? 0.5 : 1 }}>
              <CheckCircle2 size={18} color={c.anulado ? 'var(--text-muted)' : 'var(--success-500)'} />
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{formatCOP(c.monto)}</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: c.anulado ? 'var(--danger-500)' : 'var(--success-600)' }}>
                    {c.anulado ? 'Anulado' : `+${formatCOP(c.monto)}`}
                  </span>
                </div>
                <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>
                  {formatFechaHoraCO(c.fecha)} · {c.tipo}
                </p>
              </div>
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
          <Link href={`/prestamos/nuevo?refinanciarId=${id}`}>
            <button className="btn-secondary">Refinanciar préstamo</button>
          </Link>
          <button
            className="btn-danger"
            onClick={() => setShowCancelModal(true)}
            style={{ background: 'transparent', color: 'var(--danger-500)', border: '1.5px solid var(--danger-500)' }}
          >
            <XCircle size={18} />
            Cancelar préstamo
          </button>
          {prestamo.totalCobrado === 0 && (
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

      {/* ── Modal de cancelación — centrado, scrollable ── */}
      {showCancelModal && (
        <div
          style={{
            position: 'fixed', inset: 0,
            background: 'rgb(0 0 0 / 0.65)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 300, padding: '20px 16px',
            overflowY: 'auto',
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
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 300, padding: '20px 16px',
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

      {/* ── Modal de Edición ── */}
      {showEditModal && editData && (
        <div
          style={{
            position: 'fixed', inset: 0,
            background: 'rgb(0 0 0 / 0.65)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 300, padding: '20px 16px',
            overflowY: 'auto'
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
    </div>
  );
}

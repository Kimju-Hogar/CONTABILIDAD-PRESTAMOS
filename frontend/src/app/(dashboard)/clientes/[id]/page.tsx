'use client';
import { useRef, useState, use } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Phone, MapPin, ChevronRight, CreditCard, Plus, Camera, Loader2, Edit2, Trash2, X, Save } from 'lucide-react';
import { apiClient } from '@/services/api';
import { formatCOP, formatFechaCO, porcentajeProgreso } from '@/lib/utils';

const ESTADO_COLORS: Record<string, string> = {
  activo: 'badge-success', moroso: 'badge-danger', inactivo: 'badge-muted', cancelado: 'badge-muted',
};
const ESTADO_LABELS: Record<string, string> = {
  activo: 'Activo', moroso: 'En mora', inactivo: 'Inactivo', cancelado: 'Cancelado',
};

// ─── Foto Uploader ─────────────────────────────────────────────
function FotoUploader({ clienteId, fotoActual }: { clienteId: string; fotoActual?: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const [preview, setPreview] = useState<string | null>(fotoActual ?? null);

  const { mutate: subirFoto, isPending } = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('foto', file);
      const res = await apiClient.post(
        `/api/clientes/${clienteId}/fotos/cliente`,
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      );
      return res.data.data as string;
    },
    onSuccess: (url) => {
      setPreview(url);
      queryClient.invalidateQueries({ queryKey: ['cliente', clienteId] });
    },
  });

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
    subirFoto(file);
  }

  return (
    <div
      onClick={() => !isPending && inputRef.current?.click()}
      style={{
        width: 64, height: 64, borderRadius: '50%',
        background: 'rgb(255 255 255 / 0.2)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden', flexShrink: 0,
        cursor: isPending ? 'wait' : 'pointer', position: 'relative',
      }}
      title="Toca para cambiar foto"
    >
      {isPending ? (
        <Loader2 size={24} color="white" style={{ animation: 'spin 1s linear infinite' }} />
      ) : preview ? (
        <>
          <img src={preview} alt="Foto cliente" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          <div style={{
            position: 'absolute', inset: 0, background: 'rgb(0 0 0 / 0.35)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Camera size={16} color="white" />
          </div>
        </>
      ) : (
        <Camera size={24} color="white" />
      )}
      <input ref={inputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleChange} />
    </div>
  );
}

// ─── Formulario de edición ─────────────────────────────────────
interface EditForm {
  nombre: string; cedula: string; celular: string;
  direccion: string; barrio: string; ciudad: string;
  referencia?: string; observaciones?: string;
  estado: 'activo' | 'inactivo' | 'moroso' | 'cancelado';
}

export default function ClienteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const queryClient = useQueryClient();
  const [editando, setEditando] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const { data: cliente, isLoading } = useQuery({
    queryKey: ['cliente', id],
    queryFn: () => apiClient.get(`/api/clientes/${id}`).then((r) => r.data.data),
  });

  const { data: prestamos } = useQuery({
    queryKey: ['cliente-prestamos', id],
    queryFn: () => apiClient.get(`/api/clientes/${id}/prestamos`).then((r) => r.data.data),
    enabled: !!id,
  });

  // ─── Formulario de edición ──────────────────────────────────
  const { register, handleSubmit, formState: { errors, isDirty }, reset } = useForm<EditForm>();

  const abrirEdicion = () => {
    reset({
      nombre:        cliente.nombre,
      cedula:        cliente.cedula,
      celular:       cliente.celular,
      direccion:     cliente.direccion,
      barrio:        cliente.barrio,
      ciudad:        cliente.ciudad,
      referencia:    cliente.referencia ?? '',
      observaciones: cliente.observaciones ?? '',
      estado:        cliente.estado,
    });
    setEditando(true);
  };

  const { mutate: actualizar, isPending: guardando } = useMutation({
    mutationFn: (data: EditForm) => apiClient.put(`/api/clientes/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cliente', id] });
      queryClient.invalidateQueries({ queryKey: ['clientes'] });
      setEditando(false);
    },
  });

  const { mutate: eliminar, isPending: eliminando } = useMutation({
    mutationFn: () => apiClient.delete(`/api/clientes/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clientes'] });
      router.push('/clientes');
    },
  });

  if (isLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {[1,2,3].map(i => <div key={i} className="skeleton" style={{ height: 80, borderRadius: 'var(--radius-lg)' }} />)}
      </div>
    );
  }
  if (!cliente) return <div className="empty-state">Cliente no encontrado</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ── Header ── */}
      <div className="card" style={{
        background: 'linear-gradient(135deg, #4f46e5, #7c3aed)',
        color: 'white', padding: '20px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <FotoUploader clienteId={id} fotoActual={cliente.fotos?.cliente} />
          <div style={{ flex: 1 }}>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>{cliente.nombre}</h1>
            <p style={{ margin: '2px 0 0', opacity: 0.85, fontSize: 14 }}>CC: {cliente.cedula}</p>
            <span style={{
              display: 'inline-block', marginTop: 6,
              background: 'rgb(255 255 255 / 0.2)',
              padding: '3px 10px', borderRadius: 99, fontSize: 11, fontWeight: 700,
            }}>
              {ESTADO_LABELS[cliente.estado] ?? cliente.estado}
            </span>
          </div>
          {/* Botón editar */}
          <button
            type="button"
            onClick={abrirEdicion}
            style={{
              background: 'rgb(255 255 255 / 0.2)', border: 'none',
              borderRadius: 'var(--radius-md)', padding: '8px 12px',
              color: 'white', fontWeight: 600, fontSize: 13,
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            <Edit2 size={15} /> Editar
          </button>
        </div>
      </div>

      {/* ── Datos de contacto ── */}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 0, padding: 0, overflow: 'hidden' }}>
        <a href={`tel:${cliente.celular}`} className="list-item" style={{ cursor: 'pointer' }}>
          <Phone size={20} color="var(--brand-500)" />
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>Celular</p>
            <p style={{ margin: '2px 0 0', fontWeight: 600 }}>{cliente.celular}</p>
          </div>
          <span style={{ fontSize: 12, color: 'var(--brand-500)', fontWeight: 600 }}>Llamar</span>
        </a>

        <div className="list-item" style={{ cursor: 'default' }}>
          <MapPin size={20} color="var(--text-muted)" />
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>Dirección</p>
            <p style={{ margin: '2px 0 0', fontWeight: 600, fontSize: 14 }}>
              {cliente.direccion}, {cliente.barrio}, {cliente.ciudad}
            </p>
          </div>
        </div>

        {cliente.referencia && (
          <div className="list-item" style={{ cursor: 'default' }}>
            <div style={{ width: 20, flexShrink: 0 }} />
            <div>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>Referencia</p>
              <p style={{ margin: '2px 0 0', fontWeight: 600, fontSize: 14 }}>{cliente.referencia}</p>
            </div>
          </div>
        )}
      </div>

      {/* ── Resumen financiero ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {[
          { label: 'Préstamos activos', value: String(cliente.prestamosActivos), color: 'var(--brand-500)' },
          { label: 'Total prestado',    value: formatCOP(cliente.totalPrestado ?? 0), color: 'var(--text-primary)' },
        ].map(({ label, value, color }) => (
          <div key={label} className="card" style={{ textAlign: 'center' }}>
            <p style={{ margin: 0, fontSize: 20, fontWeight: 800, color }}>{value}</p>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>{label}</p>
          </div>
        ))}
      </div>

      {/* ── Préstamos ── */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Préstamos</h2>
          <Link href={`/prestamos/nuevo?clienteId=${id}`}>
            <button className="btn-primary" style={{ width: 'auto', padding: '8px 12px', fontSize: 13 }}>
              <Plus size={16} /> Nuevo
            </button>
          </Link>
        </div>

        {!prestamos || prestamos.length === 0 ? (
          <div className="empty-state" style={{ padding: '24px' }}>
            <CreditCard size={36} color="var(--border)" />
            <p style={{ margin: 0, fontWeight: 600 }}>Sin préstamos registrados</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {prestamos.map((p: Prestamo) => {
              const prog = porcentajeProgreso(p.totalCobrado, p.totalPagar);
              const isActivo = p.estado === 'activo';
              return (
                <Link key={p._id} href={`/prestamos/${p._id}`} style={{ textDecoration: 'none' }}>
                  <div className="card" style={{ cursor: 'pointer' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                      <div>
                        <p style={{ margin: 0, fontWeight: 700, fontSize: 15 }}>{formatCOP(p.capital)}</p>
                        <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
                          {p.numeroCuotas} cuotas {p.modalidad}s de {formatCOP(p.cuotaDiaria)}
                        </p>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <span className={`badge ${isActivo ? 'badge-success' : 'badge-muted'}`}>
                          {p.estado}
                        </span>
                        <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>
                          {formatFechaCO(p.fechaInicio)}
                        </p>
                      </div>
                    </div>

                    <div className="progress-bar">
                      <div className={`progress-fill ${prog >= 100 ? 'success' : ''}`} style={{ width: `${prog}%` }} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        Cobrado: {formatCOP(p.totalCobrado)}
                      </span>
                      <span style={{ fontSize: 11, color: isActivo ? 'var(--danger-500)' : 'var(--text-muted)', fontWeight: 600 }}>
                        Saldo: {formatCOP(p.saldoPendiente)}
                      </span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Botón eliminar (solo si no tiene préstamos activos) ── */}
      {(cliente.prestamosActivos ?? 0) === 0 && (
        <button
          type="button"
          onClick={() => setShowDeleteModal(true)}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            background: 'transparent', border: '1.5px solid var(--danger-500)',
            borderRadius: 'var(--radius-md)', padding: '12px',
            color: 'var(--danger-500)', fontWeight: 600, fontSize: 14,
            cursor: 'pointer', width: '100%',
          }}
        >
          <Trash2 size={16} /> Eliminar cliente
        </button>
      )}

      {/* ── Modal Editar ── */}
      {editando && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgb(0 0 0 / 0.65)',
            zIndex: 300, overflowY: 'auto', padding: '20px 16px',
            display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
          }}
          onClick={() => setEditando(false)}
        >
          <div
            className="animate-fade-in"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--bg-card)', borderRadius: 'var(--radius-xl)',
              padding: '24px 20px', width: '100%', maxWidth: 480,
              marginTop: 10,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Editar cliente</h3>
              <button type="button" onClick={() => setEditando(false)}
                style={{
                  background: 'var(--bg-input)', border: 'none', borderRadius: 'var(--radius-sm)',
                  width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', color: 'var(--text-muted)',
                }}>
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSubmit((d) => actualizar(d))} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label className="input-label">Nombre completo *</label>
                  <input className="input-field" {...register('nombre', { required: 'Requerido' })} />
                  {errors.nombre && <p className="input-error">{errors.nombre.message}</p>}
                </div>
                <div>
                  <label className="input-label">Cédula *</label>
                  <input className="input-field" {...register('cedula', { required: 'Requerido' })} />
                </div>
                <div>
                  <label className="input-label">Celular *</label>
                  <input className="input-field" inputMode="tel" {...register('celular', { required: 'Requerido' })} />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label className="input-label">Dirección *</label>
                  <input className="input-field" {...register('direccion', { required: 'Requerido' })} />
                </div>
                <div>
                  <label className="input-label">Barrio *</label>
                  <input className="input-field" {...register('barrio', { required: 'Requerido' })} />
                </div>
                <div>
                  <label className="input-label">Ciudad *</label>
                  <input className="input-field" {...register('ciudad', { required: 'Requerido' })} />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label className="input-label">Referencia</label>
                  <input className="input-field" {...register('referencia')} />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label className="input-label">Estado</label>
                  <select className="input-field" {...register('estado')}
                    style={{ appearance: 'none', WebkitAppearance: 'none' }}>
                    <option value="activo">Activo</option>
                    <option value="inactivo">Inactivo</option>
                    <option value="moroso">En mora</option>
                    <option value="cancelado">Cancelado</option>
                  </select>
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label className="input-label">Observaciones</label>
                  <textarea className="input-field" rows={3} style={{ resize: 'none' }} {...register('observaciones')} />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 4 }}>
                <button type="button" className="btn-secondary" onClick={() => setEditando(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn-primary" disabled={guardando || !isDirty}>
                  {guardando ? <Loader2 size={16} className="animate-pulse-soft" /> : <><Save size={16} /> Guardar</>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal Eliminar ── */}
      {showDeleteModal && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgb(0 0 0 / 0.65)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 300, padding: '20px',
          }}
          onClick={() => setShowDeleteModal(false)}
        >
          <div
            className="animate-fade-in"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--bg-card)', borderRadius: 'var(--radius-xl)',
              padding: '24px 20px', width: '100%', maxWidth: 380, textAlign: 'center',
            }}
          >
            <div style={{
              width: 56, height: 56, borderRadius: '50%',
              background: 'rgb(239 68 68 / 0.1)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 16px',
            }}>
              <Trash2 size={26} color="var(--danger-500)" />
            </div>
            <h3 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700 }}>¿Eliminar cliente?</h3>
            <p style={{ margin: '0 0 24px', fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              Se eliminará <strong>{cliente.nombre}</strong> permanentemente. Esta acción no se puede deshacer.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <button className="btn-secondary" onClick={() => setShowDeleteModal(false)}>Cancelar</button>
              <button className="btn-danger" disabled={eliminando} onClick={() => eliminar()}>
                {eliminando ? <Loader2 size={16} className="animate-pulse-soft" /> : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface Prestamo {
  _id: string; capital: number; totalPagar: number; totalCobrado: number;
  saldoPendiente: number; cuotaDiaria: number; modalidad: string;
  numeroCuotas: number; estado: string; fechaInicio: string;
}

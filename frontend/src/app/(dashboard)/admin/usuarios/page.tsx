'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Loader2, Plus, ShieldCheck, User, KeyRound, Power, AlertTriangle, CheckCircle2,
} from 'lucide-react';
import { apiClient } from '@/services/api';
import { formatFechaCO } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';

interface Usuario {
  _id: string;
  nombre: string;
  email: string;
  rol: 'admin' | 'cobrador';
  activo: boolean;
  ultimoAcceso?: string;
}

function Modal({ titulo, onClose, children }: { titulo: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      onClick={onClose}
      style={{
        // Por encima de la topbar y la bottom-nav, que viven en z-index 100
        position: 'fixed', inset: 0, zIndex: 200, background: 'rgb(0 0 0 / 0.5)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
    >
      <div
        className="animate-slide-up"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-card)', borderRadius: '20px 20px 0 0', padding: 20,
          width: '100%', maxWidth: 430, maxHeight: '88dvh', overflowY: 'auto',
          paddingBottom: 'calc(20px + var(--safe-area-bottom))',
        }}
      >
        <h2 style={{ margin: '0 0 14px', fontSize: 17, fontWeight: 800 }}>{titulo}</h2>
        {children}
      </div>
    </div>
  );
}

export default function UsuariosPage() {
  const queryClient = useQueryClient();
  const { usuario: yo } = useAuthStore();

  const [modal, setModal] = useState<'crear' | 'password' | null>(null);
  const [objetivo, setObjetivo] = useState<Usuario | null>(null);
  const [form, setForm] = useState({ nombre: '', email: '', password: '', rol: 'cobrador' as 'admin' | 'cobrador' });
  const [nuevaPassword, setNuevaPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const { data: usuarios, isLoading } = useQuery<Usuario[]>({
    queryKey: ['admin-usuarios'],
    queryFn: () => apiClient.get('/api/admin/usuarios').then((r) => r.data.data),
  });

  const manejarError = (e: unknown) => {
    const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
    setError(msg ?? 'No se pudo completar la operación');
  };

  const refrescar = () => queryClient.invalidateQueries({ queryKey: ['admin-usuarios'] });

  const crear = useMutation({
    mutationFn: () => apiClient.post('/api/admin/usuarios', form),
    onSuccess: () => {
      refrescar(); setModal(null); setError(null);
      setOk(`Usuario ${form.email} creado`);
      setForm({ nombre: '', email: '', password: '', rol: 'cobrador' });
      setTimeout(() => setOk(null), 4000);
    },
    onError: manejarError,
  });

  const actualizar = useMutation({
    mutationFn: ({ id, cambios }: { id: string; cambios: Partial<Usuario> }) =>
      apiClient.put(`/api/admin/usuarios/${id}`, cambios),
    onSuccess: () => { refrescar(); setError(null); },
    onError: manejarError,
  });

  const cambiarPassword = useMutation({
    mutationFn: () => apiClient.post(`/api/admin/usuarios/${objetivo!._id}/password`, { password: nuevaPassword }),
    onSuccess: () => {
      setModal(null); setNuevaPassword(''); setError(null);
      setOk('Contraseña actualizada. Ese usuario debe volver a iniciar sesión.');
      setTimeout(() => setOk(null), 5000);
    },
    onError: manejarError,
  });

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
        <Loader2 size={28} color="var(--brand-500)" style={{ animation: 'spin 1s linear infinite' }} />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>Usuarios</h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
            Administradores y cobradores del sistema
          </p>
        </div>
        <button
          className="btn-icon"
          onClick={() => { setError(null); setModal('crear'); }}
          aria-label="Crear usuario"
          style={{ background: 'var(--brand-500)', border: 'none' }}
        >
          <Plus size={18} color="white" />
        </button>
      </div>

      {error && (
        <div className="card" style={{ padding: '10px 14px', borderLeft: '3px solid var(--danger-500)', display: 'flex', gap: 8 }}>
          <AlertTriangle size={16} color="var(--danger-500)" />
          <span style={{ fontSize: 13, color: 'var(--danger-600)' }}>{error}</span>
        </div>
      )}

      {ok && (
        <div className="card" style={{ padding: '10px 14px', borderLeft: '3px solid var(--success-500)', display: 'flex', gap: 8 }}>
          <CheckCircle2 size={16} color="var(--success-500)" />
          <span style={{ fontSize: 13, color: 'var(--success-600)' }}>{ok}</span>
        </div>
      )}

      {(usuarios ?? []).map((u) => {
        const esYo = u._id === yo?.id;
        return (
          <div key={u._id} className="card" style={{ padding: '13px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {u.rol === 'admin'
                ? <ShieldCheck size={18} color="var(--brand-500)" />
                : <User size={18} color="var(--text-muted)" />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>
                  {u.nombre} {esYo && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>(tú)</span>}
                </p>
                <p style={{
                  margin: 0, fontSize: 11.5, color: 'var(--text-muted)',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {u.email}
                </p>
              </div>
              <span className={`badge ${u.activo ? 'badge-success' : 'badge-muted'}`}>
                {u.activo ? 'Activo' : 'Inactivo'}
              </span>
            </div>

            {u.ultimoAcceso && (
              <p style={{ margin: '6px 0 0', fontSize: 11.5, color: 'var(--text-muted)' }}>
                Último acceso: {formatFechaCO(u.ultimoAcceso)}
              </p>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <select
                className="input-field"
                style={{ flex: 1, minWidth: 120, padding: '7px 10px', fontSize: 12.5 }}
                value={u.rol}
                disabled={esYo}
                onChange={(e) =>
                  actualizar.mutate({ id: u._id, cambios: { rol: e.target.value as 'admin' | 'cobrador' } })
                }
              >
                <option value="cobrador">Cobrador</option>
                <option value="admin">Administrador</option>
              </select>

              <button
                className="btn-secondary"
                style={{ padding: '7px 10px', fontSize: 12.5, width: 'auto' }}
                onClick={() => { setObjetivo(u); setError(null); setModal('password'); }}
              >
                <KeyRound size={14} /> Clave
              </button>

              {!esYo && (
                <button
                  className="btn-secondary"
                  style={{ padding: '7px 10px', fontSize: 12.5, width: 'auto' }}
                  onClick={() => actualizar.mutate({ id: u._id, cambios: { activo: !u.activo } })}
                >
                  <Power size={14} /> {u.activo ? 'Desactivar' : 'Activar'}
                </button>
              )}
            </div>
          </div>
        );
      })}

      {/* ─── Crear usuario ──────────────────────────────────── */}
      {modal === 'crear' && (
        <Modal titulo="Nuevo usuario" onClose={() => setModal(null)}>
          <label className="input-label">Nombre</label>
          <input
            className="input-field"
            value={form.nombre}
            onChange={(e) => setForm({ ...form, nombre: e.target.value })}
            placeholder="Nombre completo"
          />

          <label className="input-label" style={{ marginTop: 12 }}>Correo</label>
          <input
            className="input-field"
            type="email"
            autoComplete="off"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="correo@ejemplo.com"
          />

          <label className="input-label" style={{ marginTop: 12 }}>Contraseña</label>
          <input
            className="input-field"
            type="password"
            autoComplete="new-password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            placeholder="Mínimo 8 caracteres"
          />

          <label className="input-label" style={{ marginTop: 12 }}>Rol</label>
          <select
            className="input-field"
            value={form.rol}
            onChange={(e) => setForm({ ...form, rol: e.target.value as 'admin' | 'cobrador' })}
          >
            <option value="cobrador">Cobrador</option>
            <option value="admin">Administrador</option>
          </select>

          <button
            className="btn-primary"
            style={{ marginTop: 16 }}
            disabled={crear.isPending || !form.nombre || !form.email || form.password.length < 8}
            onClick={() => crear.mutate()}
          >
            {crear.isPending ? 'Creando…' : 'Crear usuario'}
          </button>
        </Modal>
      )}

      {/* ─── Cambiar contraseña ─────────────────────────────── */}
      {modal === 'password' && objetivo && (
        <Modal titulo={`Nueva contraseña para ${objetivo.nombre}`} onClose={() => setModal(null)}>
          <label className="input-label">Contraseña</label>
          <input
            className="input-field"
            type="password"
            autoComplete="new-password"
            value={nuevaPassword}
            onChange={(e) => setNuevaPassword(e.target.value)}
            placeholder="Mínimo 8 caracteres"
          />
          <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
            Al cambiarla se cierran todas las sesiones de ese usuario.
          </p>
          <button
            className="btn-primary"
            style={{ marginTop: 16 }}
            disabled={cambiarPassword.isPending || nuevaPassword.length < 8}
            onClick={() => cambiarPassword.mutate()}
          >
            {cambiarPassword.isPending ? 'Guardando…' : 'Cambiar contraseña'}
          </button>
        </Modal>
      )}
    </div>
  );
}

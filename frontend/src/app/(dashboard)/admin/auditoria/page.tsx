'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Loader2, ShieldCheck, ChevronLeft, ChevronRight, Filter, User,
} from 'lucide-react';
import { apiClient } from '@/services/api';
import { formatFechaHoraCO } from '@/lib/utils';

interface Registro {
  _id: string;
  accion: string;
  recurso: string;
  recursoId?: string;
  ip?: string;
  timestamp: string;
  usuario?: { nombre: string; email: string; rol: string };
}

/** Cómo se lee cada acción en español, para no mostrar el código crudo. */
const ETIQUETAS: Record<string, string> = {
  LOGIN: 'Inició sesión',
  LOGIN_FAILED: 'Intento de acceso fallido',
  LOGOUT: 'Cerró sesión',
  LOGOUT_ALL: 'Cerró todas las sesiones',
  CREATE_COBRO: 'Registró un cobro',
  ANULAR_COBRO: 'Anuló un cobro',
  DELETE_COBRO: 'Eliminó un cobro',
  CREATE_PRESTAMO: 'Creó un préstamo',
  UPDATE_PRESTAMO: 'Editó un préstamo',
  CANCEL_PRESTAMO: 'Canceló un préstamo',
  DELETE_PRESTAMO: 'Eliminó un préstamo',
  REFINANCIAR_PRESTAMO: 'Renovó un préstamo',
  RETIRAR_PAPELERIA: 'Retiró papelería',
  RETIRAR_CARTON: 'Retiró un cartón',
  CREATE_CLIENTE: 'Creó un cliente',
  UPDATE_CLIENTE: 'Editó un cliente',
  DELETE_CLIENTE: 'Eliminó un cliente',
  ABRIR_CAJA: 'Abrió la caja',
  CERRAR_CAJA: 'Cerró la caja',
  REABRIR_CAJA: 'Reabrió un cierre',
  CREATE_MOVIMIENTO_CAJA: 'Registró un movimiento de caja',
  DELETE_MOVIMIENTO_CAJA: 'Eliminó un movimiento de caja',
  CREATE_USUARIO: 'Creó un usuario',
  UPDATE_USUARIO: 'Editó un usuario',
  DELETE_USUARIO: 'Eliminó un usuario',
  RESET_PASSWORD: 'Cambió una contraseña',
  UPDATE_CONFIGURACION: 'Cambió los parámetros',
  CORTE_PAPELERIA: 'Reinició la cuenta de papelería',
  QUITAR_CORTE_PAPELERIA: 'Quitó el corte de papelería',
};

/** Las acciones que destruyen o mueven plata se pintan distinto. */
const DELICADAS = new Set([
  'DELETE_COBRO', 'DELETE_PRESTAMO', 'DELETE_CLIENTE', 'DELETE_USUARIO',
  'DELETE_MOVIMIENTO_CAJA', 'ANULAR_COBRO', 'CANCEL_PRESTAMO', 'REABRIR_CAJA',
  'RESET_PASSWORD', 'LOGIN_FAILED', 'QUITAR_CORTE_PAPELERIA',
]);

export default function AuditoriaPage() {
  const [pagina, setPagina] = useState(1);
  const [accion, setAccion] = useState('');

  const { data: acciones } = useQuery<string[]>({
    queryKey: ['auditoria-acciones'],
    queryFn: () => apiClient.get('/api/admin/auditoria/acciones').then((r) => r.data.data),
    staleTime: 10 * 60 * 1000,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['auditoria', pagina, accion],
    queryFn: () => apiClient
      .get(`/api/admin/auditoria?page=${pagina}&limit=40${accion ? `&accion=${accion}` : ''}`)
      .then((r) => r.data),
  });

  const registros: Registro[] = data?.data ?? [];
  const totalPaginas = data?.pagination?.totalPages ?? 1;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>Auditoría</h1>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
          Todo lo que se ha hecho en el sistema, quién y cuándo
        </p>
      </div>

      <div>
        <label className="input-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Filter size={13} /> Filtrar por acción
        </label>
        <select
          className="input-field"
          value={accion}
          onChange={(e) => { setAccion(e.target.value); setPagina(1); }}
        >
          <option value="">Todas las acciones</option>
          {(acciones ?? []).map((a) => (
            <option key={a} value={a}>{ETIQUETAS[a] ?? a}</option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
          <Loader2 size={26} color="var(--brand-500)" style={{ animation: 'spin 1s linear infinite' }} />
        </div>
      ) : registros.length === 0 ? (
        <div className="empty-state">
          <ShieldCheck size={28} color="var(--text-muted)" />
          <p style={{ marginTop: 8, fontSize: 13.5 }}>No hay registros con ese filtro.</p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {registros.map((r, i) => {
            const delicada = DELICADAS.has(r.accion);
            return (
              <div
                key={r._id}
                style={{
                  padding: '11px 14px',
                  borderBottom: i === registros.length - 1 ? 'none' : '1px solid var(--border)',
                  borderLeft: delicada ? '3px solid var(--danger-500)' : '3px solid transparent',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{
                    fontSize: 13, fontWeight: 700,
                    color: delicada ? 'var(--danger-600)' : 'var(--text-primary)',
                  }}>
                    {ETIQUETAS[r.accion] ?? r.accion}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                    {formatFechaHoraCO(r.timestamp)}
                  </span>
                </div>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 5, marginTop: 3,
                  fontSize: 11.5, color: 'var(--text-muted)',
                }}>
                  <User size={11} />
                  {r.usuario
                    ? `${r.usuario.nombre} (${r.usuario.rol})`
                    : 'Sistema o sesión no identificada'}
                  {r.ip ? ` · ${r.ip}` : ''}
                </div>
              </div>
            );
          })}
        </div>
      )}

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

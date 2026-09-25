'use client';
import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, RefreshCw, Calculator, AlertTriangle } from 'lucide-react';
import { apiClient } from '@/services/api';
import {
  calcularPrestamo, calcularPapeleria, formatCOP, type Modalidad,
  DEFAULT_CUOTAS, CARTON_RENOVACION,
} from '@/lib/utils';

const MODALIDADES: { id: Modalidad; emoji: string; label: string }[] = [
  { id: 'diaria',    emoji: '☀️',  label: 'Diaria' },
  { id: 'semanal',   emoji: '📅',  label: 'Semanal' },
  { id: 'quincenal', emoji: '🗓️', label: 'Quincenal' },
  { id: 'mensual',   emoji: '📆',  label: 'Mensual' },
];

interface PrestamoActual {
  _id: string;
  capital: number;
  saldoPendiente: number;
  interes: number;
  estado: string;
  cliente: { _id: string; nombre: string; cedula: string };
}

export default function RenovarPrestamoPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [adicionalVal, setAdicionalVal] = useState('');
  const [modalidad, setModalidad] = useState<Modalidad>('diaria');
  const [plazoVal, setPlazoVal] = useState(String(DEFAULT_CUOTAS.diaria));
  const [interesVal, setInteresVal] = useState('20');
  const [cartonVal, setCartonVal] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [error, setError] = useState('');

  const { data: prestamo, isLoading } = useQuery<PrestamoActual>({
    queryKey: ['prestamo', id],
    queryFn: () => apiClient.get(`/api/prestamos/${id}`).then((r) => r.data.data),
  });

  const { data: config } = useQuery<{ valorCarton: number }>({
    queryKey: ['configuracion-negocio'],
    queryFn: () => apiClient.get('/api/dashboard/configuracion').then((r) => r.data.data),
    staleTime: 10 * 60 * 1000,
  });
  const valorCartonDefecto = config?.valorCarton ?? CARTON_RENOVACION;

  const renovar = useMutation({
    mutationFn: () => apiClient.post(`/api/prestamos/${id}/refinanciar`, {
      capitalAdicional: Number(adicionalVal.replace(/\D/g, '')) || 0,
      modalidad,
      interes: Number(interesVal),
      numeroCuotas: Number(plazoVal),
      carton: cartonVal === '' ? valorCartonDefecto : Number(cartonVal.replace(/\D/g, '')),
      observaciones: observaciones || undefined,
    }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['prestamos'] });
      queryClient.invalidateQueries({ queryKey: ['prestamo', id] });
      queryClient.invalidateQueries({ queryKey: ['clientes'] });
      queryClient.invalidateQueries({ queryKey: ['caja-estado'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-kpis'] });
      router.replace(`/prestamos/${res.data.data._id}`);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(msg || 'No se pudo renovar el préstamo');
    },
  });

  if (isLoading || !prestamo) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
        <Loader2 size={28} color="var(--brand-500)" style={{ animation: 'spin 1s linear infinite' }} />
      </div>
    );
  }

  if (prestamo.estado !== 'activo') {
    return (
      <div className="empty-state">
        <AlertTriangle size={30} color="var(--warning-500)" />
        <p style={{ marginTop: 8, fontSize: 13.5 }}>
          Solo se pueden renovar préstamos activos. Este está <strong>{prestamo.estado}</strong>;
          crea un préstamo nuevo desde cero.
        </p>
      </div>
    );
  }

  // ─── Cálculo de la renovación ───────────────────────────────
  const adicional = Number(adicionalVal.replace(/\D/g, '')) || 0;
  const carton = cartonVal === '' ? valorCartonDefecto : (Number(cartonVal.replace(/\D/g, '')) || 0);
  const nuevoCapital = prestamo.saldoPendiente + adicional;
  const plazo = Number(plazoVal) || DEFAULT_CUOTAS[modalidad];
  const interes = Number(interesVal) || 20;
  const valido = nuevoCapital >= 5_000 && plazo > 0 && interes >= 5 && interes <= 100;

  const preview = valido ? calcularPrestamo(nuevoCapital, modalidad, plazo, interes, carton) : null;
  // La deuda vieja se traslada en papel: de la caja solo sale la plata nueva
  const recibeEnMano = adicional - calcularPapeleria(nuevoCapital) - carton;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>Renovar préstamo</h1>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
          {prestamo.cliente.nombre} · {prestamo.cliente.cedula}
        </p>
      </div>

      {error && (
        <div className="card" style={{ padding: '10px 14px', borderLeft: '3px solid var(--danger-500)', display: 'flex', gap: 8 }}>
          <AlertTriangle size={16} color="var(--danger-500)" />
          <span style={{ fontSize: 13, color: 'var(--danger-600)' }}>{error}</span>
        </div>
      )}

      {/* ─── Qué pasa con el préstamo viejo ──────────────────── */}
      <div className="card" style={{ borderLeft: '3px solid var(--warning-500)' }}>
        <h2 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 800 }}>Deuda que arrastra</h2>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Saldo pendiente actual</span>
          <span style={{ fontSize: 15, fontWeight: 800 }}>{formatCOP(prestamo.saldoPendiente)}</span>
        </div>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
          El préstamo actual se cierra como <strong>renovado</strong> y este saldo pasa al préstamo
          nuevo. No queda cobrándose dos veces.
        </p>
      </div>

      {/* ─── Condiciones ─────────────────────────────────────── */}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h2 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Condiciones de la renovación
        </h2>

        <div>
          <label className="input-label">¿Cuánta plata nueva se lleva?</label>
          <input
            className="input-field"
            inputMode="numeric"
            placeholder="$ 0"
            value={adicionalVal ? `$ ${Number(adicionalVal).toLocaleString('es-CO')}` : ''}
            onChange={(e) => setAdicionalVal(e.target.value.replace(/\D/g, ''))}
          />
          <p style={{ margin: '4px 0 0', fontSize: 11.5, color: 'var(--text-muted)' }}>
            Déjalo en cero si solo estás renovando la tarjeta sin entregarle efectivo.
          </p>
        </div>

        <div>
          <label className="input-label">Modalidad</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {MODALIDADES.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => { setModalidad(m.id); setPlazoVal(String(DEFAULT_CUOTAS[m.id])); }}
                style={{
                  padding: '10px 8px', borderRadius: 'var(--radius-md)',
                  border: `1.5px solid ${modalidad === m.id ? 'var(--brand-500)' : 'var(--border)'}`,
                  background: modalidad === m.id ? 'rgb(79 70 229 / 0.1)' : 'var(--bg-card)',
                  color: modalidad === m.id ? 'var(--brand-text)' : 'var(--text-secondary)',
                  fontWeight: 700, fontSize: 13, cursor: 'pointer',
                }}
              >
                {m.emoji} {m.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <label className="input-label">Interés (%)</label>
            <input
              className="input-field"
              inputMode="numeric"
              value={interesVal}
              onChange={(e) => setInteresVal(e.target.value.replace(/\D/g, ''))}
              style={{ textAlign: 'right' }}
            />
          </div>
          <div>
            <label className="input-label">Cuotas</label>
            <input
              className="input-field"
              inputMode="numeric"
              value={plazoVal}
              onChange={(e) => setPlazoVal(e.target.value.replace(/\D/g, ''))}
              style={{ textAlign: 'right' }}
            />
          </div>
        </div>

        <div>
          <label className="input-label">Renovación de cartón</label>
          <input
            className="input-field"
            inputMode="numeric"
            placeholder={String(valorCartonDefecto)}
            value={cartonVal}
            onChange={(e) => setCartonVal(e.target.value.replace(/\D/g, ''))}
            style={{ textAlign: 'right' }}
          />
          <p style={{ margin: '4px 0 0', fontSize: 11.5, color: 'var(--text-muted)' }}>
            Por defecto {formatCOP(valorCartonDefecto)}. Pon 0 si no le cobras cartón.
          </p>
        </div>

        <div>
          <label className="input-label">Observaciones</label>
          <input
            className="input-field"
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
            placeholder="Opcional"
          />
        </div>
      </div>

      {/* ─── Resumen ─────────────────────────────────────────── */}
      {preview && (
        <div className="card animate-fade-in" style={{
          background: 'linear-gradient(135deg, rgb(79 70 229 / 0.08), rgb(124 58 237 / 0.08))',
          border: '1.5px solid var(--brand-100)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <Calculator size={18} color="var(--brand-500)" />
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--brand-text)' }}>
              Cómo queda la renovación
            </h3>
          </div>

          {[
            { label: 'Saldo que arrastra',            value: formatCOP(prestamo.saldoPendiente) },
            { label: 'Plata nueva',                   value: formatCOP(adicional) },
            { label: 'Capital del préstamo nuevo',    value: formatCOP(nuevoCapital), hi: true },
            null,
            { label: 'Papelería',                     value: `- ${formatCOP(preview.papeleria)}` },
            { label: 'Renovación de cartón',          value: `- ${formatCOP(carton)}` },
            {
              label: recibeEnMano >= 0 ? 'Le entregas en efectivo' : 'Él te paga en efectivo',
              value: formatCOP(Math.abs(recibeEnMano)),
              hi: true,
            },
            null,
            { label: `Interés (${interes}%)`,         value: formatCOP(preview.totalInteres) },
            { label: 'Total a cobrar',                value: formatCOP(preview.totalPagar), hi: true },
            { label: preview.descripcion,             value: '' },
          ].map((item, i) =>
            item === null ? (
              <div key={i} className="divider" style={{ margin: '10px 0' }} />
            ) : item.value === '' ? (
              <p key={i} style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
                {item.label}
              </p>
            ) : (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{item.label}</span>
                <span style={{
                  fontSize: item.hi ? 16 : 14,
                  fontWeight: item.hi ? 800 : 600,
                  color: item.hi ? 'var(--brand-text)' : 'var(--text-primary)',
                }}>
                  {item.value}
                </span>
              </div>
            )
          )}
        </div>
      )}

      {/* El cobrador tiene que saber qué efectivo mover antes de confirmar */}
      {preview && (
        <div className="card" style={{
          padding: '12px 14px',
          borderLeft: `3px solid ${recibeEnMano >= 0 ? 'var(--danger-500)' : 'var(--success-500)'}`,
        }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
            {recibeEnMano >= 0
              ? `Saca ${formatCOP(recibeEnMano)} de la caja y entrégaselos`
              : `Cóbrale ${formatCOP(Math.abs(recibeEnMano))} y mételos a la caja`}
          </p>
          <p style={{ margin: '4px 0 0', fontSize: 11.5, color: 'var(--text-muted)' }}>
            {recibeEnMano >= 0
              ? 'La caja del día registra esa salida automáticamente.'
              : 'Son la papelería y el cartón. Entran a la caja del día y cuentan como ganancia.'}
          </p>
        </div>
      )}

      <button
        className="btn-primary"
        disabled={!valido || renovar.isPending}
        onClick={() => { setError(''); renovar.mutate(); }}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
      >
        <RefreshCw size={17} />
        {renovar.isPending ? 'Renovando…' : 'Confirmar renovación'}
      </button>
    </div>
  );
}

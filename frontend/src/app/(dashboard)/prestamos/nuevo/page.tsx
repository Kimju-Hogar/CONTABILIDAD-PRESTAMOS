'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { Loader2, Calculator, Percent } from 'lucide-react';
import { apiClient } from '@/services/api';
import { calcularPrestamo, formatCOP, fechaHoyISO, type Modalidad, DEFAULT_CUOTAS } from '@/lib/utils';

// ─── Constantes UI ────────────────────────────────────────────
const TASAS_RAPIDAS = [10, 15, 20];

const MODALIDADES_OPTIONS: { id: Modalidad; emoji: string; label: string }[] = [
  { id: 'diaria',    emoji: '☀️',  label: 'Diaria' },
  { id: 'semanal',   emoji: '📅',  label: 'Semanal' },
  { id: 'quincenal', emoji: '🗓️', label: 'Quincenal' },
  { id: 'mensual',   emoji: '📆',  label: 'Mensual' },
];

// ─── Schema — z.coerce.number() para aceptar string o number ─
const schema = z.object({
  clienteId:    z.string().min(1, 'Selecciona un cliente'),
  capital:      z.coerce.number({ invalid_type_error: 'Ingresa el capital' }).min(5_000, 'Mínimo $5.000'),
  modalidad:    z.enum(['diaria', 'semanal', 'quincenal', 'mensual'] as const),
  interes:      z.coerce.number({ invalid_type_error: 'Ingresa un porcentaje' }).min(5, 'Mínimo 5%').max(100, 'Máximo 100%'),
  numeroCuotas: z.coerce.number({ invalid_type_error: 'Ingresa el plazo' }).int().positive('Mayor a 0'),
  fechaInicio:  z.string().min(1, 'La fecha de inicio es requerida'),
  observaciones: z.string().max(1000).optional(),
});

type FormData = z.infer<typeof schema>;

export default function NuevoPrestamoPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState('');
  const [preview, setPreview] = useState<ReturnType<typeof calcularPrestamo> | null>(null);

  // Estado local para los inputs controlados
  const [capitalVal, setCapitalVal]   = useState('');
  const [modalidadVal, setModalidadVal] = useState<Modalidad>('diaria');
  const [plazoVal, setPlazoVal]       = useState(String(DEFAULT_CUOTAS.diaria));
  const [interesVal, setInteresVal]   = useState('20');

  const { register, handleSubmit, setValue, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      fechaInicio:  fechaHoyISO(),
      modalidad:    'diaria',
      numeroCuotas: DEFAULT_CUOTAS.diaria,
      interes:      20,
    },
  });

  // Clientes activos para el selector
  const { data: clientesData } = useQuery({
    queryKey: ['clientes-select'],
    queryFn: () => apiClient.get('/api/clientes?estado=activo&limit=200').then((r) => r.data.data),
  });

  // ─── Recalcular preview en tiempo real ────────────────────
  const actualizarPreview = (
    capital: string,
    modalidad: Modalidad,
    plazo: string,
    tasa: string,
  ) => {
    const num  = Number(capital.replace(/\D/g, ''));
    const pNum = Number(plazo);
    const iNum = Number(tasa);
    if (num >= 5_000 && pNum > 0 && iNum >= 5 && iNum <= 100) {
      setPreview(calcularPrestamo(num, modalidad, pNum, iNum));
    } else {
      setPreview(null);
    }
  };

  // ─── Cambio de modalidad ──────────────────────────────────
  const cambiarModalidad = (m: Modalidad) => {
    const defPlazo = String(DEFAULT_CUOTAS[m]);
    setModalidadVal(m);
    setPlazoVal(defPlazo);
    setValue('modalidad', m);
    setValue('numeroCuotas', DEFAULT_CUOTAS[m]);
    actualizarPreview(capitalVal.replace(/\D/g, ''), m, defPlazo, interesVal);
  };

  // ─── Mutation ─────────────────────────────────────────────
  const { mutate, isPending } = useMutation({
    mutationFn: (data: FormData) => apiClient.post('/api/prestamos', {
      clienteId:    data.clienteId,
      capital:      data.capital,
      modalidad:    data.modalidad,
      interes:      data.interes,
      numeroCuotas: data.numeroCuotas,
      fechaInicio:  data.fechaInicio,
      observaciones: data.observaciones,
    }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['prestamos'] });
      queryClient.invalidateQueries({ queryKey: ['clientes'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-kpis'] });
      router.push(`/prestamos/${res.data.data._id}`);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setServerError(msg || 'Error al crear el préstamo');
    },
  });

  // ─── Render ───────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>Nuevo Préstamo</h1>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
          Tasa personalizable · Papelería $5.000 por cada $100.000
        </p>
      </div>

      <form onSubmit={handleSubmit((d) => mutate(d))} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* ── Cliente ── */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Cliente
          </h2>
          <div>
            <label className="input-label">Cliente *</label>
            <select className="input-field" {...register('clienteId')}
              style={{ appearance: 'none', WebkitAppearance: 'none' }}>
              <option value="">— Seleccionar cliente —</option>
              {(clientesData ?? []).map((c: { _id: string; nombre: string; cedula: string }) => (
                <option key={c._id} value={c._id}>{c.nombre} · {c.cedula}</option>
              ))}
            </select>
            {errors.clienteId && <p className="input-error">{errors.clienteId.message}</p>}
          </div>
        </div>

        {/* ── Condiciones ── */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <h2 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Condiciones
          </h2>

          {/* Capital */}
          <div>
            <label className="input-label">Capital a prestar *</label>
            <input
              className="input-field"
              inputMode="numeric"
              placeholder="$ 0"
              value={capitalVal}
              onChange={(e) => {
                const raw = e.target.value.replace(/\D/g, '');
                setCapitalVal(raw ? `$ ${Number(raw).toLocaleString('es-CO')}` : '');
                setValue('capital', Number(raw));
                actualizarPreview(raw, modalidadVal, plazoVal, interesVal);
              }}
            />
            {errors.capital && <p className="input-error">{errors.capital.message}</p>}
          </div>

          {/* Tasa de interés */}
          <div>
            <label className="input-label">Tasa de interés *</label>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              {TASAS_RAPIDAS.map((tasa) => (
                <button
                  key={tasa}
                  type="button"
                  onClick={() => {
                    const t = String(tasa);
                    setInteresVal(t);
                    setValue('interes', tasa);
                    actualizarPreview(capitalVal.replace(/\D/g, ''), modalidadVal, plazoVal, t);
                  }}
                  style={{
                    flex: 1, padding: '10px 4px',
                    border: `2px solid ${interesVal === String(tasa) ? 'var(--brand-500)' : 'var(--border)'}`,
                    borderRadius: 'var(--radius-md)',
                    background: interesVal === String(tasa) ? 'var(--brand-50)' : 'transparent',
                    color: interesVal === String(tasa) ? 'var(--brand-text)' : 'var(--text-primary)',
                    fontWeight: 700, fontSize: 15, cursor: 'pointer',
                    transition: 'all var(--transition)',
                  }}
                >
                  {tasa}%
                </button>
              ))}
            </div>
            <div style={{ position: 'relative' }}>
              <input
                type="number"
                className="input-field"
                placeholder="Otro % (ej. 12)"
                min={5} max={100}
                value={interesVal}
                style={{ paddingRight: 36 }}
                onChange={(e) => {
                  const raw = e.target.value;
                  setInteresVal(raw);
                  setValue('interes', Number(raw));
                  actualizarPreview(capitalVal.replace(/\D/g, ''), modalidadVal, plazoVal, raw);
                }}
              />
              <Percent size={14} color="var(--text-muted)" style={{
                position: 'absolute', right: 12, top: '50%',
                transform: 'translateY(-50%)', pointerEvents: 'none',
              }} />
            </div>
            {errors.interes && <p className="input-error">{errors.interes.message}</p>}
          </div>

          {/* Modalidad — grid 2×2 */}
          <div>
            <label className="input-label">Modalidad de pago *</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {MODALIDADES_OPTIONS.map(({ id, emoji, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => cambiarModalidad(id)}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center',
                    justifyContent: 'center', padding: '12px 8px', gap: 4,
                    border: `2px solid ${modalidadVal === id ? 'var(--brand-500)' : 'var(--border)'}`,
                    borderRadius: 'var(--radius-md)',
                    background: modalidadVal === id ? 'var(--brand-50)' : 'transparent',
                    cursor: 'pointer', transition: 'all var(--transition)',
                  }}
                >
                  <span style={{ fontSize: 20 }}>{emoji}</span>
                  <span style={{
                    fontSize: 13, fontWeight: 700,
                    color: modalidadVal === id ? 'var(--brand-text)' : 'var(--text-primary)',
                  }}>
                    {label}
                  </span>
                </button>
              ))}
            </div>
            {errors.modalidad && <p className="input-error">{errors.modalidad.message}</p>}
          </div>

          {/* Plazo */}
          <div>
            <label className="input-label">
              Número de cuotas
              <span style={{ color: 'var(--text-muted)', fontWeight: 400, marginLeft: 6 }}>
                ({modalidadVal === 'diaria' ? 'días' : modalidadVal === 'semanal' ? 'semanas' : modalidadVal === 'quincenal' ? 'quincenas' : 'meses'})
              </span>
            </label>
            <input
              type="number"
              className="input-field"
              placeholder={`Ej. ${DEFAULT_CUOTAS[modalidadVal]}`}
              value={plazoVal}
              min={1}
              onChange={(e) => {
                const raw = e.target.value;
                setPlazoVal(raw);
                setValue('numeroCuotas', Number(raw));
                actualizarPreview(capitalVal.replace(/\D/g, ''), modalidadVal, raw, interesVal);
              }}
            />
            {errors.numeroCuotas && <p className="input-error">{errors.numeroCuotas.message}</p>}
          </div>

          {/* Fecha inicio */}
          <div>
            <label className="input-label">Fecha de inicio *</label>
            <input type="date" className="input-field" {...register('fechaInicio')} />
            {errors.fechaInicio && <p className="input-error">{errors.fechaInicio.message}</p>}
          </div>
        </div>

        {/* ── Preview de cálculo ── */}
        {preview && (
          <div className="card animate-fade-in" style={{
            background: 'linear-gradient(135deg, rgb(79 70 229 / 0.08), rgb(124 58 237 / 0.08))',
            border: '1.5px solid var(--brand-100)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <Calculator size={18} color="var(--brand-500)" />
              <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--brand-text)' }}>
                Resumen del préstamo
              </h3>
            </div>

            {[
              { label: 'Capital',                              value: formatCOP(Number(capitalVal.replace(/\D/g, ''))), hi: false },
              { label: 'Papelería (descuento al cliente)',     value: `- ${formatCOP(preview.papeleria)}`,              hi: false },
              { label: 'El cliente recibe',                   value: formatCOP(preview.montoDesembolsado),              hi: true },
              null,
              { label: `Interés (${interesVal}%)`,            value: formatCOP(preview.totalInteres),                   hi: false },
              { label: 'Total a cobrar',                      value: formatCOP(preview.totalPagar),                     hi: true },
              { label: preview.descripcion,                   value: '',                                                hi: false },
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

        {/* ── Observaciones ── */}
        <div className="card">
          <label className="input-label">Observaciones</label>
          <textarea
            className="input-field"
            rows={3}
            placeholder="Notas adicionales..."
            style={{ resize: 'none' }}
            {...register('observaciones')}
          />
        </div>

        {serverError && (
          <div style={{
            background: 'rgb(239 68 68 / 0.1)', border: '1px solid rgb(239 68 68 / 0.3)',
            borderRadius: 'var(--radius-md)', padding: '12px 14px',
            fontSize: 13, color: 'var(--danger-600)',
          }}>
            {serverError}
          </div>
        )}

        <button type="submit" className="btn-primary" disabled={isPending || !preview} id="btn-crear-prestamo">
          {isPending
            ? <><Loader2 size={18} className="animate-pulse-soft" /> Creando préstamo...</>
            : preview
              ? `Crear préstamo · ${formatCOP(preview.totalPagar)}`
              : 'Completa el formulario para continuar'
          }
        </button>
      </form>
    </div>
  );
}

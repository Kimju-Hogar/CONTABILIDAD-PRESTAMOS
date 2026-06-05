'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { Loader2, Calculator } from 'lucide-react';
import { apiClient } from '@/services/api';
import { calcularPrestamo, formatCOP, fechaHoyISO } from '@/lib/utils';

const schema = z.object({
  clienteId: z.string().min(1, 'Selecciona un cliente'),
  capital: z.string().min(1, 'El capital es requerido')
    .transform(Number)
    .pipe(z.number().min(10_000, 'Mínimo $10.000')),
  modalidad: z.enum(['diaria', 'semanal'], { required_error: 'Selecciona una modalidad' }),
  numeroCuotas: z.string().min(1, 'El plazo es requerido')
    .transform(Number)
    .pipe(z.number().int().positive('Debe ser mayor a 0')),
  fechaInicio: z.string().min(1, 'La fecha de inicio es requerida'),
  observaciones: z.string().max(1000).optional(),
});

type FormData = z.infer<typeof schema>;

export default function NuevoPrestamoPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState('');
  const [preview, setPreview] = useState<ReturnType<typeof calcularPrestamo> | null>(null);
  const [capitalVal, setCapitalVal] = useState('');
  const [modalidadVal, setModalidadVal] = useState<'diaria' | 'semanal'>('diaria');
  const [plazoVal, setPlazoVal] = useState('115');

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { fechaInicio: fechaHoyISO(), modalidad: 'diaria', numeroCuotas: '115' as unknown as number },
  });

  // Buscar clientes para el selector
  const { data: clientesData } = useQuery({
    queryKey: ['clientes-select'],
    queryFn: () => apiClient.get('/api/clientes?estado=activo&limit=100').then((r) => r.data.data),
  });

  const actualizarPreview = (capital: string, modalidad: 'diaria' | 'semanal', plazo: string) => {
    const num = Number(capital.replace(/\D/g, ''));
    const pNum = Number(plazo);
    if (num >= 10_000 && pNum > 0) {
      setPreview(calcularPrestamo(num, modalidad, pNum));
    } else {
      setPreview(null);
    }
  };

  const { mutate, isPending } = useMutation({
    mutationFn: (data: FormData) => apiClient.post('/api/prestamos', {
      ...data,
      capital: typeof data.capital === 'string' ? Number((data.capital as string).replace(/\D/g, '')) : data.capital,
      numeroCuotas: typeof data.numeroCuotas === 'string' ? Number(data.numeroCuotas) : data.numeroCuotas,
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>Nuevo Préstamo</h1>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
          Interés fijo 20% · Papelería $5.000 por $100.000
        </p>
      </div>

      <form onSubmit={handleSubmit((data) => mutate(data))} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Cliente */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
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

        {/* Condiciones del préstamo */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
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
                setValue('capital', raw as unknown as number);
                actualizarPreview(raw, modalidadVal, plazoVal);
              }}
            />
            {errors.capital && <p className="input-error">{errors.capital.message as string}</p>}
          </div>

          {/* Modalidad */}
          <div>
            <label className="input-label">Modalidad de pago *</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {(['diaria', 'semanal'] as const).map((m) => (
                <label key={m} style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  padding: '14px 10px',
                  border: `2px solid ${modalidadVal === m ? 'var(--brand-500)' : 'var(--border)'}`,
                  borderRadius: 'var(--radius-md)',
                  background: modalidadVal === m ? 'var(--brand-50)' : 'transparent',
                  cursor: 'pointer',
                  transition: 'all var(--transition)',
                  gap: 4,
                }}>
                  <input
                    type="radio"
                    value={m}
                    style={{ display: 'none' }}
                    {...register('modalidad')}
                    onChange={() => {
                      setModalidadVal(m);
                      setValue('modalidad', m);
                      const defPlazo = m === 'diaria' ? '115' : '4';
                      setPlazoVal(defPlazo);
                      setValue('numeroCuotas', defPlazo as unknown as number);
                      actualizarPreview(capitalVal.replace(/\D/g, ''), m, defPlazo);
                    }}
                  />
                  <span style={{ fontSize: 15, fontWeight: 700, color: modalidadVal === m ? 'var(--brand-600)' : 'var(--text-primary)' }}>
                    {m === 'diaria' ? 'Diaria' : 'Semanal'}
                  </span>
                </label>
              ))}
            </div>
            {errors.modalidad && <p className="input-error">{errors.modalidad.message}</p>}
          </div>

          {/* Plazo (Días o Semanas) */}
          <div>
            <label className="input-label">Plazo ({modalidadVal === 'diaria' ? 'Días' : 'Semanas'}) *</label>
            <input
              type="number"
              className="input-field"
              placeholder="Ej. 20"
              value={plazoVal}
              onChange={(e) => {
                const raw = e.target.value.replace(/\D/g, '');
                setPlazoVal(raw);
                setValue('numeroCuotas', raw as unknown as number);
                actualizarPreview(capitalVal.replace(/\D/g, ''), modalidadVal, raw);
              }}
            />
            {errors.numeroCuotas && <p className="input-error">{errors.numeroCuotas.message}</p>}
          </div>

          {/* Fecha inicio */}
          <div>
            <label className="input-label">Fecha de inicio *</label>
            <input
              type="date"
              className="input-field"
              {...register('fechaInicio')}
            />
            {errors.fechaInicio && <p className="input-error">{errors.fechaInicio.message}</p>}
          </div>
        </div>

        {/* Preview de cálculo */}
        {preview && (
          <div className="card animate-fade-in" style={{
            background: 'linear-gradient(135deg, rgb(79 70 229 / 0.08), rgb(124 58 237 / 0.08))',
            border: '1.5px solid var(--brand-100)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <Calculator size={18} color="var(--brand-500)" />
              <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--brand-600)' }}>
                Resumen del préstamo
              </h3>
            </div>

            {[
              { label: 'Capital', value: formatCOP(Number(capitalVal.replace(/\D/g, ''))), highlight: false },
              { label: 'Papelería (descuento al cliente)', value: `- ${formatCOP(preview.papeleria)}`, highlight: false },
              { label: 'El cliente recibe', value: formatCOP(preview.montoDesembolsado), highlight: true },
              null, // separador
              { label: `Interés (20%)`, value: formatCOP(preview.totalInteres), highlight: false },
              { label: 'Total a cobrar', value: formatCOP(preview.totalPagar), highlight: true },
              { label: preview.descripcion, value: '', highlight: false },
            ].map((item, i) =>
              item === null ? (
                <div key={i} className="divider" style={{ margin: '10px 0' }} />
              ) : item.value === '' ? (
                <p key={i} style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
                  {item.label}
                </p>
              ) : (
                <div key={i} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  marginBottom: 8,
                }}>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{item.label}</span>
                  <span style={{
                    fontSize: item.highlight ? 16 : 14,
                    fontWeight: item.highlight ? 800 : 600,
                    color: item.highlight ? 'var(--brand-600)' : 'var(--text-primary)',
                  }}>
                    {item.value}
                  </span>
                </div>
              )
            )}
          </div>
        )}

        {/* Observaciones */}
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
            : `Crear préstamo · ${preview ? formatCOP(preview.totalPagar) : ''}`
          }
        </button>
      </form>
    </div>
  );
}

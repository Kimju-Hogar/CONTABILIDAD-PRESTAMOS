'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { Loader2, MapPin, AlertTriangle, CreditCard } from 'lucide-react';
import { apiClient } from '@/services/api';
import { formatCOP, horaActualCO, fechaHoyISO } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';
import { useOfflineStore } from '@/stores/offlineStore';

const schema = z.object({
  prestamoId: z.string().min(1, 'Selecciona un préstamo'),
  monto: z.string().min(1, 'El monto es requerido').transform(Number)
    .pipe(z.number().positive('El monto debe ser mayor a 0')),
  tipo: z.enum(['diario', 'parcial', 'adelantado', 'total']),
  observaciones: z.string().max(500).optional(),
});
type FormData = z.infer<typeof schema>;

interface Prestamo {
  _id: string;
  cuotaDiaria: number;
  saldoPendiente: number;
  totalPagar: number;
  totalCobrado: number;
  modalidad: 'diaria' | 'semanal';
  cliente: { nombre: string; celular: string };
}

export default function RegistrarCobroPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { accessToken } = useAuthStore();
  const { isOnline, addCobroPendiente } = useOfflineStore();
  const [geolocalizacion, setGeolocalizacion] = useState<{ lat: number; lng: number; precision?: number } | null>(null);
  const [geoError, setGeoError] = useState('');
  const [montoVal, setMontoVal] = useState('');
  const [serverError, setServerError] = useState('');

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { tipo: 'diario' },
  });

  const prestamoId = watch('prestamoId');
  const tipoSeleccionado = watch('tipo');

  // Obtener préstamos activos
  const { data: prestamosData } = useQuery({
    queryKey: ['prestamos-activos'],
    queryFn: () => apiClient.get('/api/prestamos?estado=activo&limit=100').then((r) => r.data.data),
  });
  const prestamos: Prestamo[] = prestamosData ?? [];

  const prestamoSeleccionado = prestamos.find((p) => p._id === prestamoId);

  // Auto-rellenar monto según tipo
  useEffect(() => {
    if (!prestamoSeleccionado) return;
    if (tipoSeleccionado === 'diario') {
      const m = prestamoSeleccionado.cuotaDiaria;
      setMontoVal(`$ ${m.toLocaleString('es-CO')}`);
      setValue('monto', m as unknown as number);
    } else if (tipoSeleccionado === 'total') {
      const m = prestamoSeleccionado.saldoPendiente;
      setMontoVal(`$ ${m.toLocaleString('es-CO')}`);
      setValue('monto', m as unknown as number);
    }
  }, [tipoSeleccionado, prestamoSeleccionado, setValue]);

  // Obtener geolocalización
  useEffect(() => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setGeolocalizacion({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          precision: pos.coords.accuracy,
        }),
        () => setGeoError('No se pudo obtener ubicación'),
        { timeout: 8000, enableHighAccuracy: false }
      );
    }
  }, []);

  const { mutate, isPending } = useMutation({
    mutationFn: (data: FormData) => apiClient.post('/api/cobros', {
      ...data,
      monto: typeof data.monto === 'string' ? Number((data.monto as string).replace(/\D/g, '')) : data.monto,
      fecha: new Date().toISOString(),
      geolocalizacion,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cobros'] });
      queryClient.invalidateQueries({ queryKey: ['prestamos'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-kpis'] });
      router.push('/cobros');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setServerError(msg || 'Error al registrar el cobro');
    },
  });

  const onSubmit = (data: FormData) => {
    if (!isOnline) {
      // Guardar en cola offline
      addCobroPendiente({
        data: {
          ...data,
          monto: typeof data.monto === 'string' ? Number((data.monto as string).replace(/\D/g, '')) : data.monto,
          fecha: new Date().toISOString(),
          geolocalizacion,
        },
        token: accessToken ?? '',
      });
      router.push('/cobros');
      return;
    }
    mutate(data);
  };

  const progreso = prestamoSeleccionado
    ? Math.min(100, Math.round((prestamoSeleccionado.totalCobrado / prestamoSeleccionado.totalPagar) * 100))
    : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>Registrar Cobro</h1>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
          {horaActualCO()} · {new Date().toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Bogota' })}
        </p>
      </div>

      {!isOnline && (
        <div style={{
          background: 'rgb(245 158 11 / 0.12)', border: '1.5px solid var(--warning-500)',
          borderRadius: 'var(--radius-md)', padding: '12px 14px', fontSize: 13,
          color: 'var(--warning-600)', display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <AlertTriangle size={16} />
          Sin conexión — el cobro se guardará localmente y se sincronizará automáticamente
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Selección de préstamo */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Préstamo
          </h2>
          <div>
            <label className="input-label">Seleccionar préstamo *</label>
            <select className="input-field" {...register('prestamoId')}
              style={{ appearance: 'none', WebkitAppearance: 'none' }}>
              <option value="">— Buscar cliente/préstamo —</option>
              {prestamos.map((p) => (
                <option key={p._id} value={p._id}>
                  {p.cliente.nombre} · Saldo: {formatCOP(p.saldoPendiente)}
                </option>
              ))}
            </select>
            {errors.prestamoId && <p className="input-error">{errors.prestamoId.message}</p>}
          </div>

          {/* Preview del préstamo seleccionado */}
          {prestamoSeleccionado && (
            <div className="animate-fade-in" style={{
              background: 'var(--bg-input)', borderRadius: 'var(--radius-md)', padding: '12px 14px',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                <div>
                  <p style={{ margin: 0, fontWeight: 700 }}>{prestamoSeleccionado.cliente.nombre}</p>
                  <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
                    {prestamoSeleccionado.modalidad === 'diaria' ? 'Cuota diaria' : 'Cuota semanal'}:
                    <strong> {formatCOP(prestamoSeleccionado.cuotaDiaria)}</strong>
                  </p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>Saldo</p>
                  <p style={{ margin: 0, fontWeight: 800, fontSize: 16, color: 'var(--danger-500)' }}>
                    {formatCOP(prestamoSeleccionado.saldoPendiente)}
                  </p>
                </div>
              </div>
              {/* Progress */}
              <div className="progress-bar">
                <div className="progress-fill success" style={{ width: `${progreso}%` }} />
              </div>
              <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--text-muted)', textAlign: 'right' }}>
                {progreso}% cobrado
              </p>
            </div>
          )}
        </div>

        {/* Tipo y monto */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Pago
          </h2>

          {/* Tipo de pago */}
          <div>
            <label className="input-label">Tipo de pago *</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
              {[
                { val: 'diario', label: 'Diario / Semanal', desc: 'Cuota normal' },
                { val: 'parcial', label: 'Parcial', desc: 'Monto menor' },
                { val: 'adelantado', label: 'Adelantado', desc: 'Varias cuotas' },
                { val: 'total', label: 'Total', desc: 'Pago completo' },
              ].map(({ val, label, desc }) => (
                <label key={val} style={{
                  display: 'flex', flexDirection: 'column',
                  padding: '12px 10px',
                  border: `2px solid ${tipoSeleccionado === val ? 'var(--brand-500)' : 'var(--border)'}`,
                  borderRadius: 'var(--radius-md)',
                  background: tipoSeleccionado === val ? 'var(--brand-50)' : 'transparent',
                  cursor: 'pointer',
                  gap: 2,
                }}>
                  <input type="radio" value={val} style={{ display: 'none' }} {...register('tipo')} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: tipoSeleccionado === val ? 'var(--brand-600)' : 'var(--text-primary)' }}>
                    {label}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{desc}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Monto */}
          <div>
            <label className="input-label">Monto a cobrar *</label>
            <input
              className="input-field"
              inputMode="numeric"
              placeholder="$ 0"
              value={montoVal}
              onChange={(e) => {
                const raw = e.target.value.replace(/\D/g, '');
                setMontoVal(raw ? `$ ${Number(raw).toLocaleString('es-CO')}` : '');
                setValue('monto', raw as unknown as number);
              }}
              style={{ fontSize: 20, fontWeight: 700, textAlign: 'right' }}
            />
            {errors.monto && <p className="input-error">{errors.monto.message as string}</p>}
            {prestamoSeleccionado && tipoSeleccionado === 'diario' && (
              <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
                💡 Cuota: {formatCOP(prestamoSeleccionado.cuotaDiaria)}
              </p>
            )}
          </div>
        </div>

        {/* Geolocalización */}
        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <MapPin size={20} color={geolocalizacion ? 'var(--success-500)' : 'var(--text-muted)'} />
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>
              {geolocalizacion ? 'Ubicación capturada' : 'Ubicación no compartida (opcional)'}
            </p>
            {geolocalizacion ? (
              <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>
                {geolocalizacion.lat.toFixed(5)}, {geolocalizacion.lng.toFixed(5)}
                {geolocalizacion.precision && ` ±${Math.round(geolocalizacion.precision)}m`}
              </p>
            ) : (
              <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>
                {geoError ? 'Permiso denegado o GPS apagado' : 'Buscando señal GPS...'}
              </p>
            )}
          </div>
        </div>

        {/* Observaciones */}
        <div className="card">
          <label className="input-label">Observaciones</label>
          <textarea
            className="input-field"
            rows={2}
            placeholder="Notas del cobro..."
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

        <button type="submit" className="btn-primary" disabled={isPending} id="btn-registrar-cobro"
          style={{ background: isOnline ? 'var(--brand-500)' : 'var(--warning-500)' }}>
          {isPending
            ? <><Loader2 size={18} className="animate-pulse-soft" /> Registrando...</>
            : isOnline ? '✓ Registrar Cobro' : '📥 Guardar offline'
          }
        </button>
      </form>
    </div>
  );
}

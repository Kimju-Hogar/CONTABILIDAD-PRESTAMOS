'use client';
import { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  Loader2, MapPin, AlertTriangle, Calendar, CheckSquare, Square,
  ChevronDown, ChevronUp, Clock,
} from 'lucide-react';
import { apiClient } from '@/services/api';
import { formatCOP, horaActualCO, fechaHoyISO, formatFechaCO } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';
import { useOfflineStore } from '@/stores/offlineStore';

const schema = z.object({
  prestamoId: z.string().min(1, 'Selecciona un préstamo'),
  monto: z.string().min(1, 'El monto es requerido').transform(Number)
    .pipe(z.number().positive('El monto debe ser mayor a 0')),
  tipo: z.enum(['diario', 'parcial', 'adelantado', 'total']),
  observaciones: z.string().max(500).optional(),
  fecha: z.string().min(1, 'La fecha es requerida'),
});
type FormData = z.infer<typeof schema>;

interface Cuota {
  numero: number;
  fechaEsperada: string;
  monto: number;
  estado: 'pendiente' | 'pagada' | 'parcial' | 'vencida';
  montoPagado?: number;
}

interface Prestamo {
  _id: string;
  cuotaDiaria: number;
  saldoPendiente: number;
  totalPagar: number;
  totalCobrado: number;
  modalidad: 'diaria' | 'semanal' | 'quincenal' | 'mensual';
  cliente: { nombre: string; celular: string };
  cuotas: Cuota[];
}

const ESTADO_COLOR: Record<string, string> = {
  pendiente: '#6366f1',
  vencida: '#ef4444',
  parcial: '#f59e0b',
  pagada: '#10b981',
};

const ESTADO_LABEL: Record<string, string> = {
  pendiente: 'Pendiente',
  vencida: '⚠ Vencida',
  parcial: '½ Parcial',
  pagada: '✓ Pagada',
};

export default function RegistrarCobroPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { accessToken } = useAuthStore();
  const { isOnline, addCobroPendiente } = useOfflineStore();

  const [geolocalizacion, setGeolocalizacion] = useState<{ lat: number; lng: number; precision?: number } | null>(null);
  const [geoError, setGeoError] = useState('');
  const [montoVal, setMontoVal] = useState('');
  const [serverError, setServerError] = useState('');
  const [cuotasSeleccionadas, setCuotasSeleccionadas] = useState<Set<number>>(new Set());
  const [montosPorCuota, setMontosPorCuota] = useState<Record<number, number>>({});
  const [mostrarCuotas, setMostrarCuotas] = useState(false);
  const [modoHistorico, setModoHistorico] = useState(false);

  const hoyISO = fechaHoyISO();

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { tipo: 'diario', fecha: hoyISO },
  });

  const prestamoId = watch('prestamoId');
  const tipoSeleccionado = watch('tipo');
  const fechaSeleccionada = watch('fecha');

  // Detectar si la fecha es anterior a hoy → modo histórico
  useEffect(() => {
    const esHistorico = fechaSeleccionada && fechaSeleccionada < hoyISO;
    setModoHistorico(!!esHistorico);
    if (esHistorico) {
      setMostrarCuotas(true);
    }
  }, [fechaSeleccionada, hoyISO]);

  // Obtener préstamos activos con cuotas
  const { data: prestamosData } = useQuery({
    queryKey: ['prestamos-activos-cuotas'],
    queryFn: () => apiClient.get('/api/prestamos?estado=activo&limit=200').then((r) => r.data.data),
  });
  const prestamos: Prestamo[] = prestamosData ?? [];

  // Pre-seleccionar préstamo desde query param (ej: desde dashboard)
  useEffect(() => {
    const pid = searchParams.get('prestamoId');
    if (pid && prestamos.length > 0) {
      setValue('prestamoId', pid);
    }
  }, [searchParams, prestamos, setValue]);

  const prestamoSeleccionado = prestamos.find((p) => p._id === prestamoId);

  // Cuotas no pagadas del préstamo seleccionado
  const cuotasPendientes = prestamoSeleccionado?.cuotas.filter(
    (c) => c.estado !== 'pagada'
  ) ?? [];

  // Auto-rellenar monto según tipo (solo modo normal)
  useEffect(() => {
    if (!prestamoSeleccionado || modoHistorico) return;
    if (cuotasSeleccionadas.size > 0) return; // si hay cuotas seleccionadas, no pisar

    if (tipoSeleccionado === 'diario') {
      const m = prestamoSeleccionado.cuotaDiaria;
      setMontoVal(`$ ${m.toLocaleString('es-CO')}`);
      setValue('monto', String(m) as unknown as number);
    } else if (tipoSeleccionado === 'total') {
      const m = prestamoSeleccionado.saldoPendiente;
      setMontoVal(`$ ${m.toLocaleString('es-CO')}`);
      setValue('monto', String(m) as unknown as number);
    }
  }, [tipoSeleccionado, prestamoSeleccionado, modoHistorico, cuotasSeleccionadas.size, setValue]);

  // Al seleccionar/deseleccionar cuotas → actualizar monto total (suma de montos por cuota)
  useEffect(() => {
    if (cuotasSeleccionadas.size === 0) return;
    const total = cuotasPendientes
      .filter((c) => cuotasSeleccionadas.has(c.numero))
      .reduce((acc, c) => acc + (montosPorCuota[c.numero] ?? c.monto), 0);
    setMontoVal(`$ ${total.toLocaleString('es-CO')}`);
    setValue('monto', String(total) as unknown as number);
  }, [cuotasSeleccionadas, cuotasPendientes, montosPorCuota, setValue]);

  // Limpiar cuotas al cambiar préstamo
  useEffect(() => {
    setCuotasSeleccionadas(new Set());
    setMontosPorCuota({});
  }, [prestamoId]);

  const toggleCuota = useCallback((numero: number, montoDefault: number) => {
    setCuotasSeleccionadas((prev) => {
      const next = new Set(prev);
      if (next.has(numero)) {
        next.delete(numero);
      } else {
        next.add(numero);
        // Inicializar monto de la cuota si no existe
        setMontosPorCuota((m) => ({ ...m, [numero]: m[numero] ?? montoDefault }));
      }
      return next;
    });
  }, []);

  const actualizarMontoCuota = (numero: number, valor: number) => {
    setMontosPorCuota((m) => ({ ...m, [numero]: valor }));
  };

  const seleccionarTodas = () => {
    const nuevosMontos: Record<number, number> = { ...montosPorCuota };
    cuotasPendientes.forEach((c) => { if (!nuevosMontos[c.numero]) nuevosMontos[c.numero] = c.monto; });
    setMontosPorCuota(nuevosMontos);
    setCuotasSeleccionadas(new Set(cuotasPendientes.map((c) => c.numero)));
  };

  const deseleccionarTodas = () => {
    setCuotasSeleccionadas(new Set());
  };

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
    mutationFn: (data: FormData) => {
      const montoNumerico = typeof data.monto === 'string'
        ? Number((data.monto as string).replace(/\D/g, ''))
        : data.monto;

      return apiClient.post('/api/cobros', {
        ...data,
        monto: montoNumerico,
        fecha: new Date(`${data.fecha}T12:00:00`).toISOString(),
        geolocalizacion,
        cuotasSeleccionadas: cuotasSeleccionadas.size > 0
          ? Array.from(cuotasSeleccionadas)
          : undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cobros'] });
      queryClient.invalidateQueries({ queryKey: ['prestamos'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-kpis'] });
      queryClient.invalidateQueries({ queryKey: ['cobrar-hoy'] });
      router.push('/cobros');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setServerError(msg || 'Error al registrar el cobro');
    },
  });

  const onSubmit = (data: FormData) => {
    setServerError('');
    if (!isOnline) {
      const montoNumerico = typeof data.monto === 'string'
        ? Number((data.monto as string).replace(/\D/g, ''))
        : data.monto;
      addCobroPendiente({
        data: {
          ...data,
          monto: montoNumerico,
          fecha: new Date(`${data.fecha}T12:00:00`).toISOString(),
          geolocalizacion,
          cuotasSeleccionadas: cuotasSeleccionadas.size > 0 ? Array.from(cuotasSeleccionadas) : undefined,
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
          <Clock size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
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

      {modoHistorico && (
        <div style={{
          background: 'rgb(99 102 241 / 0.10)', border: '1.5px solid var(--brand-500)',
          borderRadius: 'var(--radius-md)', padding: '12px 14px', fontSize: 13,
          color: 'var(--brand-text)', display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <Calendar size={16} />
          <span><strong>Modo histórico</strong> — Selecciona las cuotas que corresponden a esta fecha</span>
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* ── Préstamo ─────────────────────────────────── */}
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
                    {prestamoSeleccionado.modalidad === 'diaria' ? 'Cuota diaria' :
                     prestamoSeleccionado.modalidad === 'semanal' ? 'Cuota semanal' :
                     prestamoSeleccionado.modalidad === 'quincenal' ? 'Cuota quincenal' : 'Cuota mensual'}:
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
              <div className="progress-bar">
                <div className="progress-fill success" style={{ width: `${progreso}%` }} />
              </div>
              <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--text-muted)', textAlign: 'right' }}>
                {progreso}% cobrado · {cuotasPendientes.length} cuotas pendientes
              </p>
            </div>
          )}
        </div>

        {/* ── Fecha del cobro ───────────────────────────── */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Fecha del cobro
          </h2>
          <div>
            <label className="input-label">
              <Calendar size={13} style={{ marginRight: 4, verticalAlign: 'middle' }} />
              Fecha *
            </label>
            <input
              type="date"
              className="input-field"
              max={hoyISO}
              {...register('fecha')}
            />
            {errors.fecha && <p className="input-error">{errors.fecha.message}</p>}
            {fechaSeleccionada && fechaSeleccionada < hoyISO && (
              <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--brand-500)', fontWeight: 600 }}>
                📅 Registrando pago del {formatFechaCO(fechaSeleccionada)} — selecciona las cuotas correspondientes abajo
              </p>
            )}
          </div>
        </div>

        {/* ── Selector de cuotas (modo histórico o manual) ── */}
        {prestamoSeleccionado && cuotasPendientes.length > 0 && (
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <button
              type="button"
              onClick={() => setMostrarCuotas((v) => !v)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                background: 'none', border: 'none', cursor: 'pointer',
                padding: 0, color: 'var(--text-primary)',
              }}
            >
              <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Cuotas a aplicar
                {cuotasSeleccionadas.size > 0 && (
                  <span style={{
                    marginLeft: 8, background: 'var(--brand-500)', color: 'white',
                    fontSize: 11, fontWeight: 700, borderRadius: 20,
                    padding: '2px 8px', verticalAlign: 'middle',
                  }}>
                    {cuotasSeleccionadas.size} seleccionadas
                  </span>
                )}
              </h2>
              {mostrarCuotas ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </button>

            {mostrarCuotas && (
              <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
                  {modoHistorico
                    ? 'Selecciona qué cuotas corresponden a este pago histórico'
                    : 'Opcional: selecciona cuotas específicas (deja vacío para aplicar automáticamente)'}
                </p>

                {/* Botones seleccionar / deseleccionar */}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" onClick={seleccionarTodas} style={{
                    fontSize: 12, padding: '4px 12px', borderRadius: 20,
                    border: '1.5px solid var(--brand-500)', background: 'transparent',
                    color: 'var(--brand-text)', cursor: 'pointer', fontWeight: 600,
                  }}>
                    Seleccionar todas
                  </button>
                  <button type="button" onClick={deseleccionarTodas} style={{
                    fontSize: 12, padding: '4px 12px', borderRadius: 20,
                    border: '1.5px solid var(--border)', background: 'transparent',
                    color: 'var(--text-muted)', cursor: 'pointer',
                  }}>
                    Limpiar
                  </button>
                </div>

                {/* Lista de cuotas */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 340, overflowY: 'auto' }}>
                  {cuotasPendientes.map((cuota) => {
                    const seleccionada = cuotasSeleccionadas.has(cuota.numero);
                    const esVencida = cuota.estado === 'vencida';
                    return (
                      <label
                        key={cuota.numero}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 12,
                          padding: '10px 12px',
                          borderRadius: 'var(--radius-md)',
                          border: `1.5px solid ${seleccionada ? 'var(--brand-500)' : esVencida ? '#ef444444' : 'var(--border)'}`,
                          background: seleccionada ? 'rgb(99 102 241 / 0.08)' : 'var(--bg-input)',
                          cursor: 'pointer',
                          transition: 'all 0.15s',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={seleccionada}
                          onChange={() => toggleCuota(cuota.numero, cuota.monto)}
                          style={{ display: 'none' }}
                        />
                        {seleccionada
                          ? <CheckSquare size={18} color="var(--brand-500)" style={{ flexShrink: 0 }} />
                          : <Square size={18} color={esVencida ? '#ef4444' : 'var(--text-muted)'} style={{ flexShrink: 0 }} />
                        }

                        {/* Info izquierda */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 13, fontWeight: 700 }}>#{cuota.numero}</span>
                            <span style={{
                              fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 10,
                              background: ESTADO_COLOR[cuota.estado] + '25',
                              color: ESTADO_COLOR[cuota.estado],
                            }}>
                              {ESTADO_LABEL[cuota.estado]}
                            </span>
                          </div>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                            {formatFechaCO(cuota.fechaEsperada)}
                          </span>
                        </div>

                        {/* Monto: editable si seleccionada, texto si no */}
                        {seleccionada ? (
                          <input
                            type="number"
                            onClick={(e) => e.stopPropagation()}
                            value={montosPorCuota[cuota.numero] ?? cuota.monto}
                            min={0}
                            onChange={(e) => actualizarMontoCuota(cuota.numero, Number(e.target.value))}
                            style={{
                              width: 88, textAlign: 'right', fontWeight: 700, fontSize: 13,
                              background: 'var(--bg-card)', border: '1.5px solid var(--brand-500)',
                              borderRadius: 8, padding: '4px 8px', color: 'var(--brand-text)',
                              outline: 'none',
                            }}
                          />
                        ) : (
                          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                            {formatCOP(cuota.monto)}
                            {cuota.montoPagado && cuota.estado === 'parcial' && (
                              <span style={{ fontSize: 10, color: 'var(--warning-500)', display: 'block', textAlign: 'right' }}>
                                pag: {formatCOP(cuota.montoPagado)}
                              </span>
                            )}
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>

                {cuotasSeleccionadas.size > 0 && (
                  <div style={{
                    background: 'rgb(99 102 241 / 0.10)', border: '1.5px solid var(--brand-500)',
                    borderRadius: 'var(--radius-md)', padding: '10px 14px',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  }}>
                    <span style={{ fontSize: 13, color: 'var(--brand-text)', fontWeight: 600 }}>
                      {cuotasSeleccionadas.size} cuota{cuotasSeleccionadas.size !== 1 ? 's' : ''} seleccionadas
                    </span>
                    <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--brand-text)' }}>
                      {formatCOP(
                        cuotasPendientes
                          .filter((c) => cuotasSeleccionadas.has(c.numero))
                          .reduce((acc, c) => acc + (montosPorCuota[c.numero] ?? c.monto), 0)
                      )}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Tipo y monto ─────────────────────────────── */}
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
                  cursor: 'pointer', gap: 2,
                }}>
                  <input type="radio" value={val} style={{ display: 'none' }} {...register('tipo')} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: tipoSeleccionado === val ? 'var(--brand-text)' : 'var(--text-primary)' }}>
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
            {prestamoSeleccionado && tipoSeleccionado === 'diario' && cuotasSeleccionadas.size === 0 && (
              <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
                💡 Cuota: {formatCOP(prestamoSeleccionado.cuotaDiaria)}
              </p>
            )}
            {cuotasSeleccionadas.size > 0 && (
              <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--brand-500)' }}>
                💡 Monto basado en cuotas seleccionadas — puedes editarlo si el pago fue diferente
              </p>
            )}
          </div>
        </div>

        {/* ── Geolocalización ──────────────────────────── */}
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

        {/* ── Observaciones ────────────────────────────── */}
        <div className="card">
          <label className="input-label">Observaciones</label>
          <textarea
            className="input-field"
            rows={2}
            placeholder={modoHistorico ? 'Ej: Pago registrado manualmente por cobro del 10/06/2025...' : 'Notas del cobro...'}
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

        <button
          type="submit"
          className="btn-primary"
          disabled={isPending}
          id="btn-registrar-cobro"
          style={{ background: isOnline ? 'var(--brand-500)' : 'var(--warning-500)' }}
        >
          {isPending
            ? <><Loader2 size={18} className="animate-pulse-soft" /> Registrando...</>
            : isOnline
              ? modoHistorico ? '📅 Registrar Pago Histórico' : '✓ Registrar Cobro'
              : '📥 Guardar offline'
          }
        </button>
      </form>
    </div>
  );
}

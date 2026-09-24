'use client';
import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { Loader2, Camera, X, Receipt, List, Plus, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import { apiClient } from '@/services/api';
import { useRol } from '@/hooks/useRol';
import { formatCOP, fechaHoyISO, formatFechaCO } from '@/lib/utils';

const schema = z.object({
  categoria: z.enum(['combustible', 'reparaciones', 'alimentacion', 'otro']),
  descripcion: z.string().min(3).max(500),
  monto: z.string().min(1).transform(Number).pipe(z.number().positive()),
  fecha: z.string().optional(),
});
type FormData = z.infer<typeof schema>;

const CATEGORIAS = [
  { val: 'combustible', emoji: '⛽', label: 'Combustible' },
  { val: 'reparaciones', emoji: '🔧', label: 'Reparaciones' },
  { val: 'alimentacion', emoji: '🍽️', label: 'Alimentación' },
  { val: 'otro', emoji: '📦', label: 'Otro' },
];

interface Gasto {
  _id: string;
  categoria: string;
  descripcion: string;
  monto: number;
  fecha: string;
  usuario?: { nombre: string };
  fotos?: string[];
}

export default function GastosPage() {
  const { puedeEliminar } = useRol();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fotos, setFotos] = useState<File[]>([]);
  const [montoVal, setMontoVal] = useState('');
  const [success, setSuccess] = useState(false);
  const [vista, setVista] = useState<'form' | 'historial'>('form');
  const [pagina, setPagina] = useState(1);

  const { register, handleSubmit, reset, setValue, watch, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { fecha: fechaHoyISO(), categoria: 'combustible' as FormData['categoria'] },
  });

  const categoriaActual = watch('categoria') || 'combustible';

  const { mutate, isPending } = useMutation({
    mutationFn: async (data: FormData) => {
      const formData = new FormData();
      formData.append('categoria', data.categoria);
      formData.append('descripcion', data.descripcion);
      formData.append('monto', String(data.monto));
      if (data.fecha) formData.append('fecha', data.fecha);
      fotos.forEach((f) => formData.append('fotos', f));
      return apiClient.post('/api/gastos', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gastos'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-kpis'] });
      reset(); setMontoVal(''); setFotos([]); setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    },
  });

  // ─── Historial de gastos ──────────────────────────────────────
  const { data: historialData, isLoading: loadingHistorial } = useQuery({
    queryKey: ['gastos', pagina],
    queryFn: () => apiClient.get(`/api/gastos?page=${pagina}&limit=15`).then((r) => r.data),
    enabled: vista === 'historial',
  });

  const gastos: Gasto[] = historialData?.data ?? [];
  const totalPaginas = historialData?.pagination?.totalPages ?? 1;
  const totalRegistros = historialData?.pagination?.total ?? 0;

  const handleFotos = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    setFotos((prev) => [...prev, ...files].slice(0, 5));
  };

  const eliminarGasto = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/api/gastos/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['gastos'] }),
  });

  const categoriaEmoji = (cat: string) => CATEGORIAS.find((c) => c.val === cat)?.emoji ?? '📦';
  const categoriaLabel = (cat: string) => CATEGORIAS.find((c) => c.val === cat)?.label ?? cat;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Encabezado con tabs */}
      <div>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>Gastos</h1>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
          Combustible, reparaciones, alimentación y más
        </p>
      </div>

      {/* Tabs */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0,
        borderRadius: 'var(--radius-md)', overflow: 'hidden',
        border: '1.5px solid var(--border)',
      }}>
        {[
          { id: 'form', icon: <Plus size={15} />, label: 'Registrar' },
          { id: 'historial', icon: <List size={15} />, label: 'Ver registros' },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setVista(tab.id as 'form' | 'historial')}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              padding: '12px 8px',
              border: 'none',
              background: vista === tab.id ? 'var(--brand-500)' : 'var(--bg-card)',
              color: vista === tab.id ? 'white' : 'var(--text-secondary)',
              fontWeight: 700, fontSize: 13,
              cursor: 'pointer',
              transition: 'all var(--transition)',
            }}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* ─── Vista: Formulario ─────────────────────────────── */}
      {vista === 'form' && (
        <>
          {success && (
            <div className="animate-fade-in" style={{
              background: 'rgb(16 185 129 / 0.12)', border: '1.5px solid var(--success-500)',
              borderRadius: 'var(--radius-md)', padding: '12px 14px', fontSize: 14,
              color: 'var(--success-600)', fontWeight: 600, textAlign: 'center',
            }}>
              ✅ Gasto registrado exitosamente
            </div>
          )}

          <form onSubmit={handleSubmit((d) => mutate(d))} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Categoría */}
            <div className="card">
              <label className="input-label">Categoría *</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginTop: 8 }}>
                {CATEGORIAS.map(({ val, emoji, label }) => (
                  <label key={val} style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    padding: '12px 6px', gap: 6,
                    border: `2px solid ${categoriaActual === val ? 'var(--brand-500)' : 'var(--border)'}`,
                    borderRadius: 'var(--radius-md)',
                    background: categoriaActual === val ? 'var(--brand-50)' : 'transparent',
                    cursor: 'pointer',
                  }}>
                    <input type="radio" value={val} style={{ display: 'none' }}
                      {...register('categoria')}
                      onChange={() => { setValue('categoria', val as FormData['categoria']); }}
                    />
                    <span style={{ fontSize: 24 }}>{emoji}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, color: categoriaActual === val ? 'var(--brand-text)' : 'var(--text-muted)',
                      textAlign: 'center', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      {label}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {/* Detalles */}
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label className="input-label">Descripción *</label>
                <input className="input-field" placeholder="Describe el gasto..." {...register('descripcion')} />
                {errors.descripcion && <p className="input-error">{errors.descripcion.message}</p>}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label className="input-label">Monto *</label>
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
                  />
                  {errors.monto && <p className="input-error">{errors.monto.message as string}</p>}
                </div>
                <div>
                  <label className="input-label">Fecha</label>
                  <input type="date" className="input-field" {...register('fecha')} />
                </div>
              </div>
            </div>

            {/* Fotos */}
            <div className="card">
              <label className="input-label">Fotos (opcional)</label>
              <input ref={fileRef} type="file" accept="image/*" multiple capture="environment"
                style={{ display: 'none' }} onChange={handleFotos} />

              {fotos.length > 0 && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                  {fotos.map((f, i) => (
                    <div key={i} style={{ position: 'relative', width: 72, height: 72 }}>
                      <img src={URL.createObjectURL(f)} alt="" style={{
                        width: '100%', height: '100%', objectFit: 'cover',
                        borderRadius: 'var(--radius-sm)',
                      }} />
                      <button type="button" onClick={() => setFotos(fotos.filter((_, j) => j !== i))}
                        style={{
                          position: 'absolute', top: -6, right: -6, background: 'var(--danger-500)',
                          border: 'none', borderRadius: '50%', width: 20, height: 20,
                          display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                        }}>
                        <X size={12} color="white" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <button type="button" className="btn-secondary"
                onClick={() => fileRef.current?.click()}
                style={{ width: 'auto', padding: '10px 16px', display: 'inline-flex', gap: 8 }}>
                <Camera size={18} />
                {fotos.length === 0 ? 'Tomar / Adjuntar foto' : 'Agregar más fotos'}
              </button>
            </div>

            <button type="submit" className="btn-primary" disabled={isPending} id="btn-crear-gasto">
              {isPending
                ? <><Loader2 size={18} className="animate-pulse-soft" /> Guardando...</>
                : <><Receipt size={18} /> Registrar gasto</>
              }
            </button>
          </form>
        </>
      )}

      {/* ─── Vista: Historial ──────────────────────────────── */}
      {vista === 'historial' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Contador */}
          {!loadingHistorial && (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
              {totalRegistros} registro{totalRegistros !== 1 ? 's' : ''} en total
            </p>
          )}

          {loadingHistorial ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
              <Loader2 size={28} color="var(--brand-500)" style={{ animation: 'spin 1s linear infinite' }} />
            </div>
          ) : gastos.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
              <p style={{ margin: 0, fontSize: 32 }}>📭</p>
              <p style={{ margin: '8px 0 0', fontSize: 14 }}>Sin registros de gastos aún</p>
            </div>
          ) : (
            <>
              {gastos.map((g) => (
                <div key={g._id} className="card" style={{
                  display: 'flex', alignItems: 'flex-start', gap: 12,
                }}>
                  {/* Emoji categoría */}
                  <div style={{
                    width: 44, height: 44, borderRadius: 'var(--radius-md)',
                    background: 'var(--brand-50)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 22, flexShrink: 0,
                  }}>
                    {categoriaEmoji(g.categoria)}
                  </div>

                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                      <div style={{ minWidth: 0 }}>
                        <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: 'var(--text-primary)',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {g.descripcion}
                        </p>
                        <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>
                          {categoriaLabel(g.categoria)} · {formatFechaCO(g.fecha)}
                          {g.usuario?.nombre ? ` · ${g.usuario.nombre}` : ''}
                        </p>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                        <span style={{ fontWeight: 800, fontSize: 15, color: 'var(--danger-600)' }}>
                          -{formatCOP(g.monto)}
                        </span>
                        {puedeEliminar && (
                          <button
                            type="button"
                            onClick={() => {
                              if (confirm('¿Eliminar este gasto?')) eliminarGasto.mutate(g._id);
                            }}
                            style={{
                              background: 'none', border: 'none', padding: 4,
                              cursor: 'pointer', color: 'var(--text-muted)',
                              borderRadius: 'var(--radius-sm)',
                              display: 'flex', alignItems: 'center',
                            }}
                            title="Eliminar gasto"
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Fotos en miniatura */}
                    {g.fotos && g.fotos.length > 0 && (
                      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                        {g.fotos.map((url, i) => (
                          <a key={i} href={url} target="_blank" rel="noreferrer">
                            <img src={url} alt="" style={{
                              width: 48, height: 48, objectFit: 'cover',
                              borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)',
                            }} />
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {/* Paginación */}
              {totalPaginas > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 4 }}>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={pagina === 1}
                    onClick={() => setPagina((p) => Math.max(1, p - 1))}
                    style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 4 }}
                  >
                    <ChevronLeft size={16} /> Anterior
                  </button>
                  <span style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 600 }}>
                    {pagina} / {totalPaginas}
                  </span>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={pagina === totalPaginas}
                    onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
                    style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 4 }}
                  >
                    Siguiente <ChevronRight size={16} />
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Save, CheckCircle2, AlertTriangle, Settings } from 'lucide-react';
import { apiClient } from '@/services/api';
import { formatCOP } from '@/lib/utils';

interface Config {
  interesPorDefecto: number;
  papeleriaPorCienMil: number;
  papeleriaMinima: number;
  valorCarton: number;
  baseCajaSugerida: number;
}

const CAMPOS: Array<{
  clave: keyof Config;
  label: string;
  ayuda: string;
  sufijo?: string;
  dinero?: boolean;
}> = [
  {
    clave: 'interesPorDefecto',
    label: 'Interés por defecto',
    ayuda: 'Porcentaje que se aplica al crear un préstamo si no se especifica otro.',
    sufijo: '%',
  },
  {
    clave: 'papeleriaPorCienMil',
    label: 'Papelería por cada $100.000',
    ayuda: 'Se descuenta del desembolso y queda en la cuenta de papelería.',
    dinero: true,
  },
  {
    clave: 'papeleriaMinima',
    label: 'Papelería mínima',
    ayuda: 'Piso que se cobra aunque el capital sea pequeño.',
    dinero: true,
  },
  {
    clave: 'valorCarton',
    label: 'Renovación de cartón',
    ayuda: 'Valor fijo que se cobra cada vez que un cliente renueva o refinancia.',
    dinero: true,
  },
  {
    clave: 'baseCajaSugerida',
    label: 'Base de caja sugerida',
    ayuda: 'Se propone al abrir el día cuando no hay un cierre anterior.',
    dinero: true,
  },
];

export default function ConfiguracionPage() {
  const queryClient = useQueryClient();
  const [valores, setValores] = useState<Config | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);

  const { data, isLoading } = useQuery<Config>({
    queryKey: ['admin-configuracion'],
    queryFn: () => apiClient.get('/api/admin/configuracion').then((r) => r.data.data),
  });

  useEffect(() => {
    if (data && !valores) {
      setValores({
        interesPorDefecto: data.interesPorDefecto,
        papeleriaPorCienMil: data.papeleriaPorCienMil,
        papeleriaMinima: data.papeleriaMinima,
        valorCarton: data.valorCarton,
        baseCajaSugerida: data.baseCajaSugerida,
      });
    }
  }, [data, valores]);

  const guardar = useMutation({
    mutationFn: () => apiClient.put('/api/admin/configuracion', valores),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-configuracion'] });
      queryClient.invalidateQueries({ queryKey: ['configuracion-negocio'] });
      setError(null);
      setGuardado(true);
      setTimeout(() => setGuardado(false), 3000);
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(msg ?? 'No se pudo guardar');
    },
  });

  if (isLoading || !valores) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
        <Loader2 size={28} color="var(--brand-500)" style={{ animation: 'spin 1s linear infinite' }} />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>Parámetros del negocio</h1>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
          Aplican a los préstamos nuevos. Los ya creados conservan sus valores.
        </p>
      </div>

      {error && (
        <div className="card" style={{ padding: '10px 14px', borderLeft: '3px solid var(--danger-500)', display: 'flex', gap: 8 }}>
          <AlertTriangle size={16} color="var(--danger-500)" />
          <span style={{ fontSize: 13, color: 'var(--danger-600)' }}>{error}</span>
        </div>
      )}

      {guardado && (
        <div className="card" style={{ padding: '10px 14px', borderLeft: '3px solid var(--success-500)', display: 'flex', gap: 8 }}>
          <CheckCircle2 size={16} color="var(--success-500)" />
          <span style={{ fontSize: 13, color: 'var(--success-600)' }}>Parámetros guardados</span>
        </div>
      )}

      <div className="card" style={{ padding: '14px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
          <Settings size={16} color="var(--brand-500)" />
          <h2 style={{ margin: 0, fontSize: 14, fontWeight: 800 }}>Valores</h2>
        </div>

        {CAMPOS.map((c) => (
          <div key={c.clave} style={{ marginBottom: 16 }}>
            <label className="input-label">{c.label}</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                className="input-field"
                inputMode="numeric"
                value={String(valores[c.clave])}
                onChange={(e) =>
                  setValores({ ...valores, [c.clave]: Number(e.target.value.replace(/\D/g, '')) || 0 })
                }
                style={{ textAlign: 'right', fontWeight: 700 }}
              />
              {c.sufijo && (
                <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-secondary)' }}>
                  {c.sufijo}
                </span>
              )}
            </div>
            <p style={{ margin: '4px 0 0', fontSize: 11.5, color: 'var(--text-muted)' }}>
              {c.ayuda}
              {c.dinero && ` — ${formatCOP(valores[c.clave])}`}
            </p>
          </div>
        ))}

        <button
          className="btn-primary"
          disabled={guardar.isPending}
          onClick={() => guardar.mutate()}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
        >
          <Save size={16} /> {guardar.isPending ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </div>
    </div>
  );
}

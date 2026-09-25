'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Loader2, FileDown, Percent, HandCoins, TrendingUp, FileText,
  AlertTriangle, CalendarDays, Wallet, CheckCircle2,
} from 'lucide-react';
import { apiClient } from '@/services/api';
import { formatCOP, fechaHoyISO } from '@/lib/utils';
import { StatCard, StatRow, SectionCard, Sep, Segmented } from '@/components/shared/Stats';

type PeriodoId = 'hoy' | 'semana' | 'mes' | 'anio' | 'rango';

const PERIODOS: Array<{ id: PeriodoId; label: string }> = [
  { id: 'hoy', label: 'Hoy' },
  { id: 'semana', label: 'Semana' },
  { id: 'mes', label: 'Mes' },
  { id: 'anio', label: 'Año' },
  { id: 'rango', label: 'Rango' },
];

interface FilaDesglose {
  clave: string;
  prestado: number;
  prestamos: number;
  recaudado: number;
  cobros: number;
  interes: number;
  papeleria: number;
  cartones: number;
  gastos: number;
  utilidadNegocio: number;
}

interface Reporte {
  resumen: {
    periodo: { etiqueta: string; dias: number };
    colocacion: { capitalPrestado: number; cantidad: number; desembolsadoEfectivo: number; ticketPromedio: number };
    recaudo: { total: number; cantidad: number; interesDevengado: number; capitalRecuperado: number; promedioDiario: number };
    ingresos: { interesDevengado: number; papeleria: number; cartones: number; otros: number };
    egresos: { gastos: number; otros: number; total: number };
    utilidad: { negocio: number; cobrador: number; total: number; margenSobreRecaudo: number; margenSobreColocado: number };
    cuentaPapeleria: {
      papeleria: { generada: number; retirada: number; disponible: number };
      cartones: { generados: number };
      total: { generado: number; retirado: number; disponible: number };
    };
    cartera: { saldoPendiente: number; montoVencido: number; indiceMora: number; prestamosActivos: number; prestamosEnMora: number };
    caja: { cierres: number; faltantes: number; sobrantes: number; diferenciaAcumulada: number };
  };
  porDia: FilaDesglose[];
  porMes: FilaDesglose[];
}

function etiquetaClave(clave: string): string {
  if (clave.length === 7) {
    const meses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    const [anio, mes] = clave.split('-');
    return `${meses[Number(mes) - 1]} ${anio}`;
  }
  const [, mes, dia] = clave.split('-');
  return `${dia}/${mes}`;
}

export default function ReportePage() {
  const [periodo, setPeriodo] = useState<PeriodoId>('mes');
  const [desde, setDesde] = useState(fechaHoyISO().slice(0, 8) + '01');
  const [hasta, setHasta] = useState(fechaHoyISO());
  const [granularidad, setGranularidad] = useState<'dia' | 'mes'>('dia');
  const [descargando, setDescargando] = useState<'general' | 'detallado' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const qs = periodo === 'rango'
    ? `periodo=rango&desde=${desde}&hasta=${hasta}`
    : `periodo=${periodo}`;

  const { data, isLoading } = useQuery<Reporte>({
    queryKey: ['admin-reporte', qs],
    queryFn: () => apiClient.get(`/api/admin/reporte?${qs}`).then((r) => r.data.data),
  });

  const descargarPDF = async (detallado: boolean) => {
    setDescargando(detallado ? 'detallado' : 'general');
    setError(null);
    try {
      const res = await apiClient.get(
        `/api/admin/reporte.pdf?${qs}&detallado=${detallado}`,
        { responseType: 'blob' }
      );
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `gotagota_reporte_${detallado ? 'detallado' : 'general'}_${periodo}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Dar un respiro al navegador antes de soltar el blob
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch {
      setError('No se pudo generar el PDF. Revisa la conexión e intenta de nuevo.');
    } finally {
      setDescargando(null);
    }
  };

  if (isLoading || !data) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
        <Loader2 size={28} color="var(--brand-500)" style={{ animation: 'spin 1s linear infinite' }} />
      </div>
    );
  }

  const r = data.resumen;
  const filas = granularidad === 'dia' ? data.porDia : data.porMes;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>Reporte general</h1>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
          {r.periodo.etiqueta}
        </p>
      </div>

      <Segmented value={periodo} onChange={setPeriodo} options={PERIODOS} />

      {periodo === 'rango' && (
        <div className="card" style={{ padding: '12px 16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <label className="input-label">Desde</label>
            <input type="date" className="input-field" value={desde} onChange={(e) => setDesde(e.target.value)} />
          </div>
          <div>
            <label className="input-label">Hasta</label>
            <input type="date" className="input-field" value={hasta} onChange={(e) => setHasta(e.target.value)} />
          </div>
        </div>
      )}

      {error && (
        <div className="card" style={{ padding: '10px 14px', borderLeft: '3px solid var(--danger-500)', display: 'flex', gap: 8 }}>
          <AlertTriangle size={16} color="var(--danger-500)" />
          <span style={{ fontSize: 13, color: 'var(--danger-600)' }}>{error}</span>
        </div>
      )}

      {/* ─── Lo esencial ─────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <StatCard
          label="Tu ganancia"
          value={formatCOP(r.utilidad.negocio)}
          sub={`Margen ${r.utilidad.margenSobreRecaudo}%`}
          gradient="linear-gradient(135deg, #d97706, #f59e0b)"
          icon={Percent}
        />
        <StatCard
          label="Ganancia cobrador"
          value={formatCOP(r.utilidad.cobrador)}
          sub="Papelería del periodo"
          gradient="linear-gradient(135deg, #4f46e5, #7c3aed)"
          icon={HandCoins}
        />
        <StatCard
          label="Se prestó"
          value={formatCOP(r.colocacion.capitalPrestado)}
          sub={`${r.colocacion.cantidad} préstamos`}
          gradient="linear-gradient(135deg, #0ea5e9, #6366f1)"
          icon={FileText}
        />
        <StatCard
          label="Entró"
          value={formatCOP(r.recaudo.total)}
          sub={`${r.recaudo.cantidad} cobros`}
          gradient="linear-gradient(135deg, #059669, #0d9488)"
          icon={TrendingUp}
        />
      </div>

      {/* ─── Reparto ─────────────────────────────────────────── */}
      <SectionCard titulo="Cómo se reparte" icon={Percent}>
        <StatRow label="Interés ganado" valor={r.ingresos.interesDevengado} tono="positivo" />
        <StatRow label="Renovación de cartones" valor={r.ingresos.cartones} tono="positivo" />
        {r.ingresos.otros > 0 && <StatRow label="Otros ingresos" valor={r.ingresos.otros} tono="positivo" />}
        <StatRow label="Gastos" valor={-r.egresos.total} tono="negativo" />
        <Sep />
        <StatRow label="Tu ganancia (negocio)" valor={r.utilidad.negocio} negrita tono="positivo" />
        <StatRow label="Ganancia del cobrador (papelería)" valor={r.utilidad.cobrador} negrita />
        <Sep />
        <StatRow label="Total generado" valor={r.utilidad.total} negrita />
      </SectionCard>

      {/* ─── Papelería ───────────────────────────────────────── */}
      <SectionCard titulo="Cuenta de papelería y cartones" icon={FileText}>
        <p style={{ margin: '0 0 6px', fontSize: 11.5, color: 'var(--text-muted)' }}>
          Acumulado histórico, no solo del periodo.
        </p>
        <StatRow label="Papelería generada" valor={r.cuentaPapeleria.papeleria.generada} />
        <StatRow label="Papelería retirada" valor={-r.cuentaPapeleria.papeleria.retirada} tono="muted" />
        <StatRow label="Cartones cobrados" sub="Ganancia directa, no se retiran" valor={r.cuentaPapeleria.cartones.generados} />
        <Sep />
        <StatRow label="Quedó disponible" valor={r.cuentaPapeleria.total.disponible} negrita tono="positivo" />
      </SectionCard>

      {/* ─── Desglose ────────────────────────────────────────── */}
      <SectionCard
        titulo="Detalle"
        icon={CalendarDays}
        accion={
          <div style={{ width: 150 }}>
            <Segmented
              value={granularidad}
              onChange={setGranularidad}
              options={[{ id: 'dia', label: 'Días' }, { id: 'mes', label: 'Meses' }]}
            />
          </div>
        }
      >
        {filas.length === 0 ? (
          <p style={{ margin: '8px 0', fontSize: 13, color: 'var(--text-muted)' }}>
            Sin movimientos en este periodo.
          </p>
        ) : (
          <div style={{ overflowX: 'auto', marginTop: 6 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5, minWidth: 420 }}>
              <thead>
                <tr style={{ background: 'var(--bg-input)' }}>
                  {['Fecha', 'Prestado', 'Recogido', 'Interés', 'Papelería', 'Ganancia'].map((h, i) => (
                    <th key={h} style={{
                      padding: '7px 8px', fontWeight: 700, whiteSpace: 'nowrap',
                      textAlign: i === 0 ? 'left' : 'right', color: 'var(--text-secondary)',
                    }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.clave} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '7px 8px', fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {etiquetaClave(f.clave)}
                    </td>
                    <td style={{ padding: '7px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {formatCOP(f.prestado)}
                    </td>
                    <td style={{ padding: '7px 8px', textAlign: 'right', whiteSpace: 'nowrap', color: 'var(--success-600)' }}>
                      {formatCOP(f.recaudado)}
                    </td>
                    <td style={{ padding: '7px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {formatCOP(f.interes)}
                    </td>
                    <td style={{ padding: '7px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {formatCOP(f.papeleria)}
                    </td>
                    <td style={{
                      padding: '7px 8px', textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 700,
                      color: f.utilidadNegocio >= 0 ? 'var(--success-600)' : 'var(--danger-600)',
                    }}>
                      {formatCOP(f.utilidadNegocio)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* ─── Cartera y caja ──────────────────────────────────── */}
      <SectionCard titulo="Cartera y caja" icon={Wallet}>
        <StatRow label="Saldo pendiente en la calle" valor={r.cartera.saldoPendiente} negrita />
        <StatRow label="Monto vencido" valor={r.cartera.montoVencido} tono="negativo" />
        <StatRow
          label="Préstamos en mora"
          valor={`${r.cartera.prestamosEnMora} de ${r.cartera.prestamosActivos}`}
        />
        <Sep />
        <StatRow label="Cierres de caja en el periodo" valor={String(r.caja.cierres)} />
        <StatRow label="Días con faltante" valor={String(r.caja.faltantes)} tono={r.caja.faltantes > 0 ? 'negativo' : 'normal'} />
        <StatRow
          label="Descuadre acumulado"
          valor={r.caja.diferenciaAcumulada}
          tono={r.caja.diferenciaAcumulada === 0 ? 'positivo' : 'negativo'}
          negrita
        />
      </SectionCard>

      {/* ─── Descargas ───────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <button
          className="btn-primary"
          disabled={descargando !== null}
          onClick={() => descargarPDF(false)}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
        >
          {descargando === 'general'
            ? <><Loader2 size={17} style={{ animation: 'spin 1s linear infinite' }} /> Generando…</>
            : <><FileDown size={17} /> Descargar reporte general</>}
        </button>

        <button
          className="btn-secondary"
          disabled={descargando !== null}
          onClick={() => descargarPDF(true)}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
        >
          {descargando === 'detallado'
            ? <><Loader2 size={17} style={{ animation: 'spin 1s linear infinite' }} /> Generando…</>
            : <><FileDown size={17} /> Descargar detallado (día por día)</>}
        </button>

        <p style={{ margin: 0, fontSize: 11.5, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <CheckCircle2 size={13} />
          El general trae totales y el corte por mes; el detallado agrega una fila por cada día.
        </p>
      </div>
    </div>
  );
}

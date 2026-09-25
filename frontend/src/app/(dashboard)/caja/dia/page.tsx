'use client';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  Loader2, FileDown, Calculator, TrendingUp, TrendingDown, Receipt,
  HandCoins, ChevronLeft, ChevronRight, AlertTriangle, FileText, Users,
} from 'lucide-react';
import { apiClient } from '@/services/api';
import { formatCOP, fechaHoyISO, formatFechaCO } from '@/lib/utils';
import { StatCard, StatRow, SectionCard, Sep } from '@/components/shared/Stats';

interface Detalle {
  fechaKey: string;
  estado: 'sin_abrir' | 'abierto' | 'cerrado';
  baseInicial: number;
  saldoEsperado: number;
  saldoContado: number | null;
  diferencia: number;
  clientesQuePagaron: number;
  caja?: { observaciones?: string; cobrador?: { nombre: string } } | null;
  totales: {
    totalCobrado: number; cantidadCobros: number;
    totalPrestado: number; cantidadPrestamos: number; cargosCobrados: number;
    totalPapeleria: number; totalCartones: number;
    totalGastos: number; otrosIngresos: number; otrosEgresos: number;
  };
  cobros: Array<{
    _id: string; monto: number; tipo: string; hora?: string; fecha: string;
    saldoDespues: number;
    cliente?: { nombre: string }; prestamo?: { cuotaDiaria: number };
  }>;
  prestamos: Array<{
    _id: string; capital: number; papeleria: number; carton?: number;
    montoDesembolsado: number; cliente?: { nombre: string };
  }>;
  gastos: Array<{ _id: string; categoria: string; descripcion: string; monto: number }>;
  movimientos: Array<{
    _id: string; tipo: 'ingreso' | 'egreso'; concepto: string;
    monto: number; descripcion?: string;
  }>;
}

const ETIQUETAS_CONCEPTO: Record<string, string> = {
  inyeccion_capital: 'Inyección de capital',
  renovacion_carton: 'Renovación de cartón',
  abono_externo: 'Abono externo',
  otro_ingreso: 'Otro ingreso',
  retiro_utilidad: 'Retiro de utilidad',
  retiro_papeleria: 'Retiro de papelería',
  prestamo_externo: 'Préstamo por fuera del sistema',
  otro_egreso: 'Otro egreso',
  ajuste: 'Ajuste de caja',
};

/** Suma o resta días a una clave 'YYYY-MM-DD' sin líos de zona horaria. */
function moverDia(fechaKey: string, dias: number): string {
  const d = new Date(`${fechaKey}T12:00:00`);
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

function ReporteDia() {
  // Se puede llegar desde el historial con ?fecha=YYYY-MM-DD&cobradorId=...
  const params = useSearchParams();
  const cobradorId = params.get('cobradorId') ?? '';
  const sufijoCobrador = cobradorId ? `&cobradorId=${cobradorId}` : '';
  const [fecha, setFecha] = useState(params.get('fecha') ?? fechaHoyISO());
  const [descargando, setDescargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery<Detalle>({
    queryKey: ['caja-detalle', fecha, cobradorId],
    queryFn: () => apiClient.get(`/api/caja/detalle?fecha=${fecha}${sufijoCobrador}`).then((r) => r.data.data),
  });

  const descargar = async () => {
    setDescargando(true);
    setError(null);
    try {
      const res = await apiClient.get(`/api/caja/dia.pdf?fecha=${fecha}${sufijoCobrador}`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `cierre_${fecha}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch {
      setError('No se pudo generar el PDF. Revisa la conexión.');
    } finally {
      setDescargando(false);
    }
  };

  const esHoy = fecha === fechaHoyISO();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>Reporte del día</h1>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
          Todo lo que se movió, peso por peso
        </p>
      </div>

      {/* ─── Navegación por día ──────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          className="btn-icon"
          onClick={() => setFecha((f) => moverDia(f, -1))}
          aria-label="Día anterior"
        >
          <ChevronLeft size={18} />
        </button>
        <input
          type="date"
          className="input-field"
          value={fecha}
          max={fechaHoyISO()}
          onChange={(e) => setFecha(e.target.value)}
          style={{ textAlign: 'center', flex: 1 }}
        />
        <button
          className="btn-icon"
          disabled={esHoy}
          onClick={() => setFecha((f) => moverDia(f, 1))}
          aria-label="Día siguiente"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      {error && (
        <div className="card" style={{ padding: '10px 14px', borderLeft: '3px solid var(--danger-500)', display: 'flex', gap: 8 }}>
          <AlertTriangle size={16} color="var(--danger-500)" />
          <span style={{ fontSize: 13, color: 'var(--danger-600)' }}>{error}</span>
        </div>
      )}

      {isLoading || !data ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
          <Loader2 size={26} color="var(--brand-500)" style={{ animation: 'spin 1s linear infinite' }} />
        </div>
      ) : (
        <>
          <StatCard
            label={
              data.estado === 'cerrado' ? 'Cerró el día con'
              : data.estado === 'abierto' ? 'Lleva en caja'
              : 'Movimiento del día'
            }
            value={formatCOP(data.saldoContado ?? data.saldoEsperado)}
            sub={
              data.estado === 'cerrado'
                ? `Esperado ${formatCOP(data.saldoEsperado)} · Diferencia ${formatCOP(data.diferencia)}`
                : formatFechaCO(`${data.fechaKey}T12:00:00`)
            }
            gradient={
              data.estado === 'cerrado' && data.diferencia !== 0
                ? 'linear-gradient(135deg, #d97706, #f59e0b)'
                : 'linear-gradient(135deg, #059669, #0d9488)'
            }
            icon={Calculator}
          />

          {/* ─── El cuadre ─────────────────────────────────────── */}
          <SectionCard titulo="Cuadre de caja" icon={Calculator}>
            <StatRow label="Base con la que arrancó" valor={data.baseInicial} tono="muted" />
            <StatRow
              label="Cobros recibidos"
              sub={`${data.totales.cantidadCobros} cobros de ${data.clientesQuePagaron} clientes`}
              valor={data.totales.totalCobrado}
              tono="positivo"
            />
            {data.totales.cargosCobrados > 0 && (
              <StatRow
                label="Cargos de renovación cobrados"
                sub="Papelería y cartón pagados al renovar tarjeta"
                valor={data.totales.cargosCobrados}
                tono="positivo"
              />
            )}
            {data.totales.otrosIngresos > 0 && (
              <StatRow label="Otros ingresos" valor={data.totales.otrosIngresos} tono="positivo" />
            )}
            <StatRow
              label="Préstamos desembolsados"
              sub={`${data.totales.cantidadPrestamos} préstamos`}
              valor={-data.totales.totalPrestado}
              tono="negativo"
            />
            <StatRow label="Gastos" valor={-data.totales.totalGastos} tono="negativo" />
            {data.totales.otrosEgresos > 0 && (
              <StatRow label="Otros egresos y retiros" valor={-data.totales.otrosEgresos} tono="negativo" />
            )}
            <Sep />
            <StatRow label="Debía quedar" valor={data.saldoEsperado} negrita />
            {data.estado === 'cerrado' && (
              <>
                <StatRow label="Contó" valor={data.saldoContado ?? 0} negrita />
                <StatRow
                  label={data.diferencia === 0 ? 'Cuadró' : data.diferencia < 0 ? 'Faltante' : 'Sobrante'}
                  valor={data.diferencia}
                  tono={data.diferencia === 0 ? 'positivo' : 'negativo'}
                  negrita
                />
              </>
            )}
            {data.caja?.observaciones && (
              <p style={{ margin: '8px 0 0', fontSize: 12.5, color: 'var(--text-muted)' }}>
                {data.caja.observaciones}
              </p>
            )}
          </SectionCard>

          {/* ─── Cobros ────────────────────────────────────────── */}
          <SectionCard titulo={`Cobros (${data.cobros.length})`} icon={TrendingUp}>
            {data.cobros.length === 0 ? (
              <p style={{ margin: '6px 0', fontSize: 13, color: 'var(--text-muted)' }}>
                No entró nada este día.
              </p>
            ) : (
              <>
                {data.cobros.map((c) => {
                  const cuota = c.prestamo?.cuotaDiaria ?? 0;
                  const abono = cuota > 0 && c.monto < cuota;
                  return (
                    <div key={c._id} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '8px 0', borderBottom: '1px solid var(--border)',
                    }}>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', width: 36, flexShrink: 0 }}>
                        {(c.hora ?? '').slice(0, 5)}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{
                          margin: 0, fontSize: 13, fontWeight: 600,
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>
                          {c.cliente?.nombre ?? 'Cliente'}
                        </p>
                        {cuota > 0 && (
                          <p style={{ margin: 0, fontSize: 11, color: abono ? 'var(--warning-600)' : 'var(--text-muted)' }}>
                            {abono ? `Abonó · cuota ${formatCOP(cuota)}` : `Cuota completa`}
                          </p>
                        )}
                      </div>
                      <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--success-600)', whiteSpace: 'nowrap' }}>
                        {formatCOP(c.monto)}
                      </span>
                    </div>
                  );
                })}
                <Sep />
                <StatRow label="Total recogido" valor={data.totales.totalCobrado} negrita tono="positivo" />
              </>
            )}
          </SectionCard>

          {/* ─── Préstamos ─────────────────────────────────────── */}
          {data.prestamos.length > 0 && (
            <SectionCard titulo={`Préstamos entregados (${data.prestamos.length})`} icon={HandCoins}>
              {data.prestamos.map((p) => (
                <div key={p._id} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{p.cliente?.nombre ?? 'Cliente'}</span>
                    <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--danger-600)', whiteSpace: 'nowrap' }}>
                      −{formatCOP(p.montoDesembolsado)}
                    </span>
                  </div>
                  <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>
                    Capital {formatCOP(p.capital)} · papelería {formatCOP(p.papeleria)}
                    {(p.carton ?? 0) > 0 ? ` · cartón ${formatCOP(p.carton ?? 0)}` : ''}
                  </p>
                </div>
              ))}
              <Sep />
              <StatRow label="Salió en préstamos" valor={-data.totales.totalPrestado} negrita tono="negativo" />
            </SectionCard>
          )}

          {/* ─── Gastos ────────────────────────────────────────── */}
          {data.gastos.length > 0 && (
            <SectionCard titulo={`Gastos (${data.gastos.length})`} icon={Receipt}>
              {data.gastos.map((g) => (
                <StatRow key={g._id} label={g.descripcion} sub={g.categoria} valor={-g.monto} tono="negativo" />
              ))}
            </SectionCard>
          )}

          {/* ─── Movimientos manuales ──────────────────────────── */}
          {data.movimientos.length > 0 && (
            <SectionCard titulo={`Movimientos a mano (${data.movimientos.length})`} icon={TrendingDown}>
              {data.movimientos.map((m) => (
                <StatRow
                  key={m._id}
                  label={ETIQUETAS_CONCEPTO[m.concepto] ?? m.concepto}
                  sub={m.descripcion}
                  valor={m.tipo === 'ingreso' ? m.monto : -m.monto}
                  tono={m.tipo === 'ingreso' ? 'positivo' : 'negativo'}
                />
              ))}
            </SectionCard>
          )}

          {/* ─── Papelería del día ─────────────────────────────── */}
          {(data.totales.totalPapeleria > 0 || data.totales.totalCartones > 0) && (
            <SectionCard titulo="Papelería y cartones del día" icon={FileText}>
              <StatRow label="Papelería (del cobrador)" valor={data.totales.totalPapeleria} />
              <StatRow label="Renovación de cartones" valor={data.totales.totalCartones} />
              <Sep />
              <StatRow
                label="Total"
                valor={data.totales.totalPapeleria + data.totales.totalCartones}
                negrita
              />
            </SectionCard>
          )}

          {/* ─── Clientes atendidos ────────────────────────────── */}
          <SectionCard titulo="Resumen rápido" icon={Users}>
            <StatRow label="Clientes que pagaron" valor={String(data.clientesQuePagaron)} />
            <StatRow label="Cobros registrados" valor={String(data.totales.cantidadCobros)} />
            <StatRow label="Préstamos nuevos" valor={String(data.totales.cantidadPrestamos)} />
          </SectionCard>

          <button
            className="btn-primary"
            disabled={descargando}
            onClick={descargar}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
          >
            {descargando
              ? <><Loader2 size={17} style={{ animation: 'spin 1s linear infinite' }} /> Generando…</>
              : <><FileDown size={17} /> Descargar cierre en PDF</>}
          </button>
        </>
      )}
    </div>
  );
}

/** useSearchParams necesita un limite de Suspense en el App Router. */
export default function ReporteDiaPage() {
  return (
    <Suspense fallback={null}>
      <ReporteDia />
    </Suspense>
  );
}

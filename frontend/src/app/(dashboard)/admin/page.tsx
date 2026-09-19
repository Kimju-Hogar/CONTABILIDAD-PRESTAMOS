'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import {
  Loader2, TrendingUp, HandCoins, PiggyBank, Percent, Users, FileText,
  Wallet, AlertTriangle, ArrowRight, Settings, UserCog, Briefcase,
} from 'lucide-react';
import { apiClient } from '@/services/api';
import { formatCOP } from '@/lib/utils';
import { StatCard, StatRow, SectionCard, Sep, Segmented, Pill } from '@/components/shared/Stats';

type PeriodoId = 'hoy' | 'semana' | 'mes' | 'anio';

const PERIODOS: Array<{ id: PeriodoId; label: string }> = [
  { id: 'hoy', label: 'Hoy' },
  { id: 'semana', label: 'Semana' },
  { id: 'mes', label: 'Mes' },
  { id: 'anio', label: 'Año' },
];

// ─── Tipos de la respuesta del backend ────────────────────────
interface Resumen {
  periodo: { etiqueta: string; dias: number };
  colocacion: {
    capitalPrestado: number; desembolsadoEfectivo: number; interesPactado: number;
    papeleriaGenerada: number; cartonesGenerados: number; cantidad: number; ticketPromedio: number;
  };
  recaudo: {
    total: number; cantidad: number; interesDevengado: number;
    capitalRecuperado: number; promedioDiario: number;
  };
  ingresos: {
    interesDevengado: number; papeleria: number; cartones: number;
    otros: number; totalNegocio: number; total: number;
  };
  egresos: {
    gastos: number; otros: number; retiros: number; total: number;
    gastosPorCategoria: Array<{ categoria: string; total: number }>;
  };
  utilidad: {
    negocio: number; cobrador: number; total: number;
    margenSobreRecaudo: number; margenSobreColocado: number; rentabilidadCartera: number;
  };
  flujoEfectivo: { entradas: number; salidas: number; neto: number };
  cartera: {
    capitalEnCalle: number; saldoPendiente: number; totalPorCobrar: number;
    prestamosActivos: number; cuotasVencidas: number; montoVencido: number;
    prestamosEnMora: number; clientesMorosos: number; indiceMora: number;
  };
  cuentaPapeleria: {
    papeleria: { generada: number; retirada: number; disponible: number };
    cartones: { generados: number; retirados: number; disponibles: number };
    total: { generado: number; retirado: number; disponible: number };
  };
  caja: {
    cierres: number; diferenciaAcumulada: number; faltantes: number; sobrantes: number;
    hoyCerrada: boolean;
    ultimoCierre: {
      fechaKey: string; estado: string; saldoContado: number | null;
      saldoEsperado: number; diferencia: number; cobrador?: { nombre: string };
    } | null;
  };
}

interface PuntoSerie {
  fecha: string; cobrado: number; prestado: number; gastos: number; interes: number;
}

interface FilaCobrador {
  cobrador: { id: string; nombre: string; rol: string };
  recaudado: number; cobros: number; interesDevengado: number;
  prestado: number; prestamosNuevos: number;
  carteraActiva: number; prestamosActivos: number;
  montoVencido: number; indiceMora: number;
}

const ETIQUETAS_GASTO: Record<string, string> = {
  combustible: 'Combustible',
  reparaciones: 'Reparaciones',
  alimentacion: 'Alimentación',
  otro: 'Otros',
};

// ─── Tooltip de las gráficas ──────────────────────────────────
const TooltipCOP = ({ active, payload, label }: Record<string, unknown>) => {
  if (!active || !Array.isArray(payload) || !payload.length) return null;
  return (
    <div className="card" style={{ padding: '8px 12px', fontSize: 12 }}>
      <p style={{ margin: 0, fontWeight: 700 }}>{String(label)}</p>
      {(payload as Array<{ name: string; value: number; color: string }>).map((p) => (
        <p key={p.name} style={{ margin: '2px 0', color: p.color }}>
          {p.name}: {formatCOP(p.value)}
        </p>
      ))}
    </div>
  );
};

export default function AdminPage() {
  const [periodo, setPeriodo] = useState<PeriodoId>('mes');

  const { data: resumen, isLoading } = useQuery<Resumen>({
    queryKey: ['admin-resumen', periodo],
    queryFn: () => apiClient.get(`/api/admin/resumen?periodo=${periodo}`).then((r) => r.data.data),
  });

  const { data: serie } = useQuery<PuntoSerie[]>({
    queryKey: ['admin-series'],
    queryFn: () => apiClient.get('/api/admin/series?dias=30').then((r) => r.data.data),
  });

  const { data: aging } = useQuery<Array<{ rango: string; monto: number; cuotas: number }>>({
    queryKey: ['admin-aging'],
    queryFn: () => apiClient.get('/api/admin/aging').then((r) => r.data.data),
  });

  const { data: cobradores } = useQuery<FilaCobrador[]>({
    queryKey: ['admin-cobradores', periodo],
    queryFn: () => apiClient.get(`/api/admin/cobradores?periodo=${periodo}`).then((r) => r.data.data),
  });

  if (isLoading || !resumen) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
        <Loader2 size={28} color="var(--brand-500)" style={{ animation: 'spin 1s linear infinite' }} />
      </div>
    );
  }

  const grafica = (serie ?? []).map((p) => ({
    ...p,
    dia: p.fecha.slice(5).replace('-', '/'),
  }));

  const maxMora = Math.max(1, ...(aging ?? []).map((a) => a.monto));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ─── Encabezado ─────────────────────────────────────── */}
      <div>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>Panel del administrador</h1>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
          {resumen.periodo.etiqueta}
        </p>
      </div>

      <Segmented value={periodo} onChange={setPeriodo} options={PERIODOS} />

      {/* ─── Indicadores principales ────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <StatCard
          label="Se prestó"
          value={formatCOP(resumen.colocacion.capitalPrestado)}
          sub={`${resumen.colocacion.cantidad} préstamo${resumen.colocacion.cantidad === 1 ? '' : 's'}`}
          gradient="linear-gradient(135deg, #4f46e5, #7c3aed)"
          icon={HandCoins}
        />
        <StatCard
          label="Entró"
          value={formatCOP(resumen.recaudo.total)}
          sub={`${formatCOP(resumen.recaudo.promedioDiario)} / día`}
          gradient="linear-gradient(135deg, #059669, #0d9488)"
          icon={TrendingUp}
        />
        <StatCard
          label="Tu ganancia"
          value={formatCOP(resumen.utilidad.negocio)}
          sub={`Margen ${resumen.utilidad.margenSobreRecaudo}% del recaudo`}
          gradient="linear-gradient(135deg, #d97706, #f59e0b)"
          icon={PiggyBank}
        />
        <StatCard
          label="En la calle"
          value={formatCOP(resumen.cartera.saldoPendiente)}
          sub={`${resumen.cartera.prestamosActivos} préstamos activos`}
          gradient="linear-gradient(135deg, #0ea5e9, #6366f1)"
          icon={Briefcase}
        />
      </div>

      {/* ─── Gráfica de 30 días ─────────────────────────────── */}
      <SectionCard titulo="Últimos 30 días" icon={TrendingUp}>
        <div style={{ height: 190, marginTop: 6, marginLeft: -22 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={grafica}>
              <defs>
                <linearGradient id="gCobrado" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gPrestado" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="dia" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} interval={6} />
              <YAxis
                tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
                width={46}
              />
              <Tooltip content={<TooltipCOP />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area
                type="monotone" dataKey="cobrado" name="Recogido"
                stroke="#10b981" strokeWidth={2} fill="url(#gCobrado)"
              />
              <Area
                type="monotone" dataKey="prestado" name="Prestado"
                stroke="#6366f1" strokeWidth={2} fill="url(#gPrestado)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </SectionCard>

      {/* ─── De dónde sale la ganancia ──────────────────────── */}
      <SectionCard titulo="De dónde salió la ganancia" icon={Percent}>
        <StatRow
          label="Interés ganado"
          sub="Parte de intereses dentro de lo recogido"
          valor={resumen.ingresos.interesDevengado}
          tono="positivo"
        />
        <StatRow label="Renovación de cartones" valor={resumen.ingresos.cartones} tono="positivo" />
        {resumen.ingresos.otros > 0 && (
          <StatRow label="Otros ingresos" valor={resumen.ingresos.otros} tono="positivo" />
        )}
        {resumen.egresos.gastosPorCategoria.map((g) => (
          <StatRow
            key={g.categoria}
            label={ETIQUETAS_GASTO[g.categoria] ?? g.categoria}
            valor={-g.total}
            tono="negativo"
          />
        ))}
        {resumen.egresos.otros > 0 && (
          <StatRow label="Otros egresos" valor={-resumen.egresos.otros} tono="negativo" />
        )}
        <Sep />
        <StatRow label="Tu ganancia (negocio)" valor={resumen.utilidad.negocio} negrita tono="positivo" />
        <StatRow
          label="Ganancia del cobrador"
          sub="La papelería cobrada en los préstamos del periodo"
          valor={resumen.utilidad.cobrador}
          negrita
        />
        <Sep />
        <StatRow label="Total generado" valor={resumen.utilidad.total} negrita />
      </SectionCard>

      {/* ─── Márgenes ───────────────────────────────────────── */}
      <SectionCard titulo="Márgenes y rentabilidad" icon={Percent}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0' }}>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Margen sobre lo recogido</span>
          <Pill valor={resumen.utilidad.margenSobreRecaudo} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0' }}>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Margen sobre lo prestado</span>
          <Pill valor={resumen.utilidad.margenSobreColocado} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0' }}>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Rendimiento de la cartera</span>
          <Pill valor={resumen.utilidad.rentabilidadCartera} />
        </div>
        <Sep />
        <StatRow label="Ticket promedio por préstamo" valor={resumen.colocacion.ticketPromedio} />
        <StatRow label="Interés pactado en préstamos nuevos" valor={resumen.colocacion.interesPactado} />
      </SectionCard>

      {/* ─── Flujo de efectivo ──────────────────────────────── */}
      <SectionCard titulo="Flujo de efectivo" icon={Wallet}>
        <StatRow label="Entró a caja" valor={resumen.flujoEfectivo.entradas} tono="positivo" />
        <StatRow label="Salió de caja" valor={-resumen.flujoEfectivo.salidas} tono="negativo" />
        <Sep />
        <StatRow
          label="Neto del periodo"
          valor={resumen.flujoEfectivo.neto}
          negrita
          tono={resumen.flujoEfectivo.neto >= 0 ? 'positivo' : 'negativo'}
        />
        {resumen.egresos.retiros > 0 && (
          <StatRow label="Retiros del dueño incluidos" valor={resumen.egresos.retiros} tono="muted" />
        )}
      </SectionCard>

      {/* ─── Cuenta de papelería y cartones ─────────────────── */}
      <SectionCard titulo="Cuenta general de papelería y cartones" icon={FileText}>
        <StatRow label="Papelería generada" valor={resumen.cuentaPapeleria.papeleria.generada} />
        <StatRow label="Papelería ya retirada" valor={-resumen.cuentaPapeleria.papeleria.retirada} tono="muted" />
        <StatRow label="Cartones generados" valor={resumen.cuentaPapeleria.cartones.generados} />
        <StatRow label="Cartones ya retirados" valor={-resumen.cuentaPapeleria.cartones.retirados} tono="muted" />
        <Sep />
        <StatRow
          label="Disponible en la cuenta"
          valor={resumen.cuentaPapeleria.total.disponible}
          negrita
          tono="positivo"
        />
      </SectionCard>

      {/* ─── Cartera y mora ─────────────────────────────────── */}
      <SectionCard titulo="Cartera y mora" icon={AlertTriangle}>
        <StatRow label="Capital en la calle" valor={resumen.cartera.capitalEnCalle} />
        <StatRow label="Total por cobrar" valor={resumen.cartera.totalPorCobrar} />
        <StatRow label="Saldo pendiente" valor={resumen.cartera.saldoPendiente} negrita />
        <Sep />
        <StatRow label="Monto vencido" valor={resumen.cartera.montoVencido} tono="negativo" />
        <StatRow
          label="Préstamos en mora"
          valor={`${resumen.cartera.prestamosEnMora} de ${resumen.cartera.prestamosActivos}`}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0' }}>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Índice de mora</span>
          <Pill valor={resumen.cartera.indiceMora} tono="alerta" />
        </div>

        {(aging ?? []).length > 0 && (
          <>
            <Sep />
            <p style={{ margin: '4px 0 8px', fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>
              Antigüedad de lo vencido
            </p>
            {aging!.map((a) => (
              <div key={a.rango} style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span style={{ color: 'var(--text-secondary)' }}>{a.rango}</span>
                  <span style={{ fontWeight: 700 }}>{formatCOP(a.monto)}</span>
                </div>
                <div className="progress-bar" style={{ marginTop: 3 }}>
                  <div
                    className="progress-fill danger"
                    style={{ width: `${(a.monto / maxMora) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </>
        )}
      </SectionCard>

      {/* ─── Estado de caja ─────────────────────────────────── */}
      <SectionCard titulo="Cierres de caja" icon={Wallet}>
        <StatRow label="Cierres en el periodo" valor={String(resumen.caja.cierres)} />
        <StatRow label="Días con faltante" valor={String(resumen.caja.faltantes)} tono={resumen.caja.faltantes > 0 ? 'negativo' : 'normal'} />
        <StatRow label="Días con sobrante" valor={String(resumen.caja.sobrantes)} />
        <StatRow
          label="Descuadre acumulado"
          valor={resumen.caja.diferenciaAcumulada}
          tono={resumen.caja.diferenciaAcumulada === 0 ? 'positivo' : 'negativo'}
          negrita
        />
        {resumen.caja.ultimoCierre && (
          <>
            <Sep />
            <p style={{ margin: '4px 0', fontSize: 12.5, color: 'var(--text-secondary)' }}>
              Último cierre: <strong>{resumen.caja.ultimoCierre.fechaKey}</strong>
              {resumen.caja.ultimoCierre.cobrador ? ` · ${resumen.caja.ultimoCierre.cobrador.nombre}` : ''}
              {resumen.caja.ultimoCierre.estado === 'cerrado'
                ? ` · quedó con ${formatCOP(resumen.caja.ultimoCierre.saldoContado ?? 0)}`
                : ' · todavía abierto'}
            </p>
          </>
        )}
        <Link href="/caja/historial" style={{ textDecoration: 'none' }}>
          <div style={{
            marginTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '9px 0', borderTop: '1px solid var(--border)',
          }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--brand-text)' }}>
              Ver todos los cierres
            </span>
            <ArrowRight size={15} color="var(--text-muted)" />
          </div>
        </Link>
      </SectionCard>

      {/* ─── Rendimiento por cobrador ───────────────────────── */}
      {(cobradores ?? []).length > 0 && (
        <SectionCard titulo="Rendimiento por cobrador" icon={Users}>
          {cobradores!.map((c) => (
            <div key={c.cobrador.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                <p style={{ margin: 0, fontSize: 13.5, fontWeight: 700 }}>{c.cobrador.nombre}</p>
                <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--success-600)' }}>
                  {formatCOP(c.recaudado)}
                </span>
              </div>
              <p style={{ margin: '3px 0 0', fontSize: 11.5, color: 'var(--text-muted)' }}>
                {c.cobros} cobros · prestó {formatCOP(c.prestado)} en {c.prestamosNuevos} préstamos
              </p>
              <p style={{ margin: '2px 0 0', fontSize: 11.5, color: 'var(--text-muted)' }}>
                Cartera {formatCOP(c.carteraActiva)} · mora {c.indiceMora}%
              </p>
            </div>
          ))}
        </SectionCard>
      )}

      {/* ─── Accesos de administración ──────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {[
          { href: '/admin/reporte', icon: FileText, label: 'Reporte PDF' },
          { href: '/admin/usuarios', icon: UserCog, label: 'Usuarios' },
          { href: '/admin/configuracion', icon: Settings, label: 'Parámetros' },
          { href: '/clientes', icon: Users, label: 'Clientes' },
        ].map(({ href, icon: Icon, label }) => (
          <Link key={href} href={href} style={{ textDecoration: 'none' }}>
            <div className="card" style={{ padding: 14, textAlign: 'center' }}>
              <Icon size={20} color="var(--brand-500)" />
              <p style={{ margin: '6px 0 0', fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                {label}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

'use client';
import { formatCOP } from '@/lib/utils';

/** Tarjeta de indicador con fondo degradado, para las cifras principales. */
export function StatCard({
  label, value, sub, gradient, icon: Icon, onClick,
}: {
  label: string;
  value: string;
  sub?: string;
  gradient: string;
  icon?: React.ElementType;
  onClick?: () => void;
}) {
  return (
    <div
      className="animate-fade-in"
      onClick={onClick}
      style={{
        background: gradient,
        borderRadius: 'var(--radius-lg)',
        padding: '14px 16px',
        color: 'white',
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <p style={{
            margin: 0, fontSize: 10.5, fontWeight: 700, opacity: 0.85,
            textTransform: 'uppercase', letterSpacing: '0.05em',
          }}>
            {label}
          </p>
          <p style={{ margin: '6px 0 0', fontSize: 20, fontWeight: 800, lineHeight: 1.1 }}>{value}</p>
          {sub && <p style={{ margin: '3px 0 0', fontSize: 11.5, opacity: 0.8 }}>{sub}</p>}
        </div>
        {Icon && (
          <div style={{ background: 'rgb(255 255 255 / 0.2)', borderRadius: 10, padding: 7, flexShrink: 0 }}>
            <Icon size={18} />
          </div>
        )}
      </div>
    </div>
  );
}

/** Fila etiqueta / valor dentro de una tarjeta. */
export function StatRow({
  label, valor, tono = 'normal', negrita = false, sub,
}: {
  label: string;
  valor: number | string;
  tono?: 'normal' | 'positivo' | 'negativo' | 'muted';
  negrita?: boolean;
  sub?: string;
}) {
  const color =
    tono === 'positivo' ? 'var(--success-600)'
    : tono === 'negativo' ? 'var(--danger-600)'
    : tono === 'muted' ? 'var(--text-muted)'
    : 'var(--text-primary)';

  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      gap: 12, padding: '7px 0',
    }}>
      <div style={{ minWidth: 0 }}>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{label}</span>
        {sub && (
          <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)' }}>{sub}</span>
        )}
      </div>
      <span style={{
        fontSize: negrita ? 15.5 : 14,
        fontWeight: negrita ? 800 : 600,
        color,
        whiteSpace: 'nowrap',
      }}>
        {/* `valor === 0` también atrapa el -0 que deja negar un total vacío */}
        {typeof valor === 'number' ? formatCOP(valor === 0 ? 0 : valor) : valor}
      </span>
    </div>
  );
}

/** Contenedor con título para agrupar filas de datos. */
export function SectionCard({
  titulo, icon: Icon, accion, children,
}: {
  titulo: string;
  icon?: React.ElementType;
  accion?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="card" style={{ padding: '14px 16px' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 8, marginBottom: 6,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          {Icon && <Icon size={16} color="var(--brand-500)" />}
          <h2 style={{ margin: 0, fontSize: 14, fontWeight: 800 }}>{titulo}</h2>
        </div>
        {accion}
      </div>
      {children}
    </div>
  );
}

/** Línea divisoria fina entre grupos de filas. */
export function Sep() {
  return <div style={{ height: 1, background: 'var(--border)', margin: '6px 0' }} />;
}

/** Selector horizontal de opciones (periodos, vistas, etc.). */
export function Segmented<T extends string>({
  value, onChange, options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ id: T; label: string }>;
}) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(${options.length}, 1fr)`,
      borderRadius: 'var(--radius-md)',
      overflow: 'hidden',
      border: '1.5px solid var(--border)',
    }}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          style={{
            padding: '9px 4px',
            border: 'none',
            background: value === o.id ? 'var(--brand-500)' : 'var(--bg-card)',
            color: value === o.id ? 'white' : 'var(--text-secondary)',
            fontWeight: 700,
            fontSize: 12.5,
            cursor: 'pointer',
            transition: 'all var(--transition)',
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Píldora de porcentaje. Por defecto el color sale del signo; con tono
 * "alerta" se pinta en rojo sin anteponer el menos, para métricas donde un
 * número alto ya es la mala noticia (la mora, por ejemplo).
 */
export function Pill({
  valor, sufijo = '%', tono = 'auto',
}: {
  valor: number;
  sufijo?: string;
  tono?: 'auto' | 'alerta';
}) {
  const alerta = tono === 'alerta';
  const positivo = valor >= 0;
  const bueno = !alerta && positivo;

  return (
    <span style={{
      fontSize: 11.5, fontWeight: 700, padding: '2px 8px', borderRadius: 12,
      background: bueno ? 'rgb(16 185 129 / 0.15)' : 'rgb(239 68 68 / 0.15)',
      color: bueno ? 'var(--success-600)' : 'var(--danger-600)',
    }}>
      {bueno || alerta ? '' : '−'}
      {Math.abs(valor).toLocaleString('es-CO', { maximumFractionDigits: 2 })}{sufijo}
    </span>
  );
}

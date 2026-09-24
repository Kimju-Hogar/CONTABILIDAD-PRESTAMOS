'use client';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import Link from 'next/link';
import {
  Plus, Search, ChevronRight, Phone, User, Loader2, AlertTriangle,
  CheckCircle2, Clock, CircleCheck, List,
} from 'lucide-react';
import { apiClient } from '@/services/api';
import { useDebounce } from '@/hooks/useDebounce';
import { formatCOP } from '@/lib/utils';

// ─── Tipos ────────────────────────────────────────────────────
interface FilaActivo {
  prestamoId: string;
  clienteId: string;
  nombre: string;
  celular?: string;
  barrio?: string;
  cuota: number;
  saldoPendiente: number;
  pagadoHoy: boolean;
  montoCobradoHoy: number;
  atraso: number;
  diasSinPagar: number;
}

interface FilaTerminado {
  clienteId: string;
  nombre: string;
  celular?: string;
  barrio?: string;
  prestamosPagados: number;
  totalPagado: number;
}

interface Grupo<T> { cantidad: number; monto: number; clientes: T[] }

interface Tablero {
  pagaronHoy: Grupo<FilaActivo>;
  enMora: Grupo<FilaActivo>;
  debenHoy: Grupo<FilaActivo>;
  alDia: Grupo<FilaActivo>;
  terminados: Grupo<FilaTerminado>;
  totales: { conPrestamoActivo: number; clientesActivos: number };
}

type GrupoId = 'debenHoy' | 'enMora' | 'pagaronHoy' | 'alDia' | 'terminados' | 'todos';

const GRUPOS: Array<{
  id: GrupoId; label: string; icono: React.ElementType; color: string; etiquetaMonto: string;
}> = [
  { id: 'debenHoy',   label: 'Deben hoy',  icono: Clock,       color: '#4f46e5', etiquetaMonto: 'Suma de cuotas' },
  { id: 'enMora',     label: 'En mora',    icono: AlertTriangle, color: '#ef4444', etiquetaMonto: 'Atraso total' },
  { id: 'pagaronHoy', label: 'Pagaron',    icono: CheckCircle2, color: '#10b981', etiquetaMonto: 'Recogido hoy' },
  { id: 'alDia',      label: 'Al día',     icono: CircleCheck,  color: '#0ea5e9', etiquetaMonto: 'Saldo en calle' },
  { id: 'terminados', label: 'Terminaron', icono: User,         color: '#64748b', etiquetaMonto: 'Ya pagaron' },
  { id: 'todos',      label: 'Todos',      icono: List,         color: '#64748b', etiquetaMonto: '' },
];

// ─── Tarjeta de un cliente con préstamo vivo ──────────────────
function TarjetaActivo({ c, grupo }: { c: FilaActivo; grupo: GrupoId }) {
  const detalle =
    grupo === 'pagaronHoy' ? { texto: `Pagó ${formatCOP(c.montoCobradoHoy)}`, color: '#10b981' }
    : grupo === 'enMora'   ? { texto: `${c.diasSinPagar} días sin pagar · debe ${formatCOP(c.atraso)}`, color: '#ef4444' }
    : grupo === 'debenHoy' ? { texto: `Cuota de ${formatCOP(c.cuota)}`, color: 'var(--text-secondary)' }
    : { texto: `Saldo ${formatCOP(c.saldoPendiente)}`, color: 'var(--text-secondary)' };

  return (
    <Link href={`/prestamos/${c.prestamoId}`} style={{ textDecoration: 'none' }}>
      <div className="card" style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{
            margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--text-primary)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {c.nombre}
          </p>
          <p style={{ margin: '2px 0 0', fontSize: 11.5, color: detalle.color, fontWeight: 600 }}>
            {detalle.texto}
          </p>
          {c.barrio && (
            <p style={{ margin: 0, fontSize: 11, color: 'var(--text-muted)' }}>{c.barrio}</p>
          )}
        </div>
        {c.celular && (
          <a
            href={`tel:${c.celular}`}
            className="btn-icon"
            onClick={(e) => e.stopPropagation()}
            aria-label={`Llamar a ${c.nombre}`}
          >
            <Phone size={16} color="var(--brand-500)" />
          </a>
        )}
        <ChevronRight size={16} color="var(--text-muted)" />
      </div>
    </Link>
  );
}

function TarjetaTerminado({ c }: { c: FilaTerminado }) {
  return (
    <Link href={`/clientes/${c.clienteId}`} style={{ textDecoration: 'none' }}>
      <div className="card" style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <CheckCircle2 size={17} color="var(--success-500)" style={{ flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{
            margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--text-primary)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {c.nombre}
          </p>
          <p style={{ margin: '2px 0 0', fontSize: 11.5, color: 'var(--text-muted)' }}>
            {c.prestamosPagados} préstamo{c.prestamosPagados === 1 ? '' : 's'} pagado
            {c.prestamosPagados === 1 ? '' : 's'} · {formatCOP(c.totalPagado)}
          </p>
        </div>
        <ChevronRight size={16} color="var(--text-muted)" />
      </div>
    </Link>
  );
}

// ─── Página ───────────────────────────────────────────────────
export default function ClientesPage() {
  const [grupo, setGrupo] = useState<GrupoId>('debenHoy');
  const [busqueda, setBusqueda] = useState('');
  const debounced = useDebounce(busqueda, 400);

  const { data: tablero, isLoading } = useQuery<Tablero>({
    queryKey: ['tablero-clientes'],
    queryFn: () => apiClient.get('/api/dashboard/tablero-clientes').then((r) => r.data.data),
    refetchInterval: 60_000,
  });

  // El listado completo sólo se pide cuando se necesita
  const { data: todos } = useQuery({
    queryKey: ['clientes', debounced],
    queryFn: () => apiClient
      .get('/api/clientes', { params: { busqueda: debounced || undefined, limit: 100 } })
      .then((r) => r.data),
    enabled: grupo === 'todos' || debounced.length > 0,
    staleTime: 30_000,
  });

  const buscando = debounced.length > 0;
  const grupoActual = GRUPOS.find((g) => g.id === grupo)!;

  const contarGrupo = (id: GrupoId): number => {
    if (!tablero) return 0;
    if (id === 'todos') return tablero.totales.clientesActivos;
    return tablero[id].cantidad;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* ─── Encabezado ─────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>Clientes</h1>
          <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
            {tablero ? `${tablero.totales.clientesActivos} con préstamo activo` : 'Cargando…'}
          </p>
        </div>
        <Link href="/clientes/nuevo">
          <button className="btn-primary" style={{ width: 'auto', padding: '10px 16px' }} aria-label="Nuevo cliente">
            <Plus size={18} />
          </button>
        </Link>
      </div>

      {/* ─── Buscador ───────────────────────────────────────── */}
      <div style={{ position: 'relative' }}>
        <Search
          size={17}
          color="var(--text-muted)"
          style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)' }}
        />
        <input
          className="input-field"
          style={{ paddingLeft: 42 }}
          placeholder="Buscar por nombre o cédula"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />
      </div>

      {/* ─── Grupos ─────────────────────────────────────────── */}
      {!buscando && (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8,
        }}>
          {GRUPOS.map((g) => {
            const activo = grupo === g.id;
            const Icono = g.icono;
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => setGrupo(g.id)}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
                  padding: '10px 4px',
                  borderRadius: 'var(--radius-md)',
                  border: `1.5px solid ${activo ? g.color : 'var(--border)'}`,
                  background: activo ? `${g.color}1a` : 'var(--bg-card)',
                  cursor: 'pointer', minWidth: 0,
                }}
              >
                <Icono size={16} color={activo ? g.color : 'var(--text-muted)'} />
                <span style={{
                  fontSize: 17, fontWeight: 800,
                  color: activo ? g.color : 'var(--text-primary)', lineHeight: 1,
                }}>
                  {contarGrupo(g.id)}
                </span>
                <span style={{
                  fontSize: 10, fontWeight: 600, color: 'var(--text-muted)',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%',
                }}>
                  {g.label}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* ─── Total en plata del grupo ───────────────────────── */}
      {!buscando && tablero && grupo !== 'todos' && grupoActual.etiquetaMonto && (
        <div className="card" style={{
          padding: '11px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          borderLeft: `3px solid ${grupoActual.color}`,
        }}>
          <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
            {grupoActual.etiquetaMonto}
          </span>
          <span style={{ fontSize: 16, fontWeight: 800, color: grupoActual.color }}>
            {formatCOP(tablero[grupo].monto)}
          </span>
        </div>
      )}

      {/* ─── Listado ────────────────────────────────────────── */}
      {isLoading && !tablero ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
          <Loader2 size={26} color="var(--brand-500)" style={{ animation: 'spin 1s linear infinite' }} />
        </div>
      ) : buscando || grupo === 'todos' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {((todos?.data ?? []) as Array<{ _id: string; nombre: string; cedula: string; celular?: string; estado: string }>)
            .map((c) => (
              <Link key={c._id} href={`/clientes/${c._id}`} style={{ textDecoration: 'none' }}>
                <div className="card" style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{
                      margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--text-primary)',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {c.nombre}
                    </p>
                    <p style={{ margin: '2px 0 0', fontSize: 11.5, color: 'var(--text-muted)' }}>
                      CC {c.cedula}
                    </p>
                  </div>
                  <ChevronRight size={16} color="var(--text-muted)" />
                </div>
              </Link>
            ))}
          {(todos?.data ?? []).length === 0 && (
            <div className="empty-state">
              <User size={28} color="var(--text-muted)" />
              <p style={{ marginTop: 8, fontSize: 13.5 }}>Ningún cliente con esa búsqueda.</p>
            </div>
          )}
        </div>
      ) : grupo === 'terminados' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {tablero!.terminados.clientes.map((c) => <TarjetaTerminado key={c.clienteId} c={c} />)}
          {tablero!.terminados.cantidad === 0 && (
            <div className="empty-state">
              <User size={28} color="var(--text-muted)" />
              <p style={{ marginTop: 8, fontSize: 13.5 }}>Todavía nadie ha terminado de pagar.</p>
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {tablero![grupo as 'debenHoy' | 'enMora' | 'pagaronHoy' | 'alDia'].clientes.map((c) => (
            <TarjetaActivo key={c.prestamoId} c={c} grupo={grupo} />
          ))}
          {tablero![grupo as 'debenHoy' | 'enMora' | 'pagaronHoy' | 'alDia'].cantidad === 0 && (
            <div className="empty-state">
              <CheckCircle2 size={28} color="var(--success-500)" />
              <p style={{ marginTop: 8, fontSize: 13.5 }}>
                {grupo === 'enMora' ? 'Nadie está en mora. Bien ahí.'
                  : grupo === 'debenHoy' ? 'Nadie tiene cuota pendiente hoy.'
                  : grupo === 'pagaronHoy' ? 'Todavía no ha pagado nadie hoy.'
                  : 'Sin clientes en este grupo.'}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

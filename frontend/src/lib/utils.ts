// ─── Tipos y constantes ───────────────────────────────────────
export type Modalidad = 'diaria' | 'semanal' | 'quincenal' | 'mensual';

export const INTERES_FIJO = 20;
export const CUOTAS_DIARIAS = 115;
export const CUOTAS_SEMANALES = 4;
export const CUOTAS_QUINCENALES = 2;
export const CUOTAS_MENSUALES = 1;
export const PAPELERIA_POR_CIEN_MIL = 5_000;

export const DEFAULT_CUOTAS: Record<Modalidad, number> = {
  diaria:    CUOTAS_DIARIAS,
  semanal:   CUOTAS_SEMANALES,
  quincenal: CUOTAS_QUINCENALES,
  mensual:   CUOTAS_MENSUALES,
};

export const LABEL_CUOTA: Record<Modalidad, string> = {
  diaria:    'cuotas diarias',
  semanal:   'cuotas semanales',
  quincenal: 'cuotas quincenales (c/15 días)',
  mensual:   'cuotas mensuales',
};

export function calcularPapeleria(capital: number): number {
  const calculada = Math.floor(capital / 100_000) * PAPELERIA_POR_CIEN_MIL;
  return Math.max(5000, calculada);
}

export function calcularPrestamo(
  capital: number,
  modalidad: Modalidad,
  plazoPersonalizado?: number,
  interes: number = INTERES_FIJO
) {
  const numeroCuotas = plazoPersonalizado ?? DEFAULT_CUOTAS[modalidad];
  const totalInteres = Math.round(capital * interes / 100);
  const totalPagar = capital + totalInteres;
  const cuotaBase = totalPagar / numeroCuotas;
  const cuotaMonto = Math.ceil(cuotaBase / 100) * 100;
  const papeleria = calcularPapeleria(capital);
  const montoDesembolsado = capital - papeleria;

  return {
    numeroCuotas,
    totalInteres,
    totalPagar,
    cuotaMonto,
    papeleria,
    montoDesembolsado,
    descripcion: `${numeroCuotas} ${LABEL_CUOTA[modalidad]} de ${formatCOP(cuotaMonto)}`,
  };
}

// ─── Formateo ─────────────────────────────────────────────────
export function formatCOP(value: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatFechaCO(date: Date | string): string {
  return new Intl.DateTimeFormat('es-CO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'America/Bogota',
  }).format(new Date(date));
}

export function formatFechaHoraCO(date: Date | string): string {
  return new Intl.DateTimeFormat('es-CO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Bogota',
  }).format(new Date(date));
}

export function horaActualCO(): string {
  return new Intl.DateTimeFormat('es-CO', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'America/Bogota',
  }).format(new Date());
}

export function fechaHoyISO(): string {
  const now = new Date();
  const bogota = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(now);
  return bogota; // YYYY-MM-DD
}

export function porcentajeProgreso(totalCobrado: number, totalPagar: number): number {
  if (totalPagar === 0) return 0;
  return Math.min(100, Math.round((totalCobrado / totalPagar) * 100));
}

export function clsx(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ');
}

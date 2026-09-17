import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import {
  startOfDay, endOfDay, startOfWeek, endOfWeek,
  startOfMonth, endOfMonth, startOfYear, endOfYear,
  subDays, addDays, format,
} from 'date-fns';

export const TZ = 'America/Bogota';

export type Periodo = 'hoy' | 'ayer' | 'semana' | 'mes' | 'anio' | 'rango';

export interface Rango {
  inicio: Date;
  fin: Date;
}

/** Ahora mismo, expresado en hora de Bogotá (para hacer cálculos de calendario). */
export function ahoraCO(): Date {
  return toZonedTime(new Date(), TZ);
}

/** Clave de día 'YYYY-MM-DD' según el calendario de Bogotá. */
export function keyDia(fecha: Date = new Date()): string {
  return format(toZonedTime(fecha, TZ), 'yyyy-MM-dd');
}

/** Convierte una clave 'YYYY-MM-DD' al instante UTC de su medianoche en Bogotá. */
export function inicioDeKey(fechaKey: string): Date {
  return fromZonedTime(`${fechaKey}T00:00:00`, TZ);
}

/** Rango UTC [00:00, 23:59:59.999] del día de Bogotá al que pertenece `fecha`. */
export function rangoDia(fecha: Date = new Date()): Rango {
  const zonada = toZonedTime(fecha, TZ);
  return {
    inicio: fromZonedTime(startOfDay(zonada), TZ),
    fin: fromZonedTime(endOfDay(zonada), TZ),
  };
}

/** Rango UTC del día identificado por su clave 'YYYY-MM-DD'. */
export function rangoDeKey(fechaKey: string): Rango {
  return {
    inicio: fromZonedTime(`${fechaKey}T00:00:00.000`, TZ),
    fin: fromZonedTime(`${fechaKey}T23:59:59.999`, TZ),
  };
}

/** Clave del día anterior. */
export function keyDiaAnterior(fechaKey: string): string {
  return format(subDays(new Date(`${fechaKey}T12:00:00`), 1), 'yyyy-MM-dd');
}

/** Clave del día siguiente. */
export function keyDiaSiguiente(fechaKey: string): string {
  return format(addDays(new Date(`${fechaKey}T12:00:00`), 1), 'yyyy-MM-dd');
}

/**
 * Resuelve un periodo de negocio a un rango UTC.
 * La semana arranca en lunes; 'rango' exige `desde`/`hasta` en formato 'YYYY-MM-DD'.
 */
export function rangoPeriodo(periodo: Periodo, desde?: string, hasta?: string): Rango {
  const hoy = ahoraCO();

  switch (periodo) {
    case 'hoy':
      return rangoDia();
    case 'ayer':
      return rangoDia(subDays(new Date(), 1));
    case 'semana':
      return {
        inicio: fromZonedTime(startOfWeek(hoy, { weekStartsOn: 1 }), TZ),
        fin: fromZonedTime(endOfWeek(hoy, { weekStartsOn: 1 }), TZ),
      };
    case 'mes':
      return {
        inicio: fromZonedTime(startOfMonth(hoy), TZ),
        fin: fromZonedTime(endOfMonth(hoy), TZ),
      };
    case 'anio':
      return {
        inicio: fromZonedTime(startOfYear(hoy), TZ),
        fin: fromZonedTime(endOfYear(hoy), TZ),
      };
    case 'rango': {
      const ini = desde ? `${desde}T00:00:00.000` : format(startOfMonth(hoy), "yyyy-MM-dd'T'00:00:00.000");
      const fin = hasta ? `${hasta}T23:59:59.999` : format(hoy, "yyyy-MM-dd'T'23:59:59.999");
      return { inicio: fromZonedTime(ini, TZ), fin: fromZonedTime(fin, TZ) };
    }
  }
}

/** Etiqueta legible del periodo, para encabezados de reportes. */
export function etiquetaPeriodo(periodo: Periodo, rango: Rango): string {
  const f = (d: Date) => format(toZonedTime(d, TZ), 'dd/MM/yyyy');
  switch (periodo) {
    case 'hoy':    return `Hoy ${f(rango.inicio)}`;
    case 'ayer':   return `Ayer ${f(rango.inicio)}`;
    case 'semana': return `Semana del ${f(rango.inicio)} al ${f(rango.fin)}`;
    case 'mes':    return `Mes del ${f(rango.inicio)} al ${f(rango.fin)}`;
    case 'anio':   return `Año ${format(toZonedTime(rango.inicio, TZ), 'yyyy')}`;
    case 'rango':  return `Del ${f(rango.inicio)} al ${f(rango.fin)}`;
  }
}

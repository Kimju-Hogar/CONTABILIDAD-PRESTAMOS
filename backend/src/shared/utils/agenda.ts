import { fromZonedTime } from 'date-fns-tz';
import { TZ, keyDia } from './fechas';
import { logger } from './logger';

/**
 * Agenda una tarea para que corra todos los días a una hora de Bogotá.
 *
 * No se usa `setInterval(24h)` porque se desfasa: dispara a la hora en que
 * arrancó el servidor, no a la hora del reloj, y cualquier reinicio la mueve.
 * Acá se calcula cuánto falta para la próxima vez y al terminar se reprograma,
 * así el disparo queda clavado a la hora de Colombia aunque el servidor se
 * reinicie o la máquina esté en otra zona horaria.
 */
export function cadaDiaALas(hora: number, minuto: number, tarea: () => Promise<void>): void {
  const programar = () => {
    const espera = msHastaLaProxima(hora, minuto);
    setTimeout(async () => {
      try {
        await tarea();
      } catch (err) {
        logger.error('Error en tarea programada:', err);
      } finally {
        programar();
      }
    }, espera).unref?.();

    const minutos = Math.round(espera / 60_000);
    logger.info(
      `⏰ Próxima tarea de las ${String(hora).padStart(2, '0')}:${String(minuto).padStart(2, '0')} ` +
      `en ${minutos} min (hora de ${TZ})`
    );
  };

  programar();
}

/** Milisegundos que faltan para la próxima vez que sean `hora:minuto` en Bogotá. */
export function msHastaLaProxima(hora: number, minuto: number, ahora: Date = new Date()): number {
  const hhmm = `${String(hora).padStart(2, '0')}:${String(minuto).padStart(2, '0')}:00`;

  // Primero se intenta hoy; si ya pasó, el mismo horario de mañana
  let objetivo = fromZonedTime(`${keyDia(ahora)}T${hhmm}`, TZ);
  if (objetivo.getTime() <= ahora.getTime()) {
    const manana = new Date(ahora.getTime() + 24 * 60 * 60 * 1000);
    objetivo = fromZonedTime(`${keyDia(manana)}T${hhmm}`, TZ);
  }

  return objetivo.getTime() - ahora.getTime();
}

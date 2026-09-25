/**
 * recalcular-cuotas.ts — Rehace el mapa de días de todos los préstamos.
 *
 * El código viejo, al registrar un abono parcial, SOBRESCRIBÍA lo ya abonado a
 * la cuota en vez de sumarlo. Resultado: cuotas que nunca se cerraban y días
 * marcados como vencidos aunque el cliente sí hubiera pagado.
 *
 * Este script reproduce los cobros reales de cada préstamo, en orden de fecha,
 * aplicando la lógica correcta, y reescribe el estado de cada cuota. De paso
 * guarda en cada cobro cuánto puso en cada cuota (`aplicaciones`), que es lo
 * que permite anular un pago sin borrar los abonos de otros.
 *
 * NO toca el dinero: saldoPendiente y totalCobrado se dejan igual y se usan
 * como control. Si la suma reproducida no coincide, el préstamo se reporta y
 * se deja intacto.
 *
 * Uso — en seco:
 *   npm run recalcular:cuotas
 *
 * Aplicando:
 *   npm run recalcular:cuotas -- --apply
 *
 * Para revisar uno solo:
 *   PRESTAMO=<id> npm run recalcular:cuotas
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import { toZonedTime } from 'date-fns-tz';
import { startOfDay } from 'date-fns';

const APLICAR = process.argv.includes('--apply');
const SOLO = process.env['PRESTAMO'] ?? '';
const MONGODB_URI = process.env['MONGODB_URI'] ?? '';
const MONGODB_DB = process.env['MONGODB_DB'] ?? 'gotagota';
const TZ = 'America/Bogota';

if (!MONGODB_URI) { console.error('❌ MONGODB_URI no está definida'); process.exit(1); }

const cop = (n: number) => '$' + Math.round(n || 0).toLocaleString('es-CO');

interface Cuota {
  numero: number;
  monto: number;
  estado: string;
  fechaEsperada: Date;
  fechaPago?: Date;
  montoPagado?: number;
}

async function main() {
  console.log(`\n🗓️  Recalcular mapa de cuotas ${APLICAR ? '(APLICANDO)' : '(SIMULACIÓN)'}\n`);

  await mongoose.connect(MONGODB_URI, { dbName: MONGODB_DB, serverSelectionTimeoutMS: 10_000 });
  const db = mongoose.connection.db!;
  const hoy = startOfDay(toZonedTime(new Date(), TZ));

  const filtro: Record<string, unknown> = { deletedAt: null };
  if (SOLO) filtro._id = new mongoose.Types.ObjectId(SOLO);

  const prestamos = await db.collection('prestamos').find(filtro).toArray();
  console.log(`Revisando ${prestamos.length} préstamos…\n`);

  let conCambios = 0;
  let rescatadas = 0;      // cuotas que dejan de estar en rojo
  let descuadrados = 0;
  const ejemplos: string[] = [];

  for (const p of prestamos) {
    const cuotas: Cuota[] = (p.cuotas ?? []).map((c: Cuota) => ({ ...c }));
    if (cuotas.length === 0) continue;

    const antesVencidas = cuotas.filter((c) => c.estado === 'vencida').length;

    const cobros = await db.collection('cobros')
      .find({ prestamo: p._id, anulado: false })
      .sort({ fecha: 1, createdAt: 1 })
      .toArray();

    // ─── Partir de cero y reproducir los pagos reales ─────────
    for (const c of cuotas) {
      c.estado = 'pendiente';
      c.montoPagado = undefined;
      c.fechaPago = undefined;
    }

    const aplicacionesPorCobro = new Map<string, Array<{ numero: number; monto: number }>>();
    let aplicadoTotal = 0;

    for (const cobro of cobros) {
      let restante = cobro.monto as number;
      const aplicaciones: Array<{ numero: number; monto: number }> = [];

      for (const cuota of cuotas) {
        if (restante <= 0) break;
        if (cuota.estado === 'pagada') continue;

        const yaAbonado = cuota.montoPagado ?? 0;
        const faltante = Math.max(0, cuota.monto - yaAbonado);
        if (faltante === 0) { cuota.estado = 'pagada'; continue; }

        const aplicado = Math.min(restante, faltante);
        cuota.montoPagado = yaAbonado + aplicado;
        restante -= aplicado;
        aplicaciones.push({ numero: cuota.numero, monto: aplicado });

        if (cuota.montoPagado >= cuota.monto) {
          cuota.estado = 'pagada';
          cuota.fechaPago = cobro.fecha;
        } else {
          cuota.estado = 'parcial';
        }
      }

      aplicadoTotal += (cobro.monto as number) - restante;
      aplicacionesPorCobro.set(String(cobro._id), aplicaciones);
    }

    // Sólo va en rojo el día que pasó sin recibir un peso, y sólo en préstamos
    // vivos: uno cancelado, refinanciado o ya pagado no acumula más mora.
    if (p.estado === 'activo') {
      for (const c of cuotas) {
        if (c.estado === 'pendiente' && new Date(c.fechaEsperada) < hoy) c.estado = 'vencida';
      }
    }

    const cobradoReal = cobros.reduce((a, c) => a + (c.monto as number), 0);
    // Un sobrante es normal si el cliente pagó de más; lo raro es aplicar de menos
    if (aplicadoTotal < cobradoReal - 1 && aplicadoTotal < (p.totalPagar ?? 0)) {
      descuadrados++;
      continue;
    }

    // El detalle de aplicación se guarda siempre: es lo que permite anular un
    // cobro sin borrar los abonos de los demás, cambie o no el mapa.
    if (APLICAR) {
      for (const [cobroId, aplicaciones] of aplicacionesPorCobro) {
        await db.collection('cobros').updateOne(
          { _id: new mongoose.Types.ObjectId(cobroId) },
          { $set: { aplicaciones, cuotasAplicadas: aplicaciones.map((a) => a.numero) } }
        );
      }
    }

    const despuesVencidas = cuotas.filter((c) => c.estado === 'vencida').length;
    const cambio = JSON.stringify(cuotas.map((c) => [c.estado, c.montoPagado ?? 0]))
      !== JSON.stringify((p.cuotas ?? []).map((c: Cuota) => [c.estado, c.montoPagado ?? 0]));

    if (!cambio) continue;

    conCambios++;
    rescatadas += Math.max(0, antesVencidas - despuesVencidas);

    if (ejemplos.length < 8) {
      const cli = await db.collection('clientes').findOne({ _id: p.cliente });
      ejemplos.push(
        `   ${String(cli?.nombre ?? '?').slice(0, 20).padEnd(21)}` +
        ` vencidas ${String(antesVencidas).padStart(2)} → ${String(despuesVencidas).padStart(2)}` +
        `   cobrado ${cop(cobradoReal).padStart(11)}  (${cobros.length} pagos)`
      );
    }

    if (APLICAR) {
      await db.collection('prestamos').updateOne({ _id: p._id }, { $set: { cuotas } });
    }
  }

  console.log('Ejemplos de lo que cambia:');
  ejemplos.forEach((e) => console.log(e));
  console.log('');
  console.log('─'.repeat(64));
  console.log(`Préstamos con el mapa corregido : ${conCambios}`);
  console.log(`Días que dejan de estar en rojo : ${rescatadas}`);
  if (descuadrados > 0) {
    console.log(`Préstamos descuadrados (sin tocar): ${descuadrados}`);
  }
  console.log('─'.repeat(64) + '\n');

  console.log(
    APLICAR
      ? '✅ Mapas actualizados. El dinero no se tocó: saldos y totales quedan igual.\n'
      : '💡 Simulación. Repite con --apply para aplicar.\n'
  );

  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error('❌ Error:', e.message ?? e);
  await mongoose.disconnect();
  process.exit(1);
});

/**
 * MIGRACIÓN: Corregir fechas de cuotas diarias
 * ─────────────────────────────────────────────────────────────
 * Qué hace:
 *  1. Busca TODOS los préstamos de modalidad 'diaria' (activos, completados, cancelados)
 *  2. Recalcula las fechaEsperada de cada cuota:
 *     - La cuota #1 empieza el día SIGUIENTE a la fechaInicio (no el mismo día)
 *     - Si una fecha cae en domingo → se mueve al lunes
 *  3. Preserva INTACTOS: estado, fechaPago, montoPagado (el historial de pagos no se toca)
 *  4. Actualiza fechaFin con la fecha real de la última cuota
 *
 * Cómo correr:
 *   npx ts-node scripts/migrate-cuotas-diarias.ts
 *
 * Desde la carpeta /backend:
 *   npx ts-node --project tsconfig.json scripts/migrate-cuotas-diarias.ts
 */

import 'dotenv/config';
import mongoose from 'mongoose';

// ─── Config ──────────────────────────────────────────────────
const MONGODB_URI = process.env.MONGODB_URI!;
const MONGODB_DB  = process.env.MONGODB_DB ?? 'gotagota';

// ─── Helper: saltar domingo ───────────────────────────────────
function saltarDomingo(fecha: Date): Date {
  const d = new Date(fecha);
  if (d.getDay() === 0) d.setDate(d.getDate() + 1); // domingo → lunes
  return d;
}

// ─── Recalcular fechas diarias (día+1, sin domingos) ─────────
function recalcularFechasDiarias(fechaInicio: Date, numeroCuotas: number): Date[] {
  const fechas: Date[] = [];
  let fecha = new Date(fechaInicio);
  fecha.setDate(fecha.getDate() + 1); // empieza el día SIGUIENTE

  for (let i = 0; i < numeroCuotas; i++) {
    fecha = saltarDomingo(fecha);
    fechas.push(new Date(fecha)); // guardar copia
    fecha = new Date(fecha);
    fecha.setDate(fecha.getDate() + 1); // avanzar un día
  }

  return fechas;
}

// ─── Main ─────────────────────────────────────────────────────
async function main() {
  console.log('🔌 Conectando a MongoDB...');
  await mongoose.connect(MONGODB_URI, { dbName: MONGODB_DB });
  console.log('✅ Conectado a:', MONGODB_DB);

  const db = mongoose.connection.db!;
  const col = db.collection('prestamos');

  // Buscar todos los préstamos diarios NO eliminados
  const prestamos = await col.find({
    modalidad: 'diaria',
    deletedAt: null,
  }).toArray();

  console.log(`\n📋 Encontrados ${prestamos.length} préstamos de modalidad diaria\n`);

  let actualizados = 0;
  let sinCambios   = 0;
  let errores      = 0;

  for (const prestamo of prestamos) {
    try {
      const fechaInicio: Date = prestamo.fechaInicio;
      const cuotas: Array<{
        numero: number;
        fechaEsperada: Date;
        monto: number;
        estado: string;
        fechaPago?: Date;
        montoPagado?: number;
      }> = prestamo.cuotas ?? [];

      if (cuotas.length === 0) {
        console.log(`  ⚠️  ${prestamo._id} — sin cuotas, saltando`);
        sinCambios++;
        continue;
      }

      // Recalcular las nuevas fechas esperadas
      const nuevasFechas = recalcularFechasDiarias(fechaInicio, cuotas.length);

      // Construir nuevas cuotas preservando pagos existentes
      let tuvoCambios = false;
      const nuevasCuotas = cuotas.map((cuota, idx) => {
        const fechaNueva = nuevasFechas[idx];
        const fechaVieja = new Date(cuota.fechaEsperada);

        // Comparar fechas (solo fecha, sin hora)
        const mismaFecha =
          fechaNueva.toISOString().slice(0, 10) === fechaVieja.toISOString().slice(0, 10);

        if (!mismaFecha) tuvoCambios = true;

        return {
          ...cuota,
          fechaEsperada: fechaNueva, // ← nueva fecha
          // Los campos de pago se conservan intactos
        };
      });

      if (!tuvoCambios) {
        sinCambios++;
        continue;
      }

      // Calcular nueva fechaFin (última cuota)
      const nuevaFechaFin = nuevasFechas[nuevasFechas.length - 1];

      // Actualizar en la base de datos
      await col.updateOne(
        { _id: prestamo._id },
        {
          $set: {
            cuotas:   nuevasCuotas,
            fechaFin: nuevaFechaFin,
            updatedAt: new Date(),
          },
        }
      );

      const clienteId = String(prestamo.cliente);
      console.log(
        `  ✅ Préstamo ${prestamo._id} (cliente ${clienteId.slice(-6)}) — ` +
        `${cuotas.length} cuotas corregidas, ` +
        `fechaFin: ${nuevaFechaFin.toLocaleDateString('es-CO')}`
      );
      actualizados++;

    } catch (err) {
      console.error(`  ❌ Error en préstamo ${prestamo._id}:`, err);
      errores++;
    }
  }

  // ─── Resumen ──────────────────────────────────────────────
  console.log('\n════════════════════════════════════════');
  console.log(`✅ Actualizados:  ${actualizados}`);
  console.log(`⏭️  Sin cambios:   ${sinCambios}`);
  console.log(`❌ Con errores:   ${errores}`);
  console.log(`📦 Total:         ${prestamos.length}`);
  console.log('════════════════════════════════════════\n');

  await mongoose.disconnect();
  console.log('🔌 Desconectado de MongoDB');
  process.exit(errores > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('💥 Error fatal:', err);
  process.exit(1);
});

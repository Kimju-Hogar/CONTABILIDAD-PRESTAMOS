/**
 * corregir-renovacion.ts — Arregla una renovación que quedó con el desembolso
 * mal calculado por el bug viejo (registraba todo el capital como si hubiera
 * salido efectivo, cuando en una renovación sin plata nueva no sale nada).
 *
 * Deja el préstamo así:
 *   · montoDesembolsado = plata nueva entregada menos los cargos (0 si no hubo)
 *   · capital = saldo arrastrado + plata nueva + cargos financiados
 *   · interés, total a pagar, cuotas y saldo recalculados sobre ese capital
 *
 * Sólo funciona si el préstamo no tiene cobros todavía: si ya cobró algo,
 * recalcular las cuotas sería pisar pagos reales y se aborta.
 *
 * Uso — en seco:
 *   PRESTAMO=<id> npm run corregir:renovacion
 *
 * Aplicando:
 *   PRESTAMO=<id> CARGOS_FINANCIADOS=true npm run corregir:renovacion -- --apply
 *
 * CARGOS_FINANCIADOS=true  la papelería y el cartón se suman a la deuda
 *                          (el cliente no los pagó en efectivo)
 */

import 'dotenv/config';
import mongoose from 'mongoose';

const APLICAR = process.argv.includes('--apply');
const PRESTAMO = process.env['PRESTAMO'] ?? '';
const FINANCIADOS = process.env['CARGOS_FINANCIADOS'] === 'true';
const MONGODB_URI = process.env['MONGODB_URI'] ?? '';
const MONGODB_DB = process.env['MONGODB_DB'] ?? 'gotagota';

if (!MONGODB_URI) { console.error('❌ MONGODB_URI no está definida'); process.exit(1); }
if (!PRESTAMO) { console.error('❌ Falta PRESTAMO=<id>'); process.exit(1); }

const cop = (n: number) => '$ ' + Math.round(n || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');

async function main() {
  console.log(`\n🔧 Corregir renovación ${APLICAR ? '(APLICANDO)' : '(SIMULACIÓN)'}\n`);

  await mongoose.connect(MONGODB_URI, { dbName: MONGODB_DB, serverSelectionTimeoutMS: 8000 });
  const db = mongoose.connection.db!;
  const id = new mongoose.Types.ObjectId(PRESTAMO);

  const p = await db.collection('prestamos').findOne({ _id: id });
  if (!p) { console.error('❌ No existe ese préstamo\n'); process.exit(1); }

  const cli = await db.collection('clientes').findOne({ _id: p.cliente });
  const cobros = await db.collection('cobros').countDocuments({ prestamo: id, anulado: false });

  const papeleria = p.papeleria ?? 0;
  const carton = p.carton ?? 0;
  const arrastrado = p.saldoRefinanciado ?? 0;
  const cargos = papeleria + carton;

  // La plata nueva es lo que se le dio encima de la deuda que traía
  const plataNueva = Math.max(0, p.capital - arrastrado);

  console.log(`Cliente: ${cli?.nombre}`);
  console.log('');
  console.log('COMO ESTÁ:');
  console.log(`   capital            ${cop(p.capital)}`);
  console.log(`   interés            ${cop(p.totalInteres)}`);
  console.log(`   total a pagar      ${cop(p.totalPagar)}`);
  console.log(`   cuota              ${cop(p.cuotaDiaria)} x ${p.numeroCuotas}`);
  console.log(`   saldo pendiente    ${cop(p.saldoPendiente)}`);
  console.log(`   DESEMBOLSO         ${cop(p.montoDesembolsado)}   <- lo que la caja cree que salió`);
  console.log(`   (saldo arrastrado ${cop(arrastrado)} · plata nueva ${cop(plataNueva)} · cargos ${cop(cargos)})`);
  console.log('');

  if (cobros > 0) {
    console.error(`❌ Este préstamo ya tiene ${cobros} cobros. Recalcular las cuotas pisaría pagos`);
    console.error('   reales. Corrígelo a mano o anula los cobros primero.\n');
    await mongoose.disconnect();
    process.exit(1);
  }

  // ─── Cómo debería quedar ────────────────────────────────────
  const nuevoCapital = FINANCIADOS ? arrastrado + plataNueva + cargos : p.capital;
  const desembolso = FINANCIADOS ? plataNueva : plataNueva - cargos;

  const interes = p.interes ?? 20;
  const totalInteres = Math.round(nuevoCapital * interes / 100);
  const totalPagar = nuevoCapital + totalInteres;
  const numeroCuotas = p.numeroCuotas;
  const cuotaMonto = Math.ceil((totalPagar / numeroCuotas) / 100) * 100;

  console.log('COMO QUEDARÍA:');
  console.log(`   capital            ${cop(nuevoCapital)}${FINANCIADOS ? '   (se le suman los cargos a la deuda)' : ''}`);
  console.log(`   interés            ${cop(totalInteres)}`);
  console.log(`   total a pagar      ${cop(totalPagar)}`);
  console.log(`   cuota              ${cop(cuotaMonto)} x ${numeroCuotas}`);
  console.log(`   saldo pendiente    ${cop(totalPagar)}`);
  console.log(`   DESEMBOLSO         ${cop(desembolso)}   <- lo que de verdad salió de la caja`);
  console.log('');
  console.log(`   Efecto en la caja del ${new Date(p.fechaInicio).toISOString().slice(0, 10)}: ${cop(p.montoDesembolsado - desembolso)} a favor`);
  console.log('');

  if (!APLICAR) {
    console.log('💡 Simulación. Repite con --apply para aplicar.\n');
    await mongoose.disconnect();
    return;
  }

  // Las fechas de las cuotas se respetan; sólo cambia el monto
  const cuotas = (p.cuotas ?? []).map((c: Record<string, unknown>) => ({
    ...c,
    monto: cuotaMonto,
    estado: 'pendiente',
    fechaPago: undefined,
    montoPagado: undefined,
  }));

  await db.collection('prestamos').updateOne(
    { _id: id },
    {
      $set: {
        capital: nuevoCapital,
        totalInteres,
        totalPagar,
        cuotaDiaria: cuotaMonto,
        saldoPendiente: totalPagar,
        montoDesembolsado: desembolso,
        cuotas,
        observaciones: `${p.observaciones ?? ''} [Corregido: desembolso real ${cop(desembolso)}]`.trim(),
        updatedAt: new Date(),
      },
    }
  );

  console.log('✅ Préstamo corregido. Vuelve a abrir la caja de ese día y debería cuadrar.\n');
  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error('❌ Error:', e.message ?? e);
  await mongoose.disconnect();
  process.exit(1);
});

/**
 * condonar-saldos-viejos.ts — Cierra los préstamos viejos que quedaron abiertos
 * cuando el botón de renovar todavía creaba un préstamo suelto en vez de
 * refinanciar.
 *
 * El saldo pendiente se da por condonado: el préstamo queda en estado
 * 'cancelado' con su motivo, PERO conserva intactos todos sus cobros. Así el
 * historial de pagos del cliente y los reportes de meses pasados no cambian;
 * lo único que baja es la cartera viva.
 *
 * Uso — primero en seco:
 *   npm run condonar
 *
 * Aplicando de verdad:
 *   npm run condonar -- --apply
 *
 * Para tratar solo algunos préstamos:
 *   npm run condonar -- --ids=6a7bb5af...,6a12cd34... --apply
 */

import 'dotenv/config';
import mongoose from 'mongoose';

const APLICAR = process.argv.includes('--apply');
const argIds = process.argv.find((a) => a.startsWith('--ids='));
const IDS_FILTRO = argIds ? argIds.slice('--ids='.length).split(',').map((s) => s.trim()) : null;

const MONGODB_URI = process.env['MONGODB_URI'] ?? '';
const MONGODB_DB = process.env['MONGODB_DB'] ?? 'gotagota';
const MOTIVO = process.env['MOTIVO'] ?? 'Saldo condonado al renovar la tarjeta';

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI no está definida');
  process.exit(1);
}

const cop = (n: number) => '$ ' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');

async function main() {
  console.log(`\n🧾 Condonar saldos viejos ${APLICAR ? '(APLICANDO)' : '(SIMULACIÓN)'}\n`);

  await mongoose.connect(MONGODB_URI, { dbName: MONGODB_DB, serverSelectionTimeoutMS: 8000 });
  const db = mongoose.connection.db!;
  const prestamos = db.collection('prestamos');
  const clientes = db.collection('clientes');
  const cobros = db.collection('cobros');

  // Clientes que hoy tienen más de un préstamo activo
  const duplicados = await prestamos
    .aggregate([
      { $match: { estado: 'activo', deletedAt: null } },
      { $group: { _id: '$cliente', n: { $sum: 1 } } },
      { $match: { n: { $gt: 1 } } },
    ])
    .toArray();

  if (duplicados.length === 0) {
    console.log('✅ No hay clientes con más de un préstamo activo. Nada que hacer.\n');
    await mongoose.disconnect();
    return;
  }

  let totalCondonado = 0;
  let totalPagosConservados = 0;
  const aCerrar: Array<{ id: mongoose.Types.ObjectId; cliente: mongoose.Types.ObjectId; saldo: number }> = [];

  for (const d of duplicados) {
    const cliente = await clientes.findOne({ _id: d._id });
    const lista = await prestamos
      .find({ cliente: d._id, estado: 'activo', deletedAt: null })
      .sort({ fechaInicio: 1 })
      .toArray();

    // El más antiguo es el que quedó colgado; el último es la renovación real
    const viejo = lista[0]!;
    const nuevo = lista[lista.length - 1]!;

    if (IDS_FILTRO && !IDS_FILTRO.includes(viejo._id.toString())) continue;

    const pagos = await cobros.countDocuments({ prestamo: viejo._id, anulado: false });

    console.log(`${cliente?.nombre ?? 'Cliente'}:`);
    console.log(
      `   se cierra  ${new Date(viejo.fechaInicio).toISOString().slice(0, 10)}` +
      `  capital ${cop(viejo.capital)}  cobrado ${cop(viejo.totalCobrado)}` +
      `  SALDO CONDONADO ${cop(viejo.saldoPendiente)}  (${pagos} pagos se conservan)`
    );
    console.log(
      `   se conserva ${new Date(nuevo.fechaInicio).toISOString().slice(0, 10)}` +
      `  capital ${cop(nuevo.capital)}  saldo ${cop(nuevo.saldoPendiente)}\n`
    );

    totalCondonado += viejo.saldoPendiente;
    totalPagosConservados += pagos;
    aCerrar.push({ id: viejo._id, cliente: d._id, saldo: viejo.saldoPendiente });
  }

  console.log('─'.repeat(64));
  console.log(`Préstamos a cerrar : ${aCerrar.length}`);
  console.log(`Saldo condonado    : ${cop(totalCondonado)}`);
  console.log(`Pagos conservados  : ${totalPagosConservados}`);
  console.log('─'.repeat(64) + '\n');

  if (!APLICAR) {
    console.log('💡 Simulación. Repite con --apply para aplicar los cambios.\n');
    await mongoose.disconnect();
    return;
  }

  for (const p of aCerrar) {
    const actual = await prestamos.findOne({ _id: p.id });
    await prestamos.updateOne(
      { _id: p.id },
      {
        $set: {
          estado: 'cancelado',
          observaciones: `CANCELADO: ${MOTIVO}. ${actual?.observaciones ?? ''}`.trim(),
          updatedAt: new Date(),
        },
      }
    );
    // Mantener coherente el contador de préstamos activos del cliente
    await clientes.updateOne({ _id: p.cliente }, { $inc: { prestamosActivos: -1 } });
  }

  console.log(`✅ ${aCerrar.length} préstamos cerrados. Los cobros quedaron intactos.\n`);
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('❌ Error:', err.message ?? err);
  await mongoose.disconnect();
  process.exit(1);
});

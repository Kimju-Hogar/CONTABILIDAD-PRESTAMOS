/**
 * restaurar-cobros.ts — Devuelve a la base los cobros de un préstamo que se
 * perdieron al eliminarlo (eliminar hace deleteMany sobre los cobros).
 *
 * Lee los documentos desde un dump de mongodump ya descomprimido a JSON y sólo
 * inserta los que no existan, comparando por _id. Es idempotente: correrlo dos
 * veces no duplica nada.
 *
 * Uso:
 *   npm run restaurar:cobros -- --archivo=<ruta cobros.json> --prestamo=<id>
 *   npm run restaurar:cobros -- --archivo=... --prestamo=... --reactivar --apply
 *
 * --reactivar  quita también el deletedAt del préstamo, para que vuelva a verse
 *              en el historial del cliente con el estado que tenga.
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import fs from 'node:fs';

const APLICAR = process.argv.includes('--apply');
const REACTIVAR = process.argv.includes('--reactivar');

const leerArg = (nombre: string) => {
  const a = process.argv.find((x) => x.startsWith(`--${nombre}=`));
  return a ? a.slice(nombre.length + 3) : null;
};

const ARCHIVO = leerArg('archivo');
const PRESTAMO_ID = leerArg('prestamo');
const MONGODB_URI = process.env['MONGODB_URI'] ?? '';
const MONGODB_DB = process.env['MONGODB_DB'] ?? 'gotagota';

if (!MONGODB_URI) { console.error('❌ MONGODB_URI no está definida'); process.exit(1); }
if (!ARCHIVO || !PRESTAMO_ID) {
  console.error('❌ Faltan argumentos: --archivo=<cobros.json> --prestamo=<id>');
  process.exit(1);
}
if (!fs.existsSync(ARCHIVO)) { console.error(`❌ No existe el archivo ${ARCHIVO}`); process.exit(1); }

const cop = (n: number) => '$ ' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/** Convierte el JSON extendido de bsondump a tipos nativos de Mongo. */
function revivir(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(revivir);
  if (valor && typeof valor === 'object') {
    const o = valor as Record<string, any>;
    if (o['$oid']) return new mongoose.Types.ObjectId(o['$oid']);
    if (o['$date']) {
      const d = o['$date'];
      return new Date(typeof d === 'object' ? Number(d['$numberLong']) : d);
    }
    if (o['$numberInt'] !== undefined) return Number(o['$numberInt']);
    if (o['$numberLong'] !== undefined) return Number(o['$numberLong']);
    if (o['$numberDouble'] !== undefined) return Number(o['$numberDouble']);
    const salida: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) salida[k] = revivir(v);
    return salida;
  }
  return valor;
}

async function main() {
  console.log(`\n♻️  Restaurar cobros ${APLICAR ? '(APLICANDO)' : '(SIMULACIÓN)'}\n`);

  const candidatos = fs.readFileSync(ARCHIVO, 'utf8')
    .trim().split('\n')
    .map((l) => JSON.parse(l))
    .filter((c) => c.prestamo?.['$oid'] === PRESTAMO_ID)
    .map((c) => revivir(c) as Record<string, any>);

  if (candidatos.length === 0) {
    console.log('⚠️  El backup no tiene cobros para ese préstamo.\n');
    return;
  }

  await mongoose.connect(MONGODB_URI, { dbName: MONGODB_DB, serverSelectionTimeoutMS: 8000 });
  const db = mongoose.connection.db!;

  const existentes = new Set(
    (await db.collection('cobros')
      .find({ _id: { $in: candidatos.map((c) => c._id) } })
      .project({ _id: 1 })
      .toArray())
      .map((d) => d._id.toString())
  );

  const faltantes = candidatos.filter((c) => !existentes.has(c._id.toString()));
  const suma = faltantes.reduce((a, c) => a + Number(c.monto), 0);

  console.log(`En el backup        : ${candidatos.length} cobros`);
  console.log(`Ya están en la base : ${existentes.size}`);
  console.log(`Se restaurarían     : ${faltantes.length}  por ${cop(suma)}\n`);

  for (const c of faltantes) {
    console.log(`   ${new Date(c.fecha).toISOString().slice(0, 10)}  ${cop(Number(c.monto))}  (${c.tipo})`);
  }

  const prestamo = await db.collection('prestamos')
    .findOne({ _id: new mongoose.Types.ObjectId(PRESTAMO_ID) });
  if (prestamo) {
    console.log(`\nPréstamo: estado=${prestamo.estado}  deletedAt=${prestamo.deletedAt}`);
    console.log(`   totalCobrado registrado: ${cop(prestamo.totalCobrado)}  saldo: ${cop(prestamo.saldoPendiente)}`);
    if (REACTIVAR && prestamo.deletedAt) {
      console.log('   → se le quitaría el deletedAt para que vuelva a verse en el historial');
    }
  }

  if (!APLICAR) {
    console.log('\n💡 Simulación. Repite con --apply para aplicar.\n');
    await mongoose.disconnect();
    return;
  }

  if (faltantes.length > 0) {
    await db.collection('cobros').insertMany(faltantes as never[], { ordered: false });
    console.log(`\n✅ ${faltantes.length} cobros restaurados por ${cop(suma)}`);
  }

  if (REACTIVAR && prestamo?.deletedAt) {
    await db.collection('prestamos').updateOne(
      { _id: new mongoose.Types.ObjectId(PRESTAMO_ID) },
      { $set: { deletedAt: null } }
    );
    console.log('✅ El préstamo vuelve a ser visible en el historial del cliente');
  }

  console.log('');
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('❌ Error:', err.message ?? err);
  await mongoose.disconnect();
  process.exit(1);
});

/**
 * Unifica la caja: de una caja por cobrador a UNA caja por día del negocio.
 *
 * Por qué: la caja estaba partida por cobrador, así que una renovación
 * registrada a nombre de otra cuenta caía en una caja que nadie miraba y su
 * desembolso nunca descontaba del saldo. Entre el 24/09 y el 05/10 de 2026 se
 * perdieron así $1.925.000 de siete renovaciones.
 *
 * Qué hace:
 *   1. Detecta los días con más de una caja y borra las duplicadas vacías
 *      (base en cero, sin cierre contado), dejando la que tiene los datos.
 *   2. Cambia el índice único de {cobrador, fechaKey} a {fechaKey}.
 *   3. Imprime el saldo real de cada día con la caja ya unificada.
 *
 * Sin --apply no escribe nada.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const APLICAR = process.argv.includes('--apply');
const money = (n: number) => (n < 0 ? '-' : '') + '$' + Math.abs(Math.round(n || 0)).toLocaleString('es-CO');
const TZ = 'America/Bogota';

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('Falta MONGODB_URI');
  await mongoose.connect(uri, { dbName: process.env.MONGODB_DB || 'gotagota' });
  const db = mongoose.connection.db!;
  const cajas = db.collection('cajadias');

  console.log(APLICAR ? '>>> MODO APLICAR: se va a escribir\n' : '>>> SIMULACIÓN (agrega --apply para escribir)\n');

  // ─── 1. Días con caja duplicada ────────────────────────────
  const dups = await cajas.aggregate([
    { $group: { _id: '$fechaKey', n: { $sum: 1 }, ids: { $push: '$_id' } } },
    { $match: { n: { $gt: 1 } } },
    { $sort: { _id: 1 } },
  ]).toArray();

  console.log(`Días con más de una caja: ${dups.length}`);
  const aBorrar: mongoose.Types.ObjectId[] = [];

  for (const d of dups) {
    const docs = await cajas.find({ fechaKey: d._id }).toArray();
    // La principal: la cerrada; si no, la de mayor base; si empatan, la más vieja
    const orden = [...docs].sort((a, b) => {
      if ((a.estado === 'cerrado') !== (b.estado === 'cerrado')) return a.estado === 'cerrado' ? -1 : 1;
      if ((b.baseInicial ?? 0) !== (a.baseInicial ?? 0)) return (b.baseInicial ?? 0) - (a.baseInicial ?? 0);
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
    const principal = orden[0]!;
    const sobrantes = orden.slice(1);

    console.log(`\n ${d._id}: ${docs.length} cajas`);
    console.log(`   se queda  base=${money(principal.baseInicial)} estado=${principal.estado}`);

    for (const s of sobrantes) {
      const vacia =
        (s.baseInicial ?? 0) === 0 &&
        s.saldoContado == null &&
        s.estado !== 'cerrado' &&
        (s.totalCobrado ?? 0) === 0 &&
        (s.totalPrestado ?? 0) === 0;
      if (!vacia) {
        console.error(
          `   !! la duplicada base=${money(s.baseInicial)} estado=${s.estado} contado=${money(s.saldoContado ?? 0)} ` +
          'NO está vacía. Revísala a mano antes de seguir; no se borra nada.'
        );
        process.exitCode = 1;
        await mongoose.disconnect();
        return;
      }
      console.log(`   se borra  base=${money(s.baseInicial)} (vacía, apertura automática)`);
      aBorrar.push(s._id);
    }
  }

  if (APLICAR && aBorrar.length) {
    const r = await cajas.deleteMany({ _id: { $in: aBorrar } });
    console.log(`\nCajas duplicadas borradas: ${r.deletedCount}`);
  }

  // ─── 2. Índice único por día ───────────────────────────────
  const indices = await cajas.indexes();
  const viejo = indices.find((i) => i.name === 'cobrador_1_fechaKey_1');
  const nuevo = indices.find((i) => i.name === 'fechaKey_1' && i.unique);
  console.log(`\nÍndice {cobrador,fechaKey} único: ${viejo ? 'existe' : 'no existe'}`);
  console.log(`Índice {fechaKey} único:          ${nuevo ? 'existe' : 'no existe'}`);

  if (APLICAR) {
    if (viejo) { await cajas.dropIndex('cobrador_1_fechaKey_1'); console.log(' - índice viejo eliminado'); }
    if (!nuevo) {
      // Puede existir un {fechaKey:-1} no único; el único va aparte
      await cajas.createIndex({ fechaKey: 1 }, { unique: true, name: 'fechaKey_1' });
      console.log(' - índice único por día creado');
    }
  }

  // ─── 3. Saldo real de cada día, ya con la caja unificada ───
  console.log('\n=== Saldo real por día (caja unificada) ===');
  const dias = (await cajas.find({}).sort({ fechaKey: 1 }).toArray()).filter(
    (c) => !aBorrar.some((id) => String(id) === String(c._id))
  );

  for (const c of dias) {
    const inicio = new Date(`${c.fechaKey}T00:00:00.000-05:00`);
    const fin = new Date(`${c.fechaKey}T23:59:59.999-05:00`);
    const [cob] = await db.collection('cobros').aggregate([
      { $match: { fecha: { $gte: inicio, $lte: fin }, anulado: false } },
      { $group: { _id: null, v: { $sum: '$monto' } } },
    ]).toArray();
    const [pre] = await db.collection('prestamos').aggregate([
      { $match: { fechaInicio: { $gte: inicio, $lte: fin }, deletedAt: null, estado: { $ne: 'cancelado' } } },
      { $group: {
        _id: null,
        out: { $sum: { $cond: [{ $gt: ['$montoDesembolsado', 0] }, '$montoDesembolsado', 0] } },
        inn: { $sum: { $cond: [{ $lt: ['$montoDesembolsado', 0] }, { $abs: '$montoDesembolsado' }, 0] } },
      } },
    ]).toArray();
    const [gas] = await db.collection('gastos').aggregate([
      { $match: { fecha: { $gte: inicio, $lte: fin }, deletedAt: null } },
      { $group: { _id: null, v: { $sum: '$monto' } } },
    ]).toArray();
    const movs = await db.collection('movimientocajas').aggregate([
      { $match: { fechaKey: c.fechaKey, deletedAt: null } },
      { $group: { _id: '$tipo', v: { $sum: '$monto' } } },
    ]).toArray();
    const ing = movs.find((m) => m._id === 'ingreso')?.v ?? 0;
    const egr = movs.find((m) => m._id === 'egreso')?.v ?? 0;

    const cobrado = cob?.v ?? 0, prestado = pre?.out ?? 0, cargos = pre?.inn ?? 0, gastos = gas?.v ?? 0;
    const saldo = (c.baseInicial ?? 0) + cobrado + cargos + ing - prestado - gastos - egr;
    console.log(
      ` ${c.fechaKey} ${String(c.estado).padEnd(8)} base=${money(c.baseInicial).padStart(11)} ` +
      `cobrado=${money(cobrado).padStart(11)} prestado=${money(prestado).padStart(11)} ` +
      `inyectado=${money(ing).padStart(11)} gastos=${money(gastos).padStart(9)} => saldo ${money(saldo).padStart(12)}`
    );
  }

  console.log(`\nZona horaria usada: ${TZ}`);
  console.log(APLICAR ? '\nListo.' : '\nNada escrito. Repite con --apply.');
  await mongoose.disconnect();
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });

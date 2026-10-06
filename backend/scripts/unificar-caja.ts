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
 *   3. Imprime la cadena de saldos día por día, recorriendo el calendario
 *      completo: hubo días sin caja abierta en los que igual salió plata.
 *   4. Con --rebase=YYYY-MM-DD vuelve a encadenar las bases desde ese día:
 *      cada día arranca con lo que quedó el anterior. Los días previos
 *      conservan su base, porque ahí hay valores puestos a mano.
 *
 * Uso:
 *   npm run unificar:caja                                 (simulación)
 *   npm run unificar:caja -- --apply
 *   npm run unificar:caja -- --rebase=2026-10-02          (simulación)
 *   npm run unificar:caja -- --rebase=2026-10-02 --apply
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const APLICAR = process.argv.includes('--apply');
const REBASE = process.argv.find((a) => a.startsWith('--rebase='))?.split('=')[1];
const TZ = 'America/Bogota';
const money = (n: number) => (n < 0 ? '-' : '') + '$' + Math.abs(Math.round(n || 0)).toLocaleString('es-CO');
const keyHoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('Falta MONGODB_URI');
  if (REBASE && !/^\d{4}-\d{2}-\d{2}$/.test(REBASE)) throw new Error('--rebase necesita formato YYYY-MM-DD');

  await mongoose.connect(uri, { dbName: process.env.MONGODB_DB || 'gotagota' });
  const db = mongoose.connection.db!;
  const cajas = db.collection('cajadias');

  console.log(APLICAR ? '>>> MODO APLICAR: se va a escribir\n' : '>>> SIMULACIÓN (agrega --apply para escribir)\n');

  // ─── 1. Días con caja duplicada ────────────────────────────
  const dups = await cajas
    .aggregate([
      { $group: { _id: '$fechaKey', n: { $sum: 1 } } },
      { $match: { n: { $gt: 1 } } },
      { $sort: { _id: 1 } },
    ])
    .toArray();

  console.log(`Días con más de una caja: ${dups.length}`);
  const aBorrar: unknown[] = [];

  for (const d of dups) {
    const docs = await cajas.find({ fechaKey: d._id }).toArray();
    // La principal: la cerrada; si no, la de mayor base; si empatan, la más vieja
    const orden = [...docs].sort((a, b) => {
      if ((a.estado === 'cerrado') !== (b.estado === 'cerrado')) return a.estado === 'cerrado' ? -1 : 1;
      if ((b.baseInicial ?? 0) !== (a.baseInicial ?? 0)) return (b.baseInicial ?? 0) - (a.baseInicial ?? 0);
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
    const principal = orden[0]!;

    console.log(`\n ${d._id}: ${docs.length} cajas`);
    console.log(`   se queda  base=${money(principal.baseInicial)} estado=${principal.estado}`);

    for (const s of orden.slice(1)) {
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
    const r = await cajas.deleteMany({ _id: { $in: aBorrar as never[] } });
    console.log(`\nCajas duplicadas borradas: ${r.deletedCount}`);
  }

  // ─── 2. Índice único por día ───────────────────────────────
  const indices = await cajas.indexes();
  const viejo = indices.find((i) => i.name === 'cobrador_1_fechaKey_1');
  const nuevo = indices.find((i) => i.name === 'fechaKey_1' && i.unique);
  console.log(`\nÍndice {cobrador,fechaKey} único: ${viejo ? 'existe' : 'no existe'}`);
  console.log(`Índice {fechaKey} único:          ${nuevo ? 'existe' : 'no existe'}`);

  if (APLICAR) {
    if (viejo) {
      await cajas.dropIndex('cobrador_1_fechaKey_1');
      console.log(' - índice viejo eliminado');
    }
    if (!nuevo) {
      await cajas.createIndex({ fechaKey: 1 }, { unique: true, name: 'fechaKey_1' });
      console.log(' - índice único por día creado');
    }
  }

  // ─── 3. Cadena de saldos día por día ───────────────────────
  const vivas = (await cajas.find({}).sort({ fechaKey: 1 }).toArray()).filter(
    (c) => !aBorrar.some((id) => String(id) === String(c._id))
  );
  const porFecha = new Map(vivas.map((c) => [c.fechaKey, c]));

  // Calendario completo desde el primer día con caja hasta hoy: los días sin
  // caja también cuentan, porque en varios salió plata sin que nadie abriera.
  const hoy = keyHoy();
  const calendario: string[] = [];
  const primera = vivas[0]?.fechaKey ?? hoy;
  for (let t = Date.parse(`${primera}T12:00:00Z`); ; t += 86_400_000) {
    const k = new Date(t).toISOString().slice(0, 10);
    calendario.push(k);
    if (k >= hoy) break;
  }

  console.log('\n=== Cadena de saldos día por día ===');
  let corriendo = 0;
  const cambios: Array<{ id: unknown; fechaKey: string; antes: number; despues: number }> = [];

  for (const fechaKey of calendario) {
    const caja = porFecha.get(fechaKey);
    const inicio = new Date(`${fechaKey}T00:00:00.000-05:00`);
    const fin = new Date(`${fechaKey}T23:59:59.999-05:00`);

    const [cob] = await db
      .collection('cobros')
      .aggregate([
        { $match: { fecha: { $gte: inicio, $lte: fin }, anulado: false } },
        { $group: { _id: null, v: { $sum: '$monto' } } },
      ])
      .toArray();
    const [pre] = await db
      .collection('prestamos')
      .aggregate([
        { $match: { fechaInicio: { $gte: inicio, $lte: fin }, deletedAt: null, estado: { $ne: 'cancelado' } } },
        {
          $group: {
            _id: null,
            out: { $sum: { $cond: [{ $gt: ['$montoDesembolsado', 0] }, '$montoDesembolsado', 0] } },
            inn: { $sum: { $cond: [{ $lt: ['$montoDesembolsado', 0] }, { $abs: '$montoDesembolsado' }, 0] } },
          },
        },
      ])
      .toArray();
    const [gas] = await db
      .collection('gastos')
      .aggregate([
        { $match: { fecha: { $gte: inicio, $lte: fin }, deletedAt: null } },
        { $group: { _id: null, v: { $sum: '$monto' } } },
      ])
      .toArray();
    const movs = await db
      .collection('movimientocajas')
      .aggregate([
        { $match: { fechaKey, deletedAt: null } },
        { $group: { _id: '$tipo', v: { $sum: '$monto' } } },
      ])
      .toArray();

    const cobrado = cob?.v ?? 0;
    const prestado = pre?.out ?? 0;
    const cargos = pre?.inn ?? 0;
    const gastos = gas?.v ?? 0;
    const ing = movs.find((x) => x._id === 'ingreso')?.v ?? 0;
    const egr = movs.find((x) => x._id === 'egreso')?.v ?? 0;

    const huboMovimiento = cobrado || prestado || cargos || gastos || ing || egr;
    if (!caja && !huboMovimiento) continue;

    // ¿Se recalcula la base o se respeta la guardada?
    const recalcula = !!caja && !!REBASE && fechaKey >= REBASE;
    const guardada = caja?.baseInicial ?? 0;
    let base: number;
    if (!caja) {
      base = corriendo;
    } else if (recalcula) {
      base = corriendo;
      if (Math.round(base) !== Math.round(guardada)) {
        cambios.push({ id: caja._id, fechaKey, antes: guardada, despues: base });
      }
    } else {
      base = guardada;
    }

    const saldo = base + cobrado + cargos + ing - prestado - gastos - egr;
    corriendo = saldo;

    const marca = !caja
      ? '<- nadie abrió caja, pero salió plata'
      : recalcula && Math.round(base) !== Math.round(guardada)
        ? `<- base ${money(guardada)} pasa a ${money(base)}`
        : '';

    console.log(
      ` ${fechaKey} ${String(caja?.estado ?? 'sin abrir').padEnd(9)} base=${money(base).padStart(12)} ` +
        `cobros=${money(cobrado).padStart(11)} prestado=${money(prestado).padStart(11)} ` +
        `metido=${money(ing).padStart(11)} salidas=${money(gastos + egr).padStart(9)} => queda ${money(saldo).padStart(12)} ${marca}`
    );
  }

  console.log(`\nSaldo que debería haber hoy en efectivo: ${money(corriendo)}`);

  if (REBASE) {
    console.log(`\n=== Bases a reencadenar desde ${REBASE}: ${cambios.length} ===`);
    for (const k of cambios) console.log(` ${k.fechaKey}  ${money(k.antes)} -> ${money(k.despues)}`);
    if (APLICAR && cambios.length) {
      for (const k of cambios) {
        await cajas.updateOne({ _id: k.id as never }, { $set: { baseInicial: k.despues } });
      }
      console.log(`\nBases actualizadas: ${cambios.length}`);
    }
  } else {
    console.log('\n(Para reencadenar las bases: --rebase=YYYY-MM-DD)');
  }

  console.log(APLICAR ? '\nListo.' : '\nNada escrito. Repite con --apply.');
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});

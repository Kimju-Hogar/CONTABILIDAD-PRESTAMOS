import mongoose from 'mongoose';
import { CobroModel } from '../../models/Cobro.model';
import { PrestamoModel } from '../../models/Prestamo.model';
import { GastoModel } from '../../models/Gasto.model';
import { ClienteModel } from '../../models/Cliente.model';
import { CajaDiaModel } from '../../models/CajaDia.model';
import { MovimientoCajaModel } from '../../models/MovimientoCaja.model';
import { UsuarioModel } from '../../models/Usuario.model';
import {
  TZ, Periodo, Rango, rangoPeriodo, etiquetaPeriodo, keyDia, rangoDia,
} from '../../shared/utils/fechas';

const oid = (id: string) => new mongoose.Types.ObjectId(id);

/** Redondeo a 2 decimales para porcentajes; evita 33.33333333333333 en el JSON. */
const pct = (parte: number, total: number): number =>
  total > 0 ? Math.round((parte / total) * 10000) / 100 : 0;

const redondear = (n: number): number => Math.round(n);

export class AdminService {
  /**
   * Recaudo del periodo separando capital de interés.
   *
   * El interés se devenga en proporción: de cada peso cobrado, la fracción
   * `totalInteres / totalPagar` del préstamo es ganancia y el resto es
   * recuperación de capital. Así la ganancia se reconoce a lo largo de la vida
   * del préstamo en vez de aparecer de golpe al final.
   */
  private async recaudoPeriodo(rango: Rango, cobradorId?: string) {
    const match: Record<string, unknown> = {
      fecha: { $gte: rango.inicio, $lte: rango.fin },
      anulado: false,
    };
    if (cobradorId) match.cobrador = oid(cobradorId);

    const [r] = await CobroModel.aggregate([
      { $match: match },
      {
        $lookup: {
          from: 'prestamos',
          localField: 'prestamo',
          foreignField: '_id',
          as: 'p',
        },
      },
      { $unwind: { path: '$p', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          monto: 1,
          interes: {
            $cond: [
              { $gt: [{ $ifNull: ['$p.totalPagar', 0] }, 0] },
              { $multiply: ['$monto', { $divide: ['$p.totalInteres', '$p.totalPagar'] }] },
              0,
            ],
          },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$monto' },
          cantidad: { $sum: 1 },
          interes: { $sum: '$interes' },
        },
      },
    ]);

    const total = r?.total ?? 0;
    const interes = redondear(r?.interes ?? 0);
    return {
      total,
      cantidad: r?.cantidad ?? 0,
      interesDevengado: interes,
      capitalRecuperado: total - interes,
    };
  }

  /** Préstamos desembolsados en el periodo (imputados por fecha de inicio). */
  private async colocacionPeriodo(rango: Rango, cobradorId?: string) {
    const match: Record<string, unknown> = {
      fechaInicio: { $gte: rango.inicio, $lte: rango.fin },
      deletedAt: null,
      estado: { $ne: 'cancelado' },
    };
    if (cobradorId) match.cobrador = oid(cobradorId);

    const [r] = await PrestamoModel.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          capitalPrestado: { $sum: '$capital' },
          desembolsadoEfectivo: { $sum: '$montoDesembolsado' },
          interesPactado: { $sum: '$totalInteres' },
          papeleria: { $sum: '$papeleria' },
          carton: { $sum: { $ifNull: ['$carton', 0] } },
          cantidad: { $sum: 1 },
        },
      },
    ]);

    const cantidad = r?.cantidad ?? 0;
    const capital = r?.capitalPrestado ?? 0;
    return {
      capitalPrestado: capital,
      desembolsadoEfectivo: r?.desembolsadoEfectivo ?? 0,
      interesPactado: r?.interesPactado ?? 0,
      papeleriaGenerada: r?.papeleria ?? 0,
      cartonesGenerados: r?.carton ?? 0,
      cantidad,
      ticketPromedio: cantidad > 0 ? Math.round(capital / cantidad) : 0,
    };
  }

  private async egresosPeriodo(rango: Rango, cobradorId?: string) {
    const matchGastos: Record<string, unknown> = {
      fecha: { $gte: rango.inicio, $lte: rango.fin },
      deletedAt: null,
    };
    if (cobradorId) matchGastos.usuario = oid(cobradorId);

    const matchMov: Record<string, unknown> = {
      fecha: { $gte: rango.inicio, $lte: rango.fin },
      deletedAt: null,
    };
    if (cobradorId) matchMov.cobrador = oid(cobradorId);

    const [gastos, movimientos] = await Promise.all([
      GastoModel.aggregate([
        { $match: matchGastos },
        { $group: { _id: '$categoria', total: { $sum: '$monto' } } },
      ]),
      MovimientoCajaModel.aggregate([
        { $match: matchMov },
        { $group: { _id: { tipo: '$tipo', concepto: '$concepto' }, total: { $sum: '$monto' } } },
      ]),
    ]);

    const totalGastos = gastos.reduce((acc, g) => acc + g.total, 0);
    const otrosIngresos = movimientos
      .filter((m) => m._id.tipo === 'ingreso')
      .reduce((acc, m) => acc + m.total, 0);
    // Los retiros (utilidad, papelería) sacan efectivo de la caja pero no son
    // un costo del negocio: son reparto. Se reportan aparte del gasto operativo.
    const retiros = movimientos
      .filter((m) => m._id.tipo === 'egreso' && ['retiro_utilidad', 'retiro_papeleria'].includes(m._id.concepto))
      .reduce((acc, m) => acc + m.total, 0);
    const otrosEgresos = movimientos
      .filter((m) => m._id.tipo === 'egreso' && !['retiro_utilidad', 'retiro_papeleria'].includes(m._id.concepto))
      .reduce((acc, m) => acc + m.total, 0);

    return {
      gastos: totalGastos,
      gastosPorCategoria: gastos.map((g) => ({ categoria: g._id, total: g.total })),
      otrosIngresos,
      otrosEgresos,
      retiros,
    };
  }

  /** Estado de la cartera viva: cuánto hay en la calle y cuánto está vencido. */
  private async cartera(cobradorId?: string) {
    const match: Record<string, unknown> = { estado: 'activo', deletedAt: null };
    if (cobradorId) match.cobrador = oid(cobradorId);

    const [resumen, vencido, morosos] = await Promise.all([
      PrestamoModel.aggregate([
        { $match: match },
        {
          $group: {
            _id: null,
            capitalEnCalle: { $sum: '$capital' },
            saldoPendiente: { $sum: '$saldoPendiente' },
            totalPorCobrar: { $sum: '$totalPagar' },
            recuperado: { $sum: '$totalCobrado' },
            prestamos: { $sum: 1 },
          },
        },
      ]),
      PrestamoModel.aggregate([
        { $match: match },
        { $unwind: '$cuotas' },
        { $match: { 'cuotas.estado': 'vencida' } },
        {
          $group: {
            _id: null,
            montoVencido: {
              $sum: { $subtract: ['$cuotas.monto', { $ifNull: ['$cuotas.montoPagado', 0] }] },
            },
            cuotasVencidas: { $sum: 1 },
            prestamos: { $addToSet: '$_id' },
          },
        },
      ]),
      ClienteModel.countDocuments({ estado: 'moroso', deletedAt: null }),
    ]);

    const r = resumen[0];
    const v = vencido[0];
    const saldo = r?.saldoPendiente ?? 0;
    const montoVencido = v?.montoVencido ?? 0;

    return {
      capitalEnCalle: r?.capitalEnCalle ?? 0,
      saldoPendiente: saldo,
      totalPorCobrar: r?.totalPorCobrar ?? 0,
      recuperado: r?.recuperado ?? 0,
      prestamosActivos: r?.prestamos ?? 0,
      cuotasVencidas: v?.cuotasVencidas ?? 0,
      montoVencido,
      prestamosEnMora: v?.prestamos?.length ?? 0,
      clientesMorosos: morosos,
      indiceMora: pct(montoVencido, saldo),
    };
  }

  /**
   * Cuenta general de papelería y renovación de cartones: lo generado, lo que
   * ya se retiró y lo que sigue disponible en caja.
   */
  async cuentaPapeleria(cobradorId?: string) {
    const match: Record<string, unknown> = { deletedAt: null, estado: { $ne: 'cancelado' } };
    if (cobradorId) match.cobrador = oid(cobradorId);

    const [totales, retiros] = await Promise.all([
      PrestamoModel.aggregate([
        { $match: match },
        {
          $group: {
            _id: null,
            papeleriaGenerada: { $sum: '$papeleria' },
            papeleriaRetirada: {
              $sum: { $cond: ['$papeleriaRetirada', '$papeleria', 0] },
            },
            cartonesGenerados: { $sum: { $ifNull: ['$carton', 0] } },
            cartonesRetirados: {
              $sum: { $cond: [{ $ifNull: ['$cartonRetirado', false] }, { $ifNull: ['$carton', 0] }, 0] },
            },
            prestamos: { $sum: 1 },
          },
        },
      ]),
      MovimientoCajaModel.aggregate([
        { $match: { concepto: 'retiro_papeleria', deletedAt: null } },
        { $group: { _id: null, total: { $sum: '$monto' }, cantidad: { $sum: 1 } } },
      ]),
    ]);

    const t = totales[0];
    const papeleriaGenerada = t?.papeleriaGenerada ?? 0;
    const cartonesGenerados = t?.cartonesGenerados ?? 0;
    const papeleriaRetirada = t?.papeleriaRetirada ?? 0;
    const cartonesRetirados = t?.cartonesRetirados ?? 0;

    const generado = papeleriaGenerada + cartonesGenerados;
    const marcadoRetirado = papeleriaRetirada + cartonesRetirados;

    return {
      papeleria: {
        generada: papeleriaGenerada,
        retirada: papeleriaRetirada,
        disponible: papeleriaGenerada - papeleriaRetirada,
      },
      cartones: {
        generados: cartonesGenerados,
        retirados: cartonesRetirados,
        disponibles: cartonesGenerados - cartonesRetirados,
      },
      total: {
        generado,
        retirado: marcadoRetirado,
        disponible: generado - marcadoRetirado,
      },
      // Retiros de efectivo registrados contra esta cuenta en el libro de caja
      retirosEnCaja: { total: retiros[0]?.total ?? 0, cantidad: retiros[0]?.cantidad ?? 0 },
      prestamosConsiderados: t?.prestamos ?? 0,
    };
  }

  // ─── Resumen ejecutivo ──────────────────────────────────────
  /** Todo lo que el administrador necesita ver de un periodo, en una llamada. */
  async resumen(periodo: Periodo, desde?: string, hasta?: string, cobradorId?: string) {
    const rango = rangoPeriodo(periodo, desde, hasta);

    const [recaudo, colocacion, egresos, cart, papeleria, caja] = await Promise.all([
      this.recaudoPeriodo(rango, cobradorId),
      this.colocacionPeriodo(rango, cobradorId),
      this.egresosPeriodo(rango, cobradorId),
      this.cartera(cobradorId),
      this.cuentaPapeleria(cobradorId),
      this.resumenCaja(rango, cobradorId),
    ]);

    const ingresosBrutos =
      recaudo.interesDevengado +
      colocacion.papeleriaGenerada +
      colocacion.cartonesGenerados +
      egresos.otrosIngresos;

    const costos = egresos.gastos + egresos.otrosEgresos;
    const utilidadNeta = ingresosBrutos - costos;

    const dias = Math.max(
      1,
      Math.round((rango.fin.getTime() - rango.inicio.getTime()) / 86_400_000)
    );

    return {
      periodo: {
        clave: periodo,
        etiqueta: etiquetaPeriodo(periodo, rango),
        desde: rango.inicio,
        hasta: rango.fin,
        dias,
      },
      colocacion,
      recaudo: {
        ...recaudo,
        promedioDiario: Math.round(recaudo.total / dias),
      },
      ingresos: {
        interesDevengado: recaudo.interesDevengado,
        papeleria: colocacion.papeleriaGenerada,
        cartones: colocacion.cartonesGenerados,
        otros: egresos.otrosIngresos,
        total: ingresosBrutos,
      },
      egresos: {
        gastos: egresos.gastos,
        gastosPorCategoria: egresos.gastosPorCategoria,
        otros: egresos.otrosEgresos,
        retiros: egresos.retiros,
        total: costos,
      },
      utilidad: {
        bruta: ingresosBrutos,
        neta: utilidadNeta,
        margenSobreRecaudo: pct(utilidadNeta, recaudo.total),
        margenSobreColocado: pct(utilidadNeta, colocacion.capitalPrestado),
        rentabilidadCartera: pct(utilidadNeta, cart.capitalEnCalle),
      },
      flujoEfectivo: {
        entradas: recaudo.total + egresos.otrosIngresos,
        salidas: colocacion.desembolsadoEfectivo + egresos.gastos + egresos.otrosEgresos + egresos.retiros,
        neto:
          recaudo.total + egresos.otrosIngresos -
          (colocacion.desembolsadoEfectivo + egresos.gastos + egresos.otrosEgresos + egresos.retiros),
      },
      cartera: cart,
      cuentaPapeleria: papeleria,
      caja,
    };
  }

  /** Cierres del periodo: cuánto efectivo quedó y si hubo descuadres. */
  private async resumenCaja(rango: Rango, cobradorId?: string) {
    const desdeKey = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(rango.inicio);
    const hastaKey = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(rango.fin);

    const match: Record<string, unknown> = { fechaKey: { $gte: desdeKey, $lte: hastaKey } };
    if (cobradorId) match.cobrador = oid(cobradorId);

    const [agg, ultimo] = await Promise.all([
      CajaDiaModel.aggregate([
        { $match: { ...match, estado: 'cerrado' } },
        {
          $group: {
            _id: null,
            cierres: { $sum: 1 },
            diferenciaAcumulada: { $sum: '$diferencia' },
            faltantes: { $sum: { $cond: [{ $lt: ['$diferencia', 0] }, 1, 0] } },
            sobrantes: { $sum: { $cond: [{ $gt: ['$diferencia', 0] }, 1, 0] } },
          },
        },
      ]),
      CajaDiaModel.findOne(cobradorId ? { cobrador: oid(cobradorId) } : {})
        .sort({ fechaKey: -1 })
        .populate('cobrador', 'nombre')
        .lean(),
    ]);

    const a = agg[0];
    return {
      cierres: a?.cierres ?? 0,
      diferenciaAcumulada: a?.diferenciaAcumulada ?? 0,
      faltantes: a?.faltantes ?? 0,
      sobrantes: a?.sobrantes ?? 0,
      ultimoCierre: ultimo
        ? {
            fechaKey: ultimo.fechaKey,
            estado: ultimo.estado,
            saldoContado: ultimo.saldoContado,
            saldoEsperado: ultimo.saldoEsperado,
            diferencia: ultimo.diferencia,
            cobrador: ultimo.cobrador,
          }
        : null,
      hoyCerrada: (await CajaDiaModel.countDocuments({ ...match, fechaKey: keyDia(), estado: 'cerrado' })) > 0,
    };
  }

  // ─── Series temporales ──────────────────────────────────────
  /** Serie diaria de recaudo, colocación, gasto e interés devengado. */
  async series(dias: number = 30, cobradorId?: string) {
    const fin = rangoDia().fin;
    const inicio = new Date(fin.getTime() - dias * 86_400_000);

    const fmt = { $dateToString: { format: '%Y-%m-%d', date: '$fecha', timezone: TZ } };

    const matchCobros: Record<string, unknown> = { fecha: { $gte: inicio, $lte: fin }, anulado: false };
    const matchGastos: Record<string, unknown> = { fecha: { $gte: inicio, $lte: fin }, deletedAt: null };
    const matchPrestamos: Record<string, unknown> = {
      fechaInicio: { $gte: inicio, $lte: fin },
      deletedAt: null,
      estado: { $ne: 'cancelado' },
    };
    if (cobradorId) {
      matchCobros.cobrador = oid(cobradorId);
      matchGastos.usuario = oid(cobradorId);
      matchPrestamos.cobrador = oid(cobradorId);
    }

    const [cobros, prestamos, gastos] = await Promise.all([
      CobroModel.aggregate([
        { $match: matchCobros },
        { $lookup: { from: 'prestamos', localField: 'prestamo', foreignField: '_id', as: 'p' } },
        { $unwind: { path: '$p', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            fecha: 1,
            monto: 1,
            interes: {
              $cond: [
                { $gt: [{ $ifNull: ['$p.totalPagar', 0] }, 0] },
                { $multiply: ['$monto', { $divide: ['$p.totalInteres', '$p.totalPagar'] }] },
                0,
              ],
            },
          },
        },
        {
          $group: {
            _id: fmt,
            cobrado: { $sum: '$monto' },
            interes: { $sum: '$interes' },
            cantidad: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      PrestamoModel.aggregate([
        { $match: matchPrestamos },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$fechaInicio', timezone: TZ } },
            prestado: { $sum: '$capital' },
            desembolsado: { $sum: '$montoDesembolsado' },
            cantidad: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      GastoModel.aggregate([
        { $match: matchGastos },
        { $group: { _id: fmt, gastos: { $sum: '$monto' } } },
        { $sort: { _id: 1 } },
      ]),
    ]);

    // Rellenar los días sin movimiento para que la gráfica no tenga huecos
    const mapCobros = new Map(cobros.map((c) => [c._id, c]));
    const mapPrestamos = new Map(prestamos.map((p) => [p._id, p]));
    const mapGastos = new Map(gastos.map((g) => [g._id, g]));

    const serie: Array<Record<string, number | string>> = [];
    for (let i = dias; i >= 0; i--) {
      const dia = new Date(fin.getTime() - i * 86_400_000);
      const key = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(dia);
      const c = mapCobros.get(key);
      const p = mapPrestamos.get(key);
      const g = mapGastos.get(key);
      serie.push({
        fecha: key,
        cobrado: c?.cobrado ?? 0,
        interes: redondear(c?.interes ?? 0),
        cobros: c?.cantidad ?? 0,
        prestado: p?.prestado ?? 0,
        desembolsado: p?.desembolsado ?? 0,
        prestamos: p?.cantidad ?? 0,
        gastos: g?.gastos ?? 0,
      });
    }

    return serie;
  }

  /** Recaudo y colocación agrupados por mes, para ver la tendencia larga. */
  async seriesMensuales(meses: number = 12) {
    const fin = new Date();
    const inicio = new Date(fin.getFullYear(), fin.getMonth() - meses + 1, 1);

    const [cobros, prestamos] = await Promise.all([
      CobroModel.aggregate([
        { $match: { fecha: { $gte: inicio, $lte: fin }, anulado: false } },
        { $lookup: { from: 'prestamos', localField: 'prestamo', foreignField: '_id', as: 'p' } },
        { $unwind: { path: '$p', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            mes: { $dateToString: { format: '%Y-%m', date: '$fecha', timezone: TZ } },
            monto: 1,
            interes: {
              $cond: [
                { $gt: [{ $ifNull: ['$p.totalPagar', 0] }, 0] },
                { $multiply: ['$monto', { $divide: ['$p.totalInteres', '$p.totalPagar'] }] },
                0,
              ],
            },
          },
        },
        { $group: { _id: '$mes', cobrado: { $sum: '$monto' }, interes: { $sum: '$interes' } } },
        { $sort: { _id: 1 } },
      ]),
      PrestamoModel.aggregate([
        { $match: { fechaInicio: { $gte: inicio, $lte: fin }, deletedAt: null, estado: { $ne: 'cancelado' } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m', date: '$fechaInicio', timezone: TZ } },
            prestado: { $sum: '$capital' },
            cantidad: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
    ]);

    const mapPrestamos = new Map(prestamos.map((p) => [p._id, p]));
    return cobros.map((c) => ({
      mes: c._id,
      cobrado: c.cobrado,
      interes: redondear(c.interes),
      prestado: mapPrestamos.get(c._id)?.prestado ?? 0,
      prestamos: mapPrestamos.get(c._id)?.cantidad ?? 0,
    }));
  }

  // ─── Rendimiento por cobrador ───────────────────────────────
  async rendimientoCobradores(periodo: Periodo, desde?: string, hasta?: string) {
    const rango = rangoPeriodo(periodo, desde, hasta);
    const cobradores = await UsuarioModel.find({ activo: true }).select('nombre email rol').lean();

    return Promise.all(
      cobradores.map(async (u) => {
        const id = u._id.toString();
        const [recaudo, colocacion, cart] = await Promise.all([
          this.recaudoPeriodo(rango, id),
          this.colocacionPeriodo(rango, id),
          this.cartera(id),
        ]);
        return {
          cobrador: { id, nombre: u.nombre, email: u.email, rol: u.rol },
          recaudado: recaudo.total,
          cobros: recaudo.cantidad,
          interesDevengado: recaudo.interesDevengado,
          prestado: colocacion.capitalPrestado,
          prestamosNuevos: colocacion.cantidad,
          carteraActiva: cart.saldoPendiente,
          prestamosActivos: cart.prestamosActivos,
          montoVencido: cart.montoVencido,
          indiceMora: cart.indiceMora,
        };
      })
    );
  }

  // ─── Antigüedad de cartera ──────────────────────────────────
  /** Cuánto se debe, agrupado por cuántos días lleva vencido. */
  async aging() {
    const hoy = new Date();
    const filas = await PrestamoModel.aggregate([
      { $match: { estado: 'activo', deletedAt: null } },
      { $unwind: '$cuotas' },
      { $match: { 'cuotas.estado': { $in: ['vencida', 'parcial'] } } },
      {
        $project: {
          pendiente: { $subtract: ['$cuotas.monto', { $ifNull: ['$cuotas.montoPagado', 0] }] },
          diasMora: {
            $dateDiff: { startDate: '$cuotas.fechaEsperada', endDate: hoy, unit: 'day' },
          },
        },
      },
      { $match: { pendiente: { $gt: 0 }, diasMora: { $gt: 0 } } },
      {
        $bucket: {
          groupBy: '$diasMora',
          boundaries: [1, 8, 16, 31, 61, 91, 100000],
          default: 'otros',
          output: { monto: { $sum: '$pendiente' }, cuotas: { $sum: 1 } },
        },
      },
    ]);

    const etiquetas: Record<string, string> = {
      '1': '1 a 7 días',
      '8': '8 a 15 días',
      '16': '16 a 30 días',
      '31': '31 a 60 días',
      '61': '61 a 90 días',
      '91': 'Más de 90 días',
    };

    return filas.map((f) => ({
      rango: etiquetas[String(f._id)] ?? 'Sin clasificar',
      desdeDias: f._id,
      monto: f.monto,
      cuotas: f.cuotas,
    }));
  }

  // ─── Top clientes ───────────────────────────────────────────
  async topClientes(periodo: Periodo, desde?: string, hasta?: string, limite = 10) {
    const rango = rangoPeriodo(periodo, desde, hasta);
    return CobroModel.aggregate([
      { $match: { fecha: { $gte: rango.inicio, $lte: rango.fin }, anulado: false } },
      { $group: { _id: '$cliente', pagado: { $sum: '$monto' }, pagos: { $sum: 1 } } },
      { $sort: { pagado: -1 } },
      { $limit: limite },
      { $lookup: { from: 'clientes', localField: '_id', foreignField: '_id', as: 'c' } },
      { $unwind: '$c' },
      {
        $project: {
          clienteId: '$_id',
          nombre: '$c.nombre',
          cedula: '$c.cedula',
          celular: '$c.celular',
          pagado: 1,
          pagos: 1,
        },
      },
    ]);
  }
}

export const adminService = new AdminService();

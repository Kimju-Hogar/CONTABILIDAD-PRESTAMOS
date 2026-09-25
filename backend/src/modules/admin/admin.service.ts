import mongoose from 'mongoose';
import { CobroModel } from '../../models/Cobro.model';
import { PrestamoModel } from '../../models/Prestamo.model';
import { GastoModel } from '../../models/Gasto.model';
import { ClienteModel } from '../../models/Cliente.model';
import { CajaDiaModel } from '../../models/CajaDia.model';
import { MovimientoCajaModel } from '../../models/MovimientoCaja.model';
import { UsuarioModel } from '../../models/Usuario.model';
import { obtenerConfiguracion } from '../../models/Configuracion.model';
import { cajaService } from '../caja/caja.service';
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

    // Meter plata propia a la caja no es una venta: engorda el efectivo pero no
    // la ganancia. Se reporta aparte para no inflar la utilidad.
    const aportes = movimientos
      .filter((m) => m._id.tipo === 'ingreso' && m._id.concepto === 'inyeccion_capital')
      .reduce((acc, m) => acc + m.total, 0);
    const otrosIngresos = movimientos
      .filter((m) => m._id.tipo === 'ingreso' && m._id.concepto !== 'inyeccion_capital')
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
      aportes,
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
    const config = await obtenerConfiguracion();
    const corte = config.fechaCortePapeleria;

    const match: Record<string, unknown> = { deletedAt: null, estado: { $ne: 'cancelado' } };
    if (cobradorId) match.cobrador = oid(cobradorId);
    // Si hay corte de periodo, la cuenta sólo mira los préstamos de ahí en
    // adelante; lo anterior queda archivado pero consultable.
    if (corte) match.fechaInicio = { $gte: corte };

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

    // El cartón no se retira: es ganancia del negocio desde que se cobra
    const generado = papeleriaGenerada + cartonesGenerados;

    return {
      papeleria: {
        generada: papeleriaGenerada,
        retirada: papeleriaRetirada,
        disponible: papeleriaGenerada - papeleriaRetirada,
      },
      cartones: {
        generados: cartonesGenerados,
      },
      total: {
        generado,
        retirado: papeleriaRetirada,
        disponible: generado - papeleriaRetirada,
      },
      // Retiros de efectivo registrados contra esta cuenta en el libro de caja
      retirosEnCaja: { total: retiros[0]?.total ?? 0, cantidad: retiros[0]?.cantidad ?? 0 },
      prestamosConsiderados: t?.prestamos ?? 0,
      fechaCorte: corte,
    };
  }

  /**
   * Patrimonio del negocio: la plata que está afuera más la que hay en caja.
   *
   * "En la calle" es el saldo por cobrar, o sea capital pendiente más el
   * interés que falta por ganar — que es como el dueño cuenta su plata.
   * Prestar mueve efectivo de la caja a la calle; cobrar lo devuelve.
   */
  async patrimonio(cobradorId?: string) {
    const matchCartera: Record<string, unknown> = { estado: 'activo', deletedAt: null };
    if (cobradorId) matchCartera.cobrador = oid(cobradorId);

    const [cartera, cajas] = await Promise.all([
      PrestamoModel.aggregate([
        { $match: matchCartera },
        {
          $group: {
            _id: null,
            porCobrar: { $sum: '$saldoPendiente' },
            capitalPendiente: {
              $sum: {
                $max: [0, { $subtract: ['$capital', '$totalCobrado'] }],
              },
            },
            prestamos: { $sum: 1 },
          },
        },
      ]),
      // Efectivo: el último cierre de cada cobrador, más lo que lleve el día abierto
      CajaDiaModel.aggregate([
        { $sort: { fechaKey: -1 } },
        {
          $group: {
            _id: '$cobrador',
            estado: { $first: '$estado' },
            fechaKey: { $first: '$fechaKey' },
            baseInicial: { $first: '$baseInicial' },
            saldoContado: { $first: '$saldoContado' },
            saldoEsperado: { $first: '$saldoEsperado' },
          },
        },
      ]),
    ]);

    const c = cartera[0];
    const porCobrar = c?.porCobrar ?? 0;
    const capitalPendiente = c?.capitalPendiente ?? 0;

    let efectivo = 0;
    for (const caja of cajas) {
      if (caja.estado === 'cerrado') {
        efectivo += caja.saldoContado ?? caja.saldoEsperado ?? 0;
      } else {
        const t = await cajaService.calcularTotalesDia(caja.fechaKey, String(caja._id));
        efectivo +=
          (caja.baseInicial ?? 0) + t.totalCobrado + t.otrosIngresos
          - t.totalPrestado - t.totalGastos - t.otrosEgresos;
      }
    }

    return {
      enLaCalle: porCobrar,
      capitalPendiente,
      interesPorGanar: porCobrar - capitalPendiente,
      prestamosActivos: c?.prestamos ?? 0,
      efectivoEnCaja: efectivo,
      total: porCobrar + efectivo,
      cajasConsideradas: cajas.length,
    };
  }

  // ─── Resumen ejecutivo ──────────────────────────────────────
  /** Todo lo que el administrador necesita ver de un periodo, en una llamada. */
  async resumen(periodo: Periodo, desde?: string, hasta?: string, cobradorId?: string) {
    const rango = rangoPeriodo(periodo, desde, hasta);

    const [recaudo, colocacion, egresos, cart, papeleria, caja, patrimonio] = await Promise.all([
      this.recaudoPeriodo(rango, cobradorId),
      this.colocacionPeriodo(rango, cobradorId),
      this.egresosPeriodo(rango, cobradorId),
      this.cartera(cobradorId),
      this.cuentaPapeleria(cobradorId),
      this.resumenCaja(rango, cobradorId),
      this.patrimonio(cobradorId),
    ]);

    // La papelería es lo que se lleva el cobrador, así que no entra en la
    // utilidad del dueño: se reporta aparte y luego se suma al total generado.
    const ingresosNegocio =
      recaudo.interesDevengado + colocacion.cartonesGenerados + egresos.otrosIngresos;
    const papeleriaCobrador = colocacion.papeleriaGenerada;

    const costos = egresos.gastos + egresos.otrosEgresos;
    const utilidadNegocio = ingresosNegocio - costos;
    const totalGenerado = utilidadNegocio + papeleriaCobrador;

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
        papeleria: papeleriaCobrador,
        cartones: colocacion.cartonesGenerados,
        otros: egresos.otrosIngresos,
        totalNegocio: ingresosNegocio,
        total: ingresosNegocio + papeleriaCobrador,
      },
      egresos: {
        gastos: egresos.gastos,
        gastosPorCategoria: egresos.gastosPorCategoria,
        otros: egresos.otrosEgresos,
        retiros: egresos.retiros,
        total: costos,
      },
      utilidad: {
        negocio: utilidadNegocio,
        cobrador: papeleriaCobrador,
        total: totalGenerado,
        margenSobreRecaudo: pct(utilidadNegocio, recaudo.total),
        margenSobreColocado: pct(utilidadNegocio, colocacion.capitalPrestado),
        rentabilidadCartera: pct(utilidadNegocio, cart.capitalEnCalle),
      },
      flujoEfectivo: {
        // Aquí sí entra la plata propia inyectada: mueve caja aunque no sea ganancia
        entradas: recaudo.total + egresos.otrosIngresos + egresos.aportes,
        salidas: colocacion.desembolsadoEfectivo + egresos.gastos + egresos.otrosEgresos + egresos.retiros,
        aportes: egresos.aportes,
        neto:
          recaudo.total + egresos.otrosIngresos + egresos.aportes -
          (colocacion.desembolsadoEfectivo + egresos.gastos + egresos.otrosEgresos + egresos.retiros),
      },
      cartera: cart,
      cuentaPapeleria: papeleria,
      caja,
      patrimonio,
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

  // ─── Desglose por día o por mes ─────────────────────────────
  /**
   * Una fila por día (o por mes) del periodo, con lo prestado, lo recogido, el
   * interés ganado, la papelería del cobrador, los cartones y los gastos.
   * Es la tabla que se imprime en el reporte.
   */
  async desglose(
    rango: Rango,
    granularidad: 'dia' | 'mes' = 'dia',
    cobradorId?: string
  ) {
    const formato = granularidad === 'mes' ? '%Y-%m' : '%Y-%m-%d';

    const matchCobros: Record<string, unknown> = {
      fecha: { $gte: rango.inicio, $lte: rango.fin },
      anulado: false,
    };
    const matchPrestamos: Record<string, unknown> = {
      fechaInicio: { $gte: rango.inicio, $lte: rango.fin },
      deletedAt: null,
      estado: { $ne: 'cancelado' },
    };
    const matchGastos: Record<string, unknown> = {
      fecha: { $gte: rango.inicio, $lte: rango.fin },
      deletedAt: null,
    };
    // Mismo criterio que el resumen: los aportes de capital no son ganancia
    const matchMovimientos: Record<string, unknown> = {
      fecha: { $gte: rango.inicio, $lte: rango.fin },
      deletedAt: null,
      concepto: { $nin: ['inyeccion_capital', 'retiro_utilidad', 'retiro_papeleria'] },
    };
    if (cobradorId) {
      matchCobros.cobrador = oid(cobradorId);
      matchPrestamos.cobrador = oid(cobradorId);
      matchGastos.usuario = oid(cobradorId);
      matchMovimientos.cobrador = oid(cobradorId);
    }

    const [cobros, prestamos, gastos, movimientos] = await Promise.all([
      CobroModel.aggregate([
        { $match: matchCobros },
        { $lookup: { from: 'prestamos', localField: 'prestamo', foreignField: '_id', as: 'p' } },
        { $unwind: { path: '$p', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            clave: { $dateToString: { format: formato, date: '$fecha', timezone: TZ } },
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
            _id: '$clave',
            recaudado: { $sum: '$monto' },
            interes: { $sum: '$interes' },
            cobros: { $sum: 1 },
          },
        },
      ]),
      PrestamoModel.aggregate([
        { $match: matchPrestamos },
        {
          $group: {
            _id: { $dateToString: { format: formato, date: '$fechaInicio', timezone: TZ } },
            prestado: { $sum: '$capital' },
            desembolsado: { $sum: '$montoDesembolsado' },
            papeleria: { $sum: '$papeleria' },
            cartones: { $sum: { $ifNull: ['$carton', 0] } },
            prestamos: { $sum: 1 },
          },
        },
      ]),
      GastoModel.aggregate([
        { $match: matchGastos },
        {
          $group: {
            _id: { $dateToString: { format: formato, date: '$fecha', timezone: TZ } },
            gastos: { $sum: '$monto' },
          },
        },
      ]),
      MovimientoCajaModel.aggregate([
        { $match: matchMovimientos },
        {
          $group: {
            _id: {
              clave: { $dateToString: { format: formato, date: '$fecha', timezone: TZ } },
              tipo: '$tipo',
            },
            total: { $sum: '$monto' },
          },
        },
      ]),
    ]);

    const mapC = new Map(cobros.map((x) => [x._id, x]));
    const mapP = new Map(prestamos.map((x) => [x._id, x]));
    const mapG = new Map(gastos.map((x) => [x._id, x]));
    const mapMovIn = new Map(
      movimientos.filter((m) => m._id.tipo === 'ingreso').map((m) => [m._id.clave, m.total])
    );
    const mapMovOut = new Map(
      movimientos.filter((m) => m._id.tipo === 'egreso').map((m) => [m._id.clave, m.total])
    );

    const claves = [
      ...new Set([...mapC.keys(), ...mapP.keys(), ...mapG.keys(), ...mapMovIn.keys(), ...mapMovOut.keys()]),
    ].sort();

    return claves.map((clave) => {
      const c = mapC.get(clave);
      const p = mapP.get(clave);
      const g = mapG.get(clave);
      const interes = redondear(c?.interes ?? 0);
      const cartones = p?.cartones ?? 0;
      const gastosDia = g?.gastos ?? 0;
      const otrosIngresos = mapMovIn.get(clave) ?? 0;
      const otrosEgresos = mapMovOut.get(clave) ?? 0;
      return {
        clave,
        prestado: p?.prestado ?? 0,
        desembolsado: p?.desembolsado ?? 0,
        prestamos: p?.prestamos ?? 0,
        recaudado: c?.recaudado ?? 0,
        cobros: c?.cobros ?? 0,
        interes,
        papeleria: p?.papeleria ?? 0,
        cartones,
        gastos: gastosDia,
        otrosIngresos,
        otrosEgresos,
        // Utilidad del dueño: la papelería es del cobrador y se reporta aparte
        utilidadNegocio: interes + cartones + otrosIngresos - gastosDia - otrosEgresos,
      };
    });
  }

  /** Todo lo que lleva el reporte general, en una sola consulta compuesta. */
  async reporteGeneral(periodo: Periodo, desde?: string, hasta?: string, cobradorId?: string) {
    const rango = rangoPeriodo(periodo, desde, hasta);

    const [resumen, porDia, porMes, cobradores, aging] = await Promise.all([
      this.resumen(periodo, desde, hasta, cobradorId),
      this.desglose(rango, 'dia', cobradorId),
      this.desglose(rango, 'mes', cobradorId),
      this.rendimientoCobradores(periodo, desde, hasta),
      this.aging(),
    ]);

    return { resumen, porDia, porMes, cobradores, aging, generadoEn: new Date() };
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

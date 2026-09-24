import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import { startOfWeek, startOfMonth, endOfMonth, subDays } from 'date-fns';
import { CobroModel } from '../../models/Cobro.model';
import { PrestamoModel } from '../../models/Prestamo.model';
import { GastoModel } from '../../models/Gasto.model';
import { ClienteModel } from '../../models/Cliente.model';

const TZ = 'America/Bogota';

function rangoHoy() {
  const ahora = toZonedTime(new Date(), TZ);
  const inicio = fromZonedTime(new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate(), 0, 0, 0), TZ);
  const fin = fromZonedTime(new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate(), 23, 59, 59, 999), TZ);
  return { inicio, fin };
}

function rangoSemana() {
  const ahora = toZonedTime(new Date(), TZ);
  const inicio = fromZonedTime(startOfWeek(ahora, { weekStartsOn: 1 }), TZ);
  const fin = fromZonedTime(new Date(), TZ);
  return { inicio, fin };
}

function rangoMes() {
  const ahora = toZonedTime(new Date(), TZ);
  const inicio = fromZonedTime(startOfMonth(ahora), TZ);
  const fin = fromZonedTime(endOfMonth(ahora), TZ);
  return { inicio, fin };
}

export class DashboardService {
  async getKPIs() {
    const hoy = rangoHoy();
    const semana = rangoSemana();
    const mes = rangoMes();

    // Ejecutar todo en paralelo para máxima velocidad
    const [
      cobrosDia, cobrosSemana, cobrosMes,
      clientesActivos, clientesMorosos,
      prestamosActivos,
      gastosMes,
    ] = await Promise.all([
      // Cobros del día
      CobroModel.aggregate([
        { $match: { fecha: { $gte: hoy.inicio, $lte: hoy.fin }, anulado: false } },
        { $group: { _id: null, total: { $sum: '$monto' }, cantidad: { $sum: 1 } } },
      ]),
      // Cobros de la semana
      CobroModel.aggregate([
        { $match: { fecha: { $gte: semana.inicio, $lte: semana.fin }, anulado: false } },
        { $group: { _id: null, total: { $sum: '$monto' }, cantidad: { $sum: 1 } } },
      ]),
      // Cobros del mes
      CobroModel.aggregate([
        { $match: { fecha: { $gte: mes.inicio, $lte: mes.fin }, anulado: false } },
        { $group: { _id: null, total: { $sum: '$monto' }, cantidad: { $sum: 1 } } },
      ]),
      // Clientes activos
      ClienteModel.countDocuments({ estado: 'activo', deletedAt: null }),
      // Clientes morosos
      ClienteModel.countDocuments({ estado: 'moroso', deletedAt: null }),
      // Préstamos activos + métricas de capital
      PrestamoModel.aggregate([
        { $match: { estado: 'activo', deletedAt: null } },
        {
          $group: {
            _id: null,
            capitalColocado: { $sum: '$capital' },
            saldoPendienteTotal: { $sum: '$saldoPendiente' },
            totalCobrado: { $sum: '$totalCobrado' },
            gananciaTotal: { $sum: '$ganancia' },
            cantidad: { $sum: 1 },
          },
        },
      ]),
      // Gastos del mes
      GastoModel.aggregate([
        { $match: { fecha: { $gte: mes.inicio, $lte: mes.fin }, deletedAt: null } },
        { $group: { _id: null, total: { $sum: '$monto' } } },
      ]),
    ]);

    const prestamos = prestamosActivos[0] ?? {
      capitalColocado: 0, saldoPendienteTotal: 0,
      totalCobrado: 0, gananciaTotal: 0, cantidad: 0,
    };
    const gastos = gastosMes[0]?.total ?? 0;
    const cobradoMes = cobrosMes[0]?.total ?? 0;

    return {
      cobros: {
        dia: { monto: cobrosDia[0]?.total ?? 0, cantidad: cobrosDia[0]?.cantidad ?? 0 },
        semana: { monto: cobrosSemana[0]?.total ?? 0, cantidad: cobrosSemana[0]?.cantidad ?? 0 },
        mes: { monto: cobradoMes, cantidad: cobrosMes[0]?.cantidad ?? 0 },
      },
      clientes: {
        activos: clientesActivos,
        morosos: clientesMorosos,
      },
      capital: {
        colocado: prestamos.capitalColocado,
        saldoPendiente: prestamos.saldoPendienteTotal,
        recuperado: prestamos.totalCobrado,
        ganancias: prestamos.gananciaTotal,
        prestamosActivos: prestamos.cantidad,
      },
      financiero: {
        gastosMes: gastos,
        flujoCaja: cobradoMes - gastos,
      },
    };
  }

  async getFlujoCaja(dias: number = 30) {
    const desde = fromZonedTime(
      toZonedTime(subDays(new Date(), dias), TZ),
      TZ
    );

    const [cobros, gastos] = await Promise.all([
      CobroModel.aggregate([
        { $match: { fecha: { $gte: desde }, anulado: false } },
        {
          $group: {
            _id: {
              year: { $year: { date: '$fecha', timezone: TZ } },
              month: { $month: { date: '$fecha', timezone: TZ } },
              day: { $dayOfMonth: { date: '$fecha', timezone: TZ } },
            },
            cobros: { $sum: '$monto' },
          },
        },
        { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } },
      ]),
      GastoModel.aggregate([
        { $match: { fecha: { $gte: desde }, deletedAt: null } },
        {
          $group: {
            _id: {
              year: { $year: { date: '$fecha', timezone: TZ } },
              month: { $month: { date: '$fecha', timezone: TZ } },
              day: { $dayOfMonth: { date: '$fecha', timezone: TZ } },
            },
            gastos: { $sum: '$monto' },
          },
        },
      ]),
    ]);

    return { cobros, gastos };
  }

  async getClientesMorosos() {
    const hoy = new Date();
    // Préstamos activos con cuotas vencidas
    return PrestamoModel.aggregate([
      {
        $match: {
          estado: 'activo',
          deletedAt: null,
          cuotas: { $elemMatch: { estado: 'vencida' } },
        },
      },
      {
        $lookup: {
          from: 'clientes',
          localField: 'cliente',
          foreignField: '_id',
          as: 'clienteInfo',
        },
      },
      { $unwind: '$clienteInfo' },
      {
        $project: {
          clienteNombre: '$clienteInfo.nombre',
          clienteCelular: '$clienteInfo.celular',
          saldoPendiente: 1,
          cuotaDiaria: 1,
          cuotasVencidas: {
            $size: {
              $filter: {
                input: '$cuotas',
                cond: { $eq: ['$$this.estado', 'vencida'] },
              },
            },
          },
          diasMora: {
            $dateDiff: {
              startDate: '$fechaFin',
              endDate: hoy,
              unit: 'day',
            },
          },
        },
      },
      { $sort: { cuotasVencidas: -1 } },
      { $limit: 50 },
    ]);
  }
  /**
   * Los clientes repartidos por cómo van, que es como el cobrador piensa la
   * ruta: quién ya pagó hoy, quién falta, quién está en mora y quién terminó.
   *
   * Un cliente cae en un solo grupo, por prioridad: primero si pagó hoy,
   * después si está en mora, después si le toca hoy, y si no, al día.
   */
  async getTableroClientes() {
    const { inicio, fin } = rangoHoy();

    const activos = await PrestamoModel.aggregate([
      { $match: { estado: 'activo', deletedAt: null } },
      {
        $lookup: {
          from: 'clientes', localField: 'cliente', foreignField: '_id', as: 'c',
        },
      },
      { $unwind: '$c' },
      {
        $lookup: {
          from: 'cobros',
          let: { p: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ['$prestamo', '$$p'] },
                fecha: { $gte: inicio, $lte: fin },
                anulado: false,
              },
            },
          ],
          as: 'cobrosHoy',
        },
      },
      {
        $lookup: {
          from: 'cobros',
          let: { p: '$_id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$prestamo', '$$p'] }, anulado: false } },
            { $sort: { fecha: -1 } },
            { $limit: 1 },
            { $project: { fecha: 1 } },
          ],
          as: 'ultimo',
        },
      },
      {
        $addFields: {
          esperadoALaFecha: {
            $sum: {
              $map: {
                input: { $filter: { input: '$cuotas', cond: { $lte: ['$$this.fechaEsperada', fin] } } },
                in: '$$this.monto',
              },
            },
          },
          ultimoPago: { $arrayElemAt: ['$ultimo', 0] },
        },
      },
      {
        $project: {
          prestamoId: '$_id',
          clienteId: '$c._id',
          nombre: '$c.nombre',
          celular: '$c.celular',
          barrio: '$c.barrio',
          cuota: '$cuotaDiaria',
          saldoPendiente: 1,
          totalPagar: 1,
          totalCobrado: 1,
          pagadoHoy: { $gt: [{ $size: '$cobrosHoy' }, 0] },
          montoCobradoHoy: { $sum: '$cobrosHoy.monto' },
          atraso: { $max: [0, { $subtract: ['$esperadoALaFecha', '$totalCobrado'] }] },
          leTocaHoy: { $gt: ['$esperadoALaFecha', 0] },
          diasSinPagar: {
            $cond: [
              { $ifNull: ['$ultimoPago.fecha', false] },
              { $dateDiff: { startDate: '$ultimoPago.fecha', endDate: fin, unit: 'day' } },
              { $dateDiff: { startDate: '$fechaInicio', endDate: fin, unit: 'day' } },
            ],
          },
        },
      },
      { $sort: { atraso: -1, nombre: 1 } },
    ]);

    // Clientes que ya terminaron: sin préstamos activos y con alguno completado
    const terminados = await PrestamoModel.aggregate([
      { $match: { estado: 'completado', deletedAt: null } },
      {
        $group: {
          _id: '$cliente',
          prestamosPagados: { $sum: 1 },
          totalPagado: { $sum: '$totalCobrado' },
          ultimaFecha: { $max: '$updatedAt' },
        },
      },
      {
        $lookup: {
          from: 'prestamos',
          let: { cli: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ['$cliente', '$$cli'] },
                estado: 'activo',
                deletedAt: null,
              },
            },
            { $limit: 1 },
          ],
          as: 'vigentes',
        },
      },
      { $match: { 'vigentes.0': { $exists: false } } },
      { $lookup: { from: 'clientes', localField: '_id', foreignField: '_id', as: 'c' } },
      { $unwind: '$c' },
      { $match: { 'c.deletedAt': null } },
      {
        $project: {
          clienteId: '$_id',
          nombre: '$c.nombre',
          celular: '$c.celular',
          barrio: '$c.barrio',
          prestamosPagados: 1,
          totalPagado: 1,
          ultimaFecha: 1,
        },
      },
      { $sort: { ultimaFecha: -1 } },
    ]);

    // Reparto por prioridad: un cliente aparece en un solo grupo
    const pagaronHoy = activos.filter((p) => p.pagadoHoy);
    const restantes = activos.filter((p) => !p.pagadoHoy);
    const enMora = restantes.filter((p) => p.diasSinPagar >= 2 && p.atraso > 0);
    const sinMora = restantes.filter((p) => !(p.diasSinPagar >= 2 && p.atraso > 0));
    const debenHoy = sinMora.filter((p) => p.leTocaHoy);
    const alDia = sinMora.filter((p) => !p.leTocaHoy);

    const resumir = (lista: Array<Record<string, number>>, campo: string) => ({
      cantidad: lista.length,
      monto: lista.reduce((a, x) => a + (Number(x[campo]) || 0), 0),
    });

    return {
      pagaronHoy: { ...resumir(pagaronHoy, 'montoCobradoHoy'), clientes: pagaronHoy },
      enMora: { ...resumir(enMora, 'atraso'), clientes: enMora },
      debenHoy: { ...resumir(debenHoy, 'cuota'), clientes: debenHoy },
      alDia: { ...resumir(alDia, 'saldoPendiente'), clientes: alDia },
      terminados: { ...resumir(terminados, 'totalPagado'), clientes: terminados },
      totales: {
        conPrestamoActivo: activos.length,
        clientesActivos: new Set(activos.map((p) => String(p.clienteId))).size,
      },
    };
  }

  async getClientesACobrarHoy() {
    const { inicio, fin } = rangoHoy();

    // 1. Préstamos activos con cuotas esperadas hoy o cuotas vencidas (sin pagar)
    const prestamosHoy = await PrestamoModel.aggregate([
      {
        $match: {
          estado: 'activo',
          deletedAt: null,
        },
      },
      {
        // Filtrar cuotas que corresponden a hoy (pendientes/vencidas)
        $addFields: {
          cuotasHoy: {
            $filter: {
              input: '$cuotas',
              cond: {
                $and: [
                  { $in: ['$$this.estado', ['pendiente', 'vencida', 'parcial']] },
                  {
                    $lte: [
                      '$$this.fechaEsperada',
                      fin,
                    ],
                  },
                ],
              },
            },
          },
        },
      },
      {
        $match: {
          'cuotasHoy.0': { $exists: true }, // Al menos una cuota debida hoy o antes
        },
      },
      {
        $lookup: {
          from: 'clientes',
          localField: 'cliente',
          foreignField: '_id',
          as: 'clienteInfo',
        },
      },
      { $unwind: '$clienteInfo' },
      {
        $lookup: {
          from: 'cobros',
          let: { prestamoId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ['$prestamo', '$$prestamoId'] },
                fecha: { $gte: inicio, $lte: fin },
                anulado: false,
              },
            },
          ],
          as: 'cobrosHoy',
        },
      },
      {
        // Último pago del préstamo, sin importar la fecha, para saber hace
        // cuántos días que el cliente no aparece
        $lookup: {
          from: 'cobros',
          let: { prestamoId: '$_id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$prestamo', '$$prestamoId'] }, anulado: false } },
            { $sort: { fecha: -1 } },
            { $limit: 1 },
            { $project: { fecha: 1, monto: 1 } },
          ],
          as: 'ultimoCobro',
        },
      },
      {
        $addFields: {
          // Lo que el cliente ya debería haber pagado si hubiera seguido el plan
          esperadoALaFecha: {
            $sum: {
              $map: {
                input: {
                  $filter: { input: '$cuotas', cond: { $lte: ['$$this.fechaEsperada', fin] } },
                },
                in: '$$this.monto',
              },
            },
          },
          ultimoPago: { $arrayElemAt: ['$ultimoCobro', 0] },
        },
      },
      {
        $project: {
          prestamoId: '$_id',
          clienteId: '$clienteInfo._id',
          clienteNombre: '$clienteInfo.nombre',
          clienteCelular: '$clienteInfo.celular',
          modalidad: 1,
          cuotaDiaria: 1,
          saldoPendiente: 1,
          totalCobrado: 1,
          // Cuotas que pasaron de fecha sin recibir un solo peso
          cuotasVencidas: {
            $size: {
              $filter: { input: '$cuotas', cond: { $eq: ['$$this.estado', 'vencida'] } },
            },
          },
          // Atraso real en plata: lo que debía llevar pagado menos lo que pagó
          atraso: {
            $max: [0, { $subtract: ['$esperadoALaFecha', '$totalCobrado'] }],
          },
          // Si va adelantado, cuánto
          adelanto: {
            $max: [0, { $subtract: ['$totalCobrado', '$esperadoALaFecha'] }],
          },
          proximaCuota: { $arrayElemAt: ['$cuotasHoy', 0] },
          pagadoHoy: { $gt: [{ $size: '$cobrosHoy' }, 0] },
          montoCobradoHoy: { $sum: '$cobrosHoy.monto' },
          ultimoPagoFecha: '$ultimoPago.fecha',
          diasSinPagar: {
            $cond: [
              { $ifNull: ['$ultimoPago.fecha', false] },
              { $dateDiff: { startDate: '$ultimoPago.fecha', endDate: fin, unit: 'day' } },
              { $dateDiff: { startDate: '$fechaInicio', endDate: fin, unit: 'day' } },
            ],
          },
        },
      },
      // Primero los que faltan por cobrar hoy, y dentro de esos los más atrasados
      {
        $sort: { pagadoHoy: 1, atraso: -1, clienteNombre: 1 },
      },
    ]);

    return prestamosHoy;
  }
}

export const dashboardService = new DashboardService();

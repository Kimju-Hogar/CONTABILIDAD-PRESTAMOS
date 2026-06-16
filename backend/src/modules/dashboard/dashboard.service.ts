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
        $project: {
          prestamoId: '$_id',
          clienteId: '$clienteInfo._id',
          clienteNombre: '$clienteInfo.nombre',
          clienteCelular: '$clienteInfo.celular',
          modalidad: 1,
          cuotaDiaria: 1,
          saldoPendiente: 1,
          cuotasVencidas: {
            $size: {
              $filter: {
                input: '$cuotas',
                cond: { $eq: ['$$this.estado', 'vencida'] },
              },
            },
          },
          // Próxima cuota pendiente
          proximaCuota: { $arrayElemAt: ['$cuotasHoy', 0] },
          // Si ya hay cobro registrado hoy
          pagadoHoy: { $gt: [{ $size: '$cobrosHoy' }, 0] },
          montoCobradoHoy: { $sum: '$cobrosHoy.monto' },
        },
      },
      // Ordenar: primero los no pagados, luego por cuotas vencidas descendente
      {
        $sort: { pagadoHoy: 1, cuotasVencidas: -1, clienteNombre: 1 },
      },
    ]);

    return prestamosHoy;
  }
}

export const dashboardService = new DashboardService();

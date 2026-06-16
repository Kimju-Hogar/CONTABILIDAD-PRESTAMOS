import { format } from 'date-fns';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import mongoose from 'mongoose';
import { CobroModel, ICobro } from '../../models/Cobro.model';
import { PrestamoModel } from '../../models/Prestamo.model';
import { clientesRepository } from '../clientes/clientes.repository';
import { NotFoundError, AppError, ForbiddenError } from '../../shared/middleware/error.middleware';
import { buildPagination } from '../../shared/utils/responses';
import { getSocketIO } from '../../config/socket';
import type { RegistrarCobroDto, AnularCobroDto, FiltrosCobroDto } from './cobros.dto';

const TIMEZONE = 'America/Bogota';

export class CobrosService {
  async listar(filtros: FiltrosCobroDto) {
    const query: Record<string, unknown> = { anulado: false };
    if (filtros.prestamoId) query.prestamo = filtros.prestamoId;
    if (filtros.clienteId) query.cliente = filtros.clienteId;
    if (filtros.cobradorId) query.cobrador = filtros.cobradorId;
    if (filtros.tipo) query.tipo = filtros.tipo;

    if (filtros.fechaDesde || filtros.fechaHasta) {
      const fechaQuery: Record<string, Date> = {};
      if (filtros.fechaDesde) fechaQuery.$gte = new Date(filtros.fechaDesde);
      if (filtros.fechaHasta) fechaQuery.$lte = new Date(filtros.fechaHasta);
      query.fecha = fechaQuery;
    }

    const skip = (filtros.page - 1) * filtros.limit;
    const [data, total] = await Promise.all([
      CobroModel.find(query)
        .populate('cliente', 'nombre cedula')
        .populate('cobrador', 'nombre')
        .populate('prestamo', 'capital cuotaDiaria')
        .sort({ fecha: -1, createdAt: -1 })
        .skip(skip)
        .limit(filtros.limit)
        .lean(),
      CobroModel.countDocuments(query),
    ]);

    return { data, pagination: buildPagination(total, filtros.page, filtros.limit) };
  }

  async registrar(dto: RegistrarCobroDto, cobradorId: string): Promise<ICobro> {
    // Obtener préstamo con lock optimista
    const prestamo = await PrestamoModel.findById(dto.prestamoId);
    if (!prestamo) throw new NotFoundError('Préstamo');

    if (prestamo.estado !== 'activo') {
      throw new AppError('Solo se pueden registrar cobros en préstamos activos', 400);
    }

    if (dto.monto > prestamo.saldoPendiente) {
      throw new AppError(
        `El monto (${dto.monto}) supera el saldo pendiente (${prestamo.saldoPendiente})`,
        400
      );
    }

    const ahora = toZonedTime(dto.fecha ? new Date(dto.fecha) : new Date(), TIMEZONE);
    const hora = format(ahora, 'HH:mm:ss');
    const saldoAntes = prestamo.saldoPendiente;
    const saldoDespues = saldoAntes - dto.monto;

    // Determinar qué cuotas aplica este cobro
    const cuotasAplicadas: number[] = [];
    let montoRestante = dto.monto;

    if (dto.cuotasSeleccionadas && dto.cuotasSeleccionadas.length > 0) {
      // Modo manual: aplicar solo a las cuotas seleccionadas (para pagos históricos)
      const numerosSeleccionados = new Set(dto.cuotasSeleccionadas);
      for (const cuota of prestamo.cuotas) {
        if (montoRestante <= 0) break;
        if (!numerosSeleccionados.has(cuota.numero)) continue;
        if (cuota.estado === 'pagada') continue;

        cuotasAplicadas.push(cuota.numero);
        if (montoRestante >= cuota.monto) {
          cuota.estado = 'pagada';
          cuota.fechaPago = ahora;
          cuota.montoPagado = cuota.monto;
          montoRestante -= cuota.monto;
        } else {
          cuota.estado = 'parcial';
          cuota.montoPagado = montoRestante;
          montoRestante = 0;
        }
      }
    } else {
      // Modo automático: aplicar secuencialmente desde la cuota más antigua pendiente
      for (const cuota of prestamo.cuotas) {
        if (montoRestante <= 0) break;
        if (cuota.estado === 'pagada') continue;

        cuotasAplicadas.push(cuota.numero);
        if (montoRestante >= cuota.monto) {
          cuota.estado = 'pagada';
          cuota.fechaPago = ahora;
          cuota.montoPagado = cuota.monto;
          montoRestante -= cuota.monto;
        } else {
          cuota.estado = 'parcial';
          cuota.montoPagado = montoRestante;
          montoRestante = 0;
        }
      }
    }

    // Actualizar préstamo
    prestamo.saldoPendiente = saldoDespues;
    prestamo.totalCobrado += dto.monto;
    prestamo.ganancia = Math.max(0, prestamo.totalCobrado - prestamo.capital);

    if (saldoDespues <= 0 || dto.tipo === 'total') {
      prestamo.estado = 'completado';
      // Actualizar contador de cliente
      await clientesRepository.incrementarPrestamosActivos(prestamo.cliente.toString(), -1);
    }

    await prestamo.save();

    // Crear registro de cobro
    const cobro = await CobroModel.create({
      prestamo: dto.prestamoId,
      cliente: prestamo.cliente,
      cobrador: cobradorId,
      monto: dto.monto,
      tipo: dto.tipo,
      fecha: ahora,
      hora,
      geolocalizacion: dto.geolocalizacion,
      observaciones: dto.observaciones,
      cuotasAplicadas,
      saldoAntes,
      saldoDespues,
    });

    // Emitir evento Socket.IO en tiempo real
    const io = getSocketIO();
    if (io) {
      io.to('dashboard').emit('cobro:registrado', {
        cobro: await cobro.populate('cobrador', 'nombre'),
        prestamoId: dto.prestamoId,
        clienteId: prestamo.cliente,
        saldoPendiente: saldoDespues,
        prestamoCompletado: prestamo.estado === 'completado',
      });
    }

    return cobro;
  }

  async anular(id: string, dto: AnularCobroDto, usuarioId: string, rol: string): Promise<ICobro> {
    if (rol !== 'admin') throw new ForbiddenError('Solo el administrador puede anular cobros');

    const cobro = await CobroModel.findById(id);
    if (!cobro) throw new NotFoundError('Cobro');
    if (cobro.anulado) throw new AppError('El cobro ya fue anulado', 400);

    // Revertir el saldo del préstamo
    const prestamo = await PrestamoModel.findById(cobro.prestamo);
    if (prestamo) {
      prestamo.saldoPendiente += cobro.monto;
      prestamo.totalCobrado -= cobro.monto;
      prestamo.ganancia = Math.max(0, prestamo.totalCobrado - prestamo.capital);

      // Revertir estado del préstamo si estaba completado
      if (prestamo.estado === 'completado') {
        prestamo.estado = 'activo';
        await clientesRepository.incrementarPrestamosActivos(prestamo.cliente.toString(), 1);
      }

      // Revertir cuotas
      for (const numCuota of cobro.cuotasAplicadas) {
        const cuota = prestamo.cuotas.find((c) => c.numero === numCuota);
        if (cuota) {
          cuota.estado = 'pendiente';
          cuota.fechaPago = undefined;
          cuota.montoPagado = undefined;
        }
      }

      await prestamo.save();
    }

    cobro.anulado = true;
    cobro.anuladoPor = new mongoose.Types.ObjectId(usuarioId);
    cobro.anuladoEn = new Date();
    cobro.motivoAnulacion = dto.motivo;
    await cobro.save();

    return cobro;
  }

  async resumenDia(cobradorId?: string) {
    const timezone = TIMEZONE;
    const ahora = toZonedTime(new Date(), timezone);
    const inicioDia = fromZonedTime(
      new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate()),
      timezone
    );
    const finDia = fromZonedTime(
      new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate(), 23, 59, 59, 999),
      timezone
    );

    const match: Record<string, unknown> = {
      fecha: { $gte: inicioDia, $lte: finDia },
      anulado: false,
    };
    if (cobradorId) match.cobrador = new mongoose.Types.ObjectId(cobradorId);

    const [result] = await CobroModel.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          totalMonto: { $sum: '$monto' },
          cantidad: { $sum: 1 },
          porTipo: {
            $push: { tipo: '$tipo', monto: '$monto' },
          },
        },
      },
    ]);

    return result ?? { totalMonto: 0, cantidad: 0, porTipo: [] };
  }
}

export const cobrosService = new CobrosService();

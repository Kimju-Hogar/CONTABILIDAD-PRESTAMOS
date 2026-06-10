import { addDays, addWeeks, addMonths, startOfDay } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import mongoose from 'mongoose';
import { PrestamoModel, IPrestamo, ICuota } from '../../models/Prestamo.model';
import { clientesRepository } from '../clientes/clientes.repository';
import { NotFoundError, AppError } from '../../shared/middleware/error.middleware';
import { buildPagination } from '../../shared/utils/responses';
import { getSocketIO } from '../../config/socket';
import {
  INTERES_FIJO, DEFAULT_CUOTAS, calcularPapeleria,
  type Modalidad,
  type CrearPrestamoDto, type RefinanciarPrestamoDto, type FiltrosPrestamoDto,
  type CancelarPrestamoDto, type EditarPrestamoDto
} from './prestamos.dto';

const TIMEZONE = 'America/Bogota';

// ─── Cálculo financiero central ──────────────────────────────
export function calcularPrestamo(
  capital: number,
  modalidad: Modalidad,
  fechaInicio: Date,
  plazoPersonalizado?: number,
  interes: number = INTERES_FIJO
) {
  const numeroCuotas = plazoPersonalizado ?? DEFAULT_CUOTAS[modalidad];
  const totalInteres = Math.round(capital * interes / 100);
  const totalPagar = capital + totalInteres;
  const cuotaBase = totalPagar / numeroCuotas;
  // Redondear al múltiplo de 100 más cercano hacia arriba
  const cuotaMonto = Math.ceil(cuotaBase / 100) * 100;

  // fechaFin según modalidad
  const fechaFin = (() => {
    switch (modalidad) {
      case 'diaria':    return addDays(fechaInicio, numeroCuotas - 1);
      case 'semanal':   return addWeeks(fechaInicio, numeroCuotas);
      case 'quincenal': return addDays(fechaInicio, numeroCuotas * 15);
      case 'mensual':   return addMonths(fechaInicio, numeroCuotas);
    }
  })();

  const papeleria = calcularPapeleria(capital);
  const montoDesembolsado = capital - papeleria;

  return {
    numeroCuotas,
    totalInteres,
    totalPagar,
    cuotaMonto,
    fechaFin,
    papeleria,
    montoDesembolsado,
  };
}

function generarCuotas(
  fechaInicio: Date,
  numeroCuotas: number,
  cuotaMonto: number,
  modalidad: Modalidad
): ICuota[] {
  return Array.from({ length: numeroCuotas }, (_, i) => {
    const base = startOfDay(fechaInicio);
    const fechaEsperada = (() => {
      switch (modalidad) {
        case 'diaria':    return addDays(base, i);
        case 'semanal':   return addWeeks(base, i + 1);
        case 'quincenal': return addDays(base, (i + 1) * 15);
        case 'mensual':   return addMonths(base, i + 1);
      }
    })();

    return {
      numero: i + 1,
      fechaEsperada,
      monto: cuotaMonto,
      estado: 'pendiente' as const,
    };
  });
}

// ─── Servicio ─────────────────────────────────────────────────
export class PrestamosService {
  async listar(filtros: FiltrosPrestamoDto) {
    const query: Record<string, unknown> = {};
    if (filtros.clienteId) query.cliente = filtros.clienteId;
    if (filtros.cobradorId) query.cobrador = filtros.cobradorId;
    if (filtros.estado) query.estado = filtros.estado;
    if (filtros.modalidad) query.modalidad = filtros.modalidad;

    const skip = (filtros.page - 1) * filtros.limit;
    const [data, total] = await Promise.all([
      PrestamoModel.find(query)
        .populate('cliente', 'nombre cedula celular ciudad')
        .populate('cobrador', 'nombre')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(filtros.limit)
        .lean(),
      PrestamoModel.countDocuments(query),
    ]);

    return { data, pagination: buildPagination(total, filtros.page, filtros.limit) };
  }

  async obtener(id: string): Promise<IPrestamo> {
    const prestamo = await PrestamoModel.findById(id)
      .populate('cliente', 'nombre cedula celular ciudad barrio direccion')
      .populate('cobrador', 'nombre email')
      .lean();
    if (!prestamo) throw new NotFoundError('Préstamo');
    return prestamo as unknown as IPrestamo;
  }

  async crear(dto: CrearPrestamoDto, cobradorId: string): Promise<IPrestamo> {
    const cliente = await clientesRepository.findById(dto.clienteId);
    if (!cliente) throw new NotFoundError('Cliente');

    if (cliente.estado === 'cancelado') {
      throw new AppError('El cliente está cancelado y no puede recibir préstamos', 400);
    }

    const fechaInicio = toZonedTime(dto.fechaInicio, TIMEZONE);
    const calc = calcularPrestamo(dto.capital, dto.modalidad, fechaInicio, dto.numeroCuotas, dto.interes);
    const cuotas = generarCuotas(fechaInicio, calc.numeroCuotas, calc.cuotaMonto, dto.modalidad);

    const prestamo = await PrestamoModel.create({
      cliente: dto.clienteId,
      cobrador: cobradorId,
      capital: dto.capital,
      interes: dto.interes ?? INTERES_FIJO,
      modalidad: dto.modalidad,
      papeleria: calc.papeleria,
      montoDesembolsado: calc.montoDesembolsado,
      totalInteres: calc.totalInteres,
      totalPagar: calc.totalPagar,
      numeroCuotas: calc.numeroCuotas,
      cuotaDiaria: calc.cuotaMonto,        // campo legacy (monto por cuota)
      fechaInicio,
      fechaFin: calc.fechaFin,
      saldoPendiente: calc.totalPagar,
      totalCobrado: 0,
      ganancia: 0,
      estado: 'activo',
      cuotas,
      observaciones: dto.observaciones,
      createdBy: cobradorId,
    });

    await clientesRepository.incrementarPrestamosActivos(dto.clienteId, 1);

    // Notificar en tiempo real
    const io = getSocketIO();
    io?.to('dashboard').emit('prestamo:creado', {
      prestamo,
      clienteNombre: cliente.nombre,
    });

    return prestamo;
  }

  async cancelar(id: string, dto: CancelarPrestamoDto, usuarioId: string): Promise<IPrestamo> {
    const prestamo = await PrestamoModel.findById(id);
    if (!prestamo) throw new NotFoundError('Préstamo');
    if (prestamo.estado !== 'activo') throw new AppError('Solo se pueden cancelar préstamos activos', 400);

    prestamo.estado = 'cancelado';
    prestamo.observaciones = `CANCELADO: ${dto.motivo}. ${prestamo.observaciones ?? ''}`.trim();
    prestamo.updatedBy = new mongoose.Types.ObjectId(usuarioId);
    await prestamo.save();

    await clientesRepository.incrementarPrestamosActivos(prestamo.cliente.toString(), -1);

    return prestamo;
  }

  async refinanciar(id: string, dto: RefinanciarPrestamoDto, usuarioId: string): Promise<IPrestamo> {
    const original = await PrestamoModel.findById(id);
    if (!original) throw new NotFoundError('Préstamo');
    if (original.estado !== 'activo') throw new AppError('Solo se pueden refinanciar préstamos activos', 400);

    const nuevoCapital = original.saldoPendiente + (dto.capitalAdicional ?? 0);
    const fechaInicio = toZonedTime(new Date(), TIMEZONE);
    const calc = calcularPrestamo(nuevoCapital, dto.modalidad, fechaInicio);
    const cuotas = generarCuotas(fechaInicio, calc.numeroCuotas, calc.cuotaMonto, dto.modalidad);

    await PrestamoModel.findByIdAndUpdate(id, { estado: 'refinanciado' });

    const nuevoPrestamo = await PrestamoModel.create({
      cliente: original.cliente,
      cobrador: original.cobrador,
      capital: nuevoCapital,
      interes: INTERES_FIJO,
      modalidad: dto.modalidad,
      papeleria: calc.papeleria,
      montoDesembolsado: calc.montoDesembolsado,
      totalInteres: calc.totalInteres,
      totalPagar: calc.totalPagar,
      numeroCuotas: calc.numeroCuotas,
      cuotaDiaria: calc.cuotaMonto,
      fechaInicio,
      fechaFin: calc.fechaFin,
      saldoPendiente: calc.totalPagar,
      totalCobrado: 0,
      ganancia: 0,
      estado: 'activo',
      cuotas,
      refinanciadoDe: original._id,
      observaciones: dto.observaciones,
      createdBy: usuarioId,
    });

    return nuevoPrestamo;
  }

  async actualizarCuotasVencidas(): Promise<number> {
    const hoy = startOfDay(toZonedTime(new Date(), TIMEZONE));
    const result = await PrestamoModel.updateMany(
      { estado: 'activo', 'cuotas.estado': 'pendiente', 'cuotas.fechaEsperada': { $lt: hoy } },
      { $set: { 'cuotas.$[c].estado': 'vencida' } },
      { arrayFilters: [{ 'c.estado': 'pendiente', 'c.fechaEsperada': { $lt: hoy } }] }
    );
    return result.modifiedCount;
  }

  async editar(id: string, dto: EditarPrestamoDto, usuarioId: string): Promise<IPrestamo> {
    const prestamo = await PrestamoModel.findById(id);
    if (!prestamo) throw new AppError('Préstamo no encontrado', 404);
    if (prestamo.estado !== 'activo') throw new AppError('Solo se pueden editar préstamos activos', 400);

    const changes: Partial<IPrestamo> = {
      updatedBy: new mongoose.Types.ObjectId(usuarioId),
    };

    let recalculate = false;
    let capital = prestamo.capital;
    let interes = prestamo.interes;
    let numeroCuotas = prestamo.numeroCuotas;
    let modalidad = prestamo.modalidad || 'diaria';
    let fechaInicio = prestamo.fechaInicio;

    if (dto.capital !== undefined && dto.capital !== capital) { capital = dto.capital; recalculate = true; }
    if (dto.interes !== undefined && dto.interes !== interes) { interes = dto.interes; recalculate = true; }
    if (dto.numeroCuotas !== undefined && dto.numeroCuotas !== numeroCuotas) { numeroCuotas = dto.numeroCuotas; recalculate = true; }
    if (dto.modalidad !== undefined && dto.modalidad !== modalidad) { modalidad = dto.modalidad; recalculate = true; }
    if (dto.fechaInicio !== undefined && dto.fechaInicio.getTime() !== fechaInicio.getTime()) { fechaInicio = dto.fechaInicio; recalculate = true; }
    if (dto.observaciones !== undefined) changes.observaciones = dto.observaciones;

    if (recalculate) {
      if (prestamo.totalCobrado > 0) {
        throw new AppError('No se pueden modificar condiciones si ya hay cuotas pagadas. Refinancia o elimina pagos.', 400);
      }
      const calc = this.calcularPrestamo(capital, interes, numeroCuotas, modalidad, fechaInicio);
      const cuotas = this.generarCuotas(fechaInicio, numeroCuotas, modalidad, calc.cuotaMonto);

      changes.capital = capital;
      changes.interes = interes;
      changes.modalidad = modalidad;
      changes.numeroCuotas = numeroCuotas;
      changes.fechaInicio = fechaInicio;
      changes.fechaFin = calc.fechaFin;
      changes.papeleria = calc.papeleria;
      changes.montoDesembolsado = calc.montoDesembolsado;
      changes.totalInteres = calc.totalInteres;
      changes.totalPagar = calc.totalPagar;
      changes.cuotaDiaria = calc.cuotaMonto;
      changes.saldoPendiente = calc.totalPagar;
      changes.cuotas = cuotas;
    }

    Object.assign(prestamo, changes);
    await prestamo.save();
    return prestamo;
  }

  async eliminar(id: string, usuarioId: string): Promise<void> {
    const prestamo = await PrestamoModel.findById(id);
    if (!prestamo) throw new AppError('Préstamo no encontrado', 404);

    if (prestamo.totalCobrado > 0) {
      throw new AppError('No se puede eliminar un préstamo con pagos registrados. Cancela el préstamo en su lugar.', 400);
    }

    prestamo.deletedAt = new Date();
    prestamo.updatedBy = new mongoose.Types.ObjectId(usuarioId);
    await prestamo.save();
  }
}

export const prestamosService = new PrestamosService();

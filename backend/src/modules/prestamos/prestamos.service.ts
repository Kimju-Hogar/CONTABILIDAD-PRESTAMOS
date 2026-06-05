import { addDays, addWeeks, startOfDay } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import mongoose from 'mongoose';
import { PrestamoModel, IPrestamo, ICuota } from '../../models/Prestamo.model';
import { clientesRepository } from '../clientes/clientes.repository';
import { NotFoundError, AppError } from '../../shared/middleware/error.middleware';
import { buildPagination } from '../../shared/utils/responses';
import { getSocketIO } from '../../config/socket';
import {
  INTERES_FIJO, CUOTAS_DIARIAS, CUOTAS_SEMANALES, calcularPapeleria,
  type CrearPrestamoDto, type RefinanciarPrestamoDto, type FiltrosPrestamoDto,
  type CancelarPrestamoDto,
} from './prestamos.dto';

const TIMEZONE = 'America/Bogota';

// ─── Cálculo financiero central ──────────────────────────────
export function calcularPrestamo(
  capital: number,
  modalidad: 'diaria' | 'semanal',
  fechaInicio: Date,
  plazoPersonalizado?: number
) {
  const numeroCuotas = plazoPersonalizado ?? (modalidad === 'diaria' ? CUOTAS_DIARIAS : CUOTAS_SEMANALES);
  const totalInteres = Math.round(capital * INTERES_FIJO / 100);
  const totalPagar = capital + totalInteres;
  const cuotaBase = totalPagar / numeroCuotas;
  // Redondear al múltiplo de 100 más cercano hacia arriba
  const cuotaMonto = Math.ceil(cuotaBase / 100) * 100;

  const fechaFin = modalidad === 'diaria'
    ? addDays(fechaInicio, numeroCuotas - 1)
    : addWeeks(fechaInicio, numeroCuotas);

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
  modalidad: 'diaria' | 'semanal'
): ICuota[] {
  return Array.from({ length: numeroCuotas }, (_, i) => {
    const fechaEsperada = modalidad === 'diaria'
      ? addDays(startOfDay(fechaInicio), i)
      : addWeeks(startOfDay(fechaInicio), i + 1);

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
    const calc = calcularPrestamo(dto.capital, dto.modalidad, fechaInicio, dto.numeroCuotas);
    const cuotas = generarCuotas(fechaInicio, calc.numeroCuotas, calc.cuotaMonto, dto.modalidad);

    const prestamo = await PrestamoModel.create({
      cliente: dto.clienteId,
      cobrador: cobradorId,
      capital: dto.capital,
      interes: INTERES_FIJO,
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
}

export const prestamosService = new PrestamosService();

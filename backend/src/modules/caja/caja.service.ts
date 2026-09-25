import mongoose from 'mongoose';
import { CajaDiaModel, ICajaDia } from '../../models/CajaDia.model';
import { MovimientoCajaModel } from '../../models/MovimientoCaja.model';
import { CobroModel } from '../../models/Cobro.model';
import { PrestamoModel } from '../../models/Prestamo.model';
import { GastoModel } from '../../models/Gasto.model';
import { obtenerConfiguracion } from '../../models/Configuracion.model';
import { AppError, NotFoundError } from '../../shared/middleware/error.middleware';
import { buildPagination } from '../../shared/utils/responses';
import { keyDia, rangoDeKey, inicioDeKey } from '../../shared/utils/fechas';
import { getSocketIO } from '../../config/socket';
import type { AbrirCajaDto, CerrarCajaDto, CrearMovimientoDto, FiltrosCierresDto } from './caja.dto';

/** Totales de un día calculados en vivo desde las colecciones operativas. */
export interface TotalesDia {
  totalCobrado: number;
  cantidadCobros: number;
  totalPrestado: number;
  cantidadPrestamos: number;
  /**
   * Efectivo que ENTRÓ por cargos de renovación. Cuando se renueva una tarjeta
   * sin entregar plata nueva, el cliente paga la papelería y el cartón de su
   * bolsillo: ahí el desembolso queda negativo y esa plata entra a la caja.
   */
  cargosCobrados: number;
  totalPapeleria: number;
  totalCartones: number;
  totalGastos: number;
  otrosIngresos: number;
  otrosEgresos: number;
}

const oid = (id: string) => new mongoose.Types.ObjectId(id);

export class CajaService {
  // ─── Totales en vivo del día ────────────────────────────────
  /**
   * Suma todo lo que movió la caja de un cobrador en un día.
   *
   * Los préstamos se imputan por `fechaInicio` (el día en que el efectivo salió
   * hacia el cliente), no por su fecha de creación en el sistema.
   */
  async calcularTotalesDia(fechaKey: string, cobradorId: string): Promise<TotalesDia> {
    const { inicio, fin } = rangoDeKey(fechaKey);
    const cobrador = oid(cobradorId);

    const [cobros, prestamos, gastos, movimientos] = await Promise.all([
      CobroModel.aggregate([
        { $match: { fecha: { $gte: inicio, $lte: fin }, anulado: false, cobrador } },
        { $group: { _id: null, total: { $sum: '$monto' }, cantidad: { $sum: 1 } } },
      ]),
      PrestamoModel.aggregate([
        {
          $match: {
            fechaInicio: { $gte: inicio, $lte: fin },
            cobrador,
            deletedAt: null,
            estado: { $ne: 'cancelado' },
          },
        },
        {
          $group: {
            _id: null,
            // Solo lo que de verdad salió de la caja
            desembolsado: {
              $sum: { $cond: [{ $gt: ['$montoDesembolsado', 0] }, '$montoDesembolsado', 0] },
            },
            // Y aparte lo que entró: renovaciones donde el cliente pagó los cargos
            cargosCobrados: {
              $sum: {
                $cond: [{ $lt: ['$montoDesembolsado', 0] }, { $abs: '$montoDesembolsado' }, 0],
              },
            },
            papeleria: { $sum: '$papeleria' },
            carton: { $sum: { $ifNull: ['$carton', 0] } },
            cantidad: { $sum: 1 },
          },
        },
      ]),
      GastoModel.aggregate([
        { $match: { fecha: { $gte: inicio, $lte: fin }, usuario: cobrador, deletedAt: null } },
        { $group: { _id: null, total: { $sum: '$monto' } } },
      ]),
      MovimientoCajaModel.aggregate([
        { $match: { fechaKey, cobrador, deletedAt: null } },
        { $group: { _id: '$tipo', total: { $sum: '$monto' } } },
      ]),
    ]);

    const p = prestamos[0];
    const ingresos = movimientos.find((m) => m._id === 'ingreso')?.total ?? 0;
    const egresos = movimientos.find((m) => m._id === 'egreso')?.total ?? 0;

    return {
      totalCobrado: cobros[0]?.total ?? 0,
      cantidadCobros: cobros[0]?.cantidad ?? 0,
      totalPrestado: p?.desembolsado ?? 0,
      cantidadPrestamos: p?.cantidad ?? 0,
      cargosCobrados: p?.cargosCobrados ?? 0,
      totalPapeleria: p?.papeleria ?? 0,
      totalCartones: p?.carton ?? 0,
      totalGastos: gastos[0]?.total ?? 0,
      otrosIngresos: ingresos,
      otrosEgresos: egresos,
    };
  }

  /** Saldo que debería haber en efectivo dada una base y los totales del día. */
  private saldoEsperado(baseInicial: number, t: TotalesDia): number {
    return (
      baseInicial +
      t.totalCobrado +
      t.cargosCobrados +
      t.otrosIngresos -
      t.totalPrestado -
      t.totalGastos -
      t.otrosEgresos
    );
  }

  /**
   * Base sugerida para abrir un día: el efectivo con que quedó el último cierre
   * de ese cobrador. Si nunca ha cerrado, cae al valor configurado.
   */
  async baseSugerida(fechaKey: string, cobradorId: string): Promise<{ base: number; origen: string }> {
    const anterior = await CajaDiaModel.findOne({
      cobrador: oid(cobradorId),
      estado: 'cerrado',
      fechaKey: { $lt: fechaKey },
    })
      .sort({ fechaKey: -1 })
      .lean();

    if (anterior) {
      const base = anterior.saldoContado ?? anterior.saldoEsperado;
      return { base: Math.max(0, base), origen: `Cierre del ${anterior.fechaKey}` };
    }

    const config = await obtenerConfiguracion();
    return { base: config.baseCajaSugerida, origen: 'Valor configurado (sin cierres previos)' };
  }

  // ─── Estado del día ─────────────────────────────────────────
  /**
   * Foto completa del día para el cobrador: la caja (si ya se abrió), los
   * totales en vivo, el saldo esperado y la base sugerida si aún no abre.
   */
  async estadoDia(cobradorId: string, fecha?: string) {
    const fechaKey = fecha ?? keyDia();
    const caja = await CajaDiaModel.findOne({ cobrador: oid(cobradorId), fechaKey })
      .populate('cobrador', 'nombre email')
      .populate('cerradoPor', 'nombre')
      .lean();

    const totales = await this.calcularTotalesDia(fechaKey, cobradorId);
    const movimientos = await MovimientoCajaModel.find({ fechaKey, cobrador: oid(cobradorId) })
      .populate('registradoPor', 'nombre')
      .sort({ createdAt: -1 })
      .lean();

    // Un cierre guardado congela sus propios números; un día abierto se recalcula.
    if (caja?.estado === 'cerrado') {
      return {
        fechaKey,
        estado: 'cerrado' as const,
        caja,
        totales: {
          totalCobrado: caja.totalCobrado,
          cantidadCobros: totales.cantidadCobros,
          totalPrestado: caja.totalPrestado,
          cantidadPrestamos: totales.cantidadPrestamos,
          cargosCobrados: caja.cargosCobrados,
          totalPapeleria: caja.totalPapeleria,
          totalCartones: caja.totalCartones,
          totalGastos: caja.totalGastos,
          otrosIngresos: caja.otrosIngresos,
          otrosEgresos: caja.otrosEgresos,
        },
        baseInicial: caja.baseInicial,
        saldoEsperado: caja.saldoEsperado,
        saldoContado: caja.saldoContado,
        diferencia: caja.diferencia,
        movimientos,
        baseSugerida: null,
      };
    }

    if (caja) {
      return {
        fechaKey,
        estado: 'abierto' as const,
        caja,
        totales,
        baseInicial: caja.baseInicial,
        saldoEsperado: this.saldoEsperado(caja.baseInicial, totales),
        saldoContado: null,
        diferencia: 0,
        movimientos,
        baseSugerida: null,
      };
    }

    const sugerida = await this.baseSugerida(fechaKey, cobradorId);
    return {
      fechaKey,
      estado: 'sin_abrir' as const,
      caja: null,
      totales,
      baseInicial: 0,
      // Si no abrió la caja, el "esperado" se muestra igual con base 0 para que
      // el cobrador vea el neto del día aunque no haya registrado apertura.
      saldoEsperado: this.saldoEsperado(0, totales),
      saldoContado: null,
      diferencia: 0,
      movimientos,
      baseSugerida: sugerida,
    };
  }

  // ─── Abrir ──────────────────────────────────────────────────
  async abrir(dto: AbrirCajaDto, cobradorId: string): Promise<ICajaDia> {
    const fechaKey = dto.fechaKey ?? keyDia();

    const existente = await CajaDiaModel.findOne({ cobrador: oid(cobradorId), fechaKey });
    if (existente) {
      throw new AppError(
        existente.estado === 'cerrado'
          ? `El día ${fechaKey} ya fue cerrado`
          : `La caja del ${fechaKey} ya está abierta`,
        400
      );
    }

    const caja = await CajaDiaModel.create({
      fechaKey,
      fecha: inicioDeKey(fechaKey),
      cobrador: cobradorId,
      baseInicial: dto.baseInicial,
      estado: 'abierto',
      observaciones: dto.observaciones,
      abiertoPor: cobradorId,
      abiertoEn: new Date(),
    });

    getSocketIO()?.to('dashboard').emit('caja:abierta', { fechaKey, cobradorId, base: dto.baseInicial });
    return caja;
  }

  // ─── Cerrar ─────────────────────────────────────────────────
  async cerrar(dto: CerrarCajaDto, cobradorId: string, usuarioId: string): Promise<ICajaDia> {
    const fechaKey = dto.fechaKey ?? keyDia();
    const caja = await CajaDiaModel.findOne({ cobrador: oid(cobradorId), fechaKey });

    if (!caja) {
      throw new AppError(`No hay una caja abierta para el ${fechaKey}`, 400);
    }
    if (caja.estado === 'cerrado') {
      throw new AppError(`La caja del ${fechaKey} ya fue cerrada`, 400);
    }

    const totales = await this.calcularTotalesDia(fechaKey, cobradorId);
    const esperado = this.saldoEsperado(caja.baseInicial, totales);

    caja.totalCobrado = totales.totalCobrado;
    caja.totalPrestado = totales.totalPrestado;
    caja.cargosCobrados = totales.cargosCobrados;
    caja.totalPapeleria = totales.totalPapeleria;
    caja.totalCartones = totales.totalCartones;
    caja.totalGastos = totales.totalGastos;
    caja.otrosIngresos = totales.otrosIngresos;
    caja.otrosEgresos = totales.otrosEgresos;
    caja.saldoEsperado = esperado;
    caja.saldoContado = dto.saldoContado;
    caja.diferencia = dto.saldoContado - esperado;
    caja.estado = 'cerrado';
    caja.cerradoPor = oid(usuarioId);
    caja.cerradoEn = new Date();
    if (dto.observaciones) caja.observaciones = dto.observaciones;

    await caja.save();

    getSocketIO()?.to('dashboard').emit('caja:cerrada', {
      fechaKey,
      cobradorId,
      saldoContado: caja.saldoContado,
      diferencia: caja.diferencia,
    });

    return caja;
  }

  /** Reabre un cierre para corregirlo. Solo admin. */
  async reabrir(id: string, motivo: string): Promise<ICajaDia> {
    const caja = await CajaDiaModel.findById(id);
    if (!caja) throw new NotFoundError('Cierre de caja');
    if (caja.estado === 'abierto') throw new AppError('La caja ya está abierta', 400);

    caja.estado = 'abierto';
    caja.saldoContado = null;
    caja.diferencia = 0;
    caja.cerradoEn = undefined as unknown as Date;
    caja.observaciones = `REABIERTA: ${motivo}. ${caja.observaciones ?? ''}`.trim();
    await caja.save();

    return caja;
  }

  // ─── Histórico de cierres ───────────────────────────────────
  async listarCierres(filtros: FiltrosCierresDto) {
    const query: Record<string, unknown> = {};
    if (filtros.cobradorId) query.cobrador = oid(filtros.cobradorId);
    if (filtros.estado) query.estado = filtros.estado;
    if (filtros.desde || filtros.hasta) {
      const f: Record<string, string> = {};
      if (filtros.desde) f.$gte = filtros.desde;
      if (filtros.hasta) f.$lte = filtros.hasta;
      query.fechaKey = f;
    }

    const skip = (filtros.page - 1) * filtros.limit;
    const [filas, total] = await Promise.all([
      CajaDiaModel.find(query)
        .populate('cobrador', 'nombre email rol')
        .populate('cerradoPor', 'nombre email rol')
        .populate('abiertoPor', 'nombre')
        .sort({ fechaKey: -1 })
        .skip(skip)
        .limit(filtros.limit)
        .lean(),
      CajaDiaModel.countDocuments(query),
    ]);

    // Los cerrados traen su snapshot congelado; los que siguen abiertos guardan
    // ceros, así que se rellenan con los totales vivos para que el histórico no
    // muestre un día en blanco.
    const data = await Promise.all(
      filas.map(async (fila) => {
        if (fila.estado === 'cerrado') return fila;
        // `cobrador` viene poblado, así que puede ser el documento o el id suelto
        const cobradorId = (fila.cobrador as { _id?: unknown })?._id ?? fila.cobrador;
        const t = await this.calcularTotalesDia(fila.fechaKey, String(cobradorId));
        return {
          ...fila,
          totalCobrado: t.totalCobrado,
          totalPrestado: t.totalPrestado,
          cargosCobrados: t.cargosCobrados,
          totalPapeleria: t.totalPapeleria,
          totalCartones: t.totalCartones,
          totalGastos: t.totalGastos,
          otrosIngresos: t.otrosIngresos,
          otrosEgresos: t.otrosEgresos,
          saldoEsperado: this.saldoEsperado(fila.baseInicial, t),
        };
      })
    );

    return { data, pagination: buildPagination(total, filtros.page, filtros.limit) };
  }

  // ─── Movimientos manuales ───────────────────────────────────
  async crearMovimiento(dto: CrearMovimientoDto, cobradorId: string, usuarioId: string) {
    const fechaKey = dto.fechaKey ?? keyDia();

    const caja = await CajaDiaModel.findOne({ cobrador: oid(cobradorId), fechaKey }).lean();
    if (caja?.estado === 'cerrado') {
      throw new AppError(
        `El día ${fechaKey} ya está cerrado. Pide al administrador que lo reabra para corregirlo.`,
        400
      );
    }

    const movimiento = await MovimientoCajaModel.create({
      fechaKey,
      fecha: new Date(),
      cobrador: cobradorId,
      tipo: dto.tipo,
      concepto: dto.concepto,
      monto: dto.monto,
      descripcion: dto.descripcion,
      prestamo: dto.prestamoId,
      cliente: dto.clienteId,
      registradoPor: usuarioId,
    });

    getSocketIO()?.to('dashboard').emit('caja:movimiento', { fechaKey, cobradorId });
    return movimiento;
  }

  async eliminarMovimiento(id: string): Promise<void> {
    const movimiento = await MovimientoCajaModel.findById(id);
    if (!movimiento) throw new NotFoundError('Movimiento');

    const caja = await CajaDiaModel.findOne({
      cobrador: movimiento.cobrador,
      fechaKey: movimiento.fechaKey,
    }).lean();
    if (caja?.estado === 'cerrado') {
      throw new AppError('No se puede borrar un movimiento de un día ya cerrado', 400);
    }

    movimiento.deletedAt = new Date();
    await movimiento.save();
  }

  async listarMovimientos(fechaKey: string, cobradorId?: string) {
    const query: Record<string, unknown> = { fechaKey };
    if (cobradorId) query.cobrador = oid(cobradorId);
    return MovimientoCajaModel.find(query)
      .populate('registradoPor', 'nombre')
      .populate('cliente', 'nombre')
      .sort({ createdAt: -1 })
      .lean();
  }

  // ─── Detalle de movimientos del día (para el cierre) ────────
  /**
   * El día completo, línea por línea: la caja, cada cobro, cada préstamo, cada
   * gasto y cada movimiento manual. Es lo que alimenta el reporte diario.
   */
  async detalleDia(fechaKey: string, cobradorId: string) {
    const { inicio, fin } = rangoDeKey(fechaKey);
    const cobrador = oid(cobradorId);

    const [cobros, prestamos, gastos, movimientos, caja, totales] = await Promise.all([
      CobroModel.find({ fecha: { $gte: inicio, $lte: fin }, anulado: false, cobrador })
        .populate('cliente', 'nombre cedula celular')
        .populate('prestamo', 'cuotaDiaria saldoPendiente totalPagar')
        .sort({ fecha: 1 })
        .lean(),
      PrestamoModel.find({
        fechaInicio: { $gte: inicio, $lte: fin },
        cobrador,
        deletedAt: null,
        estado: { $ne: 'cancelado' },
      })
        .populate('cliente', 'nombre cedula')
        .sort({ createdAt: 1 })
        .lean(),
      GastoModel.find({ fecha: { $gte: inicio, $lte: fin }, usuario: cobrador, deletedAt: null })
        .sort({ fecha: 1 })
        .lean(),
      this.listarMovimientos(fechaKey, cobradorId),
      CajaDiaModel.findOne({ cobrador, fechaKey })
        .populate('cobrador', 'nombre email')
        .lean(),
      this.calcularTotalesDia(fechaKey, cobradorId),
    ]);

    // Un cierre guardado manda sobre el cálculo en vivo
    const baseInicial = caja?.baseInicial ?? 0;
    const esperado = caja?.estado === 'cerrado'
      ? caja.saldoEsperado
      : this.saldoEsperado(baseInicial, totales);

    // Cuántos clientes de la ruta pagaron y cuántos no aparecieron
    const clientesQuePagaron = new Set(cobros.map((c) => String(c.cliente?._id ?? c.cliente))).size;

    return {
      fechaKey,
      caja,
      estado: caja?.estado ?? 'sin_abrir',
      baseInicial,
      totales,
      saldoEsperado: esperado,
      saldoContado: caja?.saldoContado ?? null,
      diferencia: caja?.diferencia ?? 0,
      clientesQuePagaron,
      cobros,
      prestamos,
      gastos,
      movimientos,
    };
  }
}

export const cajaService = new CajaService();

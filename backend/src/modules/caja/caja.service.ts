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

/**
 * Totales de un día calculados en vivo desde las colecciones operativas.
 *
 * REGLA DEL NEGOCIO: hay **una sola caja**. La plata que se presta sale del
 * mismo bolsillo donde entran los cobros, sin importar qué cuenta registró el
 * movimiento. Por eso aquí no se filtra por cobrador: si se filtrara, una
 * renovación registrada a nombre de otra cuenta no descontaría de la caja que
 * el dueño mira (fue exactamente el bug de octubre de 2026).
 */
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
  async calcularTotalesDia(fechaKey: string): Promise<TotalesDia> {
    const { inicio, fin } = rangoDeKey(fechaKey);

    const [cobros, prestamos, gastos, movimientos] = await Promise.all([
      CobroModel.aggregate([
        { $match: { fecha: { $gte: inicio, $lte: fin }, anulado: false } },
        { $group: { _id: null, total: { $sum: '$monto' }, cantidad: { $sum: 1 } } },
      ]),
      PrestamoModel.aggregate([
        {
          $match: {
            fechaInicio: { $gte: inicio, $lte: fin },
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
        { $match: { fecha: { $gte: inicio, $lte: fin }, deletedAt: null } },
        { $group: { _id: null, total: { $sum: '$monto' } } },
      ]),
      MovimientoCajaModel.aggregate([
        { $match: { fechaKey, deletedAt: null } },
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
  async baseSugerida(fechaKey: string): Promise<{ base: number; origen: string }> {
    // El último día que tuvo caja, esté cerrado o no. Si el cobrador olvidó
    // cerrar, igual se arrastra lo que le quedó: de otro modo el día nuevo
    // arrancaría en cero y habría que escribir la base a mano.
    const anterior = await CajaDiaModel.findOne({
      fechaKey: { $lt: fechaKey },
    })
      .sort({ fechaKey: -1 })
      .lean();

    if (anterior) {
      if (anterior.estado === 'cerrado') {
        const base = anterior.saldoContado ?? anterior.saldoEsperado;
        return { base: Math.max(0, base), origen: `Cierre del ${anterior.fechaKey}` };
      }
      // Quedó abierto: se calcula con qué terminó ese día
      const t = await this.calcularTotalesDia(anterior.fechaKey);
      const base = this.saldoEsperado(anterior.baseInicial, t);
      return {
        base: Math.max(0, base),
        origen: `Saldo del ${anterior.fechaKey} (quedó sin cerrar)`,
      };
    }

    const config = await obtenerConfiguracion();
    return { base: config.baseCajaSugerida, origen: 'Valor configurado (sin días previos)' };
  }

  /**
   * Garantiza que el día tenga caja antes de mover plata.
   *
   * Se llama justo antes de registrar un cobro, un préstamo o un gasto: si el
   * cobrador todavía no abrió el día, la caja se abre sola arrastrando lo que
   * le quedó del día anterior. Así nunca hay movimientos huérfanos y el saldo
   * encadena solo de un día al siguiente.
   */
  async asegurarCajaAbierta(usuarioId: string, fecha?: string): Promise<ICajaDia> {
    const fechaKey = fecha ?? keyDia();

    const existente = await CajaDiaModel.findOne({ fechaKey });
    if (existente) return existente;

    const { base } = await this.baseSugerida(fechaKey);

    try {
      return await CajaDiaModel.create({
        fechaKey,
        fecha: inicioDeKey(fechaKey),
        cobrador: usuarioId,
        baseInicial: base,
        estado: 'abierto',
        observaciones: 'Apertura automática: arrastre del día anterior',
        abiertoPor: usuarioId,
        abiertoEn: new Date(),
      });
    } catch (e) {
      // Dos movimientos a la vez pueden chocar contra el índice único;
      // si otro ya la creó, se usa esa.
      const yaCreada = await CajaDiaModel.findOne({ fechaKey });
      if (yaCreada) return yaCreada;
      throw e;
    }
  }

  // ─── Estado del día ─────────────────────────────────────────
  /**
   * Foto completa del día para el cobrador: la caja (si ya se abrió), los
   * totales en vivo, el saldo esperado y la base sugerida si aún no abre.
   */
  async estadoDia(fecha?: string) {
    const fechaKey = fecha ?? keyDia();
    const caja = await CajaDiaModel.findOne({ fechaKey })
      .populate('cobrador', 'nombre email')
      .populate('cerradoPor', 'nombre')
      .lean();

    const totales = await this.calcularTotalesDia(fechaKey);
    const movimientos = await MovimientoCajaModel.find({ fechaKey })
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

    const sugerida = await this.baseSugerida(fechaKey);
    return {
      fechaKey,
      estado: 'sin_abrir' as const,
      caja: null,
      totales,
      // Aunque todavía no se abra formalmente, el saldo ya cuenta con lo que
      // quedó ayer: es la plata que el cobrador tiene en el bolsillo.
      baseInicial: sugerida.base,
      saldoEsperado: this.saldoEsperado(sugerida.base, totales),
      saldoContado: null,
      diferencia: 0,
      movimientos,
      baseSugerida: sugerida,
    };
  }

  // ─── Abrir ──────────────────────────────────────────────────
  async abrir(dto: AbrirCajaDto, usuarioId: string): Promise<ICajaDia> {
    const fechaKey = dto.fechaKey ?? keyDia();

    const existente = await CajaDiaModel.findOne({ fechaKey });
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
      cobrador: usuarioId,
      baseInicial: dto.baseInicial,
      estado: 'abierto',
      observaciones: dto.observaciones,
      abiertoPor: usuarioId,
      abiertoEn: new Date(),
    });

    getSocketIO()?.to('dashboard').emit('caja:abierta', { fechaKey, base: dto.baseInicial });
    return caja;
  }

  // ─── Cerrar ─────────────────────────────────────────────────
  async cerrar(dto: CerrarCajaDto, usuarioId: string): Promise<ICajaDia> {
    const fechaKey = dto.fechaKey ?? keyDia();
    const caja = await CajaDiaModel.findOne({ fechaKey });

    if (!caja) {
      throw new AppError(`No hay una caja abierta para el ${fechaKey}`, 400);
    }
    if (caja.estado === 'cerrado') {
      throw new AppError(`La caja del ${fechaKey} ya fue cerrada`, 400);
    }

    const totales = await this.calcularTotalesDia(fechaKey);
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
        const t = await this.calcularTotalesDia(fila.fechaKey);
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
  async crearMovimiento(dto: CrearMovimientoDto, usuarioId: string) {
    const fechaKey = dto.fechaKey ?? keyDia();

    const caja = await CajaDiaModel.findOne({ fechaKey }).lean();
    if (caja?.estado === 'cerrado') {
      throw new AppError(
        `El día ${fechaKey} ya está cerrado. Pide al administrador que lo reabra para corregirlo.`,
        400
      );
    }

    const movimiento = await MovimientoCajaModel.create({
      fechaKey,
      fecha: new Date(),
      cobrador: usuarioId,
      tipo: dto.tipo,
      concepto: dto.concepto,
      monto: dto.monto,
      descripcion: dto.descripcion,
      prestamo: dto.prestamoId,
      cliente: dto.clienteId,
      registradoPor: usuarioId,
    });

    getSocketIO()?.to('dashboard').emit('caja:movimiento', { fechaKey });
    return movimiento;
  }

  async eliminarMovimiento(id: string): Promise<void> {
    const movimiento = await MovimientoCajaModel.findById(id);
    if (!movimiento) throw new NotFoundError('Movimiento');

    const caja = await CajaDiaModel.findOne({ fechaKey: movimiento.fechaKey }).lean();
    if (caja?.estado === 'cerrado') {
      throw new AppError('No se puede borrar un movimiento de un día ya cerrado', 400);
    }

    movimiento.deletedAt = new Date();
    await movimiento.save();
  }

  async listarMovimientos(fechaKey: string) {
    return MovimientoCajaModel.find({ fechaKey })
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
  async detalleDia(fechaKey: string) {
    const { inicio, fin } = rangoDeKey(fechaKey);

    const [cobros, prestamos, gastos, movimientos, caja, totales] = await Promise.all([
      CobroModel.find({ fecha: { $gte: inicio, $lte: fin }, anulado: false })
        .populate('cliente', 'nombre cedula celular')
        .populate('prestamo', 'cuotaDiaria saldoPendiente totalPagar')
        .populate('cobrador', 'nombre')
        .sort({ fecha: 1 })
        .lean(),
      PrestamoModel.find({
        fechaInicio: { $gte: inicio, $lte: fin },
        deletedAt: null,
        estado: { $ne: 'cancelado' },
      })
        .populate('cliente', 'nombre cedula')
        .populate('cobrador', 'nombre')
        .sort({ createdAt: 1 })
        .lean(),
      GastoModel.find({ fecha: { $gte: inicio, $lte: fin }, deletedAt: null })
        .sort({ fecha: 1 })
        .lean(),
      this.listarMovimientos(fechaKey),
      CajaDiaModel.findOne({ fechaKey })
        .populate('cobrador', 'nombre email')
        .populate('abiertoPor', 'nombre')
        .populate('cerradoPor', 'nombre')
        .lean(),
      this.calcularTotalesDia(fechaKey),
    ]);

    // Un cierre guardado manda sobre el cálculo en vivo
    const baseInicial = caja?.baseInicial ?? 0;
    const esperado = caja?.estado === 'cerrado'
      ? caja.saldoEsperado
      : this.saldoEsperado(baseInicial, totales);

    // Cuántos clientes de la ruta pagaron y cuántos no aparecieron
    const clientesQuePagaron = new Set(cobros.map((c) => String(c.cliente?._id ?? c.cliente))).size;

    // La caja es una sola, pero sigue importando quién movió qué: esto deja
    // ver en el cierre cuánto recogió y cuánto prestó cada cuenta.
    const porPersona = new Map<string, { nombre: string; cobrado: number; prestado: number; cobros: number; prestamos: number }>();
    const fila = (u: unknown) => {
      const doc = u as { _id?: unknown; nombre?: string } | null;
      const id = String(doc?._id ?? u ?? 'sin-dueño');
      if (!porPersona.has(id)) {
        porPersona.set(id, { nombre: doc?.nombre ?? 'Sin asignar', cobrado: 0, prestado: 0, cobros: 0, prestamos: 0 });
      }
      return porPersona.get(id)!;
    };
    for (const c of cobros) { const r = fila(c.cobrador); r.cobrado += c.monto; r.cobros += 1; }
    for (const p of prestamos) {
      const r = fila(p.cobrador);
      r.prestado += Math.max(0, p.montoDesembolsado ?? 0);
      r.prestamos += 1;
    }

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
      porPersona: [...porPersona.values()].sort((a, b) => b.cobrado - a.cobrado),
      cobros,
      prestamos,
      gastos,
      movimientos,
    };
  }
}

export const cajaService = new CajaService();

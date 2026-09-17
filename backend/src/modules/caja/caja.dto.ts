import { z } from 'zod';
import { CONCEPTOS_EGRESO, CONCEPTOS_INGRESO } from '../../models/MovimientoCaja.model';

const fechaKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (YYYY-MM-DD)');

export const AbrirCajaDto = z.object({
  baseInicial: z.number().min(0, 'La base no puede ser negativa'),
  fechaKey: fechaKey.optional(),
  observaciones: z.string().max(1000).optional(),
});

export const CerrarCajaDto = z.object({
  saldoContado: z.number().min(0, 'El efectivo contado no puede ser negativo'),
  /** Permite cerrar un día anterior que quedó abierto por olvido. */
  fechaKey: fechaKey.optional(),
  observaciones: z.string().max(1000).optional(),
});

export const CrearMovimientoDto = z
  .object({
    tipo: z.enum(['ingreso', 'egreso']),
    concepto: z.enum([...CONCEPTOS_INGRESO, ...CONCEPTOS_EGRESO, 'ajuste'] as [string, ...string[]]),
    monto: z.number().positive('El monto debe ser mayor a 0'),
    descripcion: z.string().max(500).optional(),
    prestamoId: z.string().optional(),
    clienteId: z.string().optional(),
    fechaKey: fechaKey.optional(),
  })
  .refine(
    (d) =>
      d.concepto === 'ajuste' ||
      (d.tipo === 'ingreso'
        ? (CONCEPTOS_INGRESO as readonly string[]).includes(d.concepto)
        : (CONCEPTOS_EGRESO as readonly string[]).includes(d.concepto)),
    { message: 'El concepto no corresponde al tipo de movimiento', path: ['concepto'] }
  );

export const FiltrosCierresDto = z.object({
  desde: fechaKey.optional(),
  hasta: fechaKey.optional(),
  cobradorId: z.string().optional(),
  estado: z.enum(['abierto', 'cerrado']).optional(),
  page: z.string().default('1').transform(Number),
  limit: z.string().default('30').transform(Number),
});

export type AbrirCajaDto = z.infer<typeof AbrirCajaDto>;
export type CerrarCajaDto = z.infer<typeof CerrarCajaDto>;
export type CrearMovimientoDto = z.infer<typeof CrearMovimientoDto>;
export type FiltrosCierresDto = z.infer<typeof FiltrosCierresDto>;

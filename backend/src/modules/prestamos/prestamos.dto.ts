import { z } from 'zod';

// ─── Constantes de negocio ────────────────────────────────────
export const INTERES_FIJO = 20;           // 20% fijo
export const CUOTAS_DIARIAS = 115;        // modalidad diaria
export const CUOTAS_SEMANALES = 4;        // modalidad semanal (1 mes)
export const PAPELERIA_POR_CIEN_MIL = 5000; // $5.000 por cada $100.000

export function calcularPapeleria(capital: number): number {
  const calculada = Math.floor(capital / 100_000) * PAPELERIA_POR_CIEN_MIL;
  return Math.max(5000, calculada);
}

// ─── DTOs ─────────────────────────────────────────────────────
export const CrearPrestamoDto = z.object({
  clienteId: z.string().min(1, 'El cliente es requerido'),
  capital: z
    .number()
    .positive('El capital debe ser mayor a 0')
    .min(10_000, 'El capital mínimo es $10.000'),
  modalidad: z.enum(['diaria', 'semanal'], {
    required_error: 'La modalidad es requerida (diaria o semanal)',
  }),
  numeroCuotas: z
    .number()
    .int()
    .positive('Las cuotas deben ser mayores a 0')
    .optional(),
  fechaInicio: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (YYYY-MM-DD)')
    .transform((v) => new Date(v + 'T00:00:00')),
  observaciones: z.string().max(1000).optional(),
});

export const RefinanciarPrestamoDto = z.object({
  capitalAdicional: z.number().min(0).optional().default(0),
  modalidad: z.enum(['diaria', 'semanal']),
  observaciones: z.string().max(1000).optional(),
});

export const CancelarPrestamoDto = z.object({
  motivo: z.string().min(5, 'El motivo debe tener al menos 5 caracteres'),
});

export const FiltrosPrestamoDto = z.object({
  clienteId: z.string().optional(),
  cobradorId: z.string().optional(),
  estado: z.enum(['activo', 'completado', 'cancelado', 'refinanciado']).optional(),
  modalidad: z.enum(['diaria', 'semanal']).optional(),
  page: z.string().default('1').transform(Number),
  limit: z.string().default('20').transform(Number),
});

export type CrearPrestamoDto = z.infer<typeof CrearPrestamoDto>;
export type RefinanciarPrestamoDto = z.infer<typeof RefinanciarPrestamoDto>;
export type CancelarPrestamoDto = z.infer<typeof CancelarPrestamoDto>;
export type FiltrosPrestamoDto = z.infer<typeof FiltrosPrestamoDto>;

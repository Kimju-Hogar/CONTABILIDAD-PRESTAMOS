import { z } from 'zod';

// ─── Constantes de negocio ────────────────────────────────────
export const INTERES_FIJO = 20;             // 20% por defecto
export const CUOTAS_DIARIAS = 115;          // modalidad diaria
export const CUOTAS_SEMANALES = 4;          // modalidad semanal (1 mes)
export const CUOTAS_QUINCENALES = 2;        // modalidad quincenal (1 mes = 2 quincenas)
export const CUOTAS_MENSUALES = 1;          // modalidad mensual (mínimo 1 mes)
export const PAPELERIA_POR_CIEN_MIL = 5000; // $5.000 por cada $100.000

export const MODALIDAD_VALUES = ['diaria', 'semanal', 'quincenal', 'mensual'] as const;
export type Modalidad = typeof MODALIDAD_VALUES[number];

export const DEFAULT_CUOTAS: Record<Modalidad, number> = {
  diaria:    CUOTAS_DIARIAS,
  semanal:   CUOTAS_SEMANALES,
  quincenal: CUOTAS_QUINCENALES,
  mensual:   CUOTAS_MENSUALES,
};

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
    .min(5_000, 'El capital mínimo es $5.000'),
  modalidad: z.enum(MODALIDAD_VALUES, {
    required_error: 'La modalidad es requerida',
  }),
  interes: z
    .number()
    .min(5, 'El interés mínimo es 5%')
    .max(100, 'El interés máximo es 100%')
    .optional()
    .default(INTERES_FIJO),
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
  modalidad: z.enum(MODALIDAD_VALUES),
  observaciones: z.string().max(1000).optional(),
});

export const CancelarPrestamoDto = z.object({
  motivo: z.string().min(5, 'El motivo debe tener al menos 5 caracteres'),
});

export const EditarPrestamoDto = z.object({
  capital: z.number().positive().min(5_000).optional(),
  modalidad: z.enum(MODALIDAD_VALUES).optional(),
  interes: z.number().min(5).max(100).optional(),
  numeroCuotas: z.number().int().positive().optional(),
  fechaInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).transform((v) => new Date(v + 'T00:00:00')).optional(),
  observaciones: z.string().max(1000).optional(),
});

export const FiltrosPrestamoDto = z.object({
  clienteId: z.string().optional(),
  cobradorId: z.string().optional(),
  estado: z.enum(['activo', 'completado', 'cancelado', 'refinanciado']).optional(),
  modalidad: z.enum(MODALIDAD_VALUES).optional(),
  page: z.string().default('1').transform(Number),
  limit: z.string().default('20').transform(Number),
});

export type CrearPrestamoDto = z.infer<typeof CrearPrestamoDto>;
export type RefinanciarPrestamoDto = z.infer<typeof RefinanciarPrestamoDto>;
export type CancelarPrestamoDto = z.infer<typeof CancelarPrestamoDto>;
export type EditarPrestamoDto = z.infer<typeof EditarPrestamoDto>;
export type FiltrosPrestamoDto = z.infer<typeof FiltrosPrestamoDto>;

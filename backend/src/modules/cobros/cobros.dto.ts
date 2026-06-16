import { z } from 'zod';

export const RegistrarCobroDto = z.object({
  prestamoId: z.string().min(1, 'El préstamo es requerido'),
  monto: z.number().positive('El monto debe ser mayor a 0'),
  tipo: z.enum(['diario', 'parcial', 'adelantado', 'total']),
  observaciones: z.string().max(500).optional(),
  geolocalizacion: z.object({
    lat: z.number(),
    lng: z.number(),
    precision: z.number().optional(),
  }).optional(),
  fecha: z.string().optional(), // ISO date string — permite registrar pagos históricos
  cuotasSeleccionadas: z.array(z.number().int().positive()).optional(), // Números de cuota a marcar como pagadas
});

export const AnularCobroDto = z.object({
  motivo: z.string().min(10, 'El motivo debe tener al menos 10 caracteres'),
});

export const FiltrosCobroDto = z.object({
  prestamoId: z.string().optional(),
  clienteId: z.string().optional(),
  cobradorId: z.string().optional(),
  fechaDesde: z.string().optional(),
  fechaHasta: z.string().optional(),
  tipo: z.enum(['diario', 'parcial', 'adelantado', 'total']).optional(),
  page: z.string().default('1').transform(Number),
  limit: z.string().default('30').transform(Number),
});

export type RegistrarCobroDto = z.infer<typeof RegistrarCobroDto>;
export type AnularCobroDto = z.infer<typeof AnularCobroDto>;
export type FiltrosCobroDto = z.infer<typeof FiltrosCobroDto>;

import mongoose, { Document, Schema, Types } from 'mongoose';

/**
 * Movimiento manual de caja.
 *
 * Los cobros, préstamos y gastos ya viven en sus propias colecciones y la caja
 * los agrega automáticamente. Esta colección es para el dinero que se mueve por
 * fuera de esa operación: inyección de capital del dueño, retiro de utilidades,
 * cobro de renovación de cartón, retiro de la cuenta de papelería y ajustes.
 */
export const CONCEPTOS_INGRESO = [
  'inyeccion_capital',
  'renovacion_carton',
  'abono_externo',
  'otro_ingreso',
] as const;

export const CONCEPTOS_EGRESO = [
  'retiro_utilidad',
  'retiro_papeleria',
  'prestamo_externo',
  'otro_egreso',
] as const;

export type ConceptoIngreso = typeof CONCEPTOS_INGRESO[number];
export type ConceptoEgreso = typeof CONCEPTOS_EGRESO[number];
export type ConceptoMovimiento = ConceptoIngreso | ConceptoEgreso | 'ajuste';

export const ETIQUETAS_CONCEPTO: Record<ConceptoMovimiento, string> = {
  inyeccion_capital: 'Inyección de capital',
  renovacion_carton: 'Renovación de cartón',
  abono_externo: 'Abono externo',
  otro_ingreso: 'Otro ingreso',
  retiro_utilidad: 'Retiro de utilidad',
  retiro_papeleria: 'Retiro de papelería',
  prestamo_externo: 'Préstamo por fuera del sistema',
  otro_egreso: 'Otro egreso',
  ajuste: 'Ajuste de caja',
};

export interface IMovimientoCaja extends Document {
  fechaKey: string;
  fecha: Date;
  cobrador: Types.ObjectId;     // dueño de la caja afectada
  tipo: 'ingreso' | 'egreso';
  concepto: ConceptoMovimiento;
  monto: number;
  descripcion?: string;
  /** Referencia opcional al documento que originó el movimiento. */
  prestamo?: Types.ObjectId;
  cliente?: Types.ObjectId;
  registradoPor: Types.ObjectId;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const MovimientoCajaSchema = new Schema<IMovimientoCaja>(
  {
    fechaKey: {
      type: String,
      required: true,
      match: [/^\d{4}-\d{2}-\d{2}$/, 'fechaKey debe tener formato YYYY-MM-DD'],
    },
    fecha: { type: Date, required: true, default: Date.now },
    cobrador: { type: Schema.Types.ObjectId, ref: 'Usuario', required: true },
    tipo: { type: String, enum: ['ingreso', 'egreso'], required: true },
    concepto: {
      type: String,
      enum: [...CONCEPTOS_INGRESO, ...CONCEPTOS_EGRESO, 'ajuste'],
      required: true,
    },
    monto: { type: Number, required: true, min: [1, 'El monto debe ser mayor a 0'] },
    descripcion: { type: String, maxlength: [500, 'Máximo 500 caracteres'] },
    prestamo: { type: Schema.Types.ObjectId, ref: 'Prestamo' },
    cliente: { type: Schema.Types.ObjectId, ref: 'Cliente' },
    registradoPor: { type: Schema.Types.ObjectId, ref: 'Usuario', required: true },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

MovimientoCajaSchema.index({ fechaKey: -1, cobrador: 1 });
MovimientoCajaSchema.index({ fecha: -1 });
MovimientoCajaSchema.index({ concepto: 1 });
MovimientoCajaSchema.index({ deletedAt: 1 });

MovimientoCajaSchema.pre(/^find/, function (this: mongoose.Query<unknown, IMovimientoCaja>, next) {
  this.where({ deletedAt: null });
  next();
});

export const MovimientoCajaModel = mongoose.model<IMovimientoCaja>(
  'MovimientoCaja',
  MovimientoCajaSchema
);

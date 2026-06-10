import mongoose, { Document, Schema, Types } from 'mongoose';

export interface ICuota {
  numero: number;
  fechaEsperada: Date;
  monto: number;
  estado: 'pendiente' | 'pagada' | 'parcial' | 'vencida';
  fechaPago?: Date;
  montoPagado?: number;
}

export interface IPrestamo extends Document {
  cliente: Types.ObjectId;
  cobrador: Types.ObjectId;
  capital: number;
  interes: number;           // Porcentaje (ej: 20 = 20%)
  modalidad: 'diaria' | 'semanal' | 'quincenal' | 'mensual';
  totalInteres: number;      // capital * interes / 100
  totalPagar: number;        // capital + totalInteres
  numeroCuotas: number;
  cuotaDiaria: number;       // totalPagar / numeroCuotas
  papeleria: number;
  montoDesembolsado: number;
  fechaInicio: Date;
  fechaFin: Date;
  saldoPendiente: number;
  totalCobrado: number;
  ganancia: number;          // totalCobrado - capital (dinero real ganado)
  estado: 'activo' | 'completado' | 'cancelado' | 'refinanciado';
  cuotas: ICuota[];
  refinanciadoDe?: Types.ObjectId;
  observaciones?: string;
  createdBy: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const CuotaSchema = new Schema<ICuota>(
  {
    numero: { type: Number, required: true },
    fechaEsperada: { type: Date, required: true },
    monto: { type: Number, required: true },
    estado: {
      type: String,
      enum: ['pendiente', 'pagada', 'parcial', 'vencida'],
      default: 'pendiente',
    },
    fechaPago: Date,
    montoPagado: Number,
  },
  { _id: false }
);

const PrestamoSchema = new Schema<IPrestamo>(
  {
    cliente: {
      type: Schema.Types.ObjectId,
      ref: 'Cliente',
      required: true,
    },
    cobrador: {
      type: Schema.Types.ObjectId,
      ref: 'Usuario',
      required: true,
    },
    capital: {
      type: Number,
      required: true,
      min: [1, 'El capital debe ser mayor a 0'],
    },
    interes: {
      type: Number,
      required: true,
      min: [0, 'El interés no puede ser negativo'],
      max: [100, 'El interés no puede superar 100%'],
    },
    totalInteres: { type: Number, required: true },
    totalPagar: { type: Number, required: true },
    numeroCuotas: {
      type: Number,
      required: true,
      min: [1, 'Debe tener al menos 1 cuota'],
    },
    cuotaDiaria: { type: Number, required: true },
    fechaInicio: { type: Date, required: true },
    fechaFin: { type: Date, required: true },
    saldoPendiente: { type: Number, required: true },
    totalCobrado: { type: Number, default: 0 },
    ganancia: { type: Number, default: 0 },
    estado: {
      type: String,
      enum: ['activo', 'completado', 'cancelado', 'refinanciado'],
      default: 'activo',
    },
    modalidad: {
      type: String,
      enum: ['diaria', 'semanal', 'quincenal', 'mensual'],
      default: 'diaria',
    },
    papeleria: { type: Number, default: 0 },
    montoDesembolsado: { type: Number, default: 0 },
    cuotas: {
      type: [CuotaSchema],
      default: [],
    },
    refinanciadoDe: {
      type: Schema.Types.ObjectId,
      ref: 'Prestamo',
    },
    observaciones: {
      type: String,
      maxlength: [1000, 'Las observaciones no pueden superar 1000 caracteres'],
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'Usuario',
      required: true,
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: 'Usuario',
    },
    deletedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
  }
);

// ─── Índices ──────────────────────────────────────────────────
PrestamoSchema.index({ cliente: 1 });
PrestamoSchema.index({ cobrador: 1 });
PrestamoSchema.index({ estado: 1 });
PrestamoSchema.index({ fechaInicio: 1 });
PrestamoSchema.index({ fechaFin: 1 });
PrestamoSchema.index({ cliente: 1, estado: 1 });
PrestamoSchema.index({ deletedAt: 1 });

// ─── Soft delete ─────────────────────────────────────────────
PrestamoSchema.pre(/^find/, function (this: mongoose.Query<unknown, IPrestamo>, next) {
  this.where({ deletedAt: null });
  next();
});

// ─── Virtual: cuotas vencidas ─────────────────────────────────
PrestamoSchema.virtual('cuotasVencidas').get(function () {
  const hoy = new Date();
  return this.cuotas.filter(
    (c) => c.estado !== 'pagada' && c.fechaEsperada < hoy
  ).length;
});

export const PrestamoModel = mongoose.model<IPrestamo>('Prestamo', PrestamoSchema);

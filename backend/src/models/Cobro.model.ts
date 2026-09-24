import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IGeolocalizacion {
  lat: number;
  lng: number;
  precision?: number;
}

export interface ICobro extends Document {
  prestamo: Types.ObjectId;
  cliente: Types.ObjectId;
  cobrador: Types.ObjectId;
  monto: number;
  tipo: 'diario' | 'parcial' | 'adelantado' | 'total';
  fecha: Date;
  hora: string;
  geolocalizacion?: IGeolocalizacion;
  observaciones?: string;
  cuotasAplicadas: number[];
  /** Cuánto de este cobro se abonó a cada cuota, para poder revertirlo exacto. */
  aplicaciones: Array<{ numero: number; monto: number }>;
  saldoAntes: number;
  saldoDespues: number;
  anulado: boolean;
  anuladoPor?: Types.ObjectId;
  anuladoEn?: Date;
  motivoAnulacion?: string;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const CobroSchema = new Schema<ICobro>(
  {
    prestamo: {
      type: Schema.Types.ObjectId,
      ref: 'Prestamo',
      required: true,
    },
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
    monto: {
      type: Number,
      required: true,
      min: [1, 'El monto debe ser mayor a 0'],
    },
    tipo: {
      type: String,
      enum: ['diario', 'parcial', 'adelantado', 'total'],
      required: true,
    },
    fecha: {
      type: Date,
      required: true,
      default: Date.now,
    },
    hora: {
      type: String,
      required: true,
    },
    geolocalizacion: {
      lat: Number,
      lng: Number,
      precision: Number,
    },
    observaciones: {
      type: String,
      maxlength: [500, 'Las observaciones no pueden superar 500 caracteres'],
    },
    cuotasAplicadas: {
      type: [Number],
      default: [],
    },
    aplicaciones: {
      type: [new Schema({ numero: Number, monto: Number }, { _id: false })],
      default: [],
    },
    saldoAntes: {
      type: Number,
      required: true,
    },
    saldoDespues: {
      type: Number,
      required: true,
    },
    anulado: {
      type: Boolean,
      default: false,
    },
    anuladoPor: {
      type: Schema.Types.ObjectId,
      ref: 'Usuario',
    },
    anuladoEn: Date,
    motivoAnulacion: String,
    deletedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
  }
);

// ─── Índices ──────────────────────────────────────────────────
CobroSchema.index({ prestamo: 1 });
CobroSchema.index({ cliente: 1 });
CobroSchema.index({ cobrador: 1 });
CobroSchema.index({ fecha: -1 });
CobroSchema.index({ cobrador: 1, fecha: -1 });
CobroSchema.index({ deletedAt: 1 });

// Índice compuesto para resúmenes diarios
CobroSchema.index({ fecha: -1, cobrador: 1, anulado: 1 });

export const CobroModel = mongoose.model<ICobro>('Cobro', CobroSchema);

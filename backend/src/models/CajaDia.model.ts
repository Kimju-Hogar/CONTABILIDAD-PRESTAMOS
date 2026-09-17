import mongoose, { Document, Schema, Types } from 'mongoose';

/**
 * Cierre de caja diario por cobrador.
 *
 * El cobrador abre el día con una base (que arrastra del cierre anterior),
 * trabaja, y al final cuenta el efectivo y cierra. Los totales se guardan
 * como snapshot al cerrar para que el histórico no cambie si después se
 * edita un cobro viejo.
 */
export interface ICajaDia extends Document {
  fechaKey: string;          // 'YYYY-MM-DD' en calendario de Bogotá
  fecha: Date;               // instante UTC de la medianoche de ese día
  cobrador: Types.ObjectId;

  baseInicial: number;       // efectivo con el que arrancó el día

  // Snapshot de movimientos del día (se congela al cerrar)
  totalCobrado: number;      // cobros recibidos
  totalPrestado: number;     // efectivo entregado a clientes (montoDesembolsado)
  totalPapeleria: number;    // papelería retenida en préstamos del día
  totalCartones: number;     // renovación de cartones cobrada
  totalGastos: number;       // gastos registrados
  otrosIngresos: number;     // movimientos manuales de entrada
  otrosEgresos: number;      // movimientos manuales de salida

  saldoEsperado: number;     // lo que debería haber en efectivo
  saldoContado: number | null; // lo que el cobrador contó físicamente
  diferencia: number;        // contado - esperado (negativo = faltante)

  estado: 'abierto' | 'cerrado';
  observaciones?: string;

  abiertoPor: Types.ObjectId;
  abiertoEn: Date;
  cerradoPor?: Types.ObjectId;
  cerradoEn?: Date;

  createdAt: Date;
  updatedAt: Date;
}

const CajaDiaSchema = new Schema<ICajaDia>(
  {
    fechaKey: {
      type: String,
      required: true,
      match: [/^\d{4}-\d{2}-\d{2}$/, 'fechaKey debe tener formato YYYY-MM-DD'],
    },
    fecha: { type: Date, required: true },
    cobrador: { type: Schema.Types.ObjectId, ref: 'Usuario', required: true },

    baseInicial: { type: Number, required: true, min: [0, 'La base no puede ser negativa'] },

    totalCobrado: { type: Number, default: 0 },
    totalPrestado: { type: Number, default: 0 },
    totalPapeleria: { type: Number, default: 0 },
    totalCartones: { type: Number, default: 0 },
    totalGastos: { type: Number, default: 0 },
    otrosIngresos: { type: Number, default: 0 },
    otrosEgresos: { type: Number, default: 0 },

    saldoEsperado: { type: Number, default: 0 },
    saldoContado: { type: Number, default: null },
    diferencia: { type: Number, default: 0 },

    estado: {
      type: String,
      enum: ['abierto', 'cerrado'],
      default: 'abierto',
    },
    observaciones: { type: String, maxlength: [1000, 'Máximo 1000 caracteres'] },

    abiertoPor: { type: Schema.Types.ObjectId, ref: 'Usuario', required: true },
    abiertoEn: { type: Date, default: Date.now },
    cerradoPor: { type: Schema.Types.ObjectId, ref: 'Usuario' },
    cerradoEn: Date,
  },
  { timestamps: true, toJSON: { virtuals: true } }
);

// Un solo cierre por cobrador y día
CajaDiaSchema.index({ cobrador: 1, fechaKey: 1 }, { unique: true });
CajaDiaSchema.index({ fechaKey: -1 });
CajaDiaSchema.index({ estado: 1 });

export const CajaDiaModel = mongoose.model<ICajaDia>('CajaDia', CajaDiaSchema);

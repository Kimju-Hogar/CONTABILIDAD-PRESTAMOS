import mongoose, { Document, Schema, Types } from 'mongoose';

/**
 * Cierre de caja diario del negocio. Hay UNA caja por día, no una por
 * cobrador: el efectivo que se presta sale del mismo bolsillo donde entran
 * los cobros. `cobrador` queda solo como referencia de quién la abrió.
 *
 * El cobrador abre el día con una base (que arrastra del cierre anterior),
 * trabaja, y al final cuenta el efectivo y cierra. Los totales se guardan
 * como snapshot al cerrar para que el histórico no cambie si después se
 * edita un cobro viejo.
 */
export interface ICajaDia extends Document {
  fechaKey: string;          // 'YYYY-MM-DD' en calendario de Bogotá
  fecha: Date;               // instante UTC de la medianoche de ese día
  cobrador: Types.ObjectId;   // quién la abrió (histórico; la caja es del negocio)

  baseInicial: number;       // efectivo con el que arrancó el día
  /**
   * true cuando la base la calculó el sistema al abrir el día solo. Esas se
   * recalculan en vivo, así que si después se corrige un día anterior (por
   * ejemplo metiendo plata para tapar un faltante) la cadena se arregla sola.
   * Si una persona escribió la base, se respeta tal cual.
   */
  baseAutomatica: boolean;

  // Snapshot de movimientos del día (se congela al cerrar)
  totalCobrado: number;      // cobros recibidos
  totalPrestado: number;     // efectivo entregado a clientes (montoDesembolsado)
  cargosCobrados: number;    // efectivo recibido por cargos de renovación
  totalPapeleria: number;    // papelería retenida en préstamos del día
  totalCartones: number;     // renovación de cartones cobrada
  totalGastos: number;       // gastos registrados
  otrosIngresos: number;     // movimientos manuales de entrada
  otrosEgresos: number;      // movimientos manuales de salida

  saldoEsperado: number;     // lo que debería haber en efectivo
  saldoContado: number | null; // lo que el cobrador contó físicamente
  diferencia: number;        // contado - esperado (negativo = faltante)

  estado: 'abierto' | 'cerrado';
  /**
   * true cuando el día lo cerró el reloj a las 11:59 p.m. y no una persona.
   * En esos cierres `saldoContado` queda vacío: nadie contó el efectivo, así
   * que no hay con qué comparar y la diferencia no significa nada.
   */
  cierreAutomatico: boolean;
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

    // Puede ser negativa: si un día se prestó más de lo que había en mano, el
    // día siguiente arranca en rojo. Taparlo con un cero esconde el descuadre.
    baseInicial: { type: Number, required: true },
    baseAutomatica: { type: Boolean, default: false },

    totalCobrado: { type: Number, default: 0 },
    totalPrestado: { type: Number, default: 0 },
    cargosCobrados: { type: Number, default: 0 },
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
    cierreAutomatico: { type: Boolean, default: false },
    observaciones: { type: String, maxlength: [1000, 'Máximo 1000 caracteres'] },

    abiertoPor: { type: Schema.Types.ObjectId, ref: 'Usuario', required: true },
    abiertoEn: { type: Date, default: Date.now },
    cerradoPor: { type: Schema.Types.ObjectId, ref: 'Usuario' },
    cerradoEn: Date,
  },
  { timestamps: true, toJSON: { virtuals: true } }
);

// Un solo cierre por día para todo el negocio
CajaDiaSchema.index({ fechaKey: 1 }, { unique: true });
CajaDiaSchema.index({ fechaKey: -1 });
CajaDiaSchema.index({ estado: 1 });

export const CajaDiaModel = mongoose.model<ICajaDia>('CajaDia', CajaDiaSchema);

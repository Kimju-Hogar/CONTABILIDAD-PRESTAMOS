import mongoose, { Document, Schema, Types } from 'mongoose';

/**
 * Parámetros del negocio, editables por el administrador.
 * Documento único: siempre se lee/escribe con la clave `global`.
 */
export interface IConfiguracion extends Document {
  clave: string;
  interesPorDefecto: number;      // %
  papeleriaPorCienMil: number;    // $ por cada $100.000 de capital
  papeleriaMinima: number;        // piso de la papelería
  valorCarton: number;            // valor fijo por renovación de cartón
  baseCajaSugerida: number;       // base propuesta al abrir el día
  /** Desde cuándo cuenta la cuenta de papelería. Lo anterior queda archivado. */
  fechaCortePapeleria: Date | null;
  moneda: string;
  actualizadoPor?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export const CONFIG_POR_DEFECTO = {
  interesPorDefecto: 20,
  papeleriaPorCienMil: 5000,
  papeleriaMinima: 5000,
  valorCarton: 5000,
  baseCajaSugerida: 0,
  fechaCortePapeleria: null as Date | null,
  moneda: 'COP',
};

const ConfiguracionSchema = new Schema<IConfiguracion>(
  {
    clave: { type: String, default: 'global', unique: true },
    interesPorDefecto: {
      type: Number,
      default: CONFIG_POR_DEFECTO.interesPorDefecto,
      min: [1, 'El interés mínimo es 1%'],
      max: [100, 'El interés máximo es 100%'],
    },
    papeleriaPorCienMil: { type: Number, default: CONFIG_POR_DEFECTO.papeleriaPorCienMil, min: 0 },
    papeleriaMinima: { type: Number, default: CONFIG_POR_DEFECTO.papeleriaMinima, min: 0 },
    valorCarton: { type: Number, default: CONFIG_POR_DEFECTO.valorCarton, min: 0 },
    baseCajaSugerida: { type: Number, default: CONFIG_POR_DEFECTO.baseCajaSugerida, min: 0 },
    fechaCortePapeleria: { type: Date, default: null },
    moneda: { type: String, default: CONFIG_POR_DEFECTO.moneda },
    actualizadoPor: { type: Schema.Types.ObjectId, ref: 'Usuario' },
  },
  { timestamps: true }
);

export const ConfiguracionModel = mongoose.model<IConfiguracion>(
  'Configuracion',
  ConfiguracionSchema
);

/** Lee la configuración, creándola con los valores por defecto la primera vez. */
export async function obtenerConfiguracion(): Promise<IConfiguracion> {
  const existente = await ConfiguracionModel.findOne({ clave: 'global' });
  if (existente) return existente;
  return ConfiguracionModel.create({ clave: 'global', ...CONFIG_POR_DEFECTO });
}

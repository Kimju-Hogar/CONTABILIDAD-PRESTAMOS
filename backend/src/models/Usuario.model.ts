import mongoose, { Document, Schema } from 'mongoose';

export interface ISesion {
  sessionId: string;
  deviceInfo: string;
  ip: string;
  creadoEn: Date;
  expiraEn: Date;
  activa: boolean;
}

export interface IUsuario extends Document {
  nombre: string;
  email: string;
  password: string;
  rol: 'admin' | 'cobrador';
  activo: boolean;
  ultimoAcceso?: Date;
  sesiones: ISesion[];
  pushSubscription?: object;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const SesionSchema = new Schema<ISesion>(
  {
    sessionId: { type: String, required: true },
    deviceInfo: { type: String, default: 'Desconocido' },
    ip: { type: String, required: true },
    creadoEn: { type: Date, default: Date.now },
    expiraEn: { type: Date, required: true },
    activa: { type: Boolean, default: true },
  },
  { _id: false }
);

const UsuarioSchema = new Schema<IUsuario>(
  {
    nombre: {
      type: String,
      required: [true, 'El nombre es requerido'],
      trim: true,
      maxlength: [100, 'El nombre no puede superar 100 caracteres'],
    },
    email: {
      type: String,
      required: [true, 'El email es requerido'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Email inválido'],
    },
    password: {
      type: String,
      required: [true, 'La contraseña es requerida'],
      minlength: 8,
      select: false, // No retornar en queries por defecto
    },
    rol: {
      type: String,
      enum: ['admin', 'cobrador'],
      default: 'cobrador',
    },
    activo: {
      type: Boolean,
      default: true,
    },
    ultimoAcceso: Date,
    sesiones: {
      type: [SesionSchema],
      default: [],
    },
    pushSubscription: {
      type: Schema.Types.Mixed,
      select: false,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret: Record<string, unknown>) {
        delete ret['password'];
        delete ret['__v'];
        return ret;
      },
    },
  }
);

// Índices
UsuarioSchema.index({ deletedAt: 1 });

// Soft delete — excluir eliminados por defecto
UsuarioSchema.pre(/^find/, function (this: mongoose.Query<unknown, IUsuario>, next) {
  this.where({ deletedAt: null });
  next();
});

export const UsuarioModel = mongoose.model<IUsuario>('Usuario', UsuarioSchema);

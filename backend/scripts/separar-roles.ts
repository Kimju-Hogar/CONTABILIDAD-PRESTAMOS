/**
 * separar-roles.ts — Separa la cuenta de administrador de la de cobrador.
 *
 * Hoy el negocio usa una sola cuenta con rol admin para cobrar. Este script
 * crea un administrador aparte (para el dueño del sistema) y baja la cuenta
 * operativa a rol `cobrador`, de modo que el panel financiero quede reservado
 * al admin y el cobrador vea solo su caja y su ruta.
 *
 * Uso — primero en seco para ver qué haría:
 *   npm run roles:separar
 *
 * Y cuando estés conforme, aplicando los cambios:
 *   ADMIN_EMAIL=tu@correo.com ADMIN_PASSWORD='TuClaveSegura' npm run roles:separar -- --apply
 *
 * Variables:
 *   ADMIN_EMAIL     (requerido con --apply) correo del nuevo administrador
 *   ADMIN_PASSWORD  (requerido con --apply) contraseña, mínimo 8 caracteres
 *   ADMIN_NOMBRE    nombre a mostrar del nuevo administrador
 *   COBRADOR_EMAIL  cuenta que pasa a rol cobrador (por defecto admin@gotagota.com)
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const APLICAR = process.argv.includes('--apply');

const ADMIN_NOMBRE = process.env['ADMIN_NOMBRE'] ?? 'Administrador General';
const ADMIN_EMAIL = (process.env['ADMIN_EMAIL'] ?? '').toLowerCase().trim();
const ADMIN_PASSWORD = process.env['ADMIN_PASSWORD'] ?? '';
const COBRADOR_EMAIL = (process.env['COBRADOR_EMAIL'] ?? 'admin@gotagota.com').toLowerCase().trim();
const MONGODB_URI = process.env['MONGODB_URI'] ?? '';
const MONGODB_DB = process.env['MONGODB_DB'] ?? 'gotagota';
const BCRYPT_ROUNDS = Number(process.env['BCRYPT_ROUNDS'] ?? 12);

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI no está definida en el .env');
  process.exit(1);
}

const UsuarioSchema = new mongoose.Schema(
  {
    nombre: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    rol: { type: String, enum: ['admin', 'cobrador'], default: 'cobrador' },
    activo: { type: Boolean, default: true },
    sesiones: { type: Array, default: [] },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

const Usuario = mongoose.models['Usuario'] ?? mongoose.model('Usuario', UsuarioSchema);

async function main() {
  console.log(`\n🔐 GotaGota — Separación de roles ${APLICAR ? '(APLICANDO CAMBIOS)' : '(SIMULACIÓN)'}\n`);

  if (APLICAR) {
    if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
      console.error('❌ Con --apply necesitas ADMIN_EMAIL y ADMIN_PASSWORD.');
      console.error('   Ejemplo: ADMIN_EMAIL=yo@correo.com ADMIN_PASSWORD=\'MiClave123\' npm run roles:separar -- --apply\n');
      process.exit(1);
    }
    if (ADMIN_PASSWORD.length < 8) {
      console.error('❌ La contraseña debe tener al menos 8 caracteres.\n');
      process.exit(1);
    }
    if (ADMIN_EMAIL === COBRADOR_EMAIL) {
      console.error('❌ El correo del nuevo admin no puede ser el mismo del cobrador.\n');
      process.exit(1);
    }
  }

  await mongoose.connect(MONGODB_URI, { dbName: MONGODB_DB, serverSelectionTimeoutMS: 8000 });
  console.log(`✅ Conectado a ${MONGODB_DB}\n`);

  const usuarios = await Usuario.find({ deletedAt: null }).select('nombre email rol activo').lean();
  console.log('👥 Usuarios actuales:');
  for (const u of usuarios) {
    console.log(`   · ${u.email} — ${u.rol}${u.activo ? '' : ' (inactivo)'}`);
  }
  console.log('');

  // ─── 1. Crear el nuevo administrador ────────────────────────
  const yaExiste = ADMIN_EMAIL ? await Usuario.findOne({ email: ADMIN_EMAIL }).lean() : null;

  if (yaExiste) {
    console.log(`ℹ️  Ya existe un usuario con ${ADMIN_EMAIL}; se asegurará que tenga rol admin.`);
    if (APLICAR) {
      await Usuario.updateOne({ email: ADMIN_EMAIL }, { rol: 'admin', activo: true });
      console.log('   ✅ Rol admin confirmado\n');
    }
  } else if (APLICAR) {
    const hash = await bcrypt.hash(ADMIN_PASSWORD, BCRYPT_ROUNDS);
    await Usuario.create({
      nombre: ADMIN_NOMBRE,
      email: ADMIN_EMAIL,
      password: hash,
      rol: 'admin',
      activo: true,
      sesiones: [],
      deletedAt: null,
    });
    console.log(`✅ Administrador creado: ${ADMIN_EMAIL}\n`);
  } else {
    console.log(`→ Se crearía el administrador: ${ADMIN_EMAIL || '(define ADMIN_EMAIL)'}\n`);
  }

  // ─── 2. Bajar la cuenta operativa a cobrador ────────────────
  const operativa = await Usuario.findOne({ email: COBRADOR_EMAIL }).select('nombre email rol').lean();

  if (!operativa) {
    console.log(`⚠️  No se encontró la cuenta ${COBRADOR_EMAIL}; no se cambió ningún rol.`);
  } else if (operativa.rol === 'cobrador') {
    console.log(`ℹ️  ${COBRADOR_EMAIL} ya tiene rol cobrador.`);
  } else if (APLICAR) {
    // Nunca dejar el sistema sin admin
    const adminsRestantes = await Usuario.countDocuments({
      rol: 'admin',
      activo: true,
      email: { $ne: COBRADOR_EMAIL },
      deletedAt: null,
    });
    if (adminsRestantes === 0) {
      console.error('❌ Abortado: quedaría el sistema sin ningún administrador activo.');
      console.error('   Crea primero el admin nuevo y vuelve a ejecutar.\n');
      await mongoose.disconnect();
      process.exit(1);
    }
    // Revocar sesiones para que entre de nuevo ya con el rol correcto en el token
    await Usuario.updateOne(
      { email: COBRADOR_EMAIL },
      { rol: 'cobrador', $set: { sesiones: [] } }
    );
    console.log(`✅ ${COBRADOR_EMAIL} pasó a rol cobrador (debe volver a iniciar sesión)`);
  } else {
    console.log(`→ ${COBRADOR_EMAIL} pasaría de "${operativa.rol}" a "cobrador"`);
    console.log('   (se cerrarán sus sesiones para que el token tome el rol nuevo)');
  }

  console.log(
    APLICAR
      ? '\n🎉 Listo. Entra con el admin nuevo para ver el panel financiero.\n'
      : '\n💡 Simulación terminada. Repite con --apply para aplicar los cambios.\n'
  );

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('❌ Error:', err.message ?? err);
  await mongoose.disconnect();
  process.exit(1);
});

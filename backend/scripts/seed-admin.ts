/**
 * seed-admin.ts — Crea el usuario admin inicial en la base de datos.
 *
 * Uso:
 *   npx tsx scripts/seed-admin.ts
 *
 * Puedes sobrescribir los valores por defecto con variables de entorno:
 *   ADMIN_EMAIL=otro@mail.com ADMIN_PASSWORD=MiClave123 npx tsx scripts/seed-admin.ts
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

// ─── Configuración del admin a crear ─────────────────────────
const ADMIN_NOMBRE   = process.env['ADMIN_NOMBRE']   ?? 'Administrador';
const ADMIN_EMAIL    = process.env['ADMIN_EMAIL']    ?? 'admin@gotagota.com';
const ADMIN_PASSWORD = process.env['ADMIN_PASSWORD'] ?? 'Admin1234!';
const MONGODB_URI    = process.env['MONGODB_URI']    ?? '';
const MONGODB_DB     = process.env['MONGODB_DB']     ?? 'gotagota';

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI no está definida en el .env');
  process.exit(1);
}

// ─── Schema mínimo (sin importar el modelo completo) ─────────
const UsuarioSchema = new mongoose.Schema(
  {
    nombre:    { type: String, required: true, trim: true },
    email:     { type: String, required: true, unique: true, lowercase: true, trim: true },
    password:  { type: String, required: true },
    rol:       { type: String, enum: ['admin', 'cobrador'], default: 'cobrador' },
    activo:    { type: Boolean, default: true },
    sesiones:  { type: Array, default: [] },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

const Usuario = mongoose.models['Usuario'] ?? mongoose.model('Usuario', UsuarioSchema);

async function main() {
  console.log('\n🌱 GotaGota — Seed de usuario admin\n');

  // Conectar
  console.log(`📡 Conectando a MongoDB (DB: ${MONGODB_DB})...`);
  await mongoose.connect(MONGODB_URI, { dbName: MONGODB_DB, serverSelectionTimeoutMS: 5000 });
  console.log('✅ Conectado\n');

  // Verificar si ya existe
  const existente = await Usuario.findOne({ email: ADMIN_EMAIL }).select('+password');
  if (existente) {
    console.log(`⚠️  Ya existe un usuario con el email: ${ADMIN_EMAIL}`);
    console.log('   Si quieres resetear la contraseña, usa la opción --reset\n');

    const reset = process.argv.includes('--reset');
    if (reset) {
      const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);
      await Usuario.updateOne({ email: ADMIN_EMAIL }, { password: hash, rol: 'admin', activo: true });
      console.log('🔄 Contraseña y rol actualizados exitosamente\n');
    }

    await mongoose.disconnect();
    return;
  }

  // Hashear contraseña
  const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);

  // Crear usuario
  const admin = await Usuario.create({
    nombre:    ADMIN_NOMBRE,
    email:     ADMIN_EMAIL,
    password:  hash,
    rol:       'admin',
    activo:    true,
    sesiones:  [],
    deletedAt: null,
  });

  console.log('✅ Usuario admin creado exitosamente:\n');
  console.log(`   👤 Nombre:     ${admin.nombre}`);
  console.log(`   📧 Email:      ${admin.email}`);
  console.log(`   🔑 Contraseña: ${ADMIN_PASSWORD}`);
  console.log(`   🛡️  Rol:        ${admin.rol}`);
  console.log(`   🆔 ID:         ${admin.id}`);
  console.log('\n⚠️  Cambia la contraseña en producción!\n');

  await mongoose.disconnect();
  console.log('🔌 Desconectado de MongoDB\n');
}

main().catch((err) => {
  console.error('❌ Error en seed:', err.message ?? err);
  mongoose.disconnect();
  process.exit(1);
});

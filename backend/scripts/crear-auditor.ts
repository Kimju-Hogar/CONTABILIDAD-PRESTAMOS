/**
 * crear-auditor.ts — Crea (o asciende) la cuenta de auditor.
 *
 * El auditor es el perfil de control: ve todo el sistema y es el único que
 * puede eliminar registros de forma permanente. El resto de perfiles corrige
 * con "anular" o "cancelar", que dejan rastro en la bitácora.
 *
 * Uso — en seco:
 *   npm run crear:auditor
 *
 * Aplicando:
 *   AUDITOR_EMAIL=alex@gotagota.com AUDITOR_PASSWORD='TuClave' npm run crear:auditor -- --apply
 *
 * Si la cuenta ya existe, sólo le cambia el rol a auditor (y la contraseña si
 * le pasas una nueva).
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const APLICAR = process.argv.includes('--apply');

const AUDITOR_NOMBRE = process.env['AUDITOR_NOMBRE'] ?? 'Auditor';
const AUDITOR_EMAIL = (process.env['AUDITOR_EMAIL'] ?? 'alex@gotagota.com').toLowerCase().trim();
const AUDITOR_PASSWORD = process.env['AUDITOR_PASSWORD'] ?? '';
const MONGODB_URI = process.env['MONGODB_URI'] ?? '';
const MONGODB_DB = process.env['MONGODB_DB'] ?? 'gotagota';
const BCRYPT_ROUNDS = Number(process.env['BCRYPT_ROUNDS'] ?? 12);

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI no está definida');
  process.exit(1);
}

const UsuarioSchema = new mongoose.Schema(
  {
    nombre: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    rol: { type: String, enum: ['auditor', 'admin', 'cobrador'], default: 'cobrador' },
    activo: { type: Boolean, default: true },
    sesiones: { type: Array, default: [] },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

const Usuario = mongoose.models['Usuario'] ?? mongoose.model('Usuario', UsuarioSchema);

async function main() {
  console.log(`\n🛡️  Cuenta de auditor ${APLICAR ? '(APLICANDO)' : '(SIMULACIÓN)'}\n`);

  if (APLICAR && !AUDITOR_PASSWORD) {
    const existePrimero = true; // se valida abajo contra la base
    if (existePrimero) {
      // Sin contraseña sólo tiene sentido si la cuenta ya existe
      console.log('ℹ️  No pasaste AUDITOR_PASSWORD: sólo se cambiará el rol si la cuenta ya existe.\n');
    }
  }
  if (APLICAR && AUDITOR_PASSWORD && AUDITOR_PASSWORD.length < 8) {
    console.error('❌ La contraseña debe tener al menos 8 caracteres.\n');
    process.exit(1);
  }

  await mongoose.connect(MONGODB_URI, { dbName: MONGODB_DB, serverSelectionTimeoutMS: 8000 });
  console.log(`✅ Conectado a ${MONGODB_DB}\n`);

  console.log('👥 Usuarios actuales:');
  for (const u of await Usuario.find({ deletedAt: null }).select('nombre email rol activo').lean()) {
    console.log(`   · ${String(u.email).padEnd(26)} ${u.rol}${u.activo ? '' : ' (inactivo)'}`);
  }
  console.log('');

  const existente = await Usuario.findOne({ email: AUDITOR_EMAIL });

  if (existente) {
    console.log(`La cuenta ${AUDITOR_EMAIL} ya existe con rol "${existente.rol}".`);
    console.log(`→ Pasaría a rol "auditor"${AUDITOR_PASSWORD ? ' y se le cambiaría la contraseña' : ''}.`);
    if (APLICAR) {
      const cambios: Record<string, unknown> = { rol: 'auditor', activo: true, sesiones: [] };
      if (AUDITOR_PASSWORD) cambios.password = await bcrypt.hash(AUDITOR_PASSWORD, BCRYPT_ROUNDS);
      await Usuario.updateOne({ email: AUDITOR_EMAIL }, cambios);
      console.log('\n✅ Cuenta actualizada a auditor. Debe volver a iniciar sesión.\n');
    }
  } else {
    console.log(`→ Se crearía la cuenta de auditor: ${AUDITOR_EMAIL}`);
    if (APLICAR) {
      if (!AUDITOR_PASSWORD) {
        console.error('\n❌ Para crear la cuenta necesitas pasar AUDITOR_PASSWORD.\n');
        await mongoose.disconnect();
        process.exit(1);
      }
      await Usuario.create({
        nombre: AUDITOR_NOMBRE,
        email: AUDITOR_EMAIL,
        password: await bcrypt.hash(AUDITOR_PASSWORD, BCRYPT_ROUNDS),
        rol: 'auditor',
        activo: true,
        sesiones: [],
        deletedAt: null,
      });
      console.log(`\n✅ Auditor creado: ${AUDITOR_EMAIL}\n`);
    }
  }

  if (!APLICAR) console.log('\n💡 Simulación. Repite con --apply para aplicar.\n');

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('❌ Error:', err.message ?? err);
  await mongoose.disconnect();
  process.exit(1);
});

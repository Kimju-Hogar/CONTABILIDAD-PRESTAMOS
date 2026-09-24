/**
 * rotar-mongo.ts — Cambia la credencial de MongoDB sin dejar el sistema colgado.
 *
 * Prueba la URI nueva contra el cluster ANTES de escribir nada, y sólo si
 * conecta y encuentra los datos reemplaza la línea en el .env, guardando una
 * copia del archivo anterior.
 *
 * La credencial nueva se pasa por variable de entorno, nunca por argumento:
 * los argumentos quedan en el historial del shell.
 *
 * Uso — probar sin escribir:
 *   NUEVA_URI='mongodb+srv://usuario:clave@cluster...' npm run rotar:mongo
 *
 * Aplicando:
 *   NUEVA_URI='mongodb+srv://...' npm run rotar:mongo -- --apply
 *
 * Otras variables:
 *   ARCHIVO   .env a modificar (por defecto ../.env.production)
 *   MONGODB_DB  nombre de la base (por defecto gotagota)
 */

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';

const APLICAR = process.argv.includes('--apply');
const NUEVA_URI = process.env['NUEVA_URI'] ?? '';
const BASE = process.env['MONGODB_DB'] ?? 'gotagota';
const ARCHIVO = process.env['ARCHIVO'] ?? path.resolve(process.cwd(), '..', '.env.production');

/** Oculta la contraseña para poder imprimir la URI sin filtrarla. */
const enmascarar = (uri: string) => uri.replace(/(\/\/[^:]+:)[^@]+@/, '$1****@');

if (!NUEVA_URI) {
  console.error('\n❌ Falta NUEVA_URI.\n');
  console.error("   NUEVA_URI='mongodb+srv://usuario:clave@cluster...' npm run rotar:mongo\n");
  process.exit(1);
}
if (!/^mongodb(\+srv)?:\/\/[^:]+:[^@]+@/.test(NUEVA_URI)) {
  console.error('\n❌ La URI no trae usuario y contraseña. Revisa que la copiaste completa.\n');
  process.exit(1);
}

async function main() {
  console.log(`\n🔑 Rotación de credencial de MongoDB ${APLICAR ? '(APLICANDO)' : '(SOLO PRUEBA)'}\n`);
  console.log(`   URI nueva : ${enmascarar(NUEVA_URI)}`);
  console.log(`   Archivo   : ${ARCHIVO}\n`);

  // ─── 1. Probar que la credencial nueva sirve ────────────────
  console.log('🔌 Probando la conexión...');
  const cliente = new MongoClient(NUEVA_URI, { serverSelectionTimeoutMS: 10_000 });
  try {
    await cliente.connect();
    const db = cliente.db(BASE);
    await db.command({ ping: 1 });

    const colecciones = (await db.listCollections().toArray()).map((c) => c.name);
    const prestamos = await db.collection('prestamos').countDocuments();
    const clientes = await db.collection('clientes').countDocuments();

    console.log('✅ Conecta correctamente');
    console.log(`   Colecciones : ${colecciones.length}`);
    console.log(`   Préstamos   : ${prestamos}`);
    console.log(`   Clientes    : ${clientes}\n`);

    if (prestamos === 0 && clientes === 0) {
      console.error('⚠️  La base está vacía. ¿Apuntaste al cluster correcto?');
      console.error('    No se escribió nada.\n');
      process.exit(1);
    }
  } catch (e) {
    console.error(`❌ No se pudo conectar: ${(e as Error).message}`);
    console.error('   No se escribió nada. Revisa la clave y que tu IP esté permitida en Atlas.\n');
    process.exit(1);
  } finally {
    await cliente.close();
  }

  if (!APLICAR) {
    console.log('💡 La credencial sirve. Repite con --apply para escribirla en el .env.\n');
    return;
  }

  // ─── 2. Escribir el .env dejando copia del anterior ─────────
  if (!fs.existsSync(ARCHIVO)) {
    console.error(`❌ No existe ${ARCHIVO}\n`);
    process.exit(1);
  }

  const copia = `${ARCHIVO}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  fs.copyFileSync(ARCHIVO, copia);

  const original = fs.readFileSync(ARCHIVO, 'utf8');
  const actualizado = original.replace(/^MONGODB_URI=.*$/m, `MONGODB_URI=${NUEVA_URI}`);

  if (actualizado === original) {
    console.error('❌ No encontré la línea MONGODB_URI= en el archivo. No se tocó nada.\n');
    process.exit(1);
  }

  fs.writeFileSync(ARCHIVO, actualizado, 'utf8');

  console.log(`✅ Credencial actualizada en ${path.basename(ARCHIVO)}`);
  console.log(`   Copia del anterior: ${path.basename(copia)}\n`);
  console.log('⚠️  FALTA EL SERVIDOR. En el VPS:');
  console.log('     1. Edita el .env del backend y pon la misma MONGODB_URI');
  console.log('     2. Reinicia la API  (pm2 restart gotagota-api  ó  docker compose up -d)');
  console.log('     3. Comprueba:  curl -s https://api-api-prestamos.kimjuhogar.com/health\n');
  console.log('   Cuando el servidor responda bien, borra el usuario viejo en Atlas.\n');
}

main().catch((e) => {
  console.error('❌ Error:', e.message ?? e);
  process.exit(1);
});

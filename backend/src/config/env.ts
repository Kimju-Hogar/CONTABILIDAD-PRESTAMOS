import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().default('4000').transform(Number),
  TZ: z.string().default('America/Bogota'),

  // MongoDB
  MONGODB_URI: z.string().min(1, 'MONGODB_URI es requerido'),
  MONGODB_DB: z.string().default('gotagota'),

  // JWT
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET debe tener al menos 32 chars'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET debe tener al menos 32 chars'),
  JWT_ACCESS_EXPIRES: z.string().default('7d'),
  JWT_REFRESH_EXPIRES: z.string().default('90d'),

  // Bcrypt
  BCRYPT_ROUNDS: z.string().default('12').transform(Number),

  // Cloudinary
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
  CLOUDINARY_FOLDER: z.string().default('gotagota'),

  // Web Push
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_EMAIL: z.string().default('mailto:admin@kimjuhogar.com'),

  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: z.string().default('60000').transform(Number),
  RATE_LIMIT_MAX_REQUESTS: z.string().default('100').transform(Number),

  // CORS
  CORS_ORIGINS: z.string().default('https://prestamos.kimjuhogar.com'),

  // Encryption
  ENCRYPTION_KEY: z.string().min(32).optional(),

  // Logs
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  LOG_DIR: z.string().default('/var/log/gotagota'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Error en variables de entorno:');
  console.error(parsed.error.format());
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;

import mongoose from 'mongoose';
import { env } from './env';
import { logger } from '../shared/utils/logger';

const MONGODB_OPTIONS: mongoose.ConnectOptions = {
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
  maxPoolSize: 10,
  minPoolSize: 2,
  dbName: env.MONGODB_DB,
};

export async function connectDatabase(): Promise<void> {
  try {
    mongoose.set('strictQuery', true);

    // Eventos de conexión
    mongoose.connection.on('connected', () => {
      logger.info('✅ MongoDB conectado correctamente');
    });

    mongoose.connection.on('error', (err) => {
      logger.error('❌ Error de MongoDB:', err);
    });

    mongoose.connection.on('disconnected', () => {
      logger.warn('⚠️ MongoDB desconectado');
    });

    // Graceful shutdown
    process.on('SIGINT', async () => {
      await mongoose.connection.close();
      logger.info('MongoDB desconectado por SIGINT');
      process.exit(0);
    });

    await mongoose.connect(env.MONGODB_URI, MONGODB_OPTIONS);
  } catch (error) {
    logger.error('❌ No se pudo conectar a MongoDB:', error);
    process.exit(1);
  }
}

export function getConnectionStatus(): string {
  const states: Record<number, string> = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting',
  };
  return states[mongoose.connection.readyState] ?? 'unknown';
}

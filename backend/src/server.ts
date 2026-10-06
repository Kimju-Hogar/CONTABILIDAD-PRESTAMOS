import http from 'http';
import app from './app';
import { connectDatabase } from './config/database';
import { initSocket } from './config/socket';
import { env } from './config/env';
import { logger } from './shared/utils/logger';
import { prestamosService } from './modules/prestamos/prestamos.service';
import { cajaService } from './modules/caja/caja.service';
import { cadaDiaALas } from './shared/utils/agenda';
import { keyDia } from './shared/utils/fechas';

async function bootstrap() {
  // Conectar MongoDB
  await connectDatabase();

  // Crear servidor HTTP
  const server = http.createServer(app);

  // Inicializar Socket.IO
  initSocket(server);

  // Iniciar servidor
  server.listen(env.PORT, () => {
    logger.info(`🚀 GotaGota API corriendo en puerto ${env.PORT} [${env.NODE_ENV}]`);
    logger.info(`🕐 Zona horaria: ${env.TZ}`);
  });

  // ─── Cron job: actualizar cuotas vencidas ────────────────
  // Ejecutar cada día a las 00:01 hora Colombia
  const actualizarVencidas = async () => {
    try {
      const modificados = await prestamosService.actualizarCuotasVencidas();
      if (modificados > 0) {
        logger.info(`📅 Cuotas vencidas actualizadas: ${modificados} préstamos`);
      }
    } catch (err) {
      logger.error('Error actualizando cuotas vencidas:', err);
    }
  };

  // Ejecutar al inicio y luego cada día a las 00:05 de Colombia
  await actualizarVencidas();
  cadaDiaALas(0, 5, actualizarVencidas);

  // ─── Cierre automático de la caja a las 11:59 p.m. ───────
  // El día se cierra solo al terminar, con el saldo esperado y sin efectivo
  // contado: así el día siguiente arranca con lo que quedó, sin que nadie
  // tenga que entrar a cerrar.
  const cerrarCaja = async () => {
    try {
      const cerrados = await cajaService.cerrarPendientesHasta(keyDia());
      if (cerrados.length) {
        logger.info(`🧾 Caja cerrada automáticamente: ${cerrados.join(', ')}`);
      }
    } catch (err) {
      logger.error('Error en el cierre automático de caja:', err);
    }
  };

  cadaDiaALas(23, 59, cerrarCaja);

  // Al arrancar se cierran los días ya vencidos que quedaron abiertos: si el
  // servidor estuvo caído a las 11:59 esos días quedarían colgados. El día de
  // hoy no se toca, que todavía está en curso.
  const ayer = keyDia(new Date(Date.now() - 24 * 60 * 60 * 1000));
  try {
    const recuperados = await cajaService.cerrarPendientesHasta(ayer);
    if (recuperados.length) {
      logger.info(`🧾 Días que quedaron abiertos y se cerraron al arrancar: ${recuperados.join(', ')}`);
    }
  } catch (err) {
    logger.error('Error cerrando días pendientes al arrancar:', err);
  }

  // ─── Graceful Shutdown ───────────────────────────────────
  const shutdown = (signal: string) => {
    logger.info(`⚠️ ${signal} recibido. Cerrando servidor...`);
    server.close(() => {
      logger.info('✅ Servidor cerrado correctamente');
      process.exit(0);
    });
    setTimeout(() => {
      logger.error('⏰ Timeout forzado en shutdown');
      process.exit(1);
    }, 5000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('uncaughtException', (err) => {
    logger.error('💥 Excepción no capturada:', err);
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    logger.error('💥 Promise rechazada sin manejar:', reason);
  });
}

bootstrap().catch((err) => {
  console.error('❌ Error en bootstrap:', err);
  process.exit(1);
});

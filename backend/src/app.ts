import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import mongoSanitize from 'express-mongo-sanitize';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import { env } from './config/env';
import { loggerStream } from './shared/utils/logger';
import { errorMiddleware, notFoundMiddleware } from './shared/middleware/error.middleware';

// ─── Routers ─────────────────────────────────────────────────
import authRoutes from './modules/auth/auth.routes';
import clientesRoutes from './modules/clientes/clientes.routes';
import prestamosRoutes from './modules/prestamos/prestamos.routes';
import cobrosRoutes from './modules/cobros/cobros.routes';
import gastosRoutes from './modules/gastos/gastos.routes';
import dashboardRoutes from './modules/dashboard/dashboard.routes';
import reportesRoutes from './modules/reportes/reportes.routes';
import cajaRoutes from './modules/caja/caja.routes';
import adminRoutes from './modules/admin/admin.routes';

const app = express();

// ─── Seguridad ────────────────────────────────────────────────
app.set('trust proxy', 1);

app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: false, // Manejado por Nginx
}));

app.use(cors({
  origin: env.CORS_ORIGINS.split(','),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ─── Rate Limiting global ─────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Demasiadas peticiones. Intenta más tarde.' },
});
app.use('/api/', globalLimiter);

// ─── Middlewares ──────────────────────────────────────────────
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());
app.use(mongoSanitize()); // Prevenir inyección NoSQL

if (env.NODE_ENV !== 'test') {
  app.use(morgan('combined', { stream: loggerStream }));
}

// ─── Health Check ─────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    version: process.env['npm_package_version'] || '1.0.0',
    timestamp: new Date().toISOString(),
    tz: process.env['TZ'],
  });
});

// ─── API Routes ───────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/clientes', clientesRoutes);
app.use('/api/prestamos', prestamosRoutes);
app.use('/api/cobros', cobrosRoutes);
app.use('/api/gastos', gastosRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/reportes', reportesRoutes);
app.use('/api/caja', cajaRoutes);
app.use('/api/admin', adminRoutes);

// ─── Error Handlers ───────────────────────────────────────────
app.use(notFoundMiddleware);
app.use(errorMiddleware);

export default app;

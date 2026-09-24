import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { adminService } from './admin.service';
import { authMiddleware, adminOnly, auditorOnly } from '../../shared/middleware/auth.middleware';
import { auditMiddleware } from '../../shared/middleware/audit.middleware';
import { ResponseHelper, buildPagination } from '../../shared/utils/responses';
import { AppError, NotFoundError } from '../../shared/middleware/error.middleware';
import { UsuarioModel } from '../../models/Usuario.model';
import { AuditLogModel } from '../../models/AuditLog.model';
import { ConfiguracionModel, obtenerConfiguracion } from '../../models/Configuracion.model';
import { env } from '../../config/env';
import type { Periodo } from '../../shared/utils/fechas';

const router = Router();
router.use(authMiddleware, adminOnly);

const PERIODOS = ['hoy', 'ayer', 'semana', 'mes', 'anio', 'rango'] as const;

function leerPeriodo(req: Request): { periodo: Periodo; desde?: string; hasta?: string } {
  const raw = (req.query['periodo'] as string) ?? 'mes';
  const periodo = (PERIODOS as readonly string[]).includes(raw) ? (raw as Periodo) : 'mes';
  return {
    periodo,
    desde: req.query['desde'] as string | undefined,
    hasta: req.query['hasta'] as string | undefined,
  };
}

// ─── Resumen ejecutivo ────────────────────────────────────────
router.get('/resumen', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { periodo, desde, hasta } = leerPeriodo(req);
    const cobradorId = req.query['cobradorId'] as string | undefined;
    const data = await adminService.resumen(periodo, desde, hasta, cobradorId);
    ResponseHelper.success(res, data);
  } catch (error) { next(error); }
});

/** Los cuatro periodos de un vistazo — lo que se pinta arriba del panel. */
router.get('/panorama', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const [hoy, semana, mes, anio] = await Promise.all([
      adminService.resumen('hoy'),
      adminService.resumen('semana'),
      adminService.resumen('mes'),
      adminService.resumen('anio'),
    ]);
    ResponseHelper.success(res, { hoy, semana, mes, anio });
  } catch (error) { next(error); }
});

// ─── Series ───────────────────────────────────────────────────
router.get('/series', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const dias = Math.min(365, Math.max(1, Number(req.query['dias']) || 30));
    const cobradorId = req.query['cobradorId'] as string | undefined;
    ResponseHelper.success(res, await adminService.series(dias, cobradorId));
  } catch (error) { next(error); }
});

router.get('/series-mensuales', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const meses = Math.min(36, Math.max(1, Number(req.query['meses']) || 12));
    ResponseHelper.success(res, await adminService.seriesMensuales(meses));
  } catch (error) { next(error); }
});

// ─── Cobradores, cartera y clientes ───────────────────────────
router.get('/cobradores', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { periodo, desde, hasta } = leerPeriodo(req);
    ResponseHelper.success(res, await adminService.rendimientoCobradores(periodo, desde, hasta));
  } catch (error) { next(error); }
});

router.get('/aging', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    ResponseHelper.success(res, await adminService.aging());
  } catch (error) { next(error); }
});

router.get('/top-clientes', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { periodo, desde, hasta } = leerPeriodo(req);
    const limite = Math.min(50, Math.max(1, Number(req.query['limite']) || 10));
    ResponseHelper.success(res, await adminService.topClientes(periodo, desde, hasta, limite));
  } catch (error) { next(error); }
});

// ─── Reporte general ──────────────────────────────────────────
router.get('/reporte', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { periodo, desde, hasta } = leerPeriodo(req);
    const cobradorId = req.query['cobradorId'] as string | undefined;
    ResponseHelper.success(res, await adminService.reporteGeneral(periodo, desde, hasta, cobradorId));
  } catch (error) { next(error); }
});

router.get('/reporte.pdf', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { periodo, desde, hasta } = leerPeriodo(req);
    const cobradorId = req.query['cobradorId'] as string | undefined;
    const detallado = req.query['detallado'] === 'true';

    const datos = await adminService.reporteGeneral(periodo, desde, hasta, cobradorId);
    // Import dinámico: PDFKit pesa y sólo hace falta cuando piden el reporte
    const { construirReportePDF } = await import('./admin.reporte');
    const pdf = await construirReportePDF(datos, detallado);

    const nombre = `gotagota_reporte_${detallado ? 'detallado' : 'general'}_${periodo}_${Date.now()}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=${nombre}`);
    res.setHeader('Content-Length', pdf.length);
    res.send(pdf);
  } catch (error) { next(error); }
});

// ─── Bitácora de auditoría ────────────────────────────────────
router.get('/auditoria', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, Number(req.query['page']) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query['limit']) || 40));
    const query: Record<string, unknown> = {};
    if (req.query['accion']) query.accion = req.query['accion'];
    if (req.query['recurso']) query.recurso = req.query['recurso'];
    if (req.query['usuarioId']) query.usuario = req.query['usuarioId'];

    const [data, total] = await Promise.all([
      AuditLogModel.find(query)
        .populate('usuario', 'nombre email rol')
        .sort({ timestamp: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      AuditLogModel.countDocuments(query),
    ]);

    ResponseHelper.paginated(res, data, buildPagination(total, page, limit));
  } catch (error) { next(error); }
});

/** Las acciones distintas que hay registradas, para llenar el filtro. */
router.get('/auditoria/acciones', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const acciones = await AuditLogModel.distinct('accion');
    ResponseHelper.success(res, acciones.sort());
  } catch (error) { next(error); }
});

// ─── Patrimonio: lo que hay en la calle más lo que hay en caja ─
router.get('/patrimonio', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const cobradorId = req.query['cobradorId'] as string | undefined;
    ResponseHelper.success(res, await adminService.patrimonio(cobradorId));
  } catch (error) { next(error); }
});

// ─── Cuenta general de papelería y cartones ───────────────────
router.get('/cuenta-papeleria', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const cobradorId = req.query['cobradorId'] as string | undefined;
    ResponseHelper.success(res, await adminService.cuentaPapeleria(cobradorId));
  } catch (error) { next(error); }
});

/**
 * Arranca un periodo nuevo de papelería. No borra nada: guarda la fecha de
 * corte y la cuenta pasa a contar sólo lo que venga de ahí en adelante.
 */
router.post(
  '/papeleria/corte',
  auditMiddleware({ accion: 'CORTE_PAPELERIA', recurso: 'Configuracion' }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const fecha = req.body?.fecha ? new Date(String(req.body.fecha)) : new Date();
      if (Number.isNaN(fecha.getTime())) throw new AppError('Fecha de corte inválida', 400);

      await obtenerConfiguracion();
      const config = await ConfiguracionModel.findOneAndUpdate(
        { clave: 'global' },
        { fechaCortePapeleria: fecha, actualizadoPor: req.user!.sub },
        { new: true }
      );
      ResponseHelper.success(res, config, 'Periodo de papelería reiniciado');
    } catch (error) { next(error); }
  }
);

/** Deshace el corte: la cuenta vuelve a mostrar todo el histórico. */
router.delete(
  '/papeleria/corte',
  auditorOnly,
  auditMiddleware({ accion: 'QUITAR_CORTE_PAPELERIA', recurso: 'Configuracion' }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await obtenerConfiguracion();
      const config = await ConfiguracionModel.findOneAndUpdate(
        { clave: 'global' },
        { fechaCortePapeleria: null, actualizadoPor: req.user!.sub },
        { new: true }
      );
      ResponseHelper.success(res, config, 'Corte de papelería eliminado');
    } catch (error) { next(error); }
  }
);

// ─── Configuración del negocio ────────────────────────────────
const ActualizarConfigDto = z.object({
  interesPorDefecto: z.number().min(1).max(100).optional(),
  papeleriaPorCienMil: z.number().min(0).optional(),
  papeleriaMinima: z.number().min(0).optional(),
  valorCarton: z.number().min(0).optional(),
  baseCajaSugerida: z.number().min(0).optional(),
});

router.get('/configuracion', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    ResponseHelper.success(res, await obtenerConfiguracion());
  } catch (error) { next(error); }
});

router.put(
  '/configuracion',
  auditMiddleware({ accion: 'UPDATE_CONFIGURACION', recurso: 'Configuracion' }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = ActualizarConfigDto.parse(req.body);
      await obtenerConfiguracion(); // garantiza que el documento exista
      const config = await ConfiguracionModel.findOneAndUpdate(
        { clave: 'global' },
        { ...dto, actualizadoPor: req.user!.sub },
        { new: true }
      );
      ResponseHelper.success(res, config, 'Configuración actualizada');
    } catch (error) { next(error); }
  }
);

// ─── Usuarios ─────────────────────────────────────────────────
const CrearUsuarioDto = z.object({
  nombre: z.string().min(3, 'El nombre debe tener al menos 3 caracteres').max(100),
  email: z.string().email('Email inválido'),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres'),
  rol: z.enum(['auditor', 'admin', 'cobrador']).default('cobrador'),
});

const ActualizarUsuarioDto = z.object({
  nombre: z.string().min(3).max(100).optional(),
  email: z.string().email().optional(),
  rol: z.enum(['auditor', 'admin', 'cobrador']).optional(),
  activo: z.boolean().optional(),
});

router.get('/usuarios', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const usuarios = await UsuarioModel.find()
      .select('nombre email rol activo ultimoAcceso createdAt')
      .sort({ createdAt: 1 })
      .lean();
    ResponseHelper.success(res, usuarios);
  } catch (error) { next(error); }
});

router.post(
  '/usuarios',
  auditMiddleware({ accion: 'CREATE_USUARIO', recurso: 'Usuario' }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = CrearUsuarioDto.parse(req.body);
      const existente = await UsuarioModel.findOne({ email: dto.email.toLowerCase() }).lean();
      if (existente) throw new AppError('Ya existe un usuario con ese email', 409);

      const usuario = await UsuarioModel.create({
        nombre: dto.nombre,
        email: dto.email.toLowerCase(),
        password: await bcrypt.hash(dto.password, env.BCRYPT_ROUNDS),
        rol: dto.rol,
        activo: true,
      });

      ResponseHelper.created(
        res,
        { id: usuario.id, nombre: usuario.nombre, email: usuario.email, rol: usuario.rol },
        'Usuario creado exitosamente'
      );
    } catch (error) { next(error); }
  }
);

router.put(
  '/usuarios/:id',
  auditMiddleware({ accion: 'UPDATE_USUARIO', recurso: 'Usuario', getRecursoId: (r) => r.params['id'] }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = ActualizarUsuarioDto.parse(req.body);
      const id = req.params['id']!;

      // No dejar al sistema sin ningún administrador activo
      if (dto.rol === 'cobrador' || dto.activo === false) {
        const objetivo = await UsuarioModel.findById(id).select('rol activo').lean();
        if (objetivo?.rol === 'admin') {
          const adminsActivos = await UsuarioModel.countDocuments({ rol: 'admin', activo: true });
          if (adminsActivos <= 1) {
            throw new AppError('No puedes dejar el sistema sin ningún administrador activo', 400);
          }
        }
      }

      const usuario = await UsuarioModel.findByIdAndUpdate(
        id,
        { ...dto, ...(dto.email ? { email: dto.email.toLowerCase() } : {}) },
        { new: true, runValidators: true }
      ).select('nombre email rol activo');

      if (!usuario) throw new NotFoundError('Usuario');
      ResponseHelper.success(res, usuario, 'Usuario actualizado');
    } catch (error) { next(error); }
  }
);

router.post(
  '/usuarios/:id/password',
  auditMiddleware({ accion: 'RESET_PASSWORD', recurso: 'Usuario', getRecursoId: (r) => r.params['id'] }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const password = z.string().min(8, 'Mínimo 8 caracteres').parse(req.body?.password);
      const hash = await bcrypt.hash(password, env.BCRYPT_ROUNDS);
      const usuario = await UsuarioModel.findByIdAndUpdate(req.params['id'], {
        password: hash,
        $set: { 'sesiones.$[].activa': false }, // forzar nuevo inicio de sesión
      });
      if (!usuario) throw new NotFoundError('Usuario');
      ResponseHelper.success(res, null, 'Contraseña actualizada. El usuario debe volver a iniciar sesión.');
    } catch (error) { next(error); }
  }
);

router.delete(
  '/usuarios/:id',
  auditorOnly,
  auditMiddleware({ accion: 'DELETE_USUARIO', recurso: 'Usuario', getRecursoId: (r) => r.params['id'] }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params['id']!;
      if (id === req.user!.sub) throw new AppError('No puedes eliminar tu propio usuario', 400);

      const usuario = await UsuarioModel.findById(id).select('rol').lean();
      if (!usuario) throw new NotFoundError('Usuario');
      if (usuario.rol === 'admin') {
        const adminsActivos = await UsuarioModel.countDocuments({ rol: 'admin', activo: true });
        if (adminsActivos <= 1) throw new AppError('No puedes eliminar al único administrador', 400);
      }

      await UsuarioModel.findByIdAndUpdate(id, { deletedAt: new Date(), activo: false });
      ResponseHelper.success(res, null, 'Usuario eliminado');
    } catch (error) { next(error); }
  }
);

export default router;

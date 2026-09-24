import { Router, Request, Response, NextFunction } from 'express';
import { cajaService } from './caja.service';
import { authMiddleware, adminOnly, auditorOnly } from '../../shared/middleware/auth.middleware';
import { auditMiddleware } from '../../shared/middleware/audit.middleware';
import { ResponseHelper } from '../../shared/utils/responses';
import { ForbiddenError, AppError } from '../../shared/middleware/error.middleware';
import { keyDia } from '../../shared/utils/fechas';
import {
  AbrirCajaDto, CerrarCajaDto, CrearMovimientoDto, FiltrosCierresDto,
} from './caja.dto';

const router = Router();
router.use(authMiddleware);

/**
 * Cada cobrador opera su propia caja. El admin puede mirar (y operar) la de
 * cualquiera pasando `?cobradorId=`; un cobrador que lo intente recibe 403.
 */
function resolverCobrador(req: Request): string {
  const solicitado = (req.query['cobradorId'] ?? req.body?.cobradorId) as string | undefined;
  if (!solicitado) return req.user!.sub;
  const mandaEnTodo = req.user!.rol === 'admin' || req.user!.rol === 'auditor';
  if (!mandaEnTodo && solicitado !== req.user!.sub) {
    throw new ForbiddenError('Solo puedes operar tu propia caja');
  }
  return solicitado;
}

// ─── Estado del día ───────────────────────────────────────────
router.get('/estado', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const cobradorId = resolverCobrador(req);
    const fecha = req.query['fecha'] as string | undefined;
    const data = await cajaService.estadoDia(cobradorId, fecha);
    ResponseHelper.success(res, data);
  } catch (error) { next(error); }
});

// ─── Detalle de movimientos del día ───────────────────────────
router.get('/detalle', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const cobradorId = resolverCobrador(req);
    const fechaKey = (req.query['fecha'] as string) ?? keyDia();
    const data = await cajaService.detalleDia(fechaKey, cobradorId);
    ResponseHelper.success(res, data);
  } catch (error) { next(error); }
});

// ─── Cierre del día en PDF ────────────────────────────────────
router.get('/dia.pdf', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const cobradorId = resolverCobrador(req);
    const fechaKey = (req.query['fecha'] as string) ?? keyDia();
    const datos = await cajaService.detalleDia(fechaKey, cobradorId);

    // Import dinámico: PDFKit sólo hace falta cuando piden el papel
    const { construirCierreDiarioPDF } = await import('./caja.reporte');
    const pdf = await construirCierreDiarioPDF(datos as never);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=cierre_${fechaKey}.pdf`);
    res.setHeader('Content-Length', pdf.length);
    res.send(pdf);
  } catch (error) { next(error); }
});

// ─── Abrir el día ─────────────────────────────────────────────
router.post(
  '/abrir',
  auditMiddleware({ accion: 'ABRIR_CAJA', recurso: 'CajaDia' }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const cobradorId = resolverCobrador(req);
      const dto = AbrirCajaDto.parse(req.body);
      const caja = await cajaService.abrir(dto, cobradorId);
      ResponseHelper.created(res, caja, 'Caja abierta correctamente');
    } catch (error) { next(error); }
  }
);

// ─── Cerrar el día ────────────────────────────────────────────
router.post(
  '/cerrar',
  auditMiddleware({ accion: 'CERRAR_CAJA', recurso: 'CajaDia' }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const cobradorId = resolverCobrador(req);
      const dto = CerrarCajaDto.parse(req.body);
      const caja = await cajaService.cerrar(dto, cobradorId, req.user!.sub);
      ResponseHelper.success(res, caja, 'Día cerrado correctamente');
    } catch (error) { next(error); }
  }
);

// ─── Reabrir un cierre (admin) ────────────────────────────────
router.post(
  '/:id/reabrir',
  adminOnly,
  auditMiddleware({ accion: 'REABRIR_CAJA', recurso: 'CajaDia', getRecursoId: (r) => r.params['id'] }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const motivo = String(req.body?.motivo ?? '').trim();
      if (motivo.length < 5) throw new AppError('Indica el motivo de la reapertura (mínimo 5 caracteres)', 400);
      const caja = await cajaService.reabrir(req.params['id']!, motivo);
      ResponseHelper.success(res, caja, 'Cierre reabierto');
    } catch (error) { next(error); }
  }
);

// ─── Histórico de cierres ─────────────────────────────────────
router.get('/cierres', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const filtros = FiltrosCierresDto.parse(req.query);
    // Un cobrador solo ve sus propios cierres
    // El cobrador solo ve los suyos; admin y auditor ven los de todos
    if (req.user!.rol === 'cobrador') filtros.cobradorId = req.user!.sub;
    const { data, pagination } = await cajaService.listarCierres(filtros);
    ResponseHelper.paginated(res, data, pagination);
  } catch (error) { next(error); }
});

// ─── Movimientos manuales ─────────────────────────────────────
router.get('/movimientos', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const cobradorId = resolverCobrador(req);
    const fechaKey = (req.query['fecha'] as string) ?? keyDia();
    const data = await cajaService.listarMovimientos(fechaKey, cobradorId);
    ResponseHelper.success(res, data);
  } catch (error) { next(error); }
});

router.post(
  '/movimientos',
  auditMiddleware({ accion: 'CREATE_MOVIMIENTO_CAJA', recurso: 'MovimientoCaja' }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const cobradorId = resolverCobrador(req);
      const dto = CrearMovimientoDto.parse(req.body);
      const mov = await cajaService.crearMovimiento(dto, cobradorId, req.user!.sub);
      ResponseHelper.created(res, mov, 'Movimiento registrado');
    } catch (error) { next(error); }
  }
);

router.delete(
  '/movimientos/:id',
  auditorOnly,
  auditMiddleware({ accion: 'DELETE_MOVIMIENTO_CAJA', recurso: 'MovimientoCaja', getRecursoId: (r) => r.params['id'] }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await cajaService.eliminarMovimiento(req.params['id']!);
      ResponseHelper.success(res, null, 'Movimiento eliminado');
    } catch (error) { next(error); }
  }
);

export default router;

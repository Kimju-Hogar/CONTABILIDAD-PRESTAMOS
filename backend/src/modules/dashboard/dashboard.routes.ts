import { Router, Request, Response, NextFunction } from 'express';
import { dashboardService } from './dashboard.service';
import { authMiddleware } from '../../shared/middleware/auth.middleware';
import { ResponseHelper } from '../../shared/utils/responses';

const router = Router();
router.use(authMiddleware);

router.get('/kpis', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const kpis = await dashboardService.getKPIs();
    ResponseHelper.success(res, kpis);
  } catch (error) { next(error); }
});

router.get('/flujo-caja', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const dias = Number(req.query['dias']) || 30;
    const data = await dashboardService.getFlujoCaja(dias);
    ResponseHelper.success(res, data);
  } catch (error) { next(error); }
});

router.get('/morosos', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await dashboardService.getClientesMorosos();
    ResponseHelper.success(res, data);
  } catch (error) { next(error); }
});

router.get('/cobrar-hoy', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await dashboardService.getClientesACobrarHoy();
    ResponseHelper.success(res, data);
  } catch (error) { next(error); }
});

export default router;

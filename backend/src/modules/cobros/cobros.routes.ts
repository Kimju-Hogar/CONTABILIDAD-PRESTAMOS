import { Router } from 'express';
import { cobrosController } from './cobros.controller';
import { authMiddleware } from '../../shared/middleware/auth.middleware';
import { auditMiddleware } from '../../shared/middleware/audit.middleware';

const router = Router();
router.use(authMiddleware);

router.get('/', cobrosController.listar.bind(cobrosController));
router.get('/resumen/dia', cobrosController.resumenDia.bind(cobrosController));
router.get('/prestamo/:prestamoId', cobrosController.cobrosPrestamo.bind(cobrosController));

router.post(
  '/',
  auditMiddleware({ accion: 'CREATE_COBRO', recurso: 'Cobro' }),
  cobrosController.registrar.bind(cobrosController)
);

router.post(
  '/:id/anular',
  auditMiddleware({ accion: 'ANULAR_COBRO', recurso: 'Cobro', getRecursoId: (r) => r.params['id'] }),
  cobrosController.anular.bind(cobrosController)
);

router.delete(
  '/:id',
  auditMiddleware({ accion: 'DELETE_COBRO', recurso: 'Cobro', getRecursoId: (r) => r.params['id'] }),
  cobrosController.eliminar.bind(cobrosController)
);

export default router;

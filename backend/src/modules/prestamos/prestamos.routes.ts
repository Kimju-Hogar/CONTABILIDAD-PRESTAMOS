import { Router } from 'express';
import { prestamosController } from './prestamos.controller';
import { authMiddleware, adminOnly } from '../../shared/middleware/auth.middleware';
import { auditMiddleware } from '../../shared/middleware/audit.middleware';

const router = Router();
router.use(authMiddleware);

router.get('/', prestamosController.listar.bind(prestamosController));
router.get('/:id', prestamosController.obtener.bind(prestamosController));

router.post(
  '/',
  auditMiddleware({ accion: 'CREATE_PRESTAMO', recurso: 'Prestamo' }),
  prestamosController.crear.bind(prestamosController)
);

router.post(
  '/:id/cancelar',
  adminOnly,
  auditMiddleware({ accion: 'CANCEL_PRESTAMO', recurso: 'Prestamo', getRecursoId: (r) => r.params['id'] }),
  prestamosController.cancelar.bind(prestamosController)
);

router.post(
  '/:id/refinanciar',
  auditMiddleware({ accion: 'REFINANCIAR_PRESTAMO', recurso: 'Prestamo', getRecursoId: (r) => r.params['id'] }),
  prestamosController.refinanciar.bind(prestamosController)
);

router.put(
  '/:id',
  adminOnly,
  auditMiddleware({ accion: 'UPDATE_PRESTAMO', recurso: 'Prestamo', getRecursoId: (r) => r.params['id'] }),
  prestamosController.editar.bind(prestamosController)
);

router.delete(
  '/:id',
  adminOnly,
  auditMiddleware({ accion: 'DELETE_PRESTAMO', recurso: 'Prestamo', getRecursoId: (r) => r.params['id'] }),
  prestamosController.eliminar.bind(prestamosController)
);

export default router;

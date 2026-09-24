import { Router } from 'express';
import multer from 'multer';
import { clientesController } from './clientes.controller';
import { authMiddleware, auditorOnly } from '../../shared/middleware/auth.middleware';
import { auditMiddleware } from '../../shared/middleware/audit.middleware';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB máximo
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten imágenes'));
    }
  },
});

// Todas las rutas requieren autenticación
router.use(authMiddleware);

router.get('/', clientesController.listar.bind(clientesController));
router.get('/:id', clientesController.obtener.bind(clientesController));
router.get('/:id/prestamos', clientesController.obtenerPrestamos.bind(clientesController));

router.post(
  '/',
  auditMiddleware({ accion: 'CREATE_CLIENTE', recurso: 'Cliente' }),
  clientesController.crear.bind(clientesController)
);

router.put(
  '/:id',
  auditMiddleware({ accion: 'UPDATE_CLIENTE', recurso: 'Cliente', getRecursoId: (req) => req.params['id'] }),
  clientesController.actualizar.bind(clientesController)
);

router.delete(
  '/:id',
  auditorOnly,
  auditMiddleware({ accion: 'DELETE_CLIENTE', recurso: 'Cliente', getRecursoId: (req) => req.params['id'] }),
  clientesController.eliminar.bind(clientesController)
);

router.post(
  '/:id/fotos/:tipo',
  upload.single('foto'),
  clientesController.subirFoto.bind(clientesController)
);

export default router;

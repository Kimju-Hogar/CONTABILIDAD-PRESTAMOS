import { v2 as cloudinary } from 'cloudinary';
import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { GastoModel } from '../../models/Gasto.model';
import { authMiddleware, auditorOnly } from '../../shared/middleware/auth.middleware';
import { ResponseHelper, buildPagination } from '../../shared/utils/responses';
import { NotFoundError, ForbiddenError } from '../../shared/middleware/error.middleware';
import { CrearGastoDto, FiltrosGastoDto } from './gastos.dto';
import { env } from '../../config/env';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.use(authMiddleware);

// ─── Listar ───────────────────────────────────────────────────
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const filtros = FiltrosGastoDto.parse(req.query);
    const query: Record<string, unknown> = {};
    if (filtros.categoria) query.categoria = filtros.categoria;
    if (filtros.fechaDesde || filtros.fechaHasta) {
      const fd: Record<string, Date> = {};
      if (filtros.fechaDesde) fd.$gte = new Date(filtros.fechaDesde);
      if (filtros.fechaHasta) fd.$lte = new Date(filtros.fechaHasta);
      query.fecha = fd;
    }
    const skip = (filtros.page - 1) * filtros.limit;
    const [data, total] = await Promise.all([
      GastoModel.find(query).populate('usuario', 'nombre').sort({ fecha: -1 }).skip(skip).limit(filtros.limit).lean(),
      GastoModel.countDocuments(query),
    ]);
    ResponseHelper.paginated(res, data, buildPagination(total, filtros.page, filtros.limit));
  } catch (error) { next(error); }
});

// ─── Crear con fotos opcionales ───────────────────────────────
router.post('/', upload.array('fotos', 5), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const dto = CrearGastoDto.parse({
      ...req.body,
      monto: Number(req.body.monto),
    });

    // Subir fotos a Cloudinary si hay archivos
    const fotosUrls: string[] = [];
    const files = (req.files as Express.Multer.File[]) ?? [];

    for (const file of files) {
      const url = await new Promise<string>((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: `${env.CLOUDINARY_FOLDER}/gastos`, resource_type: 'image',
            transformation: [{ width: 1200, quality: 'auto', fetch_format: 'webp' }] },
          (err, result) => { if (err) reject(err); else resolve(result!.secure_url); }
        );
        stream.end(file.buffer);
      });
      fotosUrls.push(url);
    }

    const gasto = await GastoModel.create({
      ...dto,
      fecha: dto.fecha ? new Date(dto.fecha + 'T12:00:00') : new Date(),
      usuario: req.user!.sub,
      fotos: fotosUrls,
    });

    ResponseHelper.created(res, gasto, 'Gasto registrado exitosamente');
  } catch (error) { next(error); }
});

// ─── Eliminar (solo el que lo creó o admin) ──────────────────
router.delete('/:id', auditorOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const gasto = await GastoModel.findById(req.params['id']);
    if (!gasto) throw new NotFoundError('Gasto');
    if (gasto.usuario.toString() !== req.user!.sub && req.user!.rol !== 'admin') {
      throw new ForbiddenError('Solo puedes eliminar tus propios gastos');
    }
    await GastoModel.findByIdAndUpdate(req.params['id'], { deletedAt: new Date() });
    ResponseHelper.success(res, null, 'Gasto eliminado exitosamente');
  } catch (error) { next(error); }
});

export default router;

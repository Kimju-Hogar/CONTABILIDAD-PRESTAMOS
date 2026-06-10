import { Request, Response, NextFunction } from 'express';
import { prestamosService } from './prestamos.service';
import {
  CrearPrestamoDto, FiltrosPrestamoDto,
  RefinanciarPrestamoDto, CancelarPrestamoDto,
  EditarPrestamoDto
} from './prestamos.dto';
import { ResponseHelper } from '../../shared/utils/responses';

export class PrestamosController {
  async listar(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const filtros = FiltrosPrestamoDto.parse(req.query);
      const result = await prestamosService.listar(filtros);
      ResponseHelper.paginated(res, result.data, result.pagination);
    } catch (error) { next(error); }
  }

  async obtener(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const prestamo = await prestamosService.obtener(req.params['id']!);
      ResponseHelper.success(res, prestamo);
    } catch (error) { next(error); }
  }

  async crear(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const dto = CrearPrestamoDto.parse(req.body);
      const prestamo = await prestamosService.crear(dto, req.user!.sub);
      ResponseHelper.created(res, prestamo, 'Préstamo creado exitosamente');
    } catch (error) { next(error); }
  }

  async cancelar(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { motivo } = CancelarPrestamoDto.parse(req.body);
      const prestamo = await prestamosService.cancelar(req.params['id']!, { motivo }, req.user!.sub);
      ResponseHelper.success(res, prestamo, 'Préstamo cancelado exitosamente');
    } catch (error) { next(error); }
  }

  async refinanciar(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const dto = RefinanciarPrestamoDto.parse(req.body);
      const prestamo = await prestamosService.refinanciar(req.params['id']!, dto, req.user!.sub);
      ResponseHelper.created(res, prestamo, 'Préstamo refinanciado exitosamente');
    } catch (error) { next(error); }
  }

  async editar(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const dto = EditarPrestamoDto.parse(req.body);
      const prestamo = await prestamosService.editar(req.params['id']!, dto, req.user!.sub);
      ResponseHelper.success(res, prestamo, 'Préstamo editado exitosamente');
    } catch (error) { next(error); }
  }

  async eliminar(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      await prestamosService.eliminar(req.params['id']!, req.user!.sub);
      ResponseHelper.success(res, null, 'Préstamo eliminado exitosamente');
    } catch (error) { next(error); }
  }
}

export const prestamosController = new PrestamosController();

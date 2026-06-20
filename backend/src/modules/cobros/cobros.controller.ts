import { Request, Response, NextFunction } from 'express';
import { cobrosService } from './cobros.service';
import { RegistrarCobroDto, AnularCobroDto, FiltrosCobroDto } from './cobros.dto';
import { ResponseHelper } from '../../shared/utils/responses';

export class CobrosController {
  async listar(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const filtros = FiltrosCobroDto.parse(req.query);
      const result = await cobrosService.listar(filtros);
      ResponseHelper.paginated(res, result.data, result.pagination);
    } catch (error) { next(error); }
  }

  async registrar(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const dto = RegistrarCobroDto.parse(req.body);
      const cobro = await cobrosService.registrar(dto, req.user!.sub);
      ResponseHelper.created(res, cobro, 'Cobro registrado exitosamente');
    } catch (error) { next(error); }
  }

  async anular(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const dto = AnularCobroDto.parse(req.body);
      const cobro = await cobrosService.anular(req.params['id']!, dto, req.user!.sub, req.user!.rol);
      ResponseHelper.success(res, cobro, 'Cobro anulado exitosamente');
    } catch (error) { next(error); }
  }

  async resumenDia(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // Cobrador solo ve sus cobros; admin ve todos
      const cobradorId = req.user!.rol === 'admin' ? undefined : req.user!.sub;
      const resumen = await cobrosService.resumenDia(cobradorId);
      ResponseHelper.success(res, resumen);
    } catch (error) { next(error); }
  }

  async cobrosPrestamo(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const filtros = FiltrosCobroDto.parse({ prestamoId: req.params['prestamoId'], ...req.query });
      const result = await cobrosService.listar(filtros);
      ResponseHelper.paginated(res, result.data, result.pagination);
    } catch (error) { next(error); }
  }

  async eliminar(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      await cobrosService.eliminar(req.params['id']!, req.user!.rol);
      ResponseHelper.success(res, null, 'Cobro eliminado exitosamente');
    } catch (error) { next(error); }
  }
}

export const cobrosController = new CobrosController();

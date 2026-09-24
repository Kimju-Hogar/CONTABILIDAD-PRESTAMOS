import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env';
import { UnauthorizedError, ForbiddenError } from './error.middleware';
import { UsuarioModel } from '../../models/Usuario.model';

export const ROLES = ['auditor', 'admin', 'cobrador'] as const;
export type Rol = typeof ROLES[number];

export interface JwtPayload {
  sub: string;       // userId
  email: string;
  rol: Rol;
  sessionId: string;
  iat: number;
  exp: number;
}

// Extender Request para tener el usuario autenticado
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

// ─── Middleware de autenticación JWT ─────────────────────────
export async function authMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedError('Token de acceso requerido');
    }

    const token = authHeader.split(' ')[1];

    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as JwtPayload;

    // Verificar que el usuario siga activo y la sesión no fue revocada
    const usuario = await UsuarioModel.findById(payload.sub)
      .select('activo sesiones')
      .lean();

    if (!usuario || !usuario.activo) {
      throw new UnauthorizedError('Usuario inactivo o no encontrado');
    }

    const sesionValida = usuario.sesiones?.some(
      (s) => s.sessionId === payload.sessionId && s.activa
    );

    if (!sesionValida) {
      throw new UnauthorizedError('Sesión revocada — por favor inicia sesión nuevamente');
    }

    req.user = payload;
    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      next(new UnauthorizedError('Token expirado'));
    } else if (error instanceof jwt.JsonWebTokenError) {
      next(new UnauthorizedError('Token inválido'));
    } else {
      next(error);
    }
  }
}

// ─── Middleware de autorización por rol ──────────────────────
export function requireRole(...roles: Rol[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new UnauthorizedError());
    }

    // El auditor está por encima de todo: pasa cualquier control de rol
    if (req.user.rol === 'auditor') return next();

    if (!roles.includes(req.user.rol)) {
      return next(new ForbiddenError('No tienes permisos para esta acción'));
    }

    next();
  };
}

// ─── Solo Admin (el auditor también pasa) ────────────────────
export const adminOnly = requireRole('admin');

// ─── Solo Auditor — para lo que destruye datos ───────────────
export function auditorOnly(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) return next(new UnauthorizedError());
  if (req.user.rol !== 'auditor') {
    return next(new ForbiddenError('Solo el auditor puede eliminar registros'));
  }
  next();
}

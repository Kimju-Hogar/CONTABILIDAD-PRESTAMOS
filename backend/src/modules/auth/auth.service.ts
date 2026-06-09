import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { addDays, addMinutes, addHours } from 'date-fns';
import { env } from '../../config/env';
import { UsuarioModel, IUsuario } from '../../models/Usuario.model';
import { AuditLogModel } from '../../models/AuditLog.model';
import {
  UnauthorizedError,
  NotFoundError,
  AppError,
} from '../../shared/middleware/error.middleware';
import type { JwtPayload } from '../../shared/middleware/auth.middleware';
import type {
  LoginDto,
  RefreshTokenDto,
} from './auth.dto';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface LoginResult {
  usuario: Partial<IUsuario>;
  tokens: TokenPair;
}

export class AuthService {
  // ─── Login ─────────────────────────────────────────────────
  async login(dto: LoginDto, ip: string): Promise<LoginResult> {
    // Buscar usuario incluyendo password (está en select:false)
    const usuario = await UsuarioModel.findOne({ email: dto.email })
      .select('+password')
      .lean();

    if (!usuario || !usuario.activo) {
      // Usar el mismo mensaje para no revelar si el email existe
      throw new UnauthorizedError('Credenciales inválidas');
    }

    const passwordValida = await bcrypt.compare(dto.password, usuario.password);
    if (!passwordValida) {
      // Log de intento fallido
      await AuditLogModel.create({
        accion: 'LOGIN_FAILED',
        recurso: 'Auth',
        recursoId: usuario._id.toString(),
        ip,
        userAgent: dto.deviceInfo,
        timestamp: new Date(),
      });
      throw new UnauthorizedError('Credenciales inválidas');
    }

    // Generar sessionId único
    const sessionId = crypto.randomUUID();

    // Generar tokens
    const tokens = this.generateTokens(usuario._id.toString(), usuario.email, usuario.rol, sessionId);

    // Parsear expiración del refresh token desde la variable de entorno
    const expiraEn = this.parseExpiry(env.JWT_REFRESH_EXPIRES);

    // Guardar sesión en el usuario (máximo 5 sesiones activas)
    await UsuarioModel.findByIdAndUpdate(usuario._id, {
      $push: {
        sesiones: {
          $each: [{
            sessionId,
            deviceInfo: dto.deviceInfo,
            ip,
            creadoEn: new Date(),
            expiraEn,
            activa: true,
          }],
          $slice: -5, // Mantener solo las últimas 5 sesiones
        },
      },
      ultimoAcceso: new Date(),
    });

    // Auditoría de login exitoso
    await AuditLogModel.create({
      usuario: usuario._id,
      accion: 'LOGIN',
      recurso: 'Auth',
      ip,
      userAgent: dto.deviceInfo,
      timestamp: new Date(),
    });

    const { password: _p, sesiones: _s, ...usuarioPublico } = usuario;

    return {
      usuario: usuarioPublico as Record<string, unknown>,
      tokens,
    };
  }

  // ─── Refresh Token ──────────────────────────────────────────
  async refresh(dto: RefreshTokenDto): Promise<TokenPair> {
    let payload: JwtPayload;

    try {
      payload = jwt.verify(dto.refreshToken, env.JWT_REFRESH_SECRET) as JwtPayload;
    } catch {
      throw new UnauthorizedError('Refresh token inválido o expirado');
    }

    const usuario = await UsuarioModel.findById(payload.sub).select('activo sesiones rol email');

    if (!usuario || !usuario.activo) {
      throw new UnauthorizedError('Usuario inactivo');
    }

    // Verificar que la sesión sigue activa
    const sesion = usuario.sesiones.find(
      (s) => s.sessionId === payload.sessionId && s.activa
    );

    if (!sesion) {
      throw new UnauthorizedError('Sesión revocada');
    }

    // Generar nuevo par de tokens (token rotation)
    const nuevoSessionId = crypto.randomUUID();
    const tokens = this.generateTokens(usuario.id, usuario.email, usuario.rol, nuevoSessionId);

    // Revocar sesión anterior y crear nueva
    await UsuarioModel.findByIdAndUpdate(usuario._id, {
      $set: { 'sesiones.$[old].activa': false },
      $push: {
        sesiones: {
          sessionId: nuevoSessionId,
          deviceInfo: sesion.deviceInfo,
          ip: sesion.ip,
          creadoEn: new Date(),
          expiraEn: this.parseExpiry(env.JWT_REFRESH_EXPIRES),
          activa: true,
        },
      },
    }, {
      arrayFilters: [{ 'old.sessionId': payload.sessionId }],
    });

    return tokens;
  }

  // ─── Logout ─────────────────────────────────────────────────
  async logout(userId: string, sessionId: string, ip: string): Promise<void> {
    await UsuarioModel.findByIdAndUpdate(userId, {
      $set: { 'sesiones.$[session].activa': false },
    }, {
      arrayFilters: [{ 'session.sessionId': sessionId }],
    });

    await AuditLogModel.create({
      usuario: userId,
      accion: 'LOGOUT',
      recurso: 'Auth',
      ip,
      timestamp: new Date(),
    });
  }

  // ─── Logout de todas las sesiones ───────────────────────────
  async logoutAll(userId: string, ip: string): Promise<void> {
    await UsuarioModel.findByIdAndUpdate(userId, {
      $set: { 'sesiones.$[].activa': false },
    });

    await AuditLogModel.create({
      usuario: userId,
      accion: 'LOGOUT_ALL',
      recurso: 'Auth',
      ip,
      timestamp: new Date(),
    });
  }

  // ─── Cambiar contraseña ─────────────────────────────────────
  async cambiarPassword(userId: string, passwordActual: string, passwordNueva: string): Promise<void> {
    const usuario = await UsuarioModel.findById(userId).select('+password');
    if (!usuario) throw new NotFoundError('Usuario');

    const valida = await bcrypt.compare(passwordActual, usuario.password);
    if (!valida) throw new AppError('La contraseña actual es incorrecta', 400);

    const hash = await bcrypt.hash(passwordNueva, env.BCRYPT_ROUNDS);
    await UsuarioModel.findByIdAndUpdate(userId, {
      password: hash,
      $set: { 'sesiones.$[].activa': false }, // Revocar todas las sesiones
    });
  }

  // ─── Generar tokens JWT ─────────────────────────────────────
  private generateTokens(
    userId: string,
    email: string,
    rol: 'admin' | 'cobrador',
    sessionId: string
  ): TokenPair {
    const payload = { email, rol, sessionId };

    const accessToken = jwt.sign(payload, env.JWT_ACCESS_SECRET, {
      subject: userId,
      expiresIn: env.JWT_ACCESS_EXPIRES as jwt.SignOptions['expiresIn'],
    });

    const refreshToken = jwt.sign(payload, env.JWT_REFRESH_SECRET, {
      subject: userId,
      expiresIn: env.JWT_REFRESH_EXPIRES as jwt.SignOptions['expiresIn'],
    });

    return { accessToken, refreshToken };
  }
  // ─── Calcular fecha de expiración desde string tipo '7d', '15m', '2h' ─
  private parseExpiry(expiry: string): Date {
    const now = new Date();
    const match = /^(\d+)([smhd])$/.exec(expiry);
    if (!match) return addDays(now, 90); // fallback seguro
    const value = parseInt(match[1], 10);
    const unit = match[2];
    switch (unit) {
      case 'm': return addMinutes(now, value);
      case 'h': return addHours(now, value);
      case 'd': return addDays(now, value);
      default:  return addDays(now, 90);
    }
  }
}

export const authService = new AuthService();

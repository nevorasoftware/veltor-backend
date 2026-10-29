import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { randomBytes } from 'crypto';
import { Logger } from '@nestjs/common';

function resolveJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret && secret.length >= 32) return secret;
  // Nunca usar un secreto fijo conocido: sin JWT_SECRET válido se genera uno aleatorio por proceso
  // (las sesiones se invalidan al reiniciar, pero nadie puede falsificar tokens).
  new Logger('AuthModule').warn(
    'JWT_SECRET no definido o con menos de 32 caracteres. Se usará un secreto aleatorio temporal; configúralo en las variables de entorno.',
  );
  return randomBytes(48).toString('hex');
}

@Module({
  imports: [
    JwtModule.register({
      secret: resolveJwtSecret(),
      signOptions: { expiresIn: (process.env.JWT_EXPIRES_IN || '1d') as any },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtAuthGuard,
    RolesGuard,
    // Orden: primero se autentica (JWT) y luego se autoriza (roles)
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [AuthService, JwtAuthGuard, RolesGuard, JwtModule],
})
export class AuthModule {}

import { Controller, Post, Get, Body, Request, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { AuthService } from './auth.service';
import { Public } from './public.decorator';
import { Throttle } from '@nestjs/throttler';
import { Roles } from './roles.decorator';
import { SkipTenant } from '../tenant/skip-tenant.decorator';
import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail({}, { message: 'Debe ingresar un correo electrónico válido' })
  email!: string;

  @IsString()
  @IsNotEmpty({ message: 'La contraseña es requerida' })
  password!: string;
}

export class ForgotPasswordDto {
  @IsEmail({}, { message: 'Debe ingresar un correo electrónico válido' })
  email!: string;
}

export class ResetPasswordDto {
  @IsString()
  @IsNotEmpty({ message: 'El enlace de recuperación no es válido' })
  token!: string;

  @IsString()
  @MinLength(10, { message: 'La nueva contraseña debe tener al menos 10 caracteres' })
  newPassword!: string;
}

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty({ message: 'La contraseña actual es requerida' })
  currentPassword!: string;

  @IsString()
  @MinLength(10, { message: 'La nueva contraseña debe tener al menos 10 caracteres' })
  newPassword!: string;
}

const ALL_ROLES = Object.values(UserRole);

@ApiTags('Autenticación y Sesiones')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @SkipTenant()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Iniciar sesión (Panel Administrativo y Portal Cliente)' })
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto.email, dto.password);
  }

  @Public()
  @SkipTenant()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Solicitar un enlace para restablecer la contraseña (siempre responde 200)' })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.email);
  }

  @Public()
  @SkipTenant()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Restablecer la contraseña con el token recibido por correo' })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.token, dto.newPassword);
  }

  @Get('me')
  @Roles(...ALL_ROLES)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Consultar datos del usuario autenticado' })
  async getProfile(@Request() req: any) {
    return this.authService.getProfile(req.user.id);
  }

  @Post('change-password')
  @Roles(...ALL_ROLES)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cambiar la contraseña del usuario autenticado' })
  async changePassword(@Body() dto: ChangePasswordDto, @Request() req: any) {
    return this.authService.changePassword(req.user.id, dto.currentPassword, dto.newPassword);
  }
}

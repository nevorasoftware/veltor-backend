import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Request, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { UserRole } from '@prisma/client';
import { Public } from '../auth/public.decorator';
import { Roles } from '../auth/roles.decorator';
import { SkipTenant } from '../tenant/skip-tenant.decorator';
import { MAX_DOCUMENT_BYTES } from '../documents/documents.constants';
import { BulkInviteDto, CompleteRegistrationDto, REGISTRATION_FILES, RegistrationFiles, SendInviteDto } from './onboarding.dto';
import { OnboardingService } from './onboarding.service';

@ApiTags('Registro de clientes')
@ApiBearerAuth()
@Roles(UserRole.ADMIN)
@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get('customers')
  @ApiOperation({ summary: 'Clientes con su situación de registro (acceso al portal, datos faltantes y última invitación)' })
  candidates() {
    return this.onboarding.candidates();
  }

  @Post('customers/:id/invite')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Generar un enlace de registro y (por defecto) enviarlo por WhatsApp' })
  invite(@Param('id') id: string, @Body() dto: SendInviteDto, @Request() req: any) {
    return this.onboarding.invite(id, { send: dto.send !== false, createdById: req.user?.id });
  }

  @Post('invites/bulk')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Enviar la invitación a todos los clientes sin acceso con teléfono válido (dryRun para simular)' })
  bulk(@Body() dto: BulkInviteDto, @Request() req: any) {
    return this.onboarding.inviteAll({ dryRun: dto.dryRun, resend: !!dto.resend, createdById: req.user?.id });
  }
}

@ApiTags('Público: Registro de clientes')
@Controller('public/registro')
export class PublicRegistrationController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Public()
  @SkipTenant()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get(':token')
  @ApiOperation({ summary: 'Datos del enlace de registro (empresa y cliente) para mostrar el formulario' })
  info(@Param('token') token: string) {
    return this.onboarding.publicInfo(token);
  }

  @Public()
  @SkipTenant()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(':token')
  @HttpCode(HttpStatus.OK)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileFieldsInterceptor(REGISTRATION_FILES.map((f) => ({ name: f.field, maxCount: 1 })), {
      limits: { fileSize: MAX_DOCUMENT_BYTES, files: REGISTRATION_FILES.length },
    }),
  )
  @ApiOperation({ summary: 'Completar los datos del cliente (con fotos del DUI y la licencia) y crear su acceso al portal' })
  complete(@Param('token') token: string, @Body() dto: CompleteRegistrationDto, @UploadedFiles() files?: RegistrationFiles) {
    return this.onboarding.complete(token, dto, files ?? {});
  }
}

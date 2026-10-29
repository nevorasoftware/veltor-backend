import { BadRequestException, Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { IsEmail, IsOptional } from 'class-validator';
import { Roles } from '../auth/roles.decorator';
import { NotificationsService } from './notifications.service';

export class SendEmailDto {
  @IsEmail()
  @IsOptional()
  to?: string;
}

export class TestEmailDto {
  @IsEmail()
  to!: string;
}

@ApiTags('Notificaciones por Correo')
@ApiBearerAuth()
@Controller()
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  private ensureConfigured() {
    if (!this.notifications.isConfigured()) {
      throw new BadRequestException('El envío de correos no está configurado (variables GMAIL_* del servidor).');
    }
  }

  private ensureSent(result: { status: string; error?: string }) {
    if (result.status === 'FAILED') throw new BadRequestException(`No se pudo enviar el correo: ${result.error}`);
    return result;
  }

  @Get('notifications/status')
  @ApiOperation({ summary: 'Indica si el envío de correos está configurado' })
  status() {
    return { emailConfigured: this.notifications.isConfigured() };
  }

  @Post('finance/loans/:id/statement/email')
  @Roles(UserRole.ADMIN, UserRole.CASHIER, UserRole.COLLECTIONS_AGENT, UserRole.APPROVAL_OFFICER)
  @ApiOperation({ summary: 'Enviar por correo el estado de cuenta en PDF del crédito' })
  async emailStatement(@Param('id') id: string, @Body() dto: SendEmailDto) {
    this.ensureConfigured();
    return this.ensureSent(await this.notifications.sendAccountStatement(id, dto.to));
  }

  @Post('notifications/test')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Enviar un correo de prueba para validar la configuración de Gmail' })
  async test(@Body() dto: TestEmailDto) {
    this.ensureConfigured();
    return this.ensureSent(await this.notifications.sendTest(dto.to));
  }

  @Post('notifications/payment-reminders/run')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Ejecutar ahora los recordatorios de pago (normalmente corren a diario a las 8:00)' })
  async runReminders() {
    this.ensureConfigured();
    return this.notifications.sendPaymentReminders();
  }
}

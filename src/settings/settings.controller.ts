import { Controller, Get, Patch, Body, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { LateFeeTypeValue, SettingsService } from './settings.service';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, Min, Max, ValidateIf } from 'class-validator';
import { Public } from '../auth/public.decorator';
import { Roles } from '../auth/roles.decorator';

export class UpdatePreferentialRateDto {
  @IsNumber()
  @Min(0.001, { message: 'La tasa mensual mínima es 0.1% (0.001)' })
  @Max(0.10, { message: 'La tasa mensual máxima permitida es 10% (0.10)' })
  monthlyRate!: number;
}

export class UpdateNotificationEmailsDto {
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  staffEmails!: string[];
}

export class UpdateCollectionSettingsDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(30)
  reminderDaysBefore?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(30)
  graceDays?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(30)
  overdueReminderEveryDays?: number;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(28, { message: 'El día de pago debe estar entre 1 y 28 para existir en todos los meses.' })
  defaultPaymentDay?: number | null;

  @IsOptional()
  @IsIn(['NONE', 'PER_DAY', 'PER_INSTALLMENT'])
  defaultLateFeeType?: LateFeeTypeValue;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10000)
  lateFeePerDayAmount?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10000)
  lateFeePerInstallmentAmount?: number;
}

@ApiTags('Configuración del Sistema y Parámetros')
@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Public()
  @Get('public')
  @ApiOperation({ summary: 'Obtener configuración pública del sistema (tasa preferencial, plazos, prima)' })
  async getPublicSettings() {
    return this.settingsService.getPublicSettings();
  }

  @Patch('preferential-rate')
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Actualizar tasa preferencial del simulador (Administración)' })
  async updatePreferentialRate(@Body() body: UpdatePreferentialRateDto, @Request() req: any) {
    return this.settingsService.updatePreferentialRate(body.monthlyRate, req.user.id);
  }

  @Get('notifications')
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Correos del personal que reciben avisos (Administración)' })
  async getNotificationSettings() {
    return this.settingsService.getNotificationSettings();
  }

  @Get('collections')
  @Roles(UserRole.ADMIN, UserRole.CASHIER, UserRole.COLLECTIONS_AGENT, UserRole.APPROVAL_OFFICER, UserRole.COMMERCIAL_AGENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Parámetros de cobranza: recordatorios, días de gracia, día de pago y mora' })
  async getCollectionSettings() {
    return this.settingsService.getCollectionSettings();
  }

  @Patch('collections')
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Actualizar parámetros de cobranza y mora (Administración)' })
  async updateCollectionSettings(@Body() body: UpdateCollectionSettingsDto, @Request() req: any) {
    return this.settingsService.updateCollectionSettings(body, req.user.id);
  }

  @Patch('notifications')
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Actualizar los correos del personal que reciben avisos (Administración)' })
  async updateNotificationSettings(@Body() body: UpdateNotificationEmailsDto, @Request() req: any) {
    return this.settingsService.updateStaffNotificationEmails(body.staffEmails, req.user.id);
  }
}

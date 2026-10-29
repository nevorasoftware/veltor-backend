import { Controller, Get, Patch, Body, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { SettingsService } from './settings.service';
import { IsNumber, Min, Max } from 'class-validator';
import { Public } from '../auth/public.decorator';
import { Roles } from '../auth/roles.decorator';

export class UpdatePreferentialRateDto {
  @IsNumber()
  @Min(0.001, { message: 'La tasa mensual mínima es 0.1% (0.001)' })
  @Max(0.10, { message: 'La tasa mensual máxima permitida es 10% (0.10)' })
  monthlyRate!: number;
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
}

import { Controller, Get, Patch, Body, Request, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { SettingsService } from './settings.service';
import { IsNumber, Min, Max } from 'class-validator';

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

  @Get('public')
  @ApiOperation({ summary: 'Obtener configuración pública del sistema (tasa preferencial, plazos, prima)' })
  async getPublicSettings() {
    return this.settingsService.getPublicSettings();
  }

  @Patch('preferential-rate')
  @ApiOperation({ summary: 'Actualizar tasa preferencial del simulador (Administración)' })
  async updatePreferentialRate(@Body() body: UpdatePreferentialRateDto, @Request() req: any) {
    try {
      const userId = req.user?.id || 'system-admin';
      return await this.settingsService.updatePreferentialRate(body.monthlyRate, userId);
    } catch (err: any) {
      throw new BadRequestException(err.message || 'Error al actualizar la tasa');
    }
  }
}

import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { PartialType } from '@nestjs/swagger';
import { VehicleFuel, VehicleStatus, VehicleTransmission } from '@prisma/client';

export class VehicleImageDto {
  @IsString()
  @IsNotEmpty()
  url!: string;

  @IsString()
  @IsOptional()
  caption?: string;
}

/**
 * brand, model, year, type, mileageKm y color son obligatorios salvo con initialLoad=true (carga parcial de
 * créditos en curso): ahí pueden faltar y quedan en null ("Por definir"); el servicio valida la regla.
 */
export class CreateVehicleDto {
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  brand?: string;

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  model?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1950)
  @Max(2100)
  @IsOptional()
  year?: number;

  @IsString()
  @IsOptional()
  version?: string;

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  type?: string;

  @IsEnum(VehicleTransmission)
  @IsOptional()
  transmission?: VehicleTransmission;

  @IsEnum(VehicleFuel)
  @IsOptional()
  fuel?: VehicleFuel;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  engineCc?: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  mileageKm?: number;

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  color?: string;

  /** Carga parcial: permite datos faltantes (quedan en null) y por defecto no publica el vehículo en el catálogo */
  @IsBoolean()
  @IsOptional()
  initialLoad?: boolean;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60)
  @IsOptional()
  passengers?: number;

  @IsString()
  @IsOptional()
  description?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  features?: string[];

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  salePrice!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  minDownPayment?: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  costPrice?: number;

  @IsEnum(VehicleStatus)
  @IsOptional()
  status?: VehicleStatus;

  @IsBoolean()
  @IsOptional()
  isPublished?: boolean;

  /** Imágenes como URL pública o data URL (base64) comprimida desde el navegador. */
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => VehicleImageDto)
  @IsOptional()
  images?: VehicleImageDto[];
}

export class UpdateVehicleDto extends PartialType(CreateVehicleDto) {}

export class ChangeVehicleStatusDto {
  @IsEnum(VehicleStatus)
  status!: VehicleStatus;

  @IsString()
  @IsOptional()
  reason?: string;
}

export class VehicleFilterDto {
  @IsString()
  @IsOptional()
  brand?: string;

  @IsString()
  @IsOptional()
  model?: string;

  @Type(() => Number)
  @IsInt()
  @IsOptional()
  year?: number;

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  minPrice?: number;

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  maxPrice?: number;

  @IsEnum(VehicleTransmission)
  @IsOptional()
  transmission?: VehicleTransmission;

  @IsEnum(VehicleFuel)
  @IsOptional()
  fuel?: VehicleFuel;

  @IsString()
  @IsOptional()
  type?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number;
}

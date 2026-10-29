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

export class CreateVehicleDto {
  @IsString()
  @IsNotEmpty()
  brand!: string;

  @IsString()
  @IsNotEmpty()
  model!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1950)
  @Max(2100)
  year!: number;

  @IsString()
  @IsOptional()
  version?: string;

  @IsString()
  @IsNotEmpty()
  type!: string;

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
  mileageKm!: number;

  @IsString()
  @IsNotEmpty()
  color!: string;

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

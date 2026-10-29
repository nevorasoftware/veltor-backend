import { Type } from 'class-transformer';
import { IsEmail, IsEnum, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Matches, Min } from 'class-validator';
import { PartialType } from '@nestjs/swagger';
import { CustomerStatus, PersonType } from '@prisma/client';

export class CreateCustomerDto {
  @IsString()
  @IsNotEmpty()
  fullName!: string;

  @IsEnum(PersonType)
  @IsOptional()
  personType?: PersonType;

  @Matches(/^\d{8}-\d$/, { message: 'El DUI debe tener el formato 00000000-0' })
  dui!: string;

  @Matches(/^(\d{8}-\d|\d{4}-\d{6}-\d{3}-\d)$/, { message: 'El NIT debe tener el formato 00000000-0 o 0000-000000-000-0' })
  @IsOptional()
  nit?: string;

  @IsString()
  @IsOptional()
  birthDate?: string;

  @IsString()
  @IsNotEmpty()
  phone!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  address!: string;

  @IsString()
  @IsOptional()
  municipality?: string;

  @IsString()
  @IsOptional()
  department?: string;

  @IsString()
  @IsNotEmpty()
  economicActivity!: string;

  @IsString()
  @IsOptional()
  employerName?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  monthlyIncome!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  declaredDebts?: number;

  @IsString()
  @IsOptional()
  internalNotes?: string;
}

export class UpdateCustomerDto extends PartialType(CreateCustomerDto) {
  @IsEnum(CustomerStatus)
  @IsOptional()
  status?: CustomerStatus;
}

export class CustomerQueryDto {
  @IsString()
  @IsOptional()
  search?: string;

  @IsEnum(CustomerStatus)
  @IsOptional()
  status?: CustomerStatus;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  limit?: number;
}

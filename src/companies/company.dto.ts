import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsInt,
  IsNumber,
  Max,
  Min,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  Validate,
  ValidateIf,
  ValidateNested,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const HOST_RE = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

export const LOGO_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'] as const;
export const MAX_LOGO_BYTES = 1024 * 1024;

/** Cadena vacía → null (para poder borrar un campo opcional desde el formulario) */
const emptyToNull = () => Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? null : value));
const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));
const optionalNullable = () => ValidateIf((_, v) => v !== undefined && v !== null);

@ValidatorConstraint({ name: 'timezone' })
class IsTimeZone implements ValidatorConstraintInterface {
  validate(value: unknown) {
    if (typeof value !== 'string' || !value) return false;
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }
  defaultMessage() {
    return 'La zona horaria no es válida (ej. America/El_Salvador).';
  }
}

export class BankAccountDto {
  @IsString()
  @IsNotEmpty({ message: 'Indique el banco' })
  @MaxLength(100)
  bank!: string;

  @IsString()
  @IsNotEmpty({ message: 'Indique el número o detalle de la cuenta' })
  @MaxLength(200)
  detail!: string;
}

/** Marca y contactos que el ADMIN de la empresa puede editar (GET/PATCH /company). */
export class CompanyBrandingDto {
  @ApiPropertyOptional()
  @IsOptional()
  @trim()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ nullable: true })
  @emptyToNull()
  @optionalNullable()
  @IsString()
  @MaxLength(200)
  legalName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @emptyToNull()
  @optionalNullable()
  @IsString()
  @MaxLength(200)
  tagline?: string | null;

  @ApiPropertyOptional({ example: '#0f172a' })
  @IsOptional()
  @Matches(HEX_RE, { message: 'primaryColor debe tener el formato #RRGGBB' })
  primaryColor?: string;

  @ApiPropertyOptional({ example: '#1e293b' })
  @IsOptional()
  @Matches(HEX_RE, { message: 'secondaryColor debe tener el formato #RRGGBB' })
  secondaryColor?: string;

  @ApiPropertyOptional({ example: '#38bdf8' })
  @IsOptional()
  @Matches(HEX_RE, { message: 'accentColor debe tener el formato #RRGGBB' })
  accentColor?: string;

  @ApiPropertyOptional({ nullable: true })
  @emptyToNull()
  @optionalNullable()
  @IsString()
  @MaxLength(40)
  contactPhone?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @emptyToNull()
  @optionalNullable()
  @IsEmail({}, { message: 'contactEmail debe ser un correo válido' })
  contactEmail?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @emptyToNull()
  @optionalNullable()
  @IsString()
  @MaxLength(200)
  contactHours?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @emptyToNull()
  @optionalNullable()
  @IsEmail({}, { message: 'paymentsEmail debe ser un correo válido' })
  paymentsEmail?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @emptyToNull()
  @optionalNullable()
  @IsString()
  @MaxLength(40)
  paymentsWhatsapp?: string | null;

  @ApiPropertyOptional({ type: [BankAccountDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => BankAccountDto)
  bankAccounts?: BankAccountDto[];

  @ApiPropertyOptional({ nullable: true })
  @emptyToNull()
  @optionalNullable()
  @IsString()
  @MaxLength(200)
  bankAccountHolder?: string | null;

  @ApiPropertyOptional({ example: 'es-SV' })
  @IsOptional()
  @Matches(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, { message: 'locale no es válido (ej. es-SV)' })
  locale?: string;

  @ApiPropertyOptional({ example: 'USD' })
  @IsOptional()
  @Matches(/^[A-Z]{3}$/, { message: 'currency debe ser un código ISO 4217 (ej. USD)' })
  currency?: string;

  @ApiPropertyOptional({ example: 'America/El_Salvador' })
  @IsOptional()
  @Validate(IsTimeZone)
  timezone?: string;
}

/** Campos que solo el superadministrador puede cambiar. */
export class PlatformCompanyFieldsDto extends CompanyBrandingDto {
  @ApiPropertyOptional({ example: 'mi-empresa' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @Matches(SLUG_RE, { message: 'El slug debe tener 3-40 caracteres: minúsculas, números y guiones (sin guion al inicio o al final).' })
  slug?: string;

  @ApiPropertyOptional({ type: [String], example: ['www.miempresa.com'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @Transform(({ value }) => (Array.isArray(value) ? value.map((d) => (typeof d === 'string' ? d.trim().toLowerCase() : d)) : value))
  @Matches(HOST_RE, { each: true, message: 'Cada dominio debe ser un hostname válido (sin https:// ni rutas).' })
  domains?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

/** Producto financiero inicial de la empresa: valores capturados por el superadmin (sin valores por defecto) */
export class CompanyProductDto {
  @ApiProperty({ example: 'Crédito Vehicular Estándar' })
  @trim()
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: 0.012, description: 'Tasa mensual mínima en decimal (0.012 = 1.2 %)' })
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.0001)
  @Max(0.5)
  minMonthlyRate!: number;

  @ApiProperty({ example: 0.022 })
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.0001)
  @Max(0.5)
  maxMonthlyRate!: number;

  @ApiProperty({ example: 0.015 })
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.0001)
  @Max(0.5)
  defaultMonthlyRate!: number;

  @ApiProperty({ example: 12 })
  @IsInt()
  @Min(1)
  @Max(600)
  minTermMonths!: number;

  @ApiProperty({ example: 72 })
  @IsInt()
  @Min(1)
  @Max(600)
  maxTermMonths!: number;

  @ApiProperty({ example: 15, description: 'Prima mínima en porcentaje' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  minDownPercent!: number;

  @ApiProperty({ example: 5 })
  @IsInt()
  @Min(0)
  @Max(60)
  graceDays!: number;

  @ApiPropertyOptional({ nullable: true, example: 0.03, description: 'Interés moratorio mensual heredado (opcional)' })
  @optionalNullable()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(1)
  lateRateMonthly?: number | null;
}

export class DeleteCompanyDto {
  @ApiProperty({ description: 'Debe ser igual al slug de la empresa (confirmación)' })
  @IsString()
  @IsNotEmpty()
  confirmSlug!: string;
}

export class CreateCompanyDto extends OmitType(PlatformCompanyFieldsDto, ['name', 'slug'] as const) {
  @ApiProperty()
  @trim()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: 'mi-empresa' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @Matches(SLUG_RE, { message: 'El slug debe tener 3-40 caracteres: minúsculas, números y guiones (sin guion al inicio o al final).' })
  slug!: string;

  @ApiProperty({ type: CompanyProductDto, description: 'Producto financiero inicial' })
  @ValidateNested()
  @Type(() => CompanyProductDto)
  product!: CompanyProductDto;

  @ApiProperty({ description: 'Correo del primer administrador de la empresa' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: 'adminEmail debe ser un correo válido' })
  adminEmail!: string;

  @ApiProperty({ description: 'Nombre completo del primer administrador' })
  @trim()
  @IsString()
  @MinLength(3)
  @MaxLength(150)
  adminName!: string;
}

export class UpdatePlatformCompanyDto extends PartialType(PlatformCompanyFieldsDto) {}

/** El ADMIN de la empresa no puede cambiar slug, estado ni dominios. */
export class UpdateOwnCompanyDto extends CompanyBrandingDto {}

export class CompanyStatusDto {
  @ApiProperty()
  @IsBoolean()
  isActive!: boolean;
}

export class CompanyAdminDto {
  @ApiProperty()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: 'email debe ser un correo válido' })
  email!: string;

  @ApiProperty()
  @trim()
  @IsString()
  @MinLength(3)
  @MaxLength(150)
  fullName!: string;
}

export class LogoDto {
  @ApiProperty({ description: 'Contenido del logo en base64 (se acepta también un data URL)' })
  @IsString()
  @IsNotEmpty()
  base64!: string;

  @ApiProperty({ enum: LOGO_MIME_TYPES })
  @IsIn(LOGO_MIME_TYPES as unknown as string[], { message: 'El logo debe ser PNG, JPEG, WEBP o SVG.' })
  mime!: string;
}

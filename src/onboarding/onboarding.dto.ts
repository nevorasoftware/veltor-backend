import { Transform, Type } from 'class-transformer';
import { Equals, IsBoolean, IsDateString, IsEmail, IsNotEmpty, IsNumber, IsOptional, IsString, Matches, MaxLength, Min, MinLength } from 'class-validator';

const emptyToUndefined = ({ value }: { value: unknown }) => (typeof value === 'string' && value.trim() === '' ? undefined : value);

/** Datos que el cliente completa con el enlace de registro */
export class CompleteRegistrationDto {
  @Matches(/^\d{8}-\d$/, { message: 'El DUI debe tener el formato 00000000-0' })
  dui!: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @Matches(/^(\d{8}-\d|\d{4}-\d{6}-\d{3}-\d)$/, { message: 'El NIT debe tener el formato 00000000-0 o 0000-000000-000-0' })
  nit?: string;

  @IsEmail({}, { message: 'Ingrese un correo electrónico válido' })
  @MaxLength(120)
  email!: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsDateString({}, { message: 'La fecha de nacimiento no es válida' })
  birthDate?: string;

  @IsString()
  @IsNotEmpty({ message: 'La dirección es requerida' })
  @MaxLength(300)
  address!: string;

  @IsString()
  @IsNotEmpty({ message: 'El municipio es requerido' })
  @MaxLength(100)
  municipality!: string;

  @IsString()
  @IsNotEmpty({ message: 'El departamento es requerido' })
  @MaxLength(100)
  department!: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(150)
  economicActivity?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(150)
  employerName?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'El ingreso mensual debe ser un número' })
  @Min(0)
  monthlyIncome?: number;

  @IsString()
  @MinLength(10, { message: 'La contraseña debe tener al menos 10 caracteres' })
  @MaxLength(128)
  password!: string;

  // Llega como texto en multipart/form-data
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  @Equals(true, { message: 'Debe aceptar el aviso de privacidad para continuar.' })
  privacyAccepted!: boolean;
}

/** Fotos obligatorias del registro: campo multipart → categoría del expediente */
export const REGISTRATION_FILES = [
  { field: 'duiFront', category: 'DUI_FRONT', title: 'DUI (frente)' },
  { field: 'duiBack', category: 'DUI_BACK', title: 'DUI (reverso)' },
  { field: 'license', category: 'DRIVER_LICENSE', title: 'Licencia de conducir' },
] as const;
export type RegistrationFiles = Partial<Record<(typeof REGISTRATION_FILES)[number]['field'], Express.Multer.File[]>>;

export class SendInviteDto {
  /** false = solo generar el enlace para copiarlo (no envía WhatsApp) */
  @IsOptional()
  @IsBoolean()
  send?: boolean;
}

export class BulkInviteDto {
  /** true = solo simula (no crea enlaces ni envía) */
  @IsBoolean()
  dryRun!: boolean;

  /** Reenviar también a quien ya tiene una invitación vigente */
  @IsOptional()
  @IsBoolean()
  resend?: boolean;
}

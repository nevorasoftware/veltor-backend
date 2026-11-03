import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AmortizationMethod, Company, DayCountBasis, Prisma, UserRole } from '@prisma/client';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { MailService } from '../mail/mail.service';
import { staffAccessMail } from '../mail/templates';
import { GoogleDriveService } from '../storage/google-drive.service';
import { TenantContext } from '../tenant/tenant-context';
import { toCompanyInfo } from '../tenant/tenant-resolver.service';
import {
  CompanyBrandingDto,
  CreateCompanyDto,
  LOGO_MIME_TYPES,
  LogoDto,
  MAX_LOGO_BYTES,
  UpdatePlatformCompanyDto,
} from './company.dto';

export const DEFAULT_PRODUCT_CODE = 'PROD-AUTO-ESTANDAR';

/** Columnas de la empresa sin los bytes del logo */
const COMPANY_SELECT = {
  id: true,
  slug: true,
  name: true,
  legalName: true,
  tagline: true,
  logoMime: true,
  logoUpdatedAt: true,
  primaryColor: true,
  secondaryColor: true,
  accentColor: true,
  domains: true,
  contactPhone: true,
  contactEmail: true,
  contactHours: true,
  paymentsEmail: true,
  paymentsWhatsapp: true,
  bankAccounts: true,
  bankAccountHolder: true,
  locale: true,
  currency: true,
  timezone: true,
  isDefault: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CompanySelect;

type CompanyRow = Prisma.CompanyGetPayload<{ select: typeof COMPANY_SELECT }>;

const apiPrefix = () => `/${(process.env.API_PREFIX || 'api/v1').replace(/^\/+|\/+$/g, '')}`;

/** URL pública del logo; cambia con cada carga para invalidar la caché del navegador */
export const logoUrlOf = (c: { slug: string; logoUpdatedAt: Date | null; logoMime?: string | null }) =>
  c.logoUpdatedAt ? `${apiPrefix()}/public/companies/${c.slug}/logo?v=${c.logoUpdatedAt.getTime()}` : null;

/** Respuesta de GET /public/tenant (contrato) */
export const toPublicTenant = (c: CompanyRow | Company) => ({
  id: c.id,
  slug: c.slug,
  name: c.name,
  legalName: c.legalName,
  tagline: c.tagline,
  logoUrl: logoUrlOf(c),
  primaryColor: c.primaryColor,
  secondaryColor: c.secondaryColor,
  accentColor: c.accentColor,
  contactPhone: c.contactPhone,
  contactEmail: c.contactEmail,
  contactHours: c.contactHours,
  paymentsEmail: c.paymentsEmail,
  paymentsWhatsapp: c.paymentsWhatsapp,
  bankAccounts: c.bankAccounts,
  bankAccountHolder: c.bankAccountHolder,
  locale: c.locale,
  currency: c.currency,
  timezone: c.timezone,
});

/** Vista completa para administración (sin bytes del logo) */
const toAdminView = (c: CompanyRow) => ({ ...toPublicTenant(c), domains: c.domains, isDefault: c.isDefault, isActive: c.isActive, createdAt: c.createdAt, updatedAt: c.updatedAt });

/** Verifica la firma del archivo para no aceptar algo distinto a lo declarado */
function decodeLogo(dto: LogoDto): { data: Buffer; mime: string } {
  const mime = dto.mime.toLowerCase();
  if (!(LOGO_MIME_TYPES as readonly string[]).includes(mime)) throw new BadRequestException('El logo debe ser PNG, JPEG, WEBP o SVG.');
  const raw = dto.base64.replace(/^data:[^;,]+;base64,/, '').replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) throw new BadRequestException('El logo no es un base64 válido.');
  const data = Buffer.from(raw, 'base64');
  if (!data.length) throw new BadRequestException('El logo está vacío.');
  if (data.length > MAX_LOGO_BYTES) throw new BadRequestException('El logo supera el tamaño máximo de 1 MB.');

  const ok =
    (mime === 'image/png' && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) ||
    (mime === 'image/jpeg' && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) ||
    (mime === 'image/webp' && data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP') ||
    (mime === 'image/svg+xml' && isSafeSvg(data.toString('utf8')));
  if (!ok) throw new BadRequestException('El contenido del logo no coincide con el formato indicado o el SVG contiene código activo.');
  return { data, mime };
}

/** SVG sin scripts, manejadores de eventos ni referencias externas */
function isSafeSvg(text: string): boolean {
  if (!/<svg[\s>]/i.test(text)) return false;
  return !/<script|<foreignObject|\son[a-z]+\s*=|javascript:|<iframe|<embed|<object|xlink:href\s*=\s*["']?(?!#)|href\s*=\s*["']?(?!#)/i.test(text);
}

@Injectable()
export class CompaniesService {
  private readonly logger = new Logger(CompaniesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly drive: GoogleDriveService,
  ) {}

  /** Plataforma y bootstrap trabajan sobre todas las empresas: siempre sin filtro (bypass explícito). */
  private get db() {
    return this.prisma.unscoped;
  }

  // --------------------------------------------------------------------------
  // Plataforma (SUPERADMIN)
  // --------------------------------------------------------------------------

  async list() {
    const rows = await this.db.company.findMany({ select: COMPANY_SELECT, orderBy: [{ isDefault: 'desc' }, { name: 'asc' }] });
    const users = await this.db.user.groupBy({
      by: ['companyId'],
      where: { role: { not: UserRole.CUSTOMER }, companyId: { not: null } },
      _count: { _all: true },
    });
    const staff = new Map(users.map((u) => [u.companyId, u._count._all]));
    return rows.map((c) => ({ ...toAdminView(c), staffCount: staff.get(c.id) ?? 0 }));
  }

  async get(id: string) {
    const company = await this.db.company.findUnique({ where: { id }, select: COMPANY_SELECT });
    if (!company) throw new NotFoundException('Empresa no encontrada');
    const admins = await this.db.user.findMany({
      where: { companyId: id, role: UserRole.ADMIN },
      select: { id: true, email: true, fullName: true, isActive: true, mustChangePass: true, lastLoginAt: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    return { ...toAdminView(company), admins };
  }

  /** Crea la empresa, su producto financiero por defecto y su primer ADMIN (con correo de acceso). */
  async create(dto: CreateCompanyDto) {
    const { adminEmail, adminName, ...fields } = dto;
    await this.assertSlugFree(fields.slug);
    await this.assertEmailFree(adminEmail);
    if (fields.domains?.length) await this.assertDomainsFree(fields.domains);

    const company = await this.db.$transaction(async (tx) => {
      if (fields.isDefault) await tx.company.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
      const created = await tx.company.create({ data: this.toData(fields) as Prisma.CompanyCreateInput });
      await this.createDefaultProduct(tx, created.id);
      return created;
    });
    this.logger.log(`Empresa creada: ${company.slug} (${company.id})`);

    const admin = await this.createAdmin(company, { email: adminEmail, fullName: adminName });
    return { company: (await this.get(company.id)), admin };
  }

  async update(id: string, dto: UpdatePlatformCompanyDto) {
    const current = await this.db.company.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Empresa no encontrada');
    if (dto.slug && dto.slug !== current.slug) await this.assertSlugFree(dto.slug);
    if (dto.domains?.length) await this.assertDomainsFree(dto.domains, id);
    if (dto.isDefault === false && current.isDefault) {
      throw new BadRequestException('Debe existir una empresa por defecto: marque otra como predeterminada en su lugar.');
    }
    if (dto.isDefault && !current.isActive) throw new BadRequestException('La empresa por defecto debe estar activa.');

    await this.db.$transaction(async (tx) => {
      if (dto.isDefault) await tx.company.updateMany({ where: { isDefault: true, id: { not: id } }, data: { isDefault: false } });
      await tx.company.update({ where: { id }, data: this.toData(dto) });
    });
    if (dto.slug && dto.slug !== current.slug) this.drive.forgetCompany(id);
    return this.get(id);
  }

  async setStatus(id: string, isActive: boolean) {
    const current = await this.db.company.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Empresa no encontrada');
    if (!isActive && current.isDefault) {
      throw new BadRequestException('No se puede desactivar la empresa por defecto: marque otra como predeterminada primero.');
    }
    await this.db.company.update({ where: { id }, data: { isActive } });
    this.logger.warn(`Empresa ${current.slug} ${isActive ? 'activada' : 'desactivada'}`);
    return this.get(id);
  }

  async setLogo(id: string, dto: LogoDto) {
    const { data, mime } = decodeLogo(dto);
    const exists = await this.db.company.count({ where: { id } });
    if (!exists) throw new NotFoundException('Empresa no encontrada');
    await this.db.company.update({
      where: { id },
      data: { logoData: new Uint8Array(data), logoMime: mime, logoUpdatedAt: new Date() },
    });
    return this.get(id);
  }

  async addAdmin(companyId: string, dto: { email: string; fullName: string }) {
    const company = await this.db.company.findUnique({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Empresa no encontrada');
    await this.assertEmailFree(dto.email);
    return this.createAdmin(company, dto);
  }

  // --------------------------------------------------------------------------
  // Empresa propia (ADMIN) y público
  // --------------------------------------------------------------------------

  async getCurrent() {
    const company = await this.db.company.findUnique({ where: { id: TenantContext.requireCompanyId('Company') }, select: COMPANY_SELECT });
    if (!company) throw new NotFoundException('Empresa no encontrada');
    return toAdminView(company);
  }

  /** El ADMIN edita la marca y los contactos de su empresa (no slug, estado, dominios ni "por defecto"). */
  async updateCurrent(dto: CompanyBrandingDto) {
    const id = TenantContext.requireCompanyId('Company');
    const { slug: _s, domains: _d, isActive: _a, isDefault: _p, ...branding } = dto as Record<string, any>;
    await this.db.company.update({ where: { id }, data: this.toData(branding) });
    return this.getCurrent();
  }

  async setCurrentLogo(dto: LogoDto) {
    await this.setLogo(TenantContext.requireCompanyId('Company'), dto);
    return this.getCurrent();
  }

  async publicTenant() {
    const company = await this.db.company.findUnique({ where: { id: TenantContext.requireCompanyId('Company') }, select: COMPANY_SELECT });
    // La actividad ya la validó el JwtAuthGuard al resolver la empresa
    if (!company) throw new NotFoundException('Empresa no encontrada');
    return toPublicTenant(company);
  }

  async logoBySlug(slug: string) {
    const company = await this.db.company.findUnique({
      where: { slug: slug.toLowerCase() },
      select: { logoData: true, logoMime: true, logoUpdatedAt: true, isActive: true },
    });
    if (!company?.isActive || !company.logoData || !company.logoMime) throw new NotFoundException('Logo no encontrado');
    return { data: Buffer.from(company.logoData), mime: company.logoMime, updatedAt: company.logoUpdatedAt };
  }

  // --------------------------------------------------------------------------
  // Bootstrap
  // --------------------------------------------------------------------------

  /** Garantiza una empresa por defecto activa ('veltor' si no hay ninguna). */
  async ensureDefaultCompany(): Promise<Company> {
    const current = await this.db.company.findFirst({ where: { isDefault: true }, orderBy: { createdAt: 'asc' } });
    if (current) return current;

    const veltor = await this.db.company.findUnique({ where: { slug: 'veltor' } });
    if (veltor) {
      this.logger.warn('No había empresa por defecto: se marca "veltor" como predeterminada.');
      return this.db.company.update({ where: { id: veltor.id }, data: { isDefault: true, isActive: true } });
    }
    const created = await this.db.$transaction(async (tx) => {
      const c = await tx.company.create({ data: { slug: 'veltor', name: 'VELTOR', isDefault: true, isActive: true } });
      await this.createDefaultProduct(tx, c.id);
      return c;
    });
    this.logger.warn('Empresa por defecto "veltor" creada.');
    return created;
  }

  /**
   * Completa una empresa sin producto financiero (p. ej. la empresa por defecto que creó la migración en una
   * base vacía). No toca empresas que ya tienen productos.
   */
  async ensureProductFor(companyId: string) {
    const count = await this.db.financingProduct.count({ where: { companyId } });
    if (count === 0) {
      await this.createDefaultProduct(this.db, companyId);
      this.logger.log(`Producto financiero por defecto creado para la empresa ${companyId}.`);
    }
  }

  // --------------------------------------------------------------------------

  private async createDefaultProduct(db: Prisma.TransactionClient, companyId: string) {
    const num = (name: string, fallback: number) => {
      const v = Number(process.env[name]);
      return Number.isFinite(v) && v > 0 ? v : fallback;
    };
    const defaultRate = num('PRODUCT_DEFAULT_MONTHLY_RATE', 0.015);
    await db.financingProduct.upsert({
      where: { companyId_code: { companyId, code: DEFAULT_PRODUCT_CODE } },
      update: {},
      create: {
        companyId,
        code: DEFAULT_PRODUCT_CODE,
        name: process.env.PRODUCT_FINANCING_NAME || 'Crédito Vehicular Estándar',
        minMonthlyRate: num('PRODUCT_MIN_MONTHLY_RATE', Math.min(0.012, defaultRate)),
        maxMonthlyRate: num('PRODUCT_MAX_MONTHLY_RATE', Math.max(0.022, defaultRate)),
        defaultMonthlyRate: defaultRate,
        minTermMonths: num('PRODUCT_MIN_TERM_MONTHS', 12),
        maxTermMonths: num('PRODUCT_MAX_TERM_MONTHS', 72),
        minDownPercent: num('PRODUCT_MIN_DOWN_PERCENT', 15),
        dayCountBasis: DayCountBasis.D30_360,
        method: AmortizationMethod.FRENCH,
        graceDays: num('PRODUCT_GRACE_DAYS', 5),
        lateRateMonthly: num('PRODUCT_LATE_MONTHLY_RATE', 0.03),
        isActive: true,
      },
    });
  }

  /**
   * Crea un ADMIN con contraseña temporal (debe cambiarla al ingresar) y le envía el acceso por correo.
   * Si el correo no está configurado o falla, la contraseña temporal se devuelve una sola vez en la respuesta
   * para que el superadministrador la entregue por otro medio.
   */
  private async createAdmin(company: Company, dto: { email: string; fullName: string }) {
    const email = dto.email.toLowerCase().trim();
    const temporaryPassword = AuthService.generateTemporaryPassword();
    const user = await this.db.user.create({
      data: {
        email,
        fullName: dto.fullName.trim(),
        role: UserRole.ADMIN,
        companyId: company.id,
        passwordHash: await argon2.hash(temporaryPassword),
        isActive: true,
        mustChangePass: true,
      },
      select: { id: true, email: true, fullName: true, role: true, companyId: true },
    });

    const baseUrl = (process.env.APP_PUBLIC_URL || '').replace(/\/+$/, '');
    const loginUrl = baseUrl ? `${baseUrl}/login?empresa=${encodeURIComponent(company.slug)}` : null;
    // El aviso queda registrado en notification_logs de la empresa y firmado con su marca
    const result = await TenantContext.run(
      company.id,
      () =>
        this.mail.send({
          to: email,
          template: 'staff.access',
          ...staffAccessMail({ fullName: user.fullName, email, temporaryPassword, loginUrl }),
        }),
      toCompanyInfo(company),
    );
    this.logger.log(`Administrador ${email} creado para ${company.slug} (correo: ${result.status})`);

    return {
      user,
      emailStatus: result.status,
      emailError: result.error,
      ...(result.status === 'SENT' ? {} : { temporaryPassword }),
      message:
        result.status === 'SENT'
          ? `Se envió el acceso a ${email}.`
          : 'No se pudo enviar el correo: entregue la contraseña temporal al administrador por un medio seguro (se pedirá cambiarla al ingresar).',
    };
  }

  private toData(dto: Record<string, any>): Prisma.CompanyUpdateInput {
    const data: Record<string, any> = {};
    for (const [k, v] of Object.entries(dto)) {
      if (v === undefined) continue;
      if (k === 'bankAccounts') data[k] = (v as { bank: string; detail: string }[]).map(({ bank, detail }) => ({ bank, detail }));
      else if (k === 'domains') data[k] = [...new Set(v as string[])];
      else data[k] = v;
    }
    return data;
  }

  private async assertSlugFree(slug: string) {
    if (await this.db.company.count({ where: { slug } })) throw new ConflictException(`El slug "${slug}" ya está en uso.`);
  }

  private async assertEmailFree(email: string) {
    const used = await this.db.user.count({ where: { email: email.toLowerCase().trim() } });
    if (used) throw new ConflictException('Ese correo ya está registrado en la plataforma (el correo de acceso es único).');
  }

  private async assertDomainsFree(domains: string[], exceptId?: string) {
    const taken = await this.db.company.findFirst({
      where: { domains: { hasSome: domains }, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { slug: true, domains: true },
    });
    if (taken) {
      const dup = domains.filter((d) => taken.domains.includes(d));
      throw new ConflictException(`El dominio ${dup.join(', ')} ya pertenece a la empresa "${taken.slug}".`);
    }
  }
}

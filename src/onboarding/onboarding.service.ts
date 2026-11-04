import { BadRequestException, ConflictException, GoneException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CustomerStatus, LoanStatus, UserRole } from '@prisma/client';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { DomainEvents } from '../common/domain-events';
import { TenantContext } from '../tenant/tenant-context';
import { toCompanyInfo } from '../tenant/tenant-resolver.service';
import { frontendBaseUrl } from '../mail/templates';
import { WhatsappService, normalizeWhatsappPhone } from '../whatsapp/whatsapp.service';
import { CompleteRegistrationDto } from './onboarding.dto';

/** Vigencia del enlace de registro (el texto de la plantilla de WhatsApp dice 7 días) */
export const INVITE_TTL_DAYS = 7;
export const REGISTRATION_TEMPLATE = 'registro_cliente';
const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');
const TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;

/**
 * URL base del enlace de registro. Debe coincidir con la URL fija del botón de la plantilla de WhatsApp
 * (`<base>/registro/{{1}}`): por eso no usa el dominio propio de cada empresa; la página carga la marca
 * de la empresa a partir del token.
 */
export const registrationBaseUrl = () => (process.env.REGISTRATION_BASE_URL || frontendBaseUrl() || 'https://veltor.up.railway.app').replace(/\/+$/, '');

const maskPhone = (p: string | null) => (p ? p.replace(/\D/g, '').replace(/^(\d*)(\d{4})$/, (_, a: string, b: string) => `${'•'.repeat(Math.min(a.length, 4))}${b}`) : null);

export interface InviteOutcome {
  customerId: string;
  code: string;
  fullName: string;
  phone: string | null;
  status: 'SENT' | 'FAILED' | 'DISABLED' | 'INVALID_PHONE' | 'NOT_SENT' | 'SKIPPED';
  reason?: string;
  url?: string;
  expiresAt?: Date;
}

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsappService,
    private readonly events: DomainEvents,
  ) {}

  // ---------------------------------------------------------------- admin (con contexto de empresa)

  /** Clientes de la empresa con su situación de registro (para el panel). */
  async candidates() {
    const customers = await this.prisma.customer.findMany({
      select: {
        id: true, code: true, fullName: true, phone: true, email: true, dui: true, address: true,
        user: { select: { id: true } },
        invites: { orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true, expiresAt: true, usedAt: true, revokedAt: true, sendStatus: true, sendError: true } },
      },
      orderBy: { code: 'asc' },
    });
    return customers.map((c) => {
      const last = c.invites[0] ?? null;
      return {
        id: c.id, code: c.code, fullName: c.fullName, phone: c.phone,
        hasPortalAccess: !!c.user,
        missing: [!c.dui && 'DUI', !c.email && 'correo', !c.address && 'dirección'].filter(Boolean),
        validPhone: !!normalizeWhatsappPhone(c.phone),
        lastInvite: last && {
          sentAt: last.createdAt, expiresAt: last.expiresAt, sendStatus: last.sendStatus, sendError: last.sendError,
          state: last.usedAt ? 'USED' : last.revokedAt ? 'REVOKED' : last.expiresAt < new Date() ? 'EXPIRED' : 'PENDING',
        },
      };
    });
  }

  /**
   * Crea un enlace nuevo (anula los anteriores sin usar) y, si `send`, lo envía por WhatsApp.
   * Siempre devuelve la URL para que el admin pueda compartirla por otro medio.
   */
  async invite(customerId: string, opts: { send: boolean; createdById?: string }): Promise<InviteOutcome> {
    const c = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: {
        id: true, code: true, fullName: true, phone: true, user: { select: { id: true } },
        loans: { where: { status: { in: [LoanStatus.ACTIVE, LoanStatus.RESTRUCTURED, LoanStatus.DEFAULTED] } }, orderBy: { createdAt: 'desc' }, take: 1, select: { id: true, code: true } },
      },
    });
    if (!c) throw new NotFoundException('Cliente no encontrado');
    const base = { customerId: c.id, code: c.code, fullName: c.fullName, phone: c.phone };
    if (c.user) throw new ConflictException('El cliente ya tiene acceso al portal: no necesita registrarse.');

    const token = randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000);
    const url = `${registrationBaseUrl()}/registro/${token}`;

    await this.prisma.customerInvite.updateMany({ where: { customerId: c.id, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    const inv = await this.prisma.customerInvite.create({
      data: { customerId: c.id, tokenHash: hashToken(token), expiresAt, channel: opts.send ? 'WHATSAPP' : 'LINK', sentTo: c.phone, createdById: opts.createdById },
    });
    if (!opts.send) return { ...base, status: 'NOT_SENT', url, expiresAt };

    const company = TenantContext.company();
    const r = await this.whatsapp.sendTemplate({
      phone: c.phone,
      template: REGISTRATION_TEMPLATE,
      body: [c.fullName, company?.name ?? 'su financiera', c.loans[0]?.code ?? c.code],
      urlButtonParam: token,
      loanId: c.loans[0]?.id,
    });
    await this.prisma.customerInvite.update({
      where: { id: inv.id },
      data: { sendStatus: r.status, sendError: r.error?.slice(0, 500) ?? null, messageId: r.messageId ?? null, sentTo: r.to ?? c.phone },
    });
    return { ...base, status: r.status, reason: r.error, url, expiresAt };
  }

  /**
   * Envío masivo a los clientes sin acceso al portal y con teléfono válido.
   * `dryRun` solo devuelve a quién se enviaría. Omite a quien tenga una invitación vigente salvo `resend`.
   */
  async inviteAll(opts: { dryRun: boolean; resend: boolean; createdById?: string }) {
    const list = await this.candidates();
    const results: InviteOutcome[] = [];
    for (const c of list) {
      const base = { customerId: c.id, code: c.code, fullName: c.fullName, phone: c.phone };
      if (c.hasPortalAccess) { results.push({ ...base, status: 'SKIPPED', reason: 'Ya tiene acceso al portal' }); continue; }
      if (!c.validPhone) { results.push({ ...base, status: 'SKIPPED', reason: c.phone ? 'Teléfono inválido' : 'Sin teléfono' }); continue; }
      if (!opts.resend && c.lastInvite?.state === 'PENDING' && c.lastInvite.sendStatus === 'SENT') {
        results.push({ ...base, status: 'SKIPPED', reason: 'Ya tiene una invitación vigente' }); continue;
      }
      if (opts.dryRun) { results.push({ ...base, status: 'NOT_SENT', reason: 'Simulación: se enviaría' }); continue; }
      results.push(await this.invite(c.id, { send: true, createdById: opts.createdById }));
    }
    const count = (s: string) => results.filter((r) => r.status === s).length;
    return {
      dryRun: opts.dryRun,
      summary: { total: results.length, sent: count('SENT'), failed: count('FAILED') + count('DISABLED') + count('INVALID_PHONE'), skipped: count('SKIPPED'), wouldSend: opts.dryRun ? count('NOT_SENT') : 0 },
      results,
    };
  }

  // ---------------------------------------------------------------- público (sin sesión; la empresa sale del token)

  private async resolve(token: string) {
    if (!TOKEN_RE.test(token || '')) throw new NotFoundException('El enlace de registro no es válido.');
    const inv = await this.prisma.unscoped.customerInvite.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!inv) throw new NotFoundException('El enlace de registro no es válido.');
    const company = await this.prisma.unscoped.company.findUnique({ where: { id: inv.companyId }, omit: { logoData: true } });
    if (!company?.isActive) throw new NotFoundException('El enlace de registro no es válido.');
    const contact = company.contactPhone || company.paymentsWhatsapp;
    const ask = `Solicite uno nuevo a ${company.name}${contact ? ` (${contact})` : ''}.`;
    if (inv.usedAt) throw new GoneException(`Este enlace ya se utilizó. Si ya creó su acceso, inicie sesión. Si no, ${ask.charAt(0).toLowerCase()}${ask.slice(1)}`);
    if (inv.revokedAt) throw new GoneException(`Este enlace fue reemplazado por uno más reciente. Use el último que recibió o ${ask.charAt(0).toLowerCase()}${ask.slice(1)}`);
    if (inv.expiresAt < new Date()) throw new GoneException(`Este enlace venció. ${ask}`);
    return { inv, company };
  }

  async publicInfo(token: string) {
    const { inv, company } = await this.resolve(token);
    const c = await this.prisma.unscoped.customer.findUnique({
      where: { id: inv.customerId },
      select: { fullName: true, phone: true, email: true, address: true, municipality: true, department: true, personType: true, user: { select: { id: true } } },
    });
    if (!c) throw new NotFoundException('El enlace de registro no es válido.');
    if (c.user) throw new GoneException('Usted ya tiene acceso al portal. Inicie sesión con su correo.');
    return {
      company: {
        name: company.name, slug: company.slug, tagline: company.tagline,
        primaryColor: company.primaryColor, secondaryColor: company.secondaryColor, accentColor: company.accentColor,
        hasLogo: !!company.logoMime, logoVersion: company.logoUpdatedAt?.getTime() ?? 0,
        contactPhone: company.contactPhone, contactEmail: company.contactEmail,
      },
      customer: {
        fullName: c.fullName, phoneMasked: maskPhone(c.phone), personType: c.personType,
        // Solo datos de baja sensibilidad para precargar (DUI, NIT e ingresos no se exponen)
        email: c.email, address: c.address, municipality: c.municipality, department: c.department,
      },
      expiresAt: inv.expiresAt,
    };
  }

  async complete(token: string, dto: CompleteRegistrationDto) {
    const { inv, company } = await this.resolve(token);
    if (!dto.privacyAccepted) throw new BadRequestException('Debe aceptar el aviso de privacidad para continuar.');
    const email = dto.email.toLowerCase().trim();

    return TenantContext.run(company.id, async () => {
      const c = await this.prisma.customer.findUnique({ where: { id: inv.customerId }, include: { user: { select: { id: true } } } });
      if (!c) throw new NotFoundException('El enlace de registro no es válido.');
      if (c.user) throw new GoneException('Usted ya tiene acceso al portal. Inicie sesión con su correo.');

      // Duplicados: DUI y correo únicos en la empresa; el correo de acceso, en toda la plataforma
      if (await this.prisma.customer.count({ where: { dui: dto.dui, id: { not: c.id } } }))
        throw new ConflictException(`Ese DUI ya está registrado con otro cliente. Comuníquese con ${company.name}.`);
      if (await this.prisma.customer.count({ where: { email, id: { not: c.id } } }))
        throw new ConflictException('Ese correo ya está registrado con otro cliente. Use otro correo.');
      if (await this.prisma.unscoped.user.findUnique({ where: { email }, select: { id: true } }))
        throw new ConflictException('Ese correo ya tiene una cuenta. Use otro correo o inicie sesión.');

      const passwordHash = await argon2.hash(dto.password);
      const now = new Date();
      const note = `Datos completados por el cliente con el enlace de registro el ${now.toISOString().slice(0, 10)}.`;
      await this.prisma.$transaction(async (tx) => {
        // Marca el enlace como usado primero (condicional): dos envíos simultáneos no crean dos usuarios
        const used = await tx.customerInvite.updateMany({ where: { id: inv.id, usedAt: null, revokedAt: null }, data: { usedAt: now } });
        if (used.count !== 1) throw new GoneException('Este enlace ya se utilizó.');
        await tx.customer.update({
          where: { id: c.id },
          data: {
            dui: dto.dui,
            nit: dto.nit || undefined,
            email,
            birthDate: dto.birthDate ? new Date(dto.birthDate) : undefined,
            address: dto.address.trim(),
            municipality: dto.municipality.trim(),
            department: dto.department.trim(),
            economicActivity: dto.economicActivity?.trim() || undefined,
            employerName: dto.employerName?.trim() || undefined,
            monthlyIncome: dto.monthlyIncome ?? undefined,
            status: c.status === CustomerStatus.PROSPECT ? CustomerStatus.ACTIVE : undefined,
            internalNotes: c.internalNotes ? `${c.internalNotes}\n${note}` : note,
          },
        });
        await tx.user.create({
          data: { email, fullName: c.fullName, phone: c.phone, role: UserRole.CUSTOMER, passwordHash, isActive: true, mustChangePass: false, customerId: c.id },
        });
      });
      this.logger.log(`Registro completado: cliente ${c.code} (${company.slug})`);
      this.events.emit('customer.registered', { customerId: c.id });
      return { success: true, email, message: 'Sus datos quedaron registrados. Ya puede ingresar al portal con su correo y contraseña.' };
    }, toCompanyInfo(company as any));
  }
}

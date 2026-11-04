import { Injectable, Logger } from '@nestjs/common';
import { NotificationChannel, NotificationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContext } from '../tenant/tenant-context';

/**
 * WhatsApp Cloud API (Meta). Un solo número de la plataforma para todas las empresas: cada plantilla
 * lleva el nombre de la empresa como variable.
 *
 * Variables de entorno: WHATSAPP_TOKEN (usuario del sistema con rol Admin: uno con rol Employee no puede
 * usar la cuenta de pago y Meta responde "(#10) Viewer cannot access the provided Paid Message Account"),
 * WHATSAPP_PHONE_ID, opcional WHATSAPP_API_VERSION. Sin token, los envíos quedan en DISABLED.
 */

export type WhatsappSendStatus = 'SENT' | 'FAILED' | 'DISABLED' | 'INVALID_PHONE';

export interface WhatsappResult {
  status: WhatsappSendStatus;
  to: string | null;
  messageId?: string;
  error?: string;
}

export interface TemplateMessage {
  /** Teléfono tal como está en el expediente (se normaliza a 503XXXXXXXX) */
  phone: string | null | undefined;
  template: string;
  language?: string;
  /** Variables {{1}}, {{2}}… del cuerpo, en orden */
  body: (string | number)[];
  /** Sufijo dinámico del botón URL (índice 0), si la plantilla lo tiene */
  urlButtonParam?: string;
  /** Para el registro en notification_logs */
  loanId?: string;
}

/** Normaliza un teléfono a formato internacional sin "+". 8 dígitos se asumen de El Salvador (503). */
export function normalizeWhatsappPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (/^[267]\d{7}$/.test(digits)) return `503${digits}`;
  if (/^503[267]\d{7}$/.test(digits)) return digits;
  // Otros países: se acepta un número internacional completo (10 a 15 dígitos)
  if (digits.length >= 10 && digits.length <= 15 && !digits.startsWith('0')) return digits;
  return null;
}

/** Meta rechaza variables con saltos de línea, tabuladores o más de 4 espacios seguidos. */
export const cleanParam = (v: string | number) => String(v ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {4,}/g, '   ').trim() || '-';

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

  constructor(private readonly prisma: PrismaService) {}

  enabled(): boolean {
    return !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID);
  }

  async sendTemplate(msg: TemplateMessage): Promise<WhatsappResult> {
    const to = normalizeWhatsappPhone(msg.phone);
    let result: WhatsappResult;
    if (!to) result = { status: 'INVALID_PHONE', to: null, error: `Teléfono inválido: ${msg.phone ?? '(vacío)'}` };
    else if (!this.enabled()) result = { status: 'DISABLED', to, error: 'WhatsApp no está configurado (WHATSAPP_TOKEN / WHATSAPP_PHONE_ID)' };
    else result = await this.post(to, msg);

    await this.log(msg, result);
    return result;
  }

  private async post(to: string, msg: TemplateMessage): Promise<WhatsappResult> {
    const components: any[] = [{ type: 'body', parameters: msg.body.map((v) => ({ type: 'text', text: cleanParam(v) })) }];
    if (msg.urlButtonParam !== undefined) {
      components.push({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: msg.urlButtonParam }] });
    }
    const version = process.env.WHATSAPP_API_VERSION || 'v24.0';
    try {
      const res = await fetch(`https://graph.facebook.com/${version}/${process.env.WHATSAPP_PHONE_ID}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'template',
          template: { name: msg.template, language: { code: msg.language || 'es' }, components },
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const body: any = await res.json().catch(() => null);
      if (res.ok && body?.messages?.[0]?.id) return { status: 'SENT', to, messageId: body.messages[0].id };
      const error = body?.error ? `(#${body.error.code}) ${body.error.message}${body.error.error_data?.details ? ` — ${body.error.error_data.details}` : ''}` : `HTTP ${res.status}`;
      this.logger.warn(`WhatsApp ${msg.template} a ${to} falló: ${error}`);
      return { status: 'FAILED', to, error };
    } catch (e: any) {
      this.logger.warn(`WhatsApp ${msg.template} a ${to} falló: ${e?.message ?? e}`);
      return { status: 'FAILED', to, error: String(e?.message ?? e) };
    }
  }

  /** Bitácora en notification_logs (canal WHATSAPP). Nunca interrumpe el envío. */
  private async log(msg: TemplateMessage, r: WhatsappResult) {
    if (!TenantContext.companyId()) return;
    try {
      await this.prisma.notificationLog.create({
        data: {
          recipientEmail: '',
          recipientPhone: r.to ?? (msg.phone ? String(msg.phone) : null),
          subject: `WhatsApp: ${msg.template}`,
          templateName: `whatsapp.${msg.template}`,
          channel: NotificationChannel.WHATSAPP,
          status: r.status === 'SENT' ? NotificationStatus.SENT : NotificationStatus.FAILED,
          errorMessage: r.status === 'SENT' ? null : r.error?.slice(0, 500),
          sentAt: r.status === 'SENT' ? new Date() : null,
          loanId: msg.loanId,
        },
      });
    } catch (e: any) {
      this.logger.warn(`No se pudo registrar el envío de WhatsApp: ${e?.message ?? e}`);
    }
  }
}

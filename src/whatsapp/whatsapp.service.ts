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
  /** Documento del encabezado (plantillas con encabezado DOCUMENT): se sube a Meta antes de enviar */
  document?: { data: Buffer; filename: string; mime?: string };
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
    else result = await this.post(to, msg).catch((e: any) => ({ status: 'FAILED' as const, to, error: String(e?.message ?? e) }));

    await this.log(msg, result);
    if (result.status === 'SENT') await this.recordOutgoing(result.to!, 'template', `[Plantilla ${msg.template}] ${msg.body.map((v) => cleanParam(v)).join(' · ')}`, result.messageId);
    return result;
  }

  /**
   * Texto libre a un número (respuestas de la bandeja). WhatsApp solo lo permite dentro de las 24 horas
   * siguientes al último mensaje del cliente; fuera de esa ventana hay que usar una plantilla aprobada.
   */
  async sendText(phone: string, text: string): Promise<WhatsappResult> {
    const to = normalizeWhatsappPhone(phone);
    if (!to) return { status: 'INVALID_PHONE', to: null, error: `Teléfono inválido: ${phone}` };
    if (!this.enabled()) return { status: 'DISABLED', to, error: 'WhatsApp no está configurado (WHATSAPP_TOKEN / WHATSAPP_PHONE_ID)' };
    try {
      const res = await fetch(`https://graph.facebook.com/${this.version()}/${process.env.WHATSAPP_PHONE_ID}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { body: text, preview_url: true } }),
        signal: AbortSignal.timeout(15_000),
      });
      const body: any = await res.json().catch(() => null);
      if (res.ok && body?.messages?.[0]?.id) return { status: 'SENT', to, messageId: body.messages[0].id };
      const error = body?.error ? `(#${body.error.code}) ${body.error.message}${body.error.error_data?.details ? ` — ${body.error.error_data.details}` : ''}` : `HTTP ${res.status}`;
      this.logger.warn(`WhatsApp texto a ${to} falló: ${error}`);
      return { status: 'FAILED', to, error };
    } catch (e: any) {
      return { status: 'FAILED', to, error: String(e?.message ?? e) };
    }
  }

  /** Descarga un adjunto recibido (id de medio de Meta, disponible unos 30 días). */
  async downloadMedia(mediaId: string): Promise<{ data: Buffer; mime: string }> {
    if (!this.enabled()) throw new Error('WhatsApp no está configurado');
    const auth = { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` };
    const meta = await fetch(`https://graph.facebook.com/${this.version()}/${encodeURIComponent(mediaId)}`, { headers: auth, signal: AbortSignal.timeout(15_000) });
    const info: any = await meta.json().catch(() => null);
    if (!meta.ok || !info?.url) throw new Error(`No se pudo obtener el adjunto: ${info?.error?.message ?? `HTTP ${meta.status}`}`);
    const file = await fetch(info.url, { headers: auth, signal: AbortSignal.timeout(60_000) });
    if (!file.ok) throw new Error(`No se pudo descargar el adjunto: HTTP ${file.status}`);
    return { data: Buffer.from(await file.arrayBuffer()), mime: info.mime_type || file.headers.get('content-type') || 'application/octet-stream' };
  }

  /** Deja el mensaje enviado en la conversación del cliente (bandeja). Nunca interrumpe el envío. */
  async recordOutgoing(to: string, type: string, body: string, waMessageId?: string, sentById?: string) {
    if (!TenantContext.companyId()) return;
    try {
      const customer = await this.findCustomerByPhone(to);
      await this.prisma.whatsappMessage.create({
        data: { phone: to, customerId: customer?.id ?? null, direction: 'OUT', type, body, waMessageId: waMessageId ?? null, status: 'SENT', sentById: sentById ?? null },
      });
    } catch (e: any) {
      this.logger.warn(`No se pudo registrar el mensaje enviado en la bandeja: ${e?.message ?? e}`);
    }
  }

  /** Cliente de la empresa del contexto con ese teléfono (comparando en formato internacional). */
  async findCustomerByPhone(phone: string) {
    const to = normalizeWhatsappPhone(phone);
    if (!to) return null;
    const candidates = await this.prisma.customer.findMany({
      // Últimos 4 dígitos: tolera teléfonos guardados con guiones o espacios; luego se compara normalizado
      where: { phone: { contains: to.slice(-4) } },
      select: { id: true, fullName: true, code: true, phone: true },
      orderBy: { createdAt: 'asc' },
    });
    return candidates.find((c) => normalizeWhatsappPhone(c.phone) === to) ?? null;
  }

  private version() {
    return process.env.WHATSAPP_API_VERSION || 'v24.0';
  }

  /** Sube un archivo a WhatsApp y devuelve el id del medio (válido unos 30 días). */
  private async uploadMedia(doc: { data: Buffer; filename: string; mime?: string }): Promise<string> {
    const version = process.env.WHATSAPP_API_VERSION || 'v24.0';
    const mime = doc.mime || 'application/pdf';
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', mime);
    form.append('file', new Blob([new Uint8Array(doc.data)], { type: mime }), doc.filename);
    const res = await fetch(`https://graph.facebook.com/${version}/${process.env.WHATSAPP_PHONE_ID}/media`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` },
      body: form,
      signal: AbortSignal.timeout(30_000),
    });
    const body: any = await res.json().catch(() => null);
    if (!res.ok || !body?.id) throw new Error(`No se pudo subir el documento: ${body?.error?.message ?? `HTTP ${res.status}`}`);
    return body.id;
  }

  private async post(to: string, msg: TemplateMessage): Promise<WhatsappResult> {
    const components: any[] = [];
    if (msg.document) {
      const id = await this.uploadMedia(msg.document);
      components.push({ type: 'header', parameters: [{ type: 'document', document: { id, filename: msg.document.filename } }] });
    }
    components.push({ type: 'body', parameters: msg.body.map((v) => ({ type: 'text', text: cleanParam(v) })) });
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

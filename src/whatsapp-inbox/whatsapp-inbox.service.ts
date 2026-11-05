import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DocumentCategory, LoanStatus } from '@prisma/client';
import { createHmac, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContext } from '../tenant/tenant-context';
import { toCompanyInfo } from '../tenant/tenant-resolver.service';
import { WhatsappService, normalizeWhatsappPhone } from '../whatsapp/whatsapp.service';
import { DocumentsService } from '../documents/documents.service';
import { ALLOWED_DOCUMENT_MIME_TYPES, MAX_DOCUMENT_BYTES } from '../documents/documents.constants';
import { DomainEvents } from '../common/domain-events';

/** WhatsApp permite responder con texto libre solo dentro de las 24 h siguientes al último mensaje del cliente */
export const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;
/** No se repite el aviso a administración si el cliente sigue escribiendo dentro de este lapso */
const NOTIFY_QUIET_MS = 30 * 60 * 1000;
const MEDIA_TYPES = ['image', 'document', 'audio', 'video', 'sticker'];
const EXT: Record<string, string> = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'application/pdf': '.pdf' };

/** Texto legible de un mensaje entrante de la Cloud API, según su tipo. */
export function describeIncoming(m: any): { body: string | null; mediaId?: string; mediaMime?: string; mediaName?: string } {
  switch (m.type) {
    case 'text':
      return { body: m.text?.body ?? '' };
    case 'image':
    case 'document':
    case 'audio':
    case 'video':
    case 'sticker': {
      const media = m[m.type] ?? {};
      return { body: media.caption ?? null, mediaId: media.id, mediaMime: media.mime_type, mediaName: media.filename };
    }
    case 'location': {
      const l = m.location ?? {};
      return { body: [l.name, l.address, `https://maps.google.com/?q=${l.latitude},${l.longitude}`].filter(Boolean).join(' · ') };
    }
    case 'button':
      return { body: m.button?.text ?? null };
    case 'interactive':
      return { body: m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? null };
    case 'reaction':
      return { body: m.reaction?.emoji ? `Reaccionó ${m.reaction.emoji}` : 'Quitó su reacción' };
    case 'contacts':
      return { body: (m.contacts ?? []).map((c: any) => `${c.name?.formatted_name ?? ''} ${(c.phones ?? []).map((p: any) => p.phone).join(', ')}`.trim()).join(' | ') };
    default:
      return { body: m.errors?.[0]?.title ?? `(mensaje de tipo ${m.type} no soportado)` };
  }
}

/**
 * Bandeja de WhatsApp: recibe por webhook lo que los clientes escriben al número de la plataforma, lo
 * asigna a la empresa del cliente (por su teléfono), archiva los adjuntos en su expediente, avisa a
 * administración y permite responder desde el panel dentro de la ventana de 24 horas.
 */
@Injectable()
export class WhatsappInboxService {
  private readonly logger = new Logger(WhatsappInboxService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsappService,
    private readonly documents: DocumentsService,
    private readonly events: DomainEvents,
  ) {}

  // ---------------------------------------------------------------- webhook (público, sin empresa)

  /** Firma X-Hub-Signature-256 con el App Secret. Sin WHATSAPP_APP_SECRET configurado se rechaza todo (no se aceptan mensajes sin verificar). */
  verifySignature(raw: Buffer | undefined, header: string | undefined): boolean {
    const secret = process.env.WHATSAPP_APP_SECRET;
    if (!secret) {
      this.logger.error('WHATSAPP_APP_SECRET no está configurado: se rechazan los eventos del webhook de WhatsApp.');
      return false;
    }
    if (!raw || !header?.startsWith('sha256=')) return false;
    const expected = Buffer.from(createHmac('sha256', secret).update(raw).digest('hex'));
    const got = Buffer.from(header.slice(7));
    return expected.length === got.length && timingSafeEqual(expected, got);
  }

  async handleWebhook(payload: any) {
    for (const entry of payload?.entry ?? []) {
      for (const change of entry?.changes ?? []) {
        if (change?.field !== 'messages') continue;
        const value = change.value ?? {};
        const ourPhone = process.env.WHATSAPP_PHONE_ID;
        if (ourPhone && value.metadata?.phone_number_id && value.metadata.phone_number_id !== ourPhone) continue;
        const names = new Map<string, string>((value.contacts ?? []).map((c: any) => [c.wa_id, c.profile?.name]));
        for (const m of value.messages ?? []) {
          await this.receive(m, names.get(m.from)).catch((e) => this.logger.error(`No se pudo guardar el mensaje ${m?.id}: ${e?.message ?? e}`));
        }
        for (const s of value.statuses ?? []) {
          await this.updateStatus(s).catch((e) => this.logger.warn(`Estado de WhatsApp ${s?.id}: ${e?.message ?? e}`));
        }
      }
    }
  }

  /** Empresa y cliente dueños de un teléfono: cliente con crédito activo primero; si nadie lo tiene, la empresa por defecto. */
  private async resolveOwner(phone: string) {
    const candidates = await this.prisma.unscoped.customer.findMany({
      where: { phone: { contains: phone.slice(-4) }, company: { isActive: true } },
      select: { id: true, companyId: true, phone: true, createdAt: true, loans: { where: { status: LoanStatus.ACTIVE }, select: { id: true }, take: 1 } },
    });
    const matches = candidates
      .filter((c) => normalizeWhatsappPhone(c.phone) === phone)
      .sort((a, b) => b.loans.length - a.loans.length || +b.createdAt - +a.createdAt);
    const companyId = matches[0]?.companyId ?? (await this.prisma.unscoped.company.findFirst({ where: { isDefault: true }, select: { id: true } }))?.id;
    if (!companyId) return null;
    const company = await this.prisma.unscoped.company.findUnique({ where: { id: companyId } });
    return company ? { company, customerId: matches[0]?.id ?? null } : null;
  }

  private async receive(m: any, profileName?: string) {
    const phone = normalizeWhatsappPhone(m?.from) ?? String(m?.from ?? '');
    if (!m?.id || !phone) return;
    if (await this.prisma.unscoped.whatsappMessage.findUnique({ where: { waMessageId: m.id }, select: { id: true } })) return; // reintento de Meta
    const owner = await this.resolveOwner(phone);
    if (!owner) return this.logger.warn(`Mensaje de WhatsApp de ${phone} sin empresa a la cual asignarlo`);

    await TenantContext.run(owner.company.id, async () => {
      const at = m.timestamp ? new Date(Number(m.timestamp) * 1000) : new Date();
      const previous = await this.prisma.whatsappMessage.findFirst({
        where: { phone, direction: 'IN' }, orderBy: { timestamp: 'desc' }, select: { timestamp: true },
      });
      const d = describeIncoming(m);
      let msg;
      try {
        msg = await this.prisma.whatsappMessage.create({
          data: {
            phone, profileName: profileName ?? null, customerId: owner.customerId, direction: 'IN', type: m.type ?? 'unsupported',
            body: d.body, mediaId: d.mediaId ?? null, mediaMime: d.mediaMime ?? null, mediaName: d.mediaName ?? null,
            waMessageId: m.id, status: 'RECEIVED', timestamp: at,
          },
        });
      } catch (e: any) {
        if (e?.code === 'P2002') return; // el mismo evento llegó dos veces a la vez
        throw e;
      }
      this.logger.log(`WhatsApp recibido de ${phone} (${owner.company.slug}, ${m.type})`);

      if (d.mediaId && owner.customerId && MEDIA_TYPES.includes(m.type)) await this.archiveMedia(msg.id, owner.customerId, d);

      const quiet = !previous || +at - +previous.timestamp > NOTIFY_QUIET_MS;
      if (quiet) this.events.emit('whatsapp.received', { messageId: msg.id });
      if (!previous || +at - +previous.timestamp > REPLY_WINDOW_MS) await this.autoReply(phone, owner.company.name, owner.customerId);
    }, toCompanyInfo(owner.company as any));
  }

  /** Fotos y PDF que manda un cliente conocido (p. ej. comprobantes) quedan en su expediente (Drive). */
  private async archiveMedia(messageId: string, customerId: string, d: { mediaId?: string; mediaMime?: string; mediaName?: string }) {
    const mime = (d.mediaMime ?? '').split(';')[0].trim();
    if (!ALLOWED_DOCUMENT_MIME_TYPES.includes(mime)) return;
    try {
      const file = await this.whatsapp.downloadMedia(d.mediaId!);
      if (file.data.length > MAX_DOCUMENT_BYTES) return;
      const name = d.mediaName || `whatsapp-${new Date().toISOString().slice(0, 10)}${EXT[mime] ?? ''}`;
      const doc = await this.documents.uploadCustomerDocument(
        { customerId, category: DocumentCategory.OTHER, title: `WhatsApp: ${name}`, notes: 'Enviado por el cliente por WhatsApp.' },
        { buffer: file.data, mimetype: mime, originalname: name, size: file.data.length } as Express.Multer.File,
      );
      await this.prisma.whatsappMessage.update({ where: { id: messageId }, data: { documentId: doc.id } });
    } catch (e: any) {
      this.logger.warn(`No se pudo archivar el adjunto de WhatsApp ${d.mediaId}: ${e?.message ?? e}`);
    }
  }

  /** Acuse automático al primer mensaje de una conversación (una vez cada 24 h). WHATSAPP_AUTO_REPLY=off lo apaga. */
  private async autoReply(phone: string, companyName: string, customerId: string | null) {
    if ((process.env.WHATSAPP_AUTO_REPLY ?? 'on').toLowerCase() === 'off') return;
    const customer = customerId ? await this.prisma.customer.findUnique({ where: { id: customerId }, select: { fullName: true } }) : null;
    const hello = customer ? `Hola ${customer.fullName.split(' ')[0]}` : 'Hola';
    const text = `${hello}, gracias por escribir a ${companyName}. Recibimos su mensaje y le responderemos a la brevedad.`;
    const r = await this.whatsapp.sendText(phone, text);
    if (r.status === 'SENT') await this.whatsapp.recordOutgoing(phone, 'auto', text, r.messageId);
  }

  private async updateStatus(s: any) {
    if (!s?.id || !s?.status) return;
    const status = String(s.status).toUpperCase();
    const error = s.errors?.[0] ? `(#${s.errors[0].code}) ${s.errors[0].title ?? ''} ${s.errors[0].error_data?.details ?? ''}`.trim() : null;
    await this.prisma.unscoped.whatsappMessage.updateMany({ where: { waMessageId: s.id, direction: 'OUT' }, data: { status, ...(error ? { error } : {}) } });
  }

  // ---------------------------------------------------------------- panel (con empresa)

  /** Conversaciones de la empresa: una por teléfono, la más reciente primero. */
  async conversations() {
    const rows = await this.prisma.whatsappMessage.findMany({
      orderBy: { timestamp: 'desc' },
      take: 3000,
      select: {
        phone: true, direction: true, type: true, body: true, timestamp: true, readAt: true, profileName: true, customerId: true,
        customer: { select: { id: true, code: true, fullName: true } },
      },
    });
    const byPhone = new Map<string, any>();
    for (const r of rows) {
      let c = byPhone.get(r.phone);
      if (!c) {
        c = { phone: r.phone, customer: r.customer, profileName: null, last: { direction: r.direction, type: r.type, body: r.body, at: r.timestamp }, unread: 0, lastIncomingAt: null };
        byPhone.set(r.phone, c);
      }
      if (!c.customer && r.customer) c.customer = r.customer;
      if (r.direction === 'IN') {
        c.profileName ??= r.profileName;
        c.lastIncomingAt ??= r.timestamp;
        if (!r.readAt) c.unread++;
      }
    }
    const now = Date.now();
    // Solo conversaciones donde el cliente escribió: las plantillas enviadas sin respuesta no son conversación
    return [...byPhone.values()].filter((c) => c.lastIncomingAt).map((c) => ({
      ...c,
      canReply: !!c.lastIncomingAt && now - +c.lastIncomingAt < REPLY_WINDOW_MS,
      replyUntil: c.lastIncomingAt ? new Date(+c.lastIncomingAt + REPLY_WINDOW_MS) : null,
    }));
  }

  async unreadCount() {
    return { unread: await this.prisma.whatsappMessage.count({ where: { direction: 'IN', readAt: null } }) };
  }

  /** Mensajes de una conversación (marca como leídos los del cliente). */
  async thread(phoneRaw: string) {
    const phone = normalizeWhatsappPhone(phoneRaw) ?? phoneRaw;
    const messages = await this.prisma.whatsappMessage.findMany({ where: { phone }, orderBy: { timestamp: 'asc' }, take: 500 });
    if (!messages.length) throw new NotFoundException('No hay mensajes con ese número.');
    await this.prisma.whatsappMessage.updateMany({ where: { phone, direction: 'IN', readAt: null }, data: { readAt: new Date() } });
    const customer = await this.whatsapp.findCustomerByPhone(phone);
    const lastIn = [...messages].reverse().find((m) => m.direction === 'IN');
    const replyUntil = lastIn ? new Date(+lastIn.timestamp + REPLY_WINDOW_MS) : null;
    return { phone, customer, messages, canReply: !!replyUntil && replyUntil > new Date(), replyUntil };
  }

  async reply(phoneRaw: string, text: string, userId: string) {
    const phone = normalizeWhatsappPhone(phoneRaw);
    if (!phone) throw new BadRequestException('Teléfono inválido.');
    const body = text?.trim();
    if (!body) throw new BadRequestException('Escriba el mensaje.');
    const lastIn = await this.prisma.whatsappMessage.findFirst({ where: { phone, direction: 'IN' }, orderBy: { timestamp: 'desc' }, select: { timestamp: true } });
    if (!lastIn || Date.now() - +lastIn.timestamp >= REPLY_WINDOW_MS) {
      throw new BadRequestException('Pasaron más de 24 horas desde el último mensaje del cliente: WhatsApp solo permite escribirle con una plantilla aprobada.');
    }
    const r = await this.whatsapp.sendText(phone, body);
    if (r.status !== 'SENT') throw new BadRequestException(`No se pudo enviar: ${r.error ?? r.status}`);
    await this.whatsapp.recordOutgoing(phone, 'text', body, r.messageId, userId);
    return { success: true, messageId: r.messageId };
  }

  /** Archivo adjunto de un mensaje: del expediente si se archivó; si no, se descarga de WhatsApp. */
  async media(id: string) {
    const m = await this.prisma.whatsappMessage.findUnique({ where: { id } });
    if (!m?.mediaId) throw new NotFoundException('El mensaje no tiene adjunto.');
    if (m.documentId) {
      const { stream, document } = await this.documents.getDocumentFile(m.documentId);
      return { stream, mime: document.mimeType, name: document.fileName };
    }
    const file = await this.whatsapp.downloadMedia(m.mediaId).catch((e) => {
      throw new NotFoundException(`El adjunto ya no está disponible en WhatsApp: ${e?.message ?? e}`);
    });
    return { data: file.data, mime: file.mime, name: m.mediaName || `adjunto-${m.id.slice(0, 8)}` };
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { NotificationStatus } from '@prisma/client';
import * as nodemailer from 'nodemailer';
import { PrismaService } from '../prisma/prisma.service';

export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

export interface OutgoingMail {
  to: string;
  subject: string;
  html: string;
  text: string;
  template: string;
  attachments?: MailAttachment[];
  /** Si ya existe un envío exitoso con esta clave, no se vuelve a enviar. */
  dedupeKey?: string;
  loanId?: string;
}

export interface MailResult {
  status: 'SENT' | 'SKIPPED' | 'FAILED';
  error?: string;
}

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
// Endpoint de carga: admite mensajes de hasta 35 MB (adjuntos PDF incluidos)
const SEND_URL = 'https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media';

/**
 * Envío de correo con la API de Gmail sobre HTTPS (OAuth2 con refresh token).
 * No usa SMTP, por lo que funciona aunque el hosting bloquee los puertos de correo.
 * Nunca lanza excepciones: el resultado queda en notification_logs.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private accessToken: { value: string; expiresAt: number } | null = null;
  private warnedUnconfigured = false;

  // Solo arma el mensaje MIME; el envío lo hace la API de Gmail
  private readonly composer = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'windows' });

  constructor(private readonly prisma: PrismaService) {}

  isConfigured(): boolean {
    return (
      process.env.MAIL_ENABLED !== 'false' &&
      !!process.env.GMAIL_CLIENT_ID &&
      !!process.env.GMAIL_CLIENT_SECRET &&
      !!process.env.GMAIL_REFRESH_TOKEN &&
      !!process.env.GMAIL_SENDER
    );
  }

  async send(mail: OutgoingMail): Promise<MailResult> {
    if (!this.isConfigured()) {
      if (!this.warnedUnconfigured) {
        this.logger.warn('Envío de correos deshabilitado: faltan las variables GMAIL_* o MAIL_ENABLED=false.');
        this.warnedUnconfigured = true;
      }
      return { status: 'SKIPPED', error: 'El envío de correos no está configurado.' };
    }

    if (mail.dedupeKey) {
      const previous = await this.prisma.notificationLog.findUnique({ where: { dedupeKey: mail.dedupeKey } });
      if (previous?.status === NotificationStatus.SENT) return { status: 'SKIPPED' };
    }

    let result: MailResult;
    try {
      const raw = await this.compose(mail);
      await this.deliver(raw);
      result = { status: 'SENT' };
      this.logger.log(`Correo "${mail.template}" enviado a ${mail.to}`);
    } catch (err: any) {
      result = { status: 'FAILED', error: String(err?.message || err).slice(0, 1000) };
      this.logger.error(`No se pudo enviar el correo "${mail.template}" a ${mail.to}: ${result.error}`);
    }

    await this.record(mail, result).catch((err) =>
      this.logger.error(`No se pudo registrar la notificación: ${err?.message || err}`),
    );
    return result;
  }

  private async compose(mail: OutgoingMail): Promise<Buffer> {
    const fromName = process.env.MAIL_FROM_NAME || process.env.PRODUCT_NAME || 'VELTOR';
    const info = await this.composer.sendMail({
      from: { name: fromName, address: process.env.GMAIL_SENDER! },
      to: mail.to,
      replyTo: process.env.MAIL_REPLY_TO || undefined,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      attachments: mail.attachments,
    });
    return info.message as Buffer;
  }

  private async deliver(raw: Buffer, retry = true): Promise<void> {
    const token = await this.getAccessToken();
    const res = await fetch(SEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'message/rfc822' },
      body: new Uint8Array(raw),
    });
    if (res.status === 401 && retry) {
      this.accessToken = null;
      return this.deliver(raw, false);
    }
    if (!res.ok) throw new Error(`Gmail API ${res.status}: ${await res.text()}`);
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && this.accessToken.expiresAt > Date.now() + 60_000) return this.accessToken.value;

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GMAIL_CLIENT_ID!,
        client_secret: process.env.GMAIL_CLIENT_SECRET!,
        refresh_token: process.env.GMAIL_REFRESH_TOKEN!,
        grant_type: 'refresh_token',
      }),
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok || !body.access_token) {
      throw new Error(`No se pudo obtener el token de Google (${res.status}): ${body.error_description || body.error || 'sin detalle'}`);
    }
    this.accessToken = { value: body.access_token, expiresAt: Date.now() + Number(body.expires_in || 3600) * 1000 };
    return this.accessToken.value;
  }

  private async record(mail: OutgoingMail, result: MailResult) {
    const data = {
      recipientEmail: mail.to,
      subject: mail.subject,
      templateName: mail.template,
      status: result.status === 'SENT' ? NotificationStatus.SENT : NotificationStatus.FAILED,
      errorMessage: result.error ?? null,
      sentAt: result.status === 'SENT' ? new Date() : null,
      loanId: mail.loanId ?? null,
    };
    if (mail.dedupeKey) {
      await this.prisma.notificationLog.upsert({
        where: { dedupeKey: mail.dedupeKey },
        create: { ...data, dedupeKey: mail.dedupeKey },
        update: data,
      });
    } else {
      await this.prisma.notificationLog.create({ data });
    }
  }
}

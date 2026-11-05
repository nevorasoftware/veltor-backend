import { Body, Controller, ForbiddenException, Get, Headers, HttpCode, HttpStatus, Param, Post, Query, Req, Request, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { UserRole } from '@prisma/client';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { Response } from 'express';
import { Public } from '../auth/public.decorator';
import { Roles } from '../auth/roles.decorator';
import { SkipTenant } from '../tenant/skip-tenant.decorator';
import { WhatsappInboxService } from './whatsapp-inbox.service';

export class ReplyDto {
  @IsString()
  @IsNotEmpty({ message: 'Escriba el mensaje.' })
  @MaxLength(4000)
  text!: string;
}

/** Webhook de Meta (WhatsApp Cloud API): verificación (GET) y eventos de mensajes y estados (POST). */
@ApiTags('WhatsApp: webhook')
@Controller('whatsapp/webhook')
export class WhatsappWebhookController {
  constructor(private readonly inbox: WhatsappInboxService) {}

  @Public()
  @SkipTenant()
  @SkipThrottle()
  @Get()
  @ApiOperation({ summary: 'Verificación del webhook (hub.challenge) con WHATSAPP_VERIFY_TOKEN' })
  verify(@Query('hub.mode') mode: string, @Query('hub.verify_token') token: string, @Query('hub.challenge') challenge: string, @Res() res: Response) {
    const expected = process.env.WHATSAPP_VERIFY_TOKEN;
    if (mode === 'subscribe' && expected && token === expected) return res.status(200).type('text/plain').send(challenge);
    return res.sendStatus(403);
  }

  @Public()
  @SkipTenant()
  @SkipThrottle()
  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mensajes entrantes y estados de entrega (firmados con X-Hub-Signature-256)' })
  async receive(@Req() req: any, @Headers('x-hub-signature-256') signature: string, @Body() body: any) {
    if (!this.inbox.verifySignature(req.rawBody, signature)) throw new ForbiddenException('Firma inválida');
    // Meta reintenta si no recibe 200 rápido: se procesa en segundo plano
    setImmediate(() => this.inbox.handleWebhook(body).catch(() => undefined));
    return { received: true };
  }
}

const STAFF = [UserRole.ADMIN, UserRole.CASHIER, UserRole.COLLECTIONS_AGENT];

@ApiTags('WhatsApp: bandeja')
@ApiBearerAuth()
@Roles(...STAFF)
@Controller('whatsapp/inbox')
export class WhatsappInboxController {
  constructor(private readonly inbox: WhatsappInboxService) {}

  @Get()
  @ApiOperation({ summary: 'Conversaciones de WhatsApp con clientes (una por teléfono)' })
  conversations() {
    return this.inbox.conversations();
  }

  @Get('unread')
  @ApiOperation({ summary: 'Cantidad de mensajes de clientes sin leer' })
  unread() {
    return this.inbox.unreadCount();
  }

  @Get('messages/:id/media')
  @ApiOperation({ summary: 'Adjunto de un mensaje (foto, PDF, audio…)' })
  async media(@Param('id') id: string, @Res() res: Response) {
    const f: any = await this.inbox.media(id);
    res.set({ 'Content-Type': f.mime, 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(f.name)}` });
    if (f.stream) return f.stream.pipe(res);
    return res.send(f.data);
  }

  @Get(':phone')
  @ApiOperation({ summary: 'Mensajes de una conversación (los marca como leídos)' })
  thread(@Param('phone') phone: string) {
    return this.inbox.thread(phone);
  }

  @Post(':phone/reply')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Responder por WhatsApp (solo dentro de las 24 h desde el último mensaje del cliente)' })
  reply(@Param('phone') phone: string, @Body() dto: ReplyDto, @Request() req: any) {
    return this.inbox.reply(phone, dto.text, req.user.id);
  }
}

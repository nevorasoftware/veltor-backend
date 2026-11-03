/**
 * Plantillas HTML de los correos. Diseño de tabla simple y estilos en línea para que se vea bien en
 * Gmail, Outlook y clientes móviles. Nombre, logo, colores, contactos, canales de pago, moneda y enlaces
 * salen de la empresa del contexto (TenantContext); la única leyenda fija es "Desarrollado por Nevora Software".
 */

import { TenantContext } from '../tenant/tenant-context';
import {
  PLATFORM_CREDIT,
  brandHasRasterLogo,
  brandName,
  brandPrimary,
  contactParts,
  formatMoney,
  paymentChannels,
} from '../tenant/company-branding';

const brand = brandName;

/** Content-ID del logo incrustado en el correo (MailService lo adjunta) */
export const MAIL_LOGO_CID = 'company-logo';

/** URL pública del frontend de la plataforma (FRONTEND_URL o, por compatibilidad, APP_PUBLIC_URL) */
export const frontendBaseUrl = () => (process.env.FRONTEND_URL || process.env.APP_PUBLIC_URL || '').replace(/\/+$/, '');

/**
 * Enlace al sitio de la empresa: su primer dominio o, si no tiene, la URL pública del frontend con
 * ?empresa=<slug> para que cargue la marca correcta. Sin ninguno de los dos no se incluyen enlaces.
 */
export function siteLink(path: string, params: Record<string, string> = {}): string | null {
  const c = TenantContext.company();
  const domain = c?.domains?.[0];
  const query = new URLSearchParams(params);
  let base: string;
  if (domain) base = `https://${domain}`;
  else {
    base = frontendBaseUrl();
    if (!base) return null;
    if (c?.slug) query.set('empresa', c.slug);
  }
  const qs = query.toString();
  return `${base}${path}${qs ? `?${qs}` : ''}`;
}

export interface RenderedMail {
  subject: string;
  html: string;
  text: string;
}

export const esc = (v: unknown) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Monto en la moneda y el formato de la empresa */
export const usd = (v: unknown) => formatMoney(v);

/** AAAA-MM-DD → DD/MM/AAAA sin pasar por zonas horarias */
export const dateSV = (d: string) => {
  const [y, m, day] = d.slice(0, 10).split('-');
  return `${day}/${m}/${y}`;
};

const firstName = (fullName: string) => fullName.trim().split(/\s+/)[0] || fullName;

type Row = [label: string, value: string];

function rowsTable(rows: Row[]) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:16px 0;font-size:14px">
${rows
  .map(
    ([label, value]) => `<tr>
  <td style="padding:8px 0;border-bottom:1px solid #E2E8F0;color:#64748B">${esc(label)}</td>
  <td style="padding:8px 0;border-bottom:1px solid #E2E8F0;color:#0F172A;font-weight:bold;text-align:right">${esc(value)}</td>
</tr>`,
  )
  .join('\n')}
</table>`;
}

function button(label: string, href: string) {
  return `<p style="margin:24px 0 8px"><a href="${esc(href)}" style="display:inline-block;background:${esc(brandPrimary())};color:#FFFFFF;text-decoration:none;font-weight:bold;font-size:14px;padding:12px 22px;border-radius:8px">${esc(label)}</a></p>`;
}

/** Logo (PNG/JPEG incrustado) o, si no hay, el nombre de la empresa */
function headerBrand() {
  return brandHasRasterLogo()
    ? `<img src="cid:${MAIL_LOGO_CID}" alt="${esc(brand())}" style="display:block;max-height:44px;max-width:220px;border:0">`
    : esc(brand());
}

function contactLine() {
  const parts = contactParts();
  return parts.length ? `Si tienes dudas, responde a este correo o contáctanos: ${parts.join(' · ')}.` : 'Si tienes dudas, responde a este correo.';
}

/** Cuentas y canales donde el cliente puede pagar (si la empresa los configuró) */
function paymentsBlock(): { html: string; text: string[] } {
  const rows = paymentChannels();
  if (!rows.length) return { html: '', text: [] };
  return {
    html: `<p style="margin:16px 0 0;font-weight:bold">Dónde pagar</p>${rowsTable(rows.map((r) => [r.label, r.value] as Row))}`,
    text: ['Dónde pagar:', ...rows.map((r) => `${r.label}: ${r.value}`)],
  };
}

function layout(title: string, bodyHtml: string) {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#F1F5F9;font-family:Arial,Helvetica,sans-serif;color:#0F172A">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F5F9;padding:24px 12px">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:12px;overflow:hidden">
    <tr><td style="background:${esc(brandPrimary())};padding:18px 24px;color:#FFFFFF;font-size:18px;font-weight:bold;letter-spacing:2px">${headerBrand()}</td></tr>
    <tr><td style="padding:24px;font-size:15px;line-height:1.55">
      <h1 style="margin:0 0 12px;font-size:20px;color:#0F172A">${esc(title)}</h1>
      ${bodyHtml}
    </td></tr>
    <tr><td style="padding:16px 24px;background:#F8FAFC;color:#94A3B8;font-size:11px;line-height:1.5">
      Este es un mensaje automático de ${esc(brand())}. ${esc(contactLine())}<br>
      ${esc(PLATFORM_CREDIT)}
    </td></tr>
  </table>
</td></tr>
</table>
</body></html>`;
}

function textOf(title: string, lines: string[], rows: Row[] = []) {
  const contacts = contactParts();
  return [title, '', ...lines, '', ...rows.map(([l, v]) => `${l}: ${v}`), '', `— ${brand()}`, ...(contacts.length ? [contacts.join(' · ')] : []), PLATFORM_CREDIT].join('\n');
}

function portalLink(): { html: string; text: string } {
  const url = siteLink('/portal');
  if (!url) return { html: '', text: '' };
  return { html: button('Ir a mi portal', url), text: `Portal del cliente: ${url}` };
}

/* ------------------------------------------------------------------ */

export function leadReceivedMail(p: { fullName: string; code: string; vehicle?: string | null; termMonths?: number | null }): RenderedMail {
  const title = 'Recibimos tu solicitud';
  const rows: Row[] = [['Número de solicitud', p.code]];
  if (p.vehicle) rows.push(['Vehículo de interés', p.vehicle]);
  if (p.termMonths) rows.push(['Plazo solicitado', `${p.termMonths} meses`]);
  const intro = `Hola ${firstName(p.fullName)}, gracias por tu interés en financiar tu vehículo con ${brand()}.`;
  const next = 'Un asesor revisará tu solicitud y se pondrá en contacto contigo pronto para continuar con el proceso.';
  return {
    subject: `${brand()}: recibimos tu solicitud ${p.code}`,
    html: layout(title, `<p>${esc(intro)}</p>${rowsTable(rows)}<p>${esc(next)}</p>`),
    text: textOf(title, [intro, next], rows),
  };
}

export function leadStaffAlertMail(p: {
  fullName: string;
  code: string;
  email: string | null;
  phone: string;
  vehicle?: string | null;
  message?: string | null;
}): RenderedMail {
  const title = `Nuevo prospecto ${p.code}`;
  const rows: Row[] = [
    ['Nombre', p.fullName],
    ['Correo', p.email || '(sin correo)'],
    ['Teléfono', p.phone],
  ];
  if (p.vehicle) rows.push(['Vehículo', p.vehicle]);
  const url = siteLink('/admin');
  return {
    subject: `${brand()}: nuevo prospecto ${p.code} — ${p.fullName}`,
    html: layout(
      title,
      `${rowsTable(rows)}${p.message ? `<p style="color:#475569"><b>Mensaje:</b> ${esc(p.message)}</p>` : ''}${url ? button('Abrir panel', url) : ''}`,
    ),
    text: textOf(title, p.message ? [`Mensaje: ${p.message}`] : [], rows),
  };
}

export function loanApprovedMail(p: {
  fullName: string;
  loanCode: string;
  vehicle: string;
  principal: string;
  installment: string;
  termCount: number;
  monthlyRate: string;
  firstDueDate: string;
}): RenderedMail {
  const title = '¡Tu crédito fue aprobado!';
  const rows: Row[] = [
    ['Número de crédito', p.loanCode],
    ['Vehículo', p.vehicle],
    ['Monto financiado', usd(p.principal)],
    ['Cuota mensual', usd(p.installment)],
    ['Plazo', `${p.termCount} meses`],
    ['Tasa mensual', `${(Number(p.monthlyRate) * 100).toFixed(2)}%`],
    ['Primera cuota', dateSV(p.firstDueDate)],
  ];
  const intro = `Hola ${firstName(p.fullName)}, tu crédito vehicular ha sido aprobado y activado. Estos son los datos principales:`;
  const note = 'Adjuntamos tu tabla de amortización en PDF. Te enviaremos un recordatorio antes de cada fecha de pago.';
  const portal = portalLink();
  return {
    subject: `${brand()}: tu crédito ${p.loanCode} fue aprobado`,
    html: layout(title, `<p>${esc(intro)}</p>${rowsTable(rows)}<p>${esc(note)}</p>${portal.html}`),
    text: textOf(title, [intro, note, portal.text].filter(Boolean), rows),
  };
}

export function loanApprovedStaffMail(p: {
  fullName: string;
  email: string | null;
  loanCode: string;
  vehicle: string;
  principal: string;
  installment: string;
  termCount: number;
  monthlyRate: string;
  firstDueDate: string;
}): RenderedMail {
  const title = `Crédito ${p.loanCode} aprobado`;
  const rows: Row[] = [
    ['Cliente', p.fullName],
    ['Correo', p.email || '(sin correo)'],
    ['Vehículo', p.vehicle],
    ['Monto financiado', usd(p.principal)],
    ['Cuota mensual', usd(p.installment)],
    ['Plazo', `${p.termCount} meses`],
    ['Tasa mensual', `${(Number(p.monthlyRate) * 100).toFixed(2)}%`],
    ['Primera cuota', dateSV(p.firstDueDate)],
  ];
  const url = siteLink('/admin');
  return {
    subject: `${brand()}: crédito ${p.loanCode} aprobado — ${p.fullName}`,
    html: layout(title, `${rowsTable(rows)}${url ? button('Abrir panel', url) : ''}`),
    text: textOf(title, [], rows),
  };
}

export function paymentReminderMail(p: {
  fullName: string;
  loanCode: string;
  installmentNumber: number;
  termCount: number;
  dueDate: string;
  amountDue: string;
  daysBefore: number;
}): RenderedMail {
  const when = p.daysBefore === 0 ? 'hoy' : p.daysBefore === 1 ? 'mañana' : `en ${p.daysBefore} días`;
  const title = p.daysBefore === 0 ? 'Tu cuota vence hoy' : 'Recordatorio de pago';
  const rows: Row[] = [
    ['Crédito', p.loanCode],
    ['Cuota', `${p.installmentNumber} de ${p.termCount}`],
    ['Fecha de vencimiento', dateSV(p.dueDate)],
    ['Monto a pagar', usd(p.amountDue)],
  ];
  const intro = `Hola ${firstName(p.fullName)}, te recordamos que tu cuota vence ${when}.`;
  const note = 'Si ya realizaste el pago, haz caso omiso de este mensaje. Pagar a tiempo evita recargos por mora.';
  const portal = portalLink();
  const pay = paymentsBlock();
  return {
    subject: `${brand()}: tu cuota ${p.installmentNumber} vence ${when} (${dateSV(p.dueDate)})`,
    html: layout(title, `<p>${esc(intro)}</p>${rowsTable(rows)}${pay.html}<p>${esc(note)}</p>${portal.html}`),
    text: textOf(title, [intro, ...pay.text, note, portal.text].filter(Boolean), rows),
  };
}

export function paymentOverdueMail(p: {
  fullName: string;
  loanCode: string;
  installmentNumber: number;
  termCount: number;
  dueDate: string;
  daysOverdue: number;
  graceDays: number;
  installmentBalance: string;
  lateFee: string;
  lateFeeRule: string | null;
  totalDue: string;
}): RenderedMail {
  const title = 'Tienes una cuota vencida';
  const rows: Row[] = [
    ['Crédito', p.loanCode],
    ['Cuota', `${p.installmentNumber} de ${p.termCount}`],
    ['Fecha de vencimiento', dateSV(p.dueDate)],
    ['Días de atraso', String(p.daysOverdue)],
    ['Saldo de la cuota', usd(p.installmentBalance)],
    ['Mora acumulada', usd(p.lateFee)],
    ['Total a pagar hoy', usd(p.totalDue)],
  ];
  const intro = `Hola ${firstName(p.fullName)}, tu cuota ${p.installmentNumber} venció el ${dateSV(p.dueDate)} y aún tiene saldo pendiente.`;
  const rule = p.lateFeeRule
    ? `Pasados los ${p.graceDays} días de gracia se aplica mora de ${p.lateFeeRule}, que se suma al saldo hasta que registres el pago.`
    : '';
  const note = 'Si ya realizaste el pago, haz caso omiso de este mensaje o envíanos tu comprobante.';
  const portal = portalLink();
  const pay = paymentsBlock();
  return {
    subject: `${brand()}: cuota ${p.installmentNumber} vencida — total a pagar ${usd(p.totalDue)}`,
    html: layout(
      title,
      `<p>${esc(intro)}</p>${rowsTable(rows)}${rule ? `<p>${esc(rule)}</p>` : ''}${pay.html}<p>${esc(note)}</p>${portal.html}`,
    ),
    text: textOf(title, [intro, rule, ...pay.text, note, portal.text].filter(Boolean), rows),
  };
}

export function paymentRegisteredMail(p: {
  fullName: string;
  loanCode: string;
  paymentCode: string;
  amount: string;
  effectiveDate: string;
  principalBalance: string;
  paidOff: boolean;
  next?: { number: number; dueDate: string; amount: string } | null;
}): RenderedMail {
  const title = p.paidOff ? '¡Crédito cancelado en su totalidad!' : 'Pago registrado';
  const rows: Row[] = [
    ['Crédito', p.loanCode],
    ['Comprobante', p.paymentCode],
    ['Monto recibido', usd(p.amount)],
    ['Fecha de pago', dateSV(p.effectiveDate)],
    ['Saldo de capital', usd(p.principalBalance)],
  ];
  if (!p.paidOff && p.next) {
    rows.push(['Próxima cuota', `${dateSV(p.next.dueDate)} — ${usd(p.next.amount)}`]);
  }
  const intro = p.paidOff
    ? `Hola ${firstName(p.fullName)}, registramos tu pago y tu crédito quedó cancelado por completo. ¡Gracias por tu confianza!`
    : `Hola ${firstName(p.fullName)}, registramos tu pago correctamente. Este es el detalle:`;
  const portal = portalLink();
  return {
    subject: `${brand()}: ${p.paidOff ? `crédito ${p.loanCode} cancelado` : `pago recibido ${usd(p.amount)}`}`,
    html: layout(title, `<p>${esc(intro)}</p>${rowsTable(rows)}${portal.html}`),
    text: textOf(title, [intro, portal.text].filter(Boolean), rows),
  };
}

export function accountStatementMail(p: { fullName: string; loanCode: string; asOf: string; principalBalance: string }): RenderedMail {
  const title = 'Tu estado de cuenta';
  const rows: Row[] = [
    ['Crédito', p.loanCode],
    ['Fecha de corte', dateSV(p.asOf)],
    ['Saldo de capital', usd(p.principalBalance)],
  ];
  const intro = `Hola ${firstName(p.fullName)}, adjuntamos el estado de cuenta de tu crédito en PDF.`;
  const portal = portalLink();
  return {
    subject: `${brand()}: estado de cuenta del crédito ${p.loanCode}`,
    html: layout(title, `<p>${esc(intro)}</p>${rowsTable(rows)}${portal.html}`),
    text: textOf(title, [intro, portal.text].filter(Boolean), rows),
  };
}

/** Acceso al panel para un usuario del personal creado desde la plataforma (p. ej. el primer administrador). */
export function staffAccessMail(p: {
  fullName: string;
  email: string;
  temporaryPassword: string;
  loginUrl?: string | null;
}): RenderedMail {
  const title = `Tu acceso a ${brand()}`;
  const rows: Row[] = [
    ['Empresa', brand()],
    ['Usuario', p.email],
    ['Contraseña temporal', p.temporaryPassword],
  ];
  const intro = `Hola ${firstName(p.fullName)}, se creó tu usuario de administrador de ${brand()}. Al ingresar por primera vez se te pedirá cambiar la contraseña temporal.`;
  const loginUrl = p.loginUrl ?? siteLink('/login');
  const link = loginUrl ? { html: button('Ingresar al panel', loginUrl), text: `Ingreso: ${loginUrl}` } : { html: '', text: '' };
  return {
    subject: `${brand()}: tu acceso de administrador`,
    html: layout(title, `<p>${esc(intro)}</p>${rowsTable(rows)}${link.html}`),
    text: textOf(title, [intro, link.text].filter(Boolean), rows),
  };
}

/** Enlace para restablecer la contraseña (vence en 1 hora) */
export function passwordResetMail(p: { fullName: string; url: string | null; minutes: number }): RenderedMail {
  const title = 'Restablece tu contraseña';
  const intro = `Hola ${firstName(p.fullName)}, recibimos una solicitud para restablecer la contraseña de tu cuenta en ${brand()}.`;
  const note = `El enlace vence en ${p.minutes} minutos y solo se puede usar una vez. Si no lo solicitaste, ignora este correo: tu contraseña no cambiará.`;
  const link = p.url ? { html: button('Restablecer contraseña', p.url), text: `Restablecer: ${p.url}` } : { html: '', text: '' };
  return {
    subject: `${brand()}: restablece tu contraseña`,
    html: layout(title, `<p>${esc(intro)}</p>${link.html}<p style="color:#64748B;font-size:13px">${esc(note)}</p>`),
    text: textOf(title, [intro, link.text, note].filter(Boolean)),
  };
}

/** Contraseña temporal del superadministrador de la plataforma (creado al arrancar) */
export function platformAccessMail(p: { email: string; temporaryPassword: string }): RenderedMail {
  const title = 'Acceso de superadministrador';
  const rows: Row[] = [
    ['Usuario', p.email],
    ['Contraseña temporal', p.temporaryPassword],
  ];
  const intro = 'Se creó el usuario superadministrador de la plataforma. Al ingresar se te pedirá cambiar la contraseña temporal.';
  const url = siteLink('/login');
  const link = url ? { html: button('Ingresar', url), text: `Ingreso: ${url}` } : { html: '', text: '' };
  return {
    subject: 'Plataforma: acceso de superadministrador',
    html: layout(title, `<p>${esc(intro)}</p>${rowsTable(rows)}${link.html}`),
    text: textOf(title, [intro, link.text].filter(Boolean), rows),
  };
}

/** Copia para los ADMIN de la empresa de un correo enviado al cliente */
export function adminCopyMail(p: { summary: string; customerEmail: string | null; original: RenderedMail }): RenderedMail {
  const title = p.summary;
  const intro = p.customerEmail
    ? `Copia para administración: se envió al cliente (${p.customerEmail}) el correo "${p.original.subject}".`
    : `Aviso para administración: el cliente no tiene correo registrado, así que no se le envió "${p.original.subject}". Este es el contenido:`;
  return {
    subject: `${brand()} [copia]: ${p.summary}`,
    html: layout(title, `<p>${esc(intro)}</p><pre style="white-space:pre-wrap;font-family:inherit;font-size:13px;color:#334155;background:#F8FAFC;padding:12px;border-radius:8px">${esc(p.original.text)}</pre>`),
    text: textOf(title, [intro, '', p.original.text]),
  };
}

export function testMail(): RenderedMail {
  const title = 'Correo de prueba';
  const line = `El envío de correos de ${brand()} funciona correctamente.`;
  return { subject: `${brand()}: correo de prueba`, html: layout(title, `<p>${esc(line)}</p>`), text: textOf(title, [line]) };
}

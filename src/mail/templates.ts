/**
 * Plantillas HTML de los correos de VELTOR. Diseño de tabla simple y estilos en línea
 * para que se vea bien en Gmail, Outlook y clientes móviles.
 */

const brand = () => process.env.PRODUCT_NAME || 'VELTOR';
const company = () => process.env.PRODUCT_COMPANY || 'Nevora Software';
const publicUrl = () => (process.env.APP_PUBLIC_URL || '').replace(/\/+$/, '');

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

export const usd = (v: unknown) =>
  new Intl.NumberFormat(process.env.APP_LOCALE || 'es-SV', { style: 'currency', currency: process.env.APP_CURRENCY || 'USD' }).format(
    Number(v) || 0,
  );

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
  return `<p style="margin:24px 0 8px"><a href="${esc(href)}" style="display:inline-block;background:#0F172A;color:#FFFFFF;text-decoration:none;font-weight:bold;font-size:14px;padding:12px 22px;border-radius:8px">${esc(label)}</a></p>`;
}

function layout(title: string, bodyHtml: string) {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#F1F5F9;font-family:Arial,Helvetica,sans-serif;color:#0F172A">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F5F9;padding:24px 12px">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:12px;overflow:hidden">
    <tr><td style="background:#0B132B;padding:18px 24px;color:#FFFFFF;font-size:18px;font-weight:bold;letter-spacing:2px">${esc(brand())}</td></tr>
    <tr><td style="padding:24px;font-size:15px;line-height:1.55">
      <h1 style="margin:0 0 12px;font-size:20px;color:#0F172A">${esc(title)}</h1>
      ${bodyHtml}
    </td></tr>
    <tr><td style="padding:16px 24px;background:#F8FAFC;color:#94A3B8;font-size:11px;line-height:1.5">
      Este es un mensaje automático de ${esc(brand())}. Si tienes dudas, responde a este correo o comunícate con tu asesor.<br>
      ${esc(brand())} — Una solución tecnológica de ${esc(company())}
    </td></tr>
  </table>
</td></tr>
</table>
</body></html>`;
}

function textOf(title: string, lines: string[], rows: Row[] = []) {
  return [title, '', ...lines, '', ...rows.map(([l, v]) => `${l}: ${v}`), '', `— ${brand()}`].join('\n');
}

function portalLink(): { html: string; text: string } {
  const url = publicUrl();
  if (!url) return { html: '', text: '' };
  return { html: button('Ir a mi portal', `${url}/portal`), text: `Portal del cliente: ${url}/portal` };
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
  email: string;
  phone: string;
  vehicle?: string | null;
  message?: string | null;
}): RenderedMail {
  const title = `Nuevo prospecto ${p.code}`;
  const rows: Row[] = [
    ['Nombre', p.fullName],
    ['Correo', p.email],
    ['Teléfono', p.phone],
  ];
  if (p.vehicle) rows.push(['Vehículo', p.vehicle]);
  const url = publicUrl();
  return {
    subject: `${brand()}: nuevo prospecto ${p.code} — ${p.fullName}`,
    html: layout(
      title,
      `${rowsTable(rows)}${p.message ? `<p style="color:#475569"><b>Mensaje:</b> ${esc(p.message)}</p>` : ''}${url ? button('Abrir panel', `${url}/admin`) : ''}`,
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
  email: string;
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
    ['Correo', p.email],
    ['Vehículo', p.vehicle],
    ['Monto financiado', usd(p.principal)],
    ['Cuota mensual', usd(p.installment)],
    ['Plazo', `${p.termCount} meses`],
    ['Tasa mensual', `${(Number(p.monthlyRate) * 100).toFixed(2)}%`],
    ['Primera cuota', dateSV(p.firstDueDate)],
  ];
  const url = publicUrl();
  return {
    subject: `${brand()}: crédito ${p.loanCode} aprobado — ${p.fullName}`,
    html: layout(title, `${rowsTable(rows)}${url ? button('Abrir panel', `${url}/admin`) : ''}`),
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
  return {
    subject: `${brand()}: tu cuota ${p.installmentNumber} vence ${when} (${dateSV(p.dueDate)})`,
    html: layout(title, `<p>${esc(intro)}</p>${rowsTable(rows)}<p>${esc(note)}</p>${portal.html}`),
    text: textOf(title, [intro, note, portal.text].filter(Boolean), rows),
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

export function testMail(): RenderedMail {
  const title = 'Correo de prueba';
  const line = `La configuración de envío de correos de ${brand()} con Gmail funciona correctamente.`;
  return { subject: `${brand()}: correo de prueba`, html: layout(title, `<p>${esc(line)}</p>`), text: textOf(title, [line]) };
}

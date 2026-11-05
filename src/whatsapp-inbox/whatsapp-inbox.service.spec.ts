import { createHmac } from 'crypto';
import { TenantContext } from '../tenant/tenant-context';
import { WhatsappInboxService, describeIncoming } from './whatsapp-inbox.service';

const companyA = { id: 'A', slug: 'veltor', name: 'Veltor', isDefault: true, isActive: true };
const companyB = { id: 'B', slug: 'otra', name: 'Otra', isDefault: false, isActive: true };

function setup(customers: any[]) {
  const messages: any[] = [];
  const seenCompanies: (string | null | undefined)[] = [];
  const prisma: any = {
    customer: { findUnique: async ({ where }: any) => customers.find((c) => c.id === where.id) ?? null },
    whatsappMessage: {
      findFirst: async ({ where }: any) =>
        messages.filter((m) => m.phone === where.phone && m.direction === where.direction && m.companyId === TenantContext.companyId()).sort((a, b) => +b.timestamp - +a.timestamp)[0] ?? null,
      create: async ({ data }: any) => {
        seenCompanies.push(TenantContext.companyId());
        const m = { id: `m${messages.length + 1}`, companyId: TenantContext.companyId(), ...data };
        messages.push(m);
        return m;
      },
      update: async () => null,
    },
    unscoped: {
      customer: { findMany: async () => customers },
      company: {
        findFirst: async () => companyA,
        findUnique: async ({ where }: any) => [companyA, companyB].find((c) => c.id === where.id) ?? null,
      },
      whatsappMessage: {
        findUnique: async ({ where }: any) => messages.find((m) => m.waMessageId === where.waMessageId) ?? null,
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
    },
  };
  const whatsapp: any = {
    sendText: jest.fn(async (to: string) => ({ status: 'SENT', to, messageId: 'out1' })),
    recordOutgoing: jest.fn(async () => undefined),
    downloadMedia: jest.fn(async () => ({ data: Buffer.from('x'), mime: 'image/jpeg' })),
  };
  const documents: any = { uploadCustomerDocument: jest.fn(async () => ({ id: 'doc1' })) };
  const events: any = { emit: jest.fn() };
  const svc = new WhatsappInboxService(prisma, whatsapp, documents, events);
  return { svc, messages, seenCompanies, whatsapp, documents, events, prisma };
}

const hook = (msgs: any[], name = 'Juan') => ({
  entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: 'P1' }, contacts: [{ wa_id: msgs[0].from, profile: { name } }], messages: msgs } }] }],
});
const text = (id: string, from: string, body: string, ts = 1_762_300_000) => ({ id, from, timestamp: String(ts), type: 'text', text: { body } });

describe('WhatsappInboxService', () => {
  beforeAll(() => (process.env.WHATSAPP_PHONE_ID = 'P1'));

  it('valida la firma X-Hub-Signature-256 con el App Secret', () => {
    process.env.WHATSAPP_APP_SECRET = 'secreto';
    const { svc } = setup([]);
    const raw = Buffer.from('{"a":1}');
    const sig = 'sha256=' + createHmac('sha256', 'secreto').update(raw).digest('hex');
    expect(svc.verifySignature(raw, sig)).toBe(true);
    expect(svc.verifySignature(raw, 'sha256=' + '0'.repeat(64))).toBe(false);
    expect(svc.verifySignature(raw, undefined)).toBe(false);
    delete process.env.WHATSAPP_APP_SECRET;
    expect(svc.verifySignature(raw, sig)).toBe(false); // sin secreto configurado se rechaza
  });

  it('interpreta los tipos de mensaje', () => {
    expect(describeIncoming({ type: 'text', text: { body: 'hola' } }).body).toBe('hola');
    expect(describeIncoming({ type: 'image', image: { id: 'M1', mime_type: 'image/jpeg', caption: 'comprobante' } })).toEqual({ body: 'comprobante', mediaId: 'M1', mediaMime: 'image/jpeg', mediaName: undefined });
    expect(describeIncoming({ type: 'location', location: { latitude: 13.7, longitude: -89.2 } }).body).toContain('maps.google.com/?q=13.7,-89.2');
    expect(describeIncoming({ type: 'interactive', interactive: { button_reply: { title: 'Sí' } } }).body).toBe('Sí');
  });

  it('asigna el mensaje a la empresa del cliente, avisa una vez, responde el acuse y no duplica reintentos', async () => {
    const customers = [
      { id: 'c-old', companyId: 'A', phone: '7733-6035', fullName: 'Juan Garcia', createdAt: new Date('2026-01-01'), loans: [] },
      { id: 'c-B', companyId: 'B', phone: '77336035', fullName: 'Juan Garcia', createdAt: new Date('2026-02-01'), loans: [{ id: 'L' }] },
    ];
    const t = setup(customers);
    await t.svc.handleWebhook(hook([text('w1', '50377336035', 'Hola, ya pagué')]));
    expect(t.messages).toHaveLength(1);
    expect(t.seenCompanies).toEqual(['B']); // el cliente con crédito activo manda
    expect(t.messages[0]).toMatchObject({ customerId: 'c-B', direction: 'IN', body: 'Hola, ya pagué', profileName: 'Juan', phone: '50377336035' });
    expect(t.events.emit).toHaveBeenCalledWith('whatsapp.received', { messageId: 'm1' });
    expect(t.whatsapp.sendText).toHaveBeenCalledTimes(1);
    expect(t.whatsapp.sendText.mock.calls[0][1]).toMatch(/^Hola Juan, gracias por escribir a Otra/);

    // Reintento del mismo evento: no se guarda dos veces
    await t.svc.handleWebhook(hook([text('w1', '50377336035', 'Hola, ya pagué')]));
    expect(t.messages).toHaveLength(1);

    // Segundo mensaje 5 minutos después: sin aviso ni acuse nuevos
    await t.svc.handleWebhook(hook([text('w2', '50377336035', '¿Me confirman?', 1_762_300_300)]));
    expect(t.messages).toHaveLength(2);
    expect(t.events.emit).toHaveBeenCalledTimes(1);
    expect(t.whatsapp.sendText).toHaveBeenCalledTimes(1);
  });

  it('un número desconocido va a la empresa por defecto y la foto de un cliente se archiva en su expediente', async () => {
    const t = setup([{ id: 'c1', companyId: 'A', phone: '61489595', fullName: 'Ana Perez', createdAt: new Date(), loans: [{ id: 'L' }] }]);
    await t.svc.handleWebhook(hook([text('w9', '50370000000', 'info')]));
    expect(t.seenCompanies).toEqual(['A']);
    expect(t.messages[0].customerId).toBeNull();

    await t.svc.handleWebhook(hook([{ id: 'w10', from: '50361489595', timestamp: '1762300000', type: 'image', image: { id: 'MED', mime_type: 'image/jpeg', caption: 'comprobante' } }]));
    expect(t.documents.uploadCustomerDocument).toHaveBeenCalledWith(expect.objectContaining({ customerId: 'c1', category: 'OTHER' }), expect.objectContaining({ mimetype: 'image/jpeg' }));
  });

  it('ignora eventos de otro número y actualiza estados de entrega', async () => {
    const t = setup([]);
    await t.svc.handleWebhook({ entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: 'OTRO' }, messages: [text('x', '50377336035', 'hola')] } }] }] });
    expect(t.messages).toHaveLength(0);
    await t.svc.handleWebhook({ entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: 'P1' }, statuses: [{ id: 'out1', status: 'read' }] } }] }] });
    expect(t.prisma.unscoped.whatsappMessage.updateMany).toHaveBeenCalledWith({ where: { waMessageId: 'out1', direction: 'OUT' }, data: { status: 'READ' } });
  });
});

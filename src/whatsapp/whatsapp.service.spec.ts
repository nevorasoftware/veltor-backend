import { cleanParam, normalizeWhatsappPhone } from './whatsapp.service';

describe('normalizeWhatsappPhone', () => {
  it.each([
    ['61489595', '50361489595'],
    ['7008-4448', '50370084448'],
    ['2222 3333', '50322223333'],
    ['+503 6148 9595', '50361489595'],
    ['50375262437', '50375262437'],
    ['+1 (305) 555-0100', '13055550100'],
  ])('%s → %s', (raw, out) => expect(normalizeWhatsappPhone(raw)).toBe(out));

  it.each([null, undefined, '', '1234', '51489595', '0050361489595'])('rechaza %p', (raw) =>
    expect(normalizeWhatsappPhone(raw as any)).toBeNull(),
  );
});

describe('cleanParam', () => {
  it('quita saltos de línea y espacios repetidos', () => expect(cleanParam('a\nb\t c      d')).toBe('a b  c   d'));
  it('nunca envía una variable vacía', () => expect(cleanParam('  ')).toBe('-'));
});

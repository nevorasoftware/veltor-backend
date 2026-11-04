import { BadRequestException } from '@nestjs/common';
import { PwaController, frontendOrigin } from './pwa.controller';

describe('frontendOrigin', () => {
  it('acepta https y quita la ruta', () => expect(frontendOrigin('https://veltor.up.railway.app/login?x=1')).toBe('https://veltor.up.railway.app'));
  it('acepta http solo en localhost', () => expect(frontendOrigin('http://localhost:5173')).toBe('http://localhost:5173'));
  it.each(['http://evil.com', 'javascript:alert(1)', '', undefined])('rechaza %p', (v) =>
    expect(() => frontendOrigin(v as any)).toThrow(BadRequestException),
  );
});

describe('PwaController.manifest', () => {
  const company = { slug: 'veltor', name: 'VELTOR', tagline: null, locale: 'es-SV', primaryColor: '#0f172a', domains: ['autos.example.com'] };
  const ctrl = new PwaController({ resolvePublic: jest.fn().mockResolvedValue(company) } as any);

  it('en el dominio compartido la URL de inicio lleva la empresa', async () => {
    const m: any = await ctrl.manifest('veltor', 'https://veltor.up.railway.app');
    expect(m.start_url).toBe('https://veltor.up.railway.app/app?empresa=veltor');
    expect(m.scope).toBe('https://veltor.up.railway.app/');
    expect(m.name).toBe('VELTOR');
    expect(m.icons.map((i: any) => i.sizes)).toEqual(['192x192', '512x512', '512x512']);
  });

  it('en el dominio propio de la empresa no hace falta ?empresa', async () => {
    const m: any = await ctrl.manifest(undefined, 'https://autos.example.com');
    expect(m.start_url).toBe('https://autos.example.com/app');
  });
});

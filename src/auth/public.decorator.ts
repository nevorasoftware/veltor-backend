import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
/** Marca un endpoint como accesible sin token (catálogo, simulador, captación de leads). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/public.decorator';
import { Roles } from '../auth/roles.decorator';
import { SkipTenant } from '../tenant/skip-tenant.decorator';
import { CompaniesService } from './companies.service';
import {
  CompanyAdminDto,
  CompanyStatusDto,
  CreateCompanyDto,
  LogoDto,
  UpdateOwnCompanyDto,
  UpdatePlatformCompanyDto,
} from './company.dto';

/** Administración de empresas de la plataforma: solo SUPERADMIN (no requiere X-Company-Id). */
@ApiTags('Plataforma: Empresas')
@ApiBearerAuth()
@Roles(UserRole.SUPERADMIN)
@Controller('platform/companies')
export class PlatformCompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  @Get()
  @ApiOperation({ summary: 'Listar las empresas de la plataforma' })
  list() {
    return this.companies.list();
  }

  @Post()
  @ApiOperation({ summary: 'Crear una empresa, su producto financiero por defecto y su primer administrador' })
  create(@Body() dto: CreateCompanyDto) {
    return this.companies.create(dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalle de una empresa y sus administradores' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.companies.get(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Editar marca, contactos, slug, dominios o empresa por defecto' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePlatformCompanyDto) {
    return this.companies.update(id, dto);
  }

  @Put(':id/logo')
  @ApiOperation({ summary: 'Cargar el logo (PNG, JPEG, WEBP o SVG; máximo 1 MB)' })
  setLogo(@Param('id', ParseUUIDPipe) id: string, @Body() dto: LogoDto) {
    return this.companies.setLogo(id, dto);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Activar o desactivar una empresa' })
  setStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CompanyStatusDto) {
    return this.companies.setStatus(id, dto.isActive);
  }

  @Post(':id/admins')
  @ApiOperation({ summary: 'Crear un administrador de la empresa y enviarle el acceso por correo' })
  addAdmin(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CompanyAdminDto) {
    return this.companies.addAdmin(id, dto);
  }
}

/** La empresa del usuario autenticado (marca y contactos). */
@ApiTags('Mi Empresa')
@ApiBearerAuth()
@Roles(UserRole.ADMIN)
@Controller('company')
export class CompanyController {
  constructor(private readonly companies: CompaniesService) {}

  @Get()
  @ApiOperation({ summary: 'Datos de marca y contacto de mi empresa' })
  get() {
    return this.companies.getCurrent();
  }

  @Patch()
  @ApiOperation({ summary: 'Editar la marca y los contactos de mi empresa (no slug, estado ni dominios)' })
  update(@Body() dto: UpdateOwnCompanyDto) {
    return this.companies.updateCurrent(dto);
  }

  @Put('logo')
  @ApiOperation({ summary: 'Cargar el logo de mi empresa (PNG, JPEG, WEBP o SVG; máximo 1 MB)' })
  setLogo(@Body() dto: LogoDto) {
    return this.companies.setCurrentLogo(dto);
  }
}

@ApiTags('Público: Empresa')
@Controller('public')
export class PublicCompanyController {
  constructor(private readonly companies: CompaniesService) {}

  @Public()
  @Get('tenant')
  @ApiOperation({ summary: 'Empresa resuelta para esta petición (X-Tenant, dominio o la empresa por defecto)' })
  tenant() {
    return this.companies.publicTenant();
  }

  @Public()
  @SkipTenant()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Get('companies/:slug/logo')
  @ApiProduces('image/png', 'image/jpeg', 'image/webp', 'image/svg+xml')
  @ApiOperation({ summary: 'Logo de una empresa (público, con caché)' })
  async logo(@Param('slug') slug: string, @Req() req: Request, @Res() res: Response) {
    const logo = await this.companies.logoBySlug(slug);
    const etag = `"${slug}-${logo.updatedAt?.getTime() ?? 0}"`;
    res.set({
      'Content-Type': logo.mime,
      'Cache-Control': req.query.v ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
      ETag: etag,
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'X-Content-Type-Options': 'nosniff',
      // Un SVG abierto directamente no puede ejecutar código
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    });
    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }
    res.end(logo.data);
  }
}

import { PrismaClient, UserRole, PersonType, VehicleStatus, VehicleTransmission, VehicleFuel, AmortizationMethod, DayCountBasis, PaymentFrequency, LeadSource, LeadStatus, ApplicationStatus, LoanStatus, PaymentKind, PaymentMethod, AllocationConcept } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  console.log('--- Iniciando Seed de Base de Datos VELTOR ---');

  // 1. Usuarios con roles (contraseña para todos en entorno dev: Veltor2026!)
  const passwordHash = await argon2.hash('Veltor2026!');

  const usersData = [
    {
      email: 'admin@veltor.app',
      fullName: 'Carlos Mendoza',
      role: UserRole.SUPERADMIN,
      phone: '7000-0001',
    },
    {
      email: 'ejecutivo@veltor.app',
      fullName: 'Sofía Rodríguez',
      role: UserRole.COMMERCIAL_AGENT,
      phone: '7000-0002',
    },
    {
      email: 'analista@veltor.app',
      fullName: 'Guillermo Hernández',
      role: UserRole.CREDIT_ANALYST,
      phone: '7000-0003',
    },
    {
      email: 'aprobador@veltor.app',
      fullName: 'Mariana Valencia',
      role: UserRole.APPROVAL_OFFICER,
      phone: '7000-0004',
    },
    {
      email: 'cajero@veltor.app',
      fullName: 'Ricardo Peña',
      role: UserRole.CASHIER,
      phone: '7000-0005',
    },
    {
      email: 'cobranza@veltor.app',
      fullName: 'Beatriz Morales',
      role: UserRole.COLLECTIONS_AGENT,
      phone: '7000-0006',
    },
    {
      email: 'auditor@veltor.app',
      fullName: 'Ernesto Zelaya',
      role: UserRole.AUDITOR,
      phone: '7000-0007',
    },
  ];

  const createdUsers: Record<string, string> = {};
  for (const u of usersData) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: {
        email: u.email,
        fullName: u.fullName,
        role: u.role,
        phone: u.phone,
        passwordHash,
        isActive: true,
      },
    });
    createdUsers[u.role] = user.id;
  }
  console.log('✔ Usuarios por rol creados');

  // 2. Producto Financiero
  const standardProduct = await prisma.financingProduct.upsert({
    where: { code: 'PROD-AUTO-ESTANDAR' },
    update: {},
    create: {
      code: 'PROD-AUTO-ESTANDAR',
      name: 'Crédito Vehicular Estándar VELTOR',
      description: 'Financiamiento ágil para sedanes y SUVs con tasas competitivas y cuotas niveladas.',
      minMonthlyRate: 0.0120, // 1.20% mensual
      maxMonthlyRate: 0.0220, // 2.20% mensual
      defaultMonthlyRate: 0.0150, // 1.50% mensual (18% anual)
      minTermMonths: 12,
      maxTermMonths: 72,
      minDownPercent: 15.00,
      dayCountBasis: DayCountBasis.D30_360,
      method: AmortizationMethod.FRENCH,
      graceDays: 5,
      lateRateMonthly: 0.0300, // 3% mensual sobre mora
      isActive: true,
    },
  });
  console.log('✔ Producto financiero configurado');

  // 3. Catálogo de Vehículos
  const vehiclesData = [
    {
      code: 'VEH-0001',
      brand: 'Toyota',
      model: 'Corolla LE',
      year: 2023,
      version: 'LE Sedan',
      type: 'Sedán',
      transmission: VehicleTransmission.AUTOMATIC,
      fuel: VehicleFuel.GASOLINE,
      engineCc: 1800,
      mileageKm: 24500,
      color: 'Gris Grafito',
      passengers: 5,
      description: 'Excelente estado, único dueño, mantenimiento en agencia. Equipado con Toyota Safety Sense, cámara de retroceso y conectividad Apple CarPlay / Android Auto.',
      features: ['Apple CarPlay / Android Auto', 'Cámara de reversa', 'Sensores de punto ciego', 'Frenado autónomo de emergencia', 'Rines de aluminio 16"'],
      salePrice: 19800.00,
      minDownPayment: 2970.00, // 15%
      status: VehicleStatus.AVAILABLE,
      isPublished: true,
      images: [
        { url: 'https://images.unsplash.com/photo-1621007947382-bb3c3994e3fb?auto=format&fit=crop&w=1200&q=80', isPrimary: true, sortOrder: 0, caption: 'Vista exterior frontal' },
        { url: 'https://images.unsplash.com/photo-1552519507-da3b142c6e3d?auto=format&fit=crop&w=1200&q=80', isPrimary: false, sortOrder: 1, caption: 'Perfil lateral' },
      ],
    },
    {
      code: 'VEH-0002',
      brand: 'Honda',
      model: 'CR-V EX',
      year: 2022,
      version: 'EX AWD',
      type: 'SUV',
      transmission: VehicleTransmission.AUTOMATIC,
      fuel: VehicleFuel.GASOLINE,
      engineCc: 1500,
      mileageKm: 38200,
      color: 'Azul Noche Perlado',
      passengers: 5,
      description: 'Camioneta familiar espaciosa y económica gracias a su motor 1.5L Turbo. Techo corredizo, asientos eléctricos y sistema Honda Sensing.',
      features: ['Sunroof panorámico', 'Tracción AWD', 'Arranque por botón', 'Climatizador bizona', 'Rines 18"'],
      salePrice: 26500.00,
      minDownPayment: 3975.00,
      status: VehicleStatus.AVAILABLE,
      isPublished: true,
      images: [
        { url: 'https://images.unsplash.com/photo-1568605117036-5fe5e7bab0b7?auto=format&fit=crop&w=1200&q=80', isPrimary: true, sortOrder: 0, caption: 'Frontal CR-V' },
      ],
    },
    {
      code: 'VEH-0003',
      brand: 'Nissan',
      model: 'Frontier PRO-4X',
      year: 2024,
      version: 'PRO-4X 4x4',
      type: 'Pickup',
      transmission: VehicleTransmission.AUTOMATIC,
      fuel: VehicleFuel.DIESEL,
      engineCc: 2500,
      mileageKm: 9800,
      color: 'Gris Volcánico',
      passengers: 5,
      description: 'Poderoso pickup todoterreno listo para trabajo y recreación. Tracción 4x4 con bloqueo de diferencial trasero, cámara 360 y suspensión todoterreno.',
      features: ['Tracción 4x4 con reductora', 'Cámara de visión 360°', 'Asientos de cuero con logo PRO-4X', 'Estribos laterales', 'Capota de batea'],
      salePrice: 38900.00,
      minDownPayment: 5835.00,
      status: VehicleStatus.AVAILABLE,
      isPublished: true,
      images: [
        { url: 'https://images.unsplash.com/photo-1533473359331-0135ef1b58bf?auto=format&fit=crop&w=1200&q=80', isPrimary: true, sortOrder: 0, caption: 'Pickup Frontier' },
      ],
    },
    {
      code: 'VEH-0004',
      brand: 'Mazda',
      model: 'CX-5 Grand Touring',
      year: 2023,
      version: 'Grand Touring',
      type: 'SUV',
      transmission: VehicleTransmission.AUTOMATIC,
      fuel: VehicleFuel.GASOLINE,
      engineCc: 2500,
      mileageKm: 21000,
      color: 'Blanco Nieve',
      passengers: 5,
      description: 'Lujo, elegancia y dinamismo con tecnología SkyActiv. Sonido Bose con 10 bocinas, tapicería en cuero y compuerta trasera eléctrica.',
      features: ['Sistema de sonido Bose', 'Head-up Display', 'Faros adaptativos LED', 'Tapicería en cuero legítimo'],
      salePrice: 27900.00,
      minDownPayment: 4185.00,
      status: VehicleStatus.RESERVED,
      isPublished: true,
      images: [
        { url: 'https://images.unsplash.com/photo-1549399542-7e3f8b79c341?auto=format&fit=crop&w=1200&q=80', isPrimary: true, sortOrder: 0, caption: 'Mazda CX-5' },
      ],
    },
  ];

  const createdVehicles: Record<string, string> = {};
  for (const v of vehiclesData) {
    const { images, ...vData } = v;
    const vehicle = await prisma.vehicle.upsert({
      where: { code: v.code },
      update: {},
      create: {
        ...vData,
        images: {
          create: images,
        },
      },
    });
    createdVehicles[v.code] = vehicle.id;
  }
  console.log('✔ Vehículos de catálogo registrados');

  // 4. Clientes de demostración
  const customerDemo = await prisma.customer.upsert({
    where: { email: 'cliente.demo@veltor.app' },
    update: {},
    create: {
      code: 'CLI-00001',
      personType: PersonType.NATURAL,
      fullName: 'Alejandro Morales Rivera',
      dui: '04829104-5',
      nit: '0614-250892-102-3',
      birthDate: new Date('1992-08-25'),
      phone: '7744-8899',
      email: 'cliente.demo@veltor.app',
      address: 'Colonia Escalón, Calle El Mirador #142',
      municipality: 'San Salvador Centro',
      department: 'San Salvador',
      economicActivity: 'Servicios Profesionales / IT',
      employerName: 'Soluciones Digitales Tech SV',
      monthlyIncome: 2800.00,
      declaredDebts: 350.00,
      status: CustomerStatus.ACTIVE,
      internalNotes: 'Cliente con excelente historial de ingresos, comprobantes validados.',
    },
  });

  // Usuario portal cliente
  await prisma.user.upsert({
    where: { email: 'cliente.demo@veltor.app' },
    update: {},
    create: {
      email: 'cliente.demo@veltor.app',
      fullName: 'Alejandro Morales Rivera',
      role: UserRole.CUSTOMER,
      phone: '7744-8899',
      passwordHash,
      isActive: true,
      customerId: customerDemo.id,
    },
  });
  console.log('✔ Cliente y credencial del portal cliente creados');

  // 5. Crédito Formalizado de Demostración
  const loanCode = 'CRE-2026-0001';
  const existingLoan = await prisma.loan.findUnique({ where: { code: loanCode } });
  if (!existingLoan) {
    const loan = await prisma.loan.create({
      data: {
        code: loanCode,
        customerId: customerDemo.id,
        vehicleId: createdVehicles['VEH-0001'],
        productId: standardProduct.id,
        vehiclePrice: 19800.00,
        downPayment: 3800.00,
        financedFees: 0.00,
        originalPrincipal: 16000.00,
        currentPrincipalBalance: 16000.00,
        monthlyRate: 0.0150, // 1.5%
        termCount: 36,
        frequency: PaymentFrequency.MONTHLY,
        dayCount: DayCountBasis.D30_360,
        method: AmortizationMethod.FRENCH,
        graceDays: 5,
        lateRateMonthly: 0.0300,
        disbursementDate: new Date('2026-01-01'),
        firstDueDate: new Date('2026-02-01'),
        status: LoanStatus.ACTIVE,
      },
    });

    // Versión original de contrato
    await prisma.loanContractVersion.create({
      data: {
        loanId: loan.id,
        versionIndex: 0,
        reason: 'ORIGINAL',
        effectiveDate: new Date('2026-01-01'),
        principalBalance: 16000.00,
        monthlyRate: 0.0150,
        levelPayment: 578.43,
      },
    });

    console.log('✔ Crédito formalizado y tabla de amortización base registrados');
  }

  // 6. Prospecto (Lead) de prueba
  await prisma.lead.upsert({
    where: { code: 'PROS-2026-0001' },
    update: {},
    create: {
      code: 'PROS-2026-0001',
      fullName: 'María Elena Salazar',
      phone: '7921-3344',
      email: 'maria.salazar@example.com',
      message: 'Me interesa cotizar la Honda CR-V con una prima de $5,000 a 48 meses.',
      source: LeadSource.CATALOG_REQUEST,
      status: LeadStatus.NEW,
      vehicleId: createdVehicles['VEH-0002'],
      estimatedDown: 5000.00,
      termMonths: 48,
    },
  });
  console.log('✔ Prospecto inicial registrado');

  console.log('=== Seed VELTOR completado exitosamente ===');
}

main()
  .catch((e) => {
    console.error('Error durante el seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

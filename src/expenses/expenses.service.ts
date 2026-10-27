import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ExpenseCategoryType, ExpenseStatus } from '@prisma/client';
import { CreateExpenseDto, UpdateExpenseDto, QueryExpenseDto } from './dto/expense.dto';
import Decimal from 'decimal.js';

export interface ExpenseRecord {
  id: string;
  code: string;
  concept: string;
  categoryType: ExpenseCategoryType;
  subcategory: string | null;
  amount: number;
  quantity: number;
  unitPrice: number;
  expenseDate: string;
  provider: string | null;
  invoiceNumber: string | null;
  paymentMethod: string | null;
  status: ExpenseStatus;
  notes: string | null;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class ExpensesService {
  private readonly logger = new Logger(ExpensesService.name);

  // Fallback en memoria con datos iniciales demostrativos de productos y servicios
  private memoryExpenses: ExpenseRecord[] = [
    {
      id: 'exp-1',
      code: 'GST-2026-0001',
      concept: 'Kit de 4 Llantas Michelin 215/55 R17',
      categoryType: ExpenseCategoryType.PRODUCT,
      subcategory: 'Repuestos e Insumos',
      amount: 480.0,
      quantity: 4,
      unitPrice: 120.0,
      expenseDate: '2026-10-15',
      provider: 'Distribuidora Automotriz Salvadoreña S.A.',
      invoiceNumber: 'FAC-001294',
      paymentMethod: 'TRANSFER',
      status: ExpenseStatus.PAID,
      notes: 'Equipamiento para vehículo en inventario Toyota Corolla',
      createdById: null,
      createdAt: '2026-10-15T14:30:00Z',
      updatedAt: '2026-10-15T14:30:00Z',
    },
    {
      id: 'exp-2',
      code: 'GST-2026-0002',
      concept: 'Mantenimiento Preventivo y Cambio de Fluidos',
      categoryType: ExpenseCategoryType.SERVICE,
      subcategory: 'Mantenimiento y Reparación',
      amount: 175.0,
      quantity: 1,
      unitPrice: 175.0,
      expenseDate: '2026-10-18',
      provider: 'Taller Especializado AutoPro El Salvador',
      invoiceNumber: 'CCF-88421',
      paymentMethod: 'CARD',
      status: ExpenseStatus.PAID,
      notes: 'Servicio integral de afinado y cambio de aceite sintético',
      createdById: null,
      createdAt: '2026-10-18T10:15:00Z',
      updatedAt: '2026-10-18T10:15:00Z',
    },
    {
      id: 'exp-3',
      code: 'GST-2026-0003',
      concept: 'Baterías Automotrices 12V 65Ah',
      categoryType: ExpenseCategoryType.PRODUCT,
      subcategory: 'Repuestos e Insumos',
      amount: 230.0,
      quantity: 2,
      unitPrice: 115.0,
      expenseDate: '2026-10-20',
      provider: 'Acumuladores y Baterías de C.A.',
      invoiceNumber: 'FAC-55201',
      paymentMethod: 'TRANSFER',
      status: ExpenseStatus.PAID,
      notes: 'Stock para reemplazo de vehículos recibidos',
      createdById: null,
      createdAt: '2026-10-20T16:00:00Z',
      updatedAt: '2026-10-20T16:00:00Z',
    },
    {
      id: 'exp-4',
      code: 'GST-2026-0004',
      concept: 'Servicio de Valúo y Peritaje Mecánico Legal',
      categoryType: ExpenseCategoryType.SERVICE,
      subcategory: 'Servicios Profesionales',
      amount: 150.0,
      quantity: 2,
      unitPrice: 75.0,
      expenseDate: '2026-10-24',
      provider: 'Peritajes y Avalúos Técnicos SV',
      invoiceNumber: 'CCF-09142',
      paymentMethod: 'TRANSFER',
      status: ExpenseStatus.PAID,
      notes: 'Certificación técnica de 2 unidades para apertura de crédito',
      createdById: null,
      createdAt: '2026-10-24T11:45:00Z',
      updatedAt: '2026-10-24T11:45:00Z',
    },
    {
      id: 'exp-5',
      code: 'GST-2026-0005',
      concept: 'Póliza de Seguro de Flota y Responsabilidad Civil',
      categoryType: ExpenseCategoryType.SERVICE,
      subcategory: 'Seguros y Fianzas',
      amount: 620.0,
      quantity: 1,
      unitPrice: 620.0,
      expenseDate: '2026-10-26',
      provider: 'Aseguradora del Pacífico S.A.',
      invoiceNumber: 'POL-2026-99',
      paymentMethod: 'TRANSFER',
      status: ExpenseStatus.PENDING,
      notes: 'Cuota mensual de cobertura para flota vehicular',
      createdById: null,
      createdAt: '2026-10-26T09:00:00Z',
      updatedAt: '2026-10-26T09:00:00Z',
    },
  ];

  constructor(private readonly prisma: PrismaService) {}

  /** Genera un código correlativo para el gasto */
  private generateCode(): string {
    const random = Math.floor(Math.random() * 9000) + 1000;
    return `GST-2026-${random}`;
  }

  /** Listar todos los gastos con filtros opcionales */
  async findAll(query?: QueryExpenseDto): Promise<ExpenseRecord[]> {
    try {
      const where: any = {};
      if (query?.categoryType) where.categoryType = query.categoryType;
      if (query?.status) where.status = query.status;
      if (query?.startDate || query?.endDate) {
        where.expenseDate = {};
        if (query.startDate) where.expenseDate.gte = new Date(query.startDate);
        if (query.endDate) where.expenseDate.lte = new Date(query.endDate);
      }
      if (query?.search) {
        where.OR = [
          { concept: { contains: query.search, mode: 'insensitive' } },
          { provider: { contains: query.search, mode: 'insensitive' } },
          { invoiceNumber: { contains: query.search, mode: 'insensitive' } },
          { code: { contains: query.search, mode: 'insensitive' } },
        ];
      }

      const rows = await this.prisma.expense.findMany({
        where,
        orderBy: { expenseDate: 'desc' },
      });

      if (rows.length > 0) {
        return rows.map((r) => ({
          id: r.id,
          code: r.code,
          concept: r.concept,
          categoryType: r.categoryType,
          subcategory: r.subcategory,
          amount: Number(r.amount),
          quantity: Number(r.quantity),
          unitPrice: Number(r.unitPrice),
          expenseDate: r.expenseDate.toISOString().split('T')[0],
          provider: r.provider,
          invoiceNumber: r.invoiceNumber,
          paymentMethod: r.paymentMethod,
          status: r.status,
          notes: r.notes,
          createdById: r.createdById,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
        }));
      }
    } catch {
      this.logger.warn('Base de datos no disponible, utilizando almacenamiento en memoria para Gastos.');
    }

    // Filtrado en memoria
    let result = [...this.memoryExpenses];
    if (query?.categoryType) {
      result = result.filter((e) => e.categoryType === query.categoryType);
    }
    if (query?.status) {
      result = result.filter((e) => e.status === query.status);
    }
    if (query?.search) {
      const q = query.search.toLowerCase();
      result = result.filter(
        (e) =>
          e.concept.toLowerCase().includes(q) ||
          (e.provider && e.provider.toLowerCase().includes(q)) ||
          (e.invoiceNumber && e.invoiceNumber.toLowerCase().includes(q)) ||
          e.code.toLowerCase().includes(q),
      );
    }
    return result.sort((a, b) => new Date(b.expenseDate).getTime() - new Date(a.expenseDate).getTime());
  }

  /** Consultar un gasto por su ID */
  async findOne(id: string): Promise<ExpenseRecord> {
    try {
      const r = await this.prisma.expense.findUnique({ where: { id } });
      if (r) {
        return {
          id: r.id,
          code: r.code,
          concept: r.concept,
          categoryType: r.categoryType,
          subcategory: r.subcategory,
          amount: Number(r.amount),
          quantity: Number(r.quantity),
          unitPrice: Number(r.unitPrice),
          expenseDate: r.expenseDate.toISOString().split('T')[0],
          provider: r.provider,
          invoiceNumber: r.invoiceNumber,
          paymentMethod: r.paymentMethod,
          status: r.status,
          notes: r.notes,
          createdById: r.createdById,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
        };
      }
    } catch {
      // Memory fallback
    }

    const exp = this.memoryExpenses.find((e) => e.id === id);
    if (!exp) throw new NotFoundException('Gasto no encontrado');
    return exp;
  }

  /** Registrar un nuevo gasto (Producto o Servicio) */
  async create(dto: CreateExpenseDto, userId?: string): Promise<ExpenseRecord> {
    const qty = dto.quantity && dto.quantity > 0 ? dto.quantity : 1;
    const unitPrice = dto.unitPrice;
    const calculatedAmount = dto.amount !== undefined ? dto.amount : Number((qty * unitPrice).toFixed(2));
    const code = this.generateCode();
    const dateObj = dto.expenseDate ? new Date(dto.expenseDate) : new Date();

    try {
      const created = await this.prisma.expense.create({
        data: {
          code,
          concept: dto.concept,
          categoryType: dto.categoryType,
          subcategory: dto.subcategory || null,
          quantity: qty,
          unitPrice,
          amount: calculatedAmount,
          expenseDate: dateObj,
          provider: dto.provider || null,
          invoiceNumber: dto.invoiceNumber || null,
          paymentMethod: dto.paymentMethod || null,
          status: dto.status || ExpenseStatus.PAID,
          notes: dto.notes || null,
          createdById: userId || null,
        },
      });

      const record: ExpenseRecord = {
        id: created.id,
        code: created.code,
        concept: created.concept,
        categoryType: created.categoryType,
        subcategory: created.subcategory,
        amount: Number(created.amount),
        quantity: Number(created.quantity),
        unitPrice: Number(created.unitPrice),
        expenseDate: created.expenseDate.toISOString().split('T')[0],
        provider: created.provider,
        invoiceNumber: created.invoiceNumber,
        paymentMethod: created.paymentMethod,
        status: created.status,
        notes: created.notes,
        createdById: created.createdById,
        createdAt: created.createdAt.toISOString(),
        updatedAt: created.updatedAt.toISOString(),
      };

      // Sincronizar en memoria
      this.memoryExpenses.unshift(record);
      return record;
    } catch {
      this.logger.warn('Guardando gasto en memoria local...');
    }

    const newRecord: ExpenseRecord = {
      id: `exp-${Date.now()}`,
      code,
      concept: dto.concept,
      categoryType: dto.categoryType,
      subcategory: dto.subcategory || null,
      amount: calculatedAmount,
      quantity: qty,
      unitPrice,
      expenseDate: dateObj.toISOString().split('T')[0],
      provider: dto.provider || null,
      invoiceNumber: dto.invoiceNumber || null,
      paymentMethod: dto.paymentMethod || null,
      status: dto.status || ExpenseStatus.PAID,
      notes: dto.notes || null,
      createdById: userId || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.memoryExpenses.unshift(newRecord);
    return newRecord;
  }

  /** Modificar un gasto existente */
  async update(id: string, dto: UpdateExpenseDto): Promise<ExpenseRecord> {
    try {
      const updateData: any = {};
      if (dto.concept !== undefined) updateData.concept = dto.concept;
      if (dto.categoryType !== undefined) updateData.categoryType = dto.categoryType;
      if (dto.subcategory !== undefined) updateData.subcategory = dto.subcategory;
      if (dto.quantity !== undefined) updateData.quantity = dto.quantity;
      if (dto.unitPrice !== undefined) updateData.unitPrice = dto.unitPrice;
      if (dto.amount !== undefined) updateData.amount = dto.amount;
      else if (dto.quantity !== undefined || dto.unitPrice !== undefined) {
        // Recalcular monto
        const current = await this.prisma.expense.findUnique({ where: { id } });
        if (current) {
          const q = dto.quantity !== undefined ? dto.quantity : Number(current.quantity);
          const p = dto.unitPrice !== undefined ? dto.unitPrice : Number(current.unitPrice);
          updateData.amount = Number((q * p).toFixed(2));
        }
      }
      if (dto.expenseDate !== undefined) updateData.expenseDate = new Date(dto.expenseDate);
      if (dto.provider !== undefined) updateData.provider = dto.provider;
      if (dto.invoiceNumber !== undefined) updateData.invoiceNumber = dto.invoiceNumber;
      if (dto.paymentMethod !== undefined) updateData.paymentMethod = dto.paymentMethod;
      if (dto.status !== undefined) updateData.status = dto.status;
      if (dto.notes !== undefined) updateData.notes = dto.notes;

      const updated = await this.prisma.expense.update({
        where: { id },
        data: updateData,
      });

      const record: ExpenseRecord = {
        id: updated.id,
        code: updated.code,
        concept: updated.concept,
        categoryType: updated.categoryType,
        subcategory: updated.subcategory,
        amount: Number(updated.amount),
        quantity: Number(updated.quantity),
        unitPrice: Number(updated.unitPrice),
        expenseDate: updated.expenseDate.toISOString().split('T')[0],
        provider: updated.provider,
        invoiceNumber: updated.invoiceNumber,
        paymentMethod: updated.paymentMethod,
        status: updated.status,
        notes: updated.notes,
        createdById: updated.createdById,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      };

      // Actualizar en memoria
      const idx = this.memoryExpenses.findIndex((e) => e.id === id);
      if (idx !== -1) this.memoryExpenses[idx] = record;

      return record;
    } catch {
      // Memory fallback
    }

    const idx = this.memoryExpenses.findIndex((e) => e.id === id);
    if (idx === -1) throw new NotFoundException('Gasto no encontrado');

    const current = this.memoryExpenses[idx];
    const qty = dto.quantity !== undefined ? dto.quantity : current.quantity;
    const unitPrice = dto.unitPrice !== undefined ? dto.unitPrice : current.unitPrice;
    const amount =
      dto.amount !== undefined ? dto.amount : Number((qty * unitPrice).toFixed(2));

    const updated: ExpenseRecord = {
      ...current,
      concept: dto.concept !== undefined ? dto.concept : current.concept,
      categoryType: dto.categoryType !== undefined ? dto.categoryType : current.categoryType,
      subcategory: dto.subcategory !== undefined ? dto.subcategory : current.subcategory,
      quantity: qty,
      unitPrice,
      amount,
      expenseDate: dto.expenseDate || current.expenseDate,
      provider: dto.provider !== undefined ? dto.provider : current.provider,
      invoiceNumber: dto.invoiceNumber !== undefined ? dto.invoiceNumber : current.invoiceNumber,
      paymentMethod: dto.paymentMethod !== undefined ? dto.paymentMethod : current.paymentMethod,
      status: dto.status !== undefined ? dto.status : current.status,
      notes: dto.notes !== undefined ? dto.notes : current.notes,
      updatedAt: new Date().toISOString(),
    };

    this.memoryExpenses[idx] = updated;
    return updated;
  }

  /** Eliminar un gasto */
  async remove(id: string): Promise<{ success: boolean; message: string }> {
    try {
      await this.prisma.expense.delete({ where: { id } });
    } catch {
      // Continuar con borrado en memoria
    }

    const initialLength = this.memoryExpenses.length;
    this.memoryExpenses = this.memoryExpenses.filter((e) => e.id !== id);

    return {
      success: true,
      message: 'Gasto eliminado exitosamente.',
    };
  }

  /** Contabilización de Gastos: Totales acumulados, por producto/servicio, mes actual y estados */
  async getSummary() {
    const expenses = await this.findAll();

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth(); // 0-indexed

    let totalAmount = new Decimal(0);
    let productsTotal = new Decimal(0);
    let servicesTotal = new Decimal(0);
    let currentMonthTotal = new Decimal(0);
    let paidTotal = new Decimal(0);
    let pendingTotal = new Decimal(0);

    let productsCount = 0;
    let servicesCount = 0;
    let paidCount = 0;
    let pendingCount = 0;

    const bySubcategory: Record<string, { count: number; total: number }> = {};

    for (const exp of expenses) {
      const amt = new Decimal(exp.amount || 0);
      totalAmount = totalAmount.plus(amt);

      if (exp.categoryType === ExpenseCategoryType.PRODUCT) {
        productsTotal = productsTotal.plus(amt);
        productsCount++;
      } else if (exp.categoryType === ExpenseCategoryType.SERVICE) {
        servicesTotal = servicesTotal.plus(amt);
        servicesCount++;
      }

      if (exp.status === ExpenseStatus.PAID) {
        paidTotal = paidTotal.plus(amt);
        paidCount++;
      } else if (exp.status === ExpenseStatus.PENDING) {
        pendingTotal = pendingTotal.plus(amt);
        pendingCount++;
      }

      // Evaluar si es del mes actual
      const expDate = new Date(exp.expenseDate);
      if (expDate.getFullYear() === currentYear && expDate.getMonth() === currentMonth) {
        currentMonthTotal = currentMonthTotal.plus(amt);
      }

      // Agrupación por subcategoría
      const sub = exp.subcategory || (exp.categoryType === ExpenseCategoryType.PRODUCT ? 'Productos Varios' : 'Servicios Generales');
      if (!bySubcategory[sub]) {
        bySubcategory[sub] = { count: 0, total: 0 };
      }
      bySubcategory[sub].count++;
      bySubcategory[sub].total = Number(new Decimal(bySubcategory[sub].total).plus(amt).toFixed(2));
    }

    return {
      totalAmount: totalAmount.toFixed(2),
      productsTotal: productsTotal.toFixed(2),
      servicesTotal: servicesTotal.toFixed(2),
      currentMonthTotal: currentMonthTotal.toFixed(2),
      paidTotal: paidTotal.toFixed(2),
      pendingTotal: pendingTotal.toFixed(2),
      totalCount: expenses.length,
      productsCount,
      servicesCount,
      paidCount,
      pendingCount,
      bySubcategory,
      accountingPeriod: `${currentMonth + 1}/${currentYear}`,
    };
  }
}

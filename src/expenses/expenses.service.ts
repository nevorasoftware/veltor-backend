import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Expense, ExpenseCategoryType, ExpenseStatus, Prisma } from '@prisma/client';
import { CreateExpenseDto, UpdateExpenseDto, QueryExpenseDto } from './dto/expense.dto';
import Decimal from 'decimal.js';
import { nextSequentialCode, withUniqueRetry } from '../common/codes';

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

function toRecord(r: Expense): ExpenseRecord {
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

/** Las fechas YYYY-MM-DD se guardan a mediodía UTC para que no cambien de día por zona horaria. */
function parseExpenseDate(value: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00Z`) : new Date(value);
}

@Injectable()
export class ExpensesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Listar todos los gastos con filtros opcionales */
  async findAll(query: QueryExpenseDto = {}): Promise<ExpenseRecord[]> {
    const where: Prisma.ExpenseWhereInput = {};
    if (query.categoryType) where.categoryType = query.categoryType;
    if (query.status) where.status = query.status;
    if (query.startDate || query.endDate) {
      where.expenseDate = {};
      if (query.startDate) where.expenseDate.gte = new Date(`${query.startDate}T00:00:00Z`);
      if (query.endDate) where.expenseDate.lte = new Date(`${query.endDate}T23:59:59Z`);
    }
    if (query.search) {
      where.OR = [
        { concept: { contains: query.search, mode: 'insensitive' } },
        { provider: { contains: query.search, mode: 'insensitive' } },
        { invoiceNumber: { contains: query.search, mode: 'insensitive' } },
        { subcategory: { contains: query.search, mode: 'insensitive' } },
        { code: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const rows = await this.prisma.expense.findMany({ where, orderBy: { expenseDate: 'desc' } });
    return rows.map(toRecord);
  }

  async findOne(id: string): Promise<ExpenseRecord> {
    const r = await this.prisma.expense.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Gasto no encontrado');
    return toRecord(r);
  }

  /** Registrar un nuevo gasto (Producto o Servicio) */
  async create(dto: CreateExpenseDto, userId?: string): Promise<ExpenseRecord> {
    const qty = dto.quantity && dto.quantity > 0 ? dto.quantity : 1;
    const amount = dto.amount ?? new Decimal(qty).mul(dto.unitPrice).toDecimalPlaces(2).toNumber();

    const created = await withUniqueRetry(async () => {
      const code = await nextSequentialCode(
        (prefix) =>
          this.prisma.expense.findFirst({ where: { code: { startsWith: prefix } }, orderBy: { code: 'desc' }, select: { code: true } }),
        'GST',
        4,
      );
      return this.prisma.expense.create({
        data: {
          code,
          concept: dto.concept,
          categoryType: dto.categoryType,
          subcategory: dto.subcategory || null,
          quantity: qty,
          unitPrice: dto.unitPrice,
          amount,
          expenseDate: dto.expenseDate ? parseExpenseDate(dto.expenseDate) : new Date(),
          provider: dto.provider || null,
          invoiceNumber: dto.invoiceNumber || null,
          paymentMethod: dto.paymentMethod || null,
          status: dto.status || ExpenseStatus.PAID,
          notes: dto.notes || null,
          createdById: userId || null,
        },
      });
    });

    return toRecord(created);
  }

  /** Modificar un gasto existente */
  async update(id: string, dto: UpdateExpenseDto): Promise<ExpenseRecord> {
    const current = await this.prisma.expense.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Gasto no encontrado');

    const data: Prisma.ExpenseUpdateInput = {
      concept: dto.concept,
      categoryType: dto.categoryType,
      subcategory: dto.subcategory,
      quantity: dto.quantity,
      unitPrice: dto.unitPrice,
      provider: dto.provider,
      invoiceNumber: dto.invoiceNumber,
      paymentMethod: dto.paymentMethod,
      status: dto.status,
      notes: dto.notes,
    };
    if (dto.expenseDate !== undefined) data.expenseDate = parseExpenseDate(dto.expenseDate);

    if (dto.amount !== undefined) {
      data.amount = dto.amount;
    } else if (dto.quantity !== undefined || dto.unitPrice !== undefined) {
      const q = dto.quantity ?? Number(current.quantity);
      const p = dto.unitPrice ?? Number(current.unitPrice);
      data.amount = new Decimal(q).mul(p).toDecimalPlaces(2).toNumber();
    }

    const updated = await this.prisma.expense.update({ where: { id }, data });
    return toRecord(updated);
  }

  /** Eliminar un gasto */
  async remove(id: string): Promise<{ success: boolean; message: string }> {
    await this.findOne(id);
    await this.prisma.expense.delete({ where: { id } });
    return { success: true, message: 'Gasto eliminado exitosamente.' };
  }

  /** Contabilización de Gastos: Totales acumulados, por producto/servicio, mes actual y estados */
  async getSummary() {
    const expenses = await this.findAll();

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

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
      // Los gastos anulados no forman parte de la contabilidad
      if (exp.status === ExpenseStatus.CANCELLED) continue;

      const amt = new Decimal(exp.amount || 0);
      totalAmount = totalAmount.plus(amt);

      if (exp.categoryType === ExpenseCategoryType.PRODUCT) {
        productsTotal = productsTotal.plus(amt);
        productsCount++;
      } else {
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

      const [y, m] = exp.expenseDate.split('-').map(Number);
      if (y === currentYear && m - 1 === currentMonth) {
        currentMonthTotal = currentMonthTotal.plus(amt);
      }

      const sub = exp.subcategory || (exp.categoryType === ExpenseCategoryType.PRODUCT ? 'Productos Varios' : 'Servicios Generales');
      if (!bySubcategory[sub]) bySubcategory[sub] = { count: 0, total: 0 };
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
      totalCount: productsCount + servicesCount,
      productsCount,
      servicesCount,
      paidCount,
      pendingCount,
      bySubcategory,
      accountingPeriod: `${currentMonth + 1}/${currentYear}`,
    };
  }
}

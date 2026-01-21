import { db } from "./db";
import {
  testEquipment, partNumbers, testSteps, workOrders,
  type TestEquipment, type InsertTestEquipment,
  type PartNumber, type InsertPartNumber,
  type TestStep, type InsertTestStep,
  type WorkOrder, type InsertWorkOrder,
  type PartNumberWithSteps
} from "@shared/schema";
import { eq, desc } from "drizzle-orm";

export interface IStorage {
  // Equipment
  getEquipment(): Promise<TestEquipment[]>;
  createEquipment(equipment: InsertTestEquipment): Promise<TestEquipment>;
  deleteEquipment(id: number): Promise<void>;

  // Parts
  getParts(): Promise<PartNumber[]>;
  getPart(id: number): Promise<PartNumberWithSteps | undefined>;
  createPart(part: InsertPartNumber): Promise<PartNumber>;
  deletePart(id: number): Promise<void>;

  // Steps
  createStep(step: InsertTestStep): Promise<TestStep>;
  deleteStep(id: number): Promise<void>;
  getStepsByPartId(partId: number): Promise<TestStep[]>;

  // Orders
  getOrders(): Promise<(WorkOrder & { partNumber: PartNumber })[]>;
  createOrder(order: InsertWorkOrder): Promise<WorkOrder>;
  deleteOrder(id: number): Promise<void>;
  
  // Helpers for scheduler
  getAllSteps(): Promise<(TestStep & { equipment: TestEquipment })[]>;
}

export class DatabaseStorage implements IStorage {
  async getEquipment(): Promise<TestEquipment[]> {
    return await db.select().from(testEquipment);
  }

  async createEquipment(equipment: InsertTestEquipment): Promise<TestEquipment> {
    const [newItem] = await db.insert(testEquipment).values(equipment).returning();
    return newItem;
  }

  async deleteEquipment(id: number): Promise<void> {
    await db.delete(testEquipment).where(eq(testEquipment.id, id));
  }

  async getParts(): Promise<PartNumber[]> {
    return await db.select().from(partNumbers);
  }

  async getPart(id: number): Promise<PartNumberWithSteps | undefined> {
    const part = await db.query.partNumbers.findFirst({
      where: eq(partNumbers.id, id),
      with: {
        steps: {
          with: {
            equipment: true
          },
          orderBy: (steps, { asc }) => [asc(steps.stepOrder)]
        }
      }
    });
    return part;
  }

  async createPart(part: InsertPartNumber): Promise<PartNumber> {
    const [newItem] = await db.insert(partNumbers).values(part).returning();
    return newItem;
  }

  async deletePart(id: number): Promise<void> {
    await db.delete(partNumbers).where(eq(partNumbers.id, id));
  }

  async createStep(step: InsertTestStep): Promise<TestStep> {
    const [newItem] = await db.insert(testSteps).values(step).returning();
    return newItem;
  }

  async deleteStep(id: number): Promise<void> {
    await db.delete(testSteps).where(eq(testSteps.id, id));
  }

  async getStepsByPartId(partId: number): Promise<TestStep[]> {
    return await db.select().from(testSteps).where(eq(testSteps.partNumberId, partId));
  }

  async getOrders(): Promise<(WorkOrder & { partNumber: PartNumber })[]> {
    return await db.query.workOrders.findMany({
      with: {
        partNumber: true
      },
      orderBy: (orders, { desc }) => [desc(orders.priority), desc(orders.createdAt)]
    });
  }

  async createOrder(order: InsertWorkOrder): Promise<WorkOrder> {
    const [newItem] = await db.insert(workOrders).values(order).returning();
    return newItem;
  }

  async deleteOrder(id: number): Promise<void> {
    await db.delete(workOrders).where(eq(workOrders.id, id));
  }

  async getAllSteps(): Promise<(TestStep & { equipment: TestEquipment })[]> {
    return await db.query.testSteps.findMany({
      with: {
        equipment: true
      }
    });
  }
}

export const storage = new DatabaseStorage();

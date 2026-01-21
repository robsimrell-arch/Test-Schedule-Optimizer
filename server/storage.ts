import { db } from "./db";
import {
  testEquipment, partNumbers, testSteps, stepEquipment, workOrders,
  type TestEquipment, type InsertTestEquipment,
  type PartNumber, type InsertPartNumber,
  type TestStep, type InsertTestStep,
  type WorkOrder, type InsertWorkOrder,
  type PartNumberWithSteps, type TestStepWithEquipment,
  type InsertStepEquipment
} from "@shared/schema";
import { eq, desc } from "drizzle-orm";

export interface IStorage {
  // Equipment
  getEquipment(): Promise<TestEquipment[]>;
  createEquipment(equipment: InsertTestEquipment): Promise<TestEquipment>;
  updateEquipment(id: number, equipment: Partial<InsertTestEquipment>): Promise<TestEquipment | undefined>;
  deleteEquipment(id: number): Promise<void>;

  // Parts
  getParts(): Promise<PartNumber[]>;
  getPart(id: number): Promise<PartNumberWithSteps | undefined>;
  createPart(part: InsertPartNumber): Promise<PartNumber>;
  deletePart(id: number): Promise<void>;

  // Steps
  createStep(step: InsertTestStep, equipmentRequirements: { equipmentId: number; quantityRequired: number }[]): Promise<TestStepWithEquipment>;
  updateStep(id: number, step: Partial<InsertTestStep>, equipmentRequirements?: { equipmentId: number; quantityRequired: number }[]): Promise<TestStepWithEquipment | undefined>;
  deleteStep(id: number): Promise<void>;
  getStepsByPartId(partId: number): Promise<TestStepWithEquipment[]>;

  // Orders
  getOrders(): Promise<(WorkOrder & { partNumber: PartNumber })[]>;
  createOrder(order: InsertWorkOrder): Promise<WorkOrder>;
  deleteOrder(id: number): Promise<void>;
  
  // Helpers for scheduler
  getAllSteps(): Promise<TestStepWithEquipment[]>;
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

  async updateEquipment(id: number, equipment: Partial<InsertTestEquipment>): Promise<TestEquipment | undefined> {
    const [updated] = await db.update(testEquipment).set(equipment).where(eq(testEquipment.id, id)).returning();
    return updated;
  }

  async getParts(): Promise<PartNumberWithSteps[]> {
    const parts = await db.query.partNumbers.findMany({
      with: {
        steps: {
          with: {
            equipmentRequirements: {
              with: {
                equipment: true
              }
            }
          },
          orderBy: (steps, { asc }) => [asc(steps.stepOrder)]
        }
      }
    });
    return parts as PartNumberWithSteps[];
  }

  async getPart(id: number): Promise<PartNumberWithSteps | undefined> {
    const part = await db.query.partNumbers.findFirst({
      where: eq(partNumbers.id, id),
      with: {
        steps: {
          with: {
            equipmentRequirements: {
              with: {
                equipment: true
              }
            }
          },
          orderBy: (steps, { asc }) => [asc(steps.stepOrder)]
        }
      }
    });
    return part as PartNumberWithSteps | undefined;
  }

  async createPart(part: InsertPartNumber): Promise<PartNumber> {
    const [newItem] = await db.insert(partNumbers).values(part).returning();
    return newItem;
  }

  async deletePart(id: number): Promise<void> {
    await db.delete(partNumbers).where(eq(partNumbers.id, id));
  }

  async createStep(step: InsertTestStep, equipmentRequirements: { equipmentId: number; quantityRequired: number }[]): Promise<TestStepWithEquipment> {
    return await db.transaction(async (tx) => {
      const [newStep] = await tx.insert(testSteps).values(step).returning();
      
      if (equipmentRequirements.length > 0) {
        await tx.insert(stepEquipment).values(
          equipmentRequirements.map(eq => ({ 
            stepId: newStep.id, 
            equipmentId: eq.equipmentId,
            quantityRequired: eq.quantityRequired
          }))
        );
      }

      const result = await tx.query.testSteps.findFirst({
        where: eq(testSteps.id, newStep.id),
        with: {
          equipmentRequirements: {
            with: {
              equipment: true
            }
          }
        }
      });
      return result as TestStepWithEquipment;
    });
  }

  async updateStep(id: number, step: Partial<InsertTestStep>, equipmentRequirements?: { equipmentId: number; quantityRequired: number }[]): Promise<TestStepWithEquipment | undefined> {
    return await db.transaction(async (tx) => {
      if (Object.keys(step).length > 0) {
        await tx.update(testSteps).set(step).where(eq(testSteps.id, id));
      }
      
      if (equipmentRequirements !== undefined) {
        await tx.delete(stepEquipment).where(eq(stepEquipment.stepId, id));
        if (equipmentRequirements.length > 0) {
          await tx.insert(stepEquipment).values(
            equipmentRequirements.map(eqReq => ({ 
              stepId: id, 
              equipmentId: eqReq.equipmentId,
              quantityRequired: eqReq.quantityRequired
            }))
          );
        }
      }

      const result = await tx.query.testSteps.findFirst({
        where: eq(testSteps.id, id),
        with: {
          equipmentRequirements: {
            with: {
              equipment: true
            }
          }
        }
      });
      return result as TestStepWithEquipment | undefined;
    });
  }

  async deleteStep(id: number): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.delete(stepEquipment).where(eq(stepEquipment.stepId, id));
      await tx.delete(testSteps).where(eq(testSteps.id, id));
    });
  }

  async getStepsByPartId(partId: number): Promise<TestStepWithEquipment[]> {
    const steps = await db.query.testSteps.findMany({
      where: eq(testSteps.partNumberId, partId),
      with: {
        equipmentRequirements: {
          with: {
            equipment: true
          }
        }
      }
    });
    return steps as TestStepWithEquipment[];
  }

  async getOrders(): Promise<(WorkOrder & { partNumber: PartNumber })[]> {
    const orders = await db.query.workOrders.findMany({
      with: {
        partNumber: true
      },
      orderBy: (orders, { desc }) => [desc(orders.priority), desc(orders.createdAt)]
    });
    return orders as (WorkOrder & { partNumber: PartNumber })[];
  }

  async createOrder(order: InsertWorkOrder): Promise<WorkOrder> {
    const [newItem] = await db.insert(workOrders).values(order).returning();
    return newItem;
  }

  async deleteOrder(id: number): Promise<void> {
    await db.delete(workOrders).where(eq(workOrders.id, id));
  }

  async getAllSteps(): Promise<TestStepWithEquipment[]> {
    const steps = await db.query.testSteps.findMany({
      with: {
        equipmentRequirements: {
          with: {
            equipment: true
          }
        }
      }
    });
    return steps as TestStepWithEquipment[];
  }
}

export const storage = new DatabaseStorage();

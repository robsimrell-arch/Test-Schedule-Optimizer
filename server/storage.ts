import { db } from "./db";
import {
  testEquipment, partNumbers, testSteps, stepEquipment, workOrders, partEquipmentCompatibility, workOrderStepOffsets, partDependencies,
  type TestEquipment, type InsertTestEquipment,
  type PartNumber, type InsertPartNumber,
  type TestStep, type InsertTestStep,
  type WorkOrder, type InsertWorkOrder,
  type PartNumberWithSteps, type TestStepWithEquipment,
  type InsertStepEquipment, type PartEquipmentCompatibility,
  type WorkOrderStepOffset, type InsertWorkOrderStepOffset,
  type PartDependency, type WorkOrderWithDetails
} from "../shared/schema";
import { eq, desc, and, notInArray } from "drizzle-orm";

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
  updatePart(id: number, part: Partial<InsertPartNumber>): Promise<PartNumber | undefined>;
  deletePart(id: number): Promise<void>;

  // Steps
  createStep(step: InsertTestStep, equipmentRequirements: { equipmentId: number; quantityRequired: number; durationMinutes?: number | null }[]): Promise<TestStepWithEquipment>;
  updateStep(id: number, step: Partial<InsertTestStep>, equipmentRequirements?: { equipmentId: number; quantityRequired: number; durationMinutes?: number | null }[]): Promise<TestStepWithEquipment | undefined>;
  deleteStep(id: number): Promise<void>;
  getStepsByPartId(partId: number): Promise<TestStepWithEquipment[]>;

  // Orders
  getOrders(): Promise<WorkOrderWithDetails[]>;
  createOrder(order: InsertWorkOrder & { stepOffsets?: { stepId: number, quantityCompleted: number }[] }): Promise<WorkOrder>;
  updateOrder(id: number, order: Partial<InsertWorkOrder> & { stepOffsets?: { stepId: number, quantityCompleted: number }[] }): Promise<WorkOrder | undefined>;
  deleteOrder(id: number): Promise<void>;
  
  // Helpers for scheduler
  getAllSteps(): Promise<TestStepWithEquipment[]>;

  // Part-Chamber Compatibility
  getPartCompatibility(partNumberId: number): Promise<PartEquipmentCompatibility[]>;
  setPartCompatibility(partNumberId: number, compatibilities: { equipmentId: number; durationMinutes?: number | null; changeoverMinutes?: number | null }[]): Promise<PartEquipmentCompatibility[]>;
  getAllPartCompatibility(): Promise<PartEquipmentCompatibility[]>;
  
  // Chambers (for Chamber Compatibility tab)
  getChambers(): Promise<TestEquipment[]>;

  // BOM / Sub-assembly Dependencies
  getPartDependencies(parentPartId: number): Promise<(PartDependency & { childPart: PartNumber })[]>;
  setPartDependencies(parentPartId: number, deps: { childPartId: number; quantityRequired: number }[]): Promise<PartDependency[]>;
  getAllPartDependencies(): Promise<PartDependency[]>;
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

  async updatePart(id: number, part: Partial<InsertPartNumber>): Promise<PartNumber | undefined> {
    const [updated] = await db.update(partNumbers).set(part).where(eq(partNumbers.id, id)).returning();
    return updated;
  }

  async deletePart(id: number): Promise<void> {
    await db.delete(partNumbers).where(eq(partNumbers.id, id));
  }

  async createStep(step: InsertTestStep, equipmentRequirements: { equipmentId: number; quantityRequired: number; durationMinutes?: number | null }[]): Promise<TestStepWithEquipment> {
    return await db.transaction(async (tx) => {
      const [newStep] = await tx.insert(testSteps).values(step).returning();
      
      if (equipmentRequirements.length > 0) {
        await tx.insert(stepEquipment).values(
          equipmentRequirements.map(eq => ({ 
            stepId: newStep.id, 
            equipmentId: eq.equipmentId,
            quantityRequired: eq.quantityRequired,
            durationMinutes: eq.durationMinutes ?? null
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

  async updateStep(id: number, step: Partial<InsertTestStep>, equipmentRequirements?: { equipmentId: number; quantityRequired: number; durationMinutes?: number | null }[]): Promise<TestStepWithEquipment | undefined> {
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
              quantityRequired: eqReq.quantityRequired,
              durationMinutes: eqReq.durationMinutes ?? null
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

  async getOrders(): Promise<WorkOrderWithDetails[]> {
    const orders = await db.query.workOrders.findMany({
      with: {
        partNumber: true,
        stepOffsets: true,
      },
      orderBy: (orders, { desc }) => [desc(orders.priority), desc(orders.createdAt)]
    });
    return orders as WorkOrderWithDetails[];
  }

  async createOrder(order: InsertWorkOrder & { stepOffsets?: { stepId: number, quantityCompleted: number }[] }): Promise<WorkOrder> {
    const { stepOffsets, ...orderData } = order;
    return await db.transaction(async (tx) => {
      const [newItem] = await tx.insert(workOrders).values(orderData).returning();
      if (stepOffsets && stepOffsets.length > 0) {
        await tx.insert(workOrderStepOffsets).values(
          stepOffsets.map(offset => ({
            workOrderId: newItem.id,
            stepId: offset.stepId,
            quantityCompleted: offset.quantityCompleted
          }))
        );
      }
      return newItem;
    });
  }

  async deleteOrder(id: number): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.delete(workOrderStepOffsets).where(eq(workOrderStepOffsets.workOrderId, id));
      await tx.delete(workOrders).where(eq(workOrders.id, id));
    });
  }

  async updateOrder(id: number, order: Partial<InsertWorkOrder> & { stepOffsets?: { stepId: number, quantityCompleted: number }[] }): Promise<WorkOrder | undefined> {
    const { stepOffsets, ...orderData } = order;
    return await db.transaction(async (tx) => {
      if (Object.keys(orderData).length > 0) {
        await tx.update(workOrders).set(orderData).where(eq(workOrders.id, id));
      }
      if (stepOffsets !== undefined) {
        await tx.delete(workOrderStepOffsets).where(eq(workOrderStepOffsets.workOrderId, id));
        if (stepOffsets.length > 0) {
          await tx.insert(workOrderStepOffsets).values(
            stepOffsets.map(offset => ({
              workOrderId: id,
              stepId: offset.stepId,
              quantityCompleted: offset.quantityCompleted
            }))
          );
        }
      }
      const [updated] = await tx.select().from(workOrders).where(eq(workOrders.id, id));
      return updated;
    });
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

  async getPartCompatibility(partNumberId: number): Promise<PartEquipmentCompatibility[]> {
    return await db.select().from(partEquipmentCompatibility).where(eq(partEquipmentCompatibility.partNumberId, partNumberId));
  }

  async setPartCompatibility(partNumberId: number, compatibilities: { equipmentId: number; durationMinutes?: number | null; changeoverMinutes?: number | null }[]): Promise<PartEquipmentCompatibility[]> {
    // Deduplicate by equipmentId (keep last occurrence)
    const dedupedMap = new Map<number, { equipmentId: number; durationMinutes: number | null; changeoverMinutes: number | null }>();
    for (const c of compatibilities) {
      dedupedMap.set(c.equipmentId, { 
        equipmentId: c.equipmentId, 
        durationMinutes: c.durationMinutes ?? null,
        changeoverMinutes: c.changeoverMinutes ?? null
      });
    }
    const dedupedCompatibilities = Array.from(dedupedMap.values());
    const equipmentIdsToKeep = dedupedCompatibilities.map(c => c.equipmentId);
    
    return await db.transaction(async (tx) => {
      // Delete only rows that are not in the new set (diff-based approach)
      if (equipmentIdsToKeep.length > 0) {
        await tx.delete(partEquipmentCompatibility)
          .where(and(
            eq(partEquipmentCompatibility.partNumberId, partNumberId),
            notInArray(partEquipmentCompatibility.equipmentId, equipmentIdsToKeep)
          ));
      } else {
        // If no compatibilities to keep, delete all for this part
        await tx.delete(partEquipmentCompatibility)
          .where(eq(partEquipmentCompatibility.partNumberId, partNumberId));
      }
      
      // Upsert new compatibilities (insert or update duration and changeover)
      for (const c of dedupedCompatibilities) {
        await tx.insert(partEquipmentCompatibility)
          .values({ 
            partNumberId, 
            equipmentId: c.equipmentId,
            durationMinutes: c.durationMinutes,
            changeoverMinutes: c.changeoverMinutes
          })
          .onConflictDoUpdate({
            target: [partEquipmentCompatibility.partNumberId, partEquipmentCompatibility.equipmentId],
            set: { 
              durationMinutes: c.durationMinutes,
              changeoverMinutes: c.changeoverMinutes
            }
          });
      }
      
      return await tx.select().from(partEquipmentCompatibility).where(eq(partEquipmentCompatibility.partNumberId, partNumberId));
    });
  }

  async getAllPartCompatibility(): Promise<PartEquipmentCompatibility[]> {
    return await db.select().from(partEquipmentCompatibility);
  }
  
  async getChambers(): Promise<TestEquipment[]> {
    const allEquipment = await db.select().from(testEquipment);
    return allEquipment.filter(eq => eq.name.toLowerCase().includes("chamber"));
  }

  async getPartDependencies(parentPartId: number): Promise<(PartDependency & { childPart: PartNumber })[]> {
    const deps = await db.query.partDependencies.findMany({
      where: eq(partDependencies.parentPartId, parentPartId),
      with: { childPart: true },
    });
    return deps as (PartDependency & { childPart: PartNumber })[];
  }

  async setPartDependencies(parentPartId: number, deps: { childPartId: number; quantityRequired: number }[]): Promise<PartDependency[]> {
    return await db.transaction(async (tx) => {
      await tx.delete(partDependencies).where(eq(partDependencies.parentPartId, parentPartId));
      if (deps.length === 0) return [];
      const inserted = await tx.insert(partDependencies).values(
        deps.map(d => ({ parentPartId, childPartId: d.childPartId, quantityRequired: d.quantityRequired }))
      ).returning();
      return inserted;
    });
  }

  async getAllPartDependencies(): Promise<PartDependency[]> {
    return await db.select().from(partDependencies);
  }
}

export const storage = new DatabaseStorage();

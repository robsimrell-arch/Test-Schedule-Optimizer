import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// === TABLE DEFINITIONS ===

export const testEquipment = pgTable("test_equipment", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  quantity: integer("quantity").notNull().default(1), // Number of units available
  description: text("description"),
});

export const partNumbers = pgTable("part_numbers", {
  id: serial("id").primaryKey(),
  partNumber: text("part_number").notNull().unique(),
  description: text("description"),
});

export const testSteps = pgTable("test_steps", {
  id: serial("id").primaryKey(),
  partNumberId: integer("part_number_id").notNull(),
  testEquipmentId: integer("test_equipment_id").notNull(),
  stepOrder: integer("step_order").notNull(), // Sequence order (1, 2, 3...)
  durationMinutes: integer("duration_minutes").notNull(), // Time to process one batch
  batchSize: integer("batch_size").notNull().default(1), // Max units per batch
});

export const workOrders = pgTable("work_orders", {
  id: serial("id").primaryKey(),
  partNumberId: integer("part_number_id").notNull(),
  quantity: integer("quantity").notNull(), // Total units to produce
  priority: integer("priority").default(1), // Higher number = higher priority
  status: text("status").notNull().default("pending"), // pending, scheduled, completed
  dueDate: timestamp("due_date"),
  createdAt: timestamp("created_at").defaultNow(),
});

// === RELATIONS ===

export const partNumbersRelations = relations(partNumbers, ({ many }) => ({
  steps: many(testSteps),
  workOrders: many(workOrders),
}));

export const testStepsRelations = relations(testSteps, ({ one }) => ({
  partNumber: one(partNumbers, {
    fields: [testSteps.partNumberId],
    references: [partNumbers.id],
  }),
  equipment: one(testEquipment, {
    fields: [testSteps.testEquipmentId],
    references: [testEquipment.id],
  }),
}));

export const workOrdersRelations = relations(workOrders, ({ one }) => ({
  partNumber: one(partNumbers, {
    fields: [workOrders.partNumberId],
    references: [partNumbers.id],
  }),
}));

export const testEquipmentRelations = relations(testEquipment, ({ many }) => ({
  steps: many(testSteps),
}));

// === BASE SCHEMAS ===

export const insertTestEquipmentSchema = createInsertSchema(testEquipment).omit({ id: true });
export const insertPartNumberSchema = createInsertSchema(partNumbers).omit({ id: true });
export const insertTestStepSchema = createInsertSchema(testSteps).omit({ id: true });
export const insertWorkOrderSchema = createInsertSchema(workOrders).omit({ id: true, createdAt: true });

// === EXPLICIT API CONTRACT TYPES ===

export type TestEquipment = typeof testEquipment.$inferSelect;
export type InsertTestEquipment = z.infer<typeof insertTestEquipmentSchema>;

export type PartNumber = typeof partNumbers.$inferSelect;
export type InsertPartNumber = z.infer<typeof insertPartNumberSchema>;

export type TestStep = typeof testSteps.$inferSelect;
export type InsertTestStep = z.infer<typeof insertTestStepSchema>;

export type WorkOrder = typeof workOrders.$inferSelect;
export type InsertWorkOrder = z.infer<typeof insertWorkOrderSchema>;

// Complex types including relations for the frontend
export type PartNumberWithSteps = PartNumber & { steps: (TestStep & { equipment: TestEquipment })[] };
export type WorkOrderWithDetails = WorkOrder & { partNumber: PartNumber };

// Schedule Calculation Types
export interface ScheduledTask {
  id: string; // Unique ID for the Gantt task
  workOrderId: number;
  partNumber: string;
  stepId: number;
  equipmentId: number;
  equipmentName: string;
  startTime: string; // ISO string
  endTime: string; // ISO string
  type: "test_run";
  progress: number;
  dependencies?: string[];
}

export interface ScheduleResponse {
  tasks: ScheduledTask[];
  equipmentUsage: Record<number, { name: string, usage: number }>; // % usage
}

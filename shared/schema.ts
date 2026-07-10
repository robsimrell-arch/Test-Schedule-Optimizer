import { pgTable, text, serial, integer, timestamp, primaryKey, boolean } from "drizzle-orm/pg-core";
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
  stepOrder: integer("step_order").notNull(), // Sequence order (1, 2, 3...)
  name: text("name"), // Optional step name (e.g., "Vibration Test", "Burn-in")
  durationMinutes: integer("duration_minutes").notNull(), // Time to process one batch (default for non-chamber equipment)
  batchSize: integer("batch_size").notNull().default(1), // Max units per batch
  chamberRequired: boolean("chamber_required").notNull().default(false), // Does this step need an ESS chamber?
});

// Join table for multiple equipment per step
export const stepEquipment = pgTable("step_equipment", {
  stepId: integer("step_id").notNull(),
  equipmentId: integer("equipment_id").notNull(),
  quantityRequired: integer("quantity_required").notNull().default(1), // How many units of this equipment needed
  durationMinutes: integer("duration_minutes"), // Equipment-specific duration (nullable, falls back to step duration)
}, (t) => ({
  pk: primaryKey({ columns: [t.stepId, t.equipmentId] }),
}));

export const workOrderStepOffsets = pgTable("work_order_step_offsets", {
  id: serial("id").primaryKey(),
  workOrderId: integer("work_order_id").notNull(),
  stepId: integer("step_id").notNull(),
  quantityCompleted: integer("quantity_completed").notNull().default(0),
});

export const workOrders = pgTable("work_orders", {
  id: serial("id").primaryKey(),
  workOrderNumber: text("work_order_number"), // User-assigned work order number/identifier
  partNumberId: integer("part_number_id").notNull(),
  quantity: integer("quantity").notNull(), // Total units to produce
  priority: integer("priority").default(1), // Lower number = higher priority (e.g. 1 is highest)
  status: text("status").notNull().default("pending"), // pending, scheduled, completed
  dueDate: timestamp("due_date"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Part-chamber compatibility (which chambers a part can use and their durations)
export const partEquipmentCompatibility = pgTable("part_equipment_compatibility", {
  partNumberId: integer("part_number_id").notNull(),
  equipmentId: integer("equipment_id").notNull(),
  durationMinutes: integer("duration_minutes"),
  changeoverMinutes: integer("changeover_minutes"),
}, (t) => ({
  pk: primaryKey({ columns: [t.partNumberId, t.equipmentId] }),
}));

// Sub-assembly / BOM dependencies: childPartId must be fully tested before parentPartId can start
export const partDependencies = pgTable("part_dependencies", {
  id: serial("id").primaryKey(),
  parentPartId: integer("parent_part_id").notNull(), // The assembly that depends on the sub-assembly
  childPartId: integer("child_part_id").notNull(),   // The sub-assembly that must be completed first
  quantityRequired: integer("quantity_required").notNull().default(1), // Units of child needed per unit of parent
});

// === RELATIONS ===

export const partNumbersRelations = relations(partNumbers, ({ many }) => ({
  steps: many(testSteps),
  workOrders: many(workOrders),
  compatibleEquipment: many(partEquipmentCompatibility),
  parentDependencies: many(partDependencies, { relationName: "parentDeps" }),
  childDependencies: many(partDependencies, { relationName: "childDeps" }),
}));

export const partDependenciesRelations = relations(partDependencies, ({ one }) => ({
  parentPart: one(partNumbers, {
    fields: [partDependencies.parentPartId],
    references: [partNumbers.id],
    relationName: "parentDeps",
  }),
  childPart: one(partNumbers, {
    fields: [partDependencies.childPartId],
    references: [partNumbers.id],
    relationName: "childDeps",
  }),
}));

export const partEquipmentCompatibilityRelations = relations(partEquipmentCompatibility, ({ one }) => ({
  partNumber: one(partNumbers, {
    fields: [partEquipmentCompatibility.partNumberId],
    references: [partNumbers.id],
  }),
  equipment: one(testEquipment, {
    fields: [partEquipmentCompatibility.equipmentId],
    references: [testEquipment.id],
  }),
}));

export const testStepsRelations = relations(testSteps, ({ one, many }) => ({
  partNumber: one(partNumbers, {
    fields: [testSteps.partNumberId],
    references: [partNumbers.id],
  }),
  equipmentRequirements: many(stepEquipment),
}));

export const stepEquipmentRelations = relations(stepEquipment, ({ one }) => ({
  step: one(testSteps, {
    fields: [stepEquipment.stepId],
    references: [testSteps.id],
  }),
  equipment: one(testEquipment, {
    fields: [stepEquipment.equipmentId],
    references: [testEquipment.id],
  }),
}));

export const workOrdersRelations = relations(workOrders, ({ one, many }) => ({
  partNumber: one(partNumbers, {
    fields: [workOrders.partNumberId],
    references: [partNumbers.id],
  }),
  stepOffsets: many(workOrderStepOffsets),
}));

export const workOrderStepOffsetsRelations = relations(workOrderStepOffsets, ({ one }) => ({
  workOrder: one(workOrders, {
    fields: [workOrderStepOffsets.workOrderId],
    references: [workOrders.id],
  }),
  step: one(testSteps, {
    fields: [workOrderStepOffsets.stepId],
    references: [testSteps.id],
  }),
}));

export const testEquipmentRelations = relations(testEquipment, ({ many }) => ({
  steps: many(stepEquipment),
  compatibleParts: many(partEquipmentCompatibility),
}));

// === BASE SCHEMAS ===

export const insertTestEquipmentSchema = createInsertSchema(testEquipment).omit({ id: true });
export const insertPartNumberSchema = createInsertSchema(partNumbers).omit({ id: true });
export const insertTestStepSchema = createInsertSchema(testSteps).omit({ id: true });
export const insertStepEquipmentSchema = createInsertSchema(stepEquipment);
export const insertWorkOrderSchema = createInsertSchema(workOrders).omit({ id: true, createdAt: true });
export const insertWorkOrderStepOffsetSchema = createInsertSchema(workOrderStepOffsets).omit({ id: true });
export const insertPartEquipmentCompatibilitySchema = createInsertSchema(partEquipmentCompatibility);
export const insertPartDependencySchema = createInsertSchema(partDependencies).omit({ id: true });

// === EXPLICIT API CONTRACT TYPES ===

export type TestEquipment = typeof testEquipment.$inferSelect;
export type InsertTestEquipment = z.infer<typeof insertTestEquipmentSchema>;

export type PartNumber = typeof partNumbers.$inferSelect;
export type InsertPartNumber = z.infer<typeof insertPartNumberSchema>;

export type TestStep = typeof testSteps.$inferSelect;
export type InsertTestStep = z.infer<typeof insertTestStepSchema>;

export type StepEquipment = typeof stepEquipment.$inferSelect;
export type InsertStepEquipment = z.infer<typeof insertStepEquipmentSchema>;

export type WorkOrder = typeof workOrders.$inferSelect;
export type InsertWorkOrder = z.infer<typeof insertWorkOrderSchema>;

export type WorkOrderStepOffset = typeof workOrderStepOffsets.$inferSelect;
export type InsertWorkOrderStepOffset = z.infer<typeof insertWorkOrderStepOffsetSchema>;

export type PartEquipmentCompatibility = typeof partEquipmentCompatibility.$inferSelect;
export type InsertPartEquipmentCompatibility = z.infer<typeof insertPartEquipmentCompatibilitySchema>;

export type PartDependency = typeof partDependencies.$inferSelect;
export type InsertPartDependency = z.infer<typeof insertPartDependencySchema>;

// Complex types including relations for the frontend
export type TestStepWithEquipment = TestStep & { equipmentRequirements: (StepEquipment & { equipment: TestEquipment })[] };
export type PartNumberWithSteps = PartNumber & { steps: TestStepWithEquipment[] };
export type PartDependencyWithPart = PartDependency & { childPart: PartNumber };
export type WorkOrderWithDetails = WorkOrder & { 
  partNumber: PartNumber,
  stepOffsets?: { stepId: number, quantityCompleted: number }[]
};

// Schedule Calculation Types
export interface ScheduledTask {
  id: string; // Unique ID for the Gantt task
  workOrderId: number;
  partNumber: string;
  stepId: number;
  stepOrder: number; // Step sequence number (1, 2, 3, etc.)
  stepName?: string; // Optional step name (e.g., "Vibration Test")
  equipmentIds: number[];
  equipmentNames: string;
  startTime: string; // ISO string
  endTime: string; // ISO string
  type: "test_run" | "shortage_placeholder";
  progress: number;
  dependencies?: string[];
  unitsCount?: number; // Number of units tested in this task segment
  isShortageAffected?: boolean;
}

export interface DueDateWarning {
  workOrderId: number;
  workOrderNumber: string | null;
  partNumber: string;
  dueDate: string;         // ISO string
  projectedCompletion: string; // ISO string - end time of last task for this order
  daysLate: number;        // How many calendar days past due
}

export interface ShortageWarning {
  childPartId: number;
  childPartNumber: string;
  totalDemand: number;
  totalSupply: number;
  shortage: number;
  affectedOrders: {
    workOrderId: number;
    workOrderNumber: string | null;
    parentPartNumber: string;
    parentPartId: number;
    quantityRequired: number;
  }[];
}

export interface ScheduleResponse {
  tasks: ScheduledTask[];
  equipmentUsage: Record<number, { name: string, usage: number }>; // % usage
  dueDateWarnings: DueDateWarning[];
  shortageWarnings?: ShortageWarning[];
}

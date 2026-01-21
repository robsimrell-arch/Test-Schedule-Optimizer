import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api, errorSchemas } from "@shared/routes";
import { z } from "zod";
import { addMinutes, formatISO } from "date-fns";
import { seedDatabase } from "./seed";
import type { ScheduledTask, ScheduleResponse } from "@shared/schema";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // Seed database on startup
  seedDatabase().catch(console.error);

  // === EQUIPMENT ROUTES ===
  app.get(api.equipment.list.path, async (req, res) => {
    const equipment = await storage.getEquipment();
    res.json(equipment);
  });

  app.post(api.equipment.create.path, async (req, res) => {
    try {
      const input = api.equipment.create.input.parse(req.body);
      const equipment = await storage.createEquipment(input);
      res.status(201).json(equipment);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      throw err;
    }
  });

  app.delete(api.equipment.delete.path, async (req, res) => {
    await storage.deleteEquipment(Number(req.params.id));
    res.status(204).send();
  });

  app.patch(api.equipment.update.path, async (req, res) => {
    try {
      const input = api.equipment.update.input.parse(req.body);
      const updated = await storage.updateEquipment(Number(req.params.id), input);
      if (!updated) return res.status(404).json({ message: "Equipment not found" });
      res.json(updated);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      throw err;
    }
  });

  // === PART ROUTES ===
  app.get(api.parts.list.path, async (req, res) => {
    const parts = await storage.getParts();
    res.json(parts);
  });

  app.get(api.parts.get.path, async (req, res) => {
    const part = await storage.getPart(Number(req.params.id));
    if (!part) return res.status(404).json({ message: "Part not found" });
    res.json(part);
  });

  app.post(api.parts.create.path, async (req, res) => {
    try {
      const input = api.parts.create.input.parse(req.body);
      const part = await storage.createPart(input);
      res.status(201).json(part);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      throw err;
    }
  });

  app.delete(api.parts.delete.path, async (req, res) => {
    await storage.deletePart(Number(req.params.id));
    res.status(204).send();
  });

  // === STEP ROUTES ===
  app.post(api.steps.create.path, async (req, res) => {
    try {
      const body = z.object({
        partNumberId: z.coerce.number(),
        equipmentRequirements: z.array(z.object({
          equipmentId: z.coerce.number(),
          quantityRequired: z.coerce.number().default(1),
          durationMinutes: z.coerce.number().optional().nullable()
        })),
        durationMinutes: z.coerce.number(),
        batchSize: z.coerce.number(),
        stepOrder: z.coerce.number(),
      }).parse(req.body);
      
      const step = await storage.createStep({
        partNumberId: body.partNumberId,
        durationMinutes: body.durationMinutes,
        batchSize: body.batchSize,
        stepOrder: body.stepOrder
      }, body.equipmentRequirements);
      
      res.status(201).json(step);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      throw err;
    }
  });

  app.delete(api.steps.delete.path, async (req, res) => {
    await storage.deleteStep(Number(req.params.id));
    res.status(204).send();
  });

  app.patch(api.steps.update.path, async (req, res) => {
    try {
      const body = z.object({
        durationMinutes: z.coerce.number().optional(),
        batchSize: z.coerce.number().optional(),
        stepOrder: z.coerce.number().optional(),
        equipmentRequirements: z.array(z.object({
          equipmentId: z.coerce.number(),
          quantityRequired: z.coerce.number().default(1),
          durationMinutes: z.coerce.number().optional().nullable()
        })).optional(),
      }).parse(req.body);
      
      const { equipmentRequirements, ...stepFields } = body;
      const updated = await storage.updateStep(
        Number(req.params.id), 
        stepFields, 
        equipmentRequirements
      );
      
      if (!updated) return res.status(404).json({ message: "Step not found" });
      res.json(updated);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      throw err;
    }
  });

  // === ORDER ROUTES ===
  app.get(api.orders.list.path, async (req, res) => {
    const orders = await storage.getOrders();
    res.json(orders);
  });

  app.post(api.orders.create.path, async (req, res) => {
    try {
      const partNumberId = Number(req.body.partNumberId);
      const quantity = Number(req.body.quantity);
      const priority = Number(req.body.priority) || 1;
      const dueDate = req.body.dueDate ? new Date(req.body.dueDate) : null;
      const status = req.body.status || "pending";

      if (isNaN(partNumberId) || isNaN(quantity)) {
        return res.status(400).json({ message: "Invalid partNumberId or quantity" });
      }

      const order = await storage.createOrder({
        partNumberId,
        quantity,
        priority,
        dueDate,
        status
      });

      res.status(201).json(order);
    } catch (err: any) {
      console.error("Error creating work order:", err);
      res.status(500).json({ message: err.message || "Internal server error" });
    }
  });

  app.delete(api.orders.delete.path, async (req, res) => {
    await storage.deleteOrder(Number(req.params.id));
    res.status(204).send();
  });

  // === SCHEDULER LOGIC ===
  app.get(api.schedule.calculate.path, async (req, res) => {
    const orders = await storage.getOrders();
    const equipmentList = await storage.getEquipment();
    
    // Heuristic Scheduler Implementation
    // 1. Initialize machine availability
    const machineAvailability: Record<number, Date[]> = {};
    equipmentList.forEach(eq => {
      machineAvailability[eq.id] = Array(eq.quantity).fill(new Date()); 
    });

    const tasks: ScheduledTask[] = [];
    
    // 2. Process orders by priority
    for (const order of orders) {
      const part = await storage.getPart(order.partNumberId);
      if (!part || !part.steps) continue;

      let currentBatchStartTime = new Date();
      
      for (const step of part.steps) {
        const totalUnits = order.quantity;
        const batchSize = step.batchSize;
        const batchesNeeded = Math.ceil(totalUnits / batchSize);
        const totalDuration = batchesNeeded * step.durationMinutes;
        
        const eqRequirements = step.equipmentRequirements || [];
        if (eqRequirements.length === 0) continue;

        // Find earliest time where ALL required equipment are available simultaneously
        // This is a simplified version: Find the max availability across all required machines
        
        let startWindow = new Date(currentBatchStartTime);
        let selectedUnits: { eqId: number, unitIdx: number }[] = [];

        // We need to find a single unit for each required equipment type
        // This is a greedy search for simplicity
        
        let machinesReadyAt = new Date(startWindow);
        
        for (const req of eqRequirements) {
          const eqId = req.equipmentId;
          const slots = machineAvailability[eqId];
          
          // Find earliest slot
          let earliestSlotIdx = 0;
          for(let i=1; i < slots.length; i++) {
            if (slots[i] < slots[earliestSlotIdx]) earliestSlotIdx = i;
          }
          
          if (slots[earliestSlotIdx] > machinesReadyAt) {
            machinesReadyAt = slots[earliestSlotIdx];
          }
          selectedUnits.push({ eqId, unitIdx: earliestSlotIdx });
        }

        let actualStartTime = new Date(machinesReadyAt);
        let actualEndTime = addMinutes(actualStartTime, totalDuration);

        tasks.push({
          id: `wo-${order.id}-step-${step.id}`,
          workOrderId: order.id,
          partNumber: part.partNumber,
          stepId: step.id,
          equipmentIds: selectedUnits.map(u => u.eqId),
          equipmentNames: eqRequirements.map(r => r.equipment.name).join(", "),
          startTime: formatISO(actualStartTime),
          endTime: formatISO(actualEndTime),
          type: "test_run",
          progress: 0,
          dependencies: []
        });

        // Update all machines involved
        for (const unit of selectedUnits) {
          machineAvailability[unit.eqId][unit.unitIdx] = actualEndTime;
        }

        currentBatchStartTime = actualEndTime;
      }
    }

    res.json({
      tasks,
      equipmentUsage: {}
    });
  });

  return httpServer;
}

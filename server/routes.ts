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
      const input = api.steps.create.input.extend({
        partNumberId: z.coerce.number(),
        testEquipmentId: z.coerce.number(),
        durationMinutes: z.coerce.number(),
        batchSize: z.coerce.number(),
        stepOrder: z.coerce.number(),
      }).parse(req.body);
      
      const step = await storage.createStep(input);
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

  // === ORDER ROUTES ===
  app.get(api.orders.list.path, async (req, res) => {
    const orders = await storage.getOrders();
    res.json(orders);
  });

  app.post(api.orders.create.path, async (req, res) => {
    try {
      const input = api.orders.create.input.extend({
        partNumberId: z.coerce.number(),
        quantity: z.coerce.number(),
        priority: z.coerce.number().default(1),
      }).parse(req.body);

      const order = await storage.createOrder(input);
      res.status(201).json(order);
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
      // Create independent timelines for each "unit" of the same equipment
      // e.g. if quantity is 2, we have 2 availability slots
      machineAvailability[eq.id] = Array(eq.quantity).fill(new Date()); 
    });

    const tasks: ScheduledTask[] = [];
    
    // 2. Process orders by priority
    for (const order of orders) {
      const part = await storage.getPart(order.partNumberId);
      if (!part || !part.steps) continue;

      let currentBatchStartTime = new Date(); // Start "now" (or after previous step)
      
      // Calculate total batches needed
      // Logic: Each step might have a DIFFERENT batch size. 
      // Simplified: We schedule "runs" through the steps.
      
      // For each step in the part's process
      for (const step of part.steps) {
        const totalUnits = order.quantity;
        const batchSize = step.batchSize;
        const batchesNeeded = Math.ceil(totalUnits / batchSize);
        const durationPerBatch = step.durationMinutes;

        // Schedule each batch for this step
        // In reality, batches can flow independently, but let's assume strict sequential flow for the whole order 
        // OR pipelining? Let's do a simplified pipelining:
        // All units must finish Step 1 before Step 2? No, usually it's continuous.
        // Let's model it as: Step N starts after Step N-1 finishes for that specific batch.
        
        // We will just schedule ONE big block for the whole order on this machine for simplicity of visualization
        // OR better: Break it down by batch if batchesNeeded is small, or aggregate if large.
        // Let's aggregate for MVP: Total time on machine = batchesNeeded * durationPerBatch
        
        const totalDuration = batchesNeeded * durationPerBatch;
        
        // Find earliest available machine unit
        const machineId = step.testEquipmentId;
        const availableSlots = machineAvailability[machineId] || [new Date()];
        
        // Find the unit that finishes earliest, BUT must be after the previous step for this order completed
        // Wait, if we aggregate, we assume the whole order moves together (simplification).
        // Let's assume the order occupies the machine for `totalDuration`.
        
        // Find "best" machine unit (earliest available)
        let bestUnitIndex = 0;
        let earliestDate = availableSlots[0];
        
        for(let i=1; i < availableSlots.length; i++) {
          if (availableSlots[i] < earliestDate) {
            earliestDate = availableSlots[i];
            bestUnitIndex = i;
          }
        }

        // The task can start when:
        // 1. The machine is free (earliestDate)
        // 2. The previous step for this order is done (currentBatchStartTime)
        // We take the MAX of these two.
        
        let actualStartTime = new Date(Math.max(earliestDate.getTime(), currentBatchStartTime.getTime()));
        let actualEndTime = addMinutes(actualStartTime, totalDuration);

        // Record the task
        tasks.push({
          id: `wo-${order.id}-step-${step.id}`,
          workOrderId: order.id,
          partNumber: part.partNumber,
          stepId: step.id,
          equipmentId: step.testEquipmentId,
          equipmentName: step.equipment.name,
          startTime: formatISO(actualStartTime),
          endTime: formatISO(actualEndTime),
          type: "test_run",
          progress: 0,
          dependencies: []
        });

        // Update state
        // The machine is now busy until actualEndTime
        availableSlots[bestUnitIndex] = actualEndTime;
        machineAvailability[machineId] = availableSlots;

        // The next step for this order can't start until this step finishes 
        // (Assuming strictly sequential processing of the whole order for MVP)
        currentBatchStartTime = actualEndTime;
      }
    }

    res.json({
      tasks,
      equipmentUsage: {} // Todo: Calculate stats
    });
  });

  return httpServer;
}

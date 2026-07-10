import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api, errorSchemas } from "../shared/routes";
import { z } from "zod";
import { addMinutes, formatISO, setHours, setMinutes, setSeconds, setMilliseconds, addDays, isBefore, isAfter } from "date-fns";
import { seedDatabase } from "./seed";
import type { ScheduledTask, ScheduleResponse } from "../shared/schema";

// Shift configuration
const SHIFT_START_HOUR = 7; // 7 AM
const HOURS_PER_SHIFT = 8;

// Helper: Check if a day is a working day based on work week setting
function isWorkingDay(date: Date, workDays: 5 | 6 | 7): boolean {
  const dayOfWeek = date.getDay(); // 0 = Sunday, 6 = Saturday
  if (workDays === 7) return true; // 7-day week - all days work
  if (workDays === 6) return dayOfWeek !== 0; // 6-day week - Sunday off
  return dayOfWeek !== 0 && dayOfWeek !== 6; // 5-day week - Sat/Sun off
}

// Helper: Move to next working day if current day is not a working day
function skipToWorkingDay(date: Date, workDays: 5 | 6 | 7): Date {
  let result = new Date(date);
  while (!isWorkingDay(result, workDays)) {
    result = addDays(result, 1);
  }
  return result;
}

// Helper: Get the next available working time based on shift schedule
function getNextWorkingTime(date: Date, shifts: 1 | 2 | 3, workDays: 5 | 6 | 7 = 7): Date {
  if (shifts === 3) {
    // 3 shifts = 24 hours, just need to be on a working day
    let result = skipToWorkingDay(new Date(date), workDays);
    return result;
  }
  const hoursPerDay = shifts * HOURS_PER_SHIFT; // 8 or 16 hours
  const shiftEndHour = SHIFT_START_HOUR + hoursPerDay; // 15 (3pm) or 23 (11pm)
  
  let result = new Date(date);
  
  // First, skip to a working day
  result = skipToWorkingDay(result, workDays);
  
  const currentHour = result.getHours();
  
  // If before shift start, move to shift start
  if (currentHour < SHIFT_START_HOUR) {
    result = setHours(result, SHIFT_START_HOUR);
    result = setMinutes(result, 0);
    result = setSeconds(result, 0);
    result = setMilliseconds(result, 0);
    return result;
  }
  
  // If after shift end, move to next working day's shift start
  if (currentHour >= shiftEndHour) {
    result = addDays(result, 1);
    result = skipToWorkingDay(result, workDays);
    result = setHours(result, SHIFT_START_HOUR);
    result = setMinutes(result, 0);
    result = setSeconds(result, 0);
    result = setMilliseconds(result, 0);
    return result;
  }
  
  // Within working hours
  return result;
}

// Helper: Add working minutes (skipping non-working hours and non-working days)
function addWorkingMinutes(startDate: Date, minutes: number, shifts: 1 | 2 | 3, workDays: 5 | 6 | 7 = 7): Date {
  if (shifts === 3) {
    // 3 shifts = 24 hours/day, just need to handle non-working days
    let current = getNextWorkingTime(startDate, shifts, workDays);
    let remainingMinutes = minutes;
    while (remainingMinutes > 0) {
      const currentHour = current.getHours();
      const currentMinute = current.getMinutes();
      const minutesUntilMidnight = (24 * 60) - (currentHour * 60 + currentMinute);
      if (remainingMinutes <= minutesUntilMidnight) {
        current = addMinutes(current, remainingMinutes);
        remainingMinutes = 0;
      } else {
        remainingMinutes -= minutesUntilMidnight;
        current = addDays(current, 1);
        current = skipToWorkingDay(current, workDays);
        current = setHours(current, 0);
        current = setMinutes(current, 0);
        current = setSeconds(current, 0);
        current = setMilliseconds(current, 0);
      }
    }
    return current;
  }
  const hoursPerDay = shifts * HOURS_PER_SHIFT;
  const minutesPerDay = hoursPerDay * 60;
  const shiftEndHour = SHIFT_START_HOUR + hoursPerDay;
  
  // Ensure we start at a valid working time
  let current = getNextWorkingTime(startDate, shifts, workDays);
  let remainingMinutes = minutes;
  
  while (remainingMinutes > 0) {
    const currentHour = current.getHours();
    const currentMinute = current.getMinutes();
    
    // Calculate minutes left in current day's shift
    const minutesUntilEndOfShift = (shiftEndHour * 60) - (currentHour * 60 + currentMinute);
    
    if (remainingMinutes <= minutesUntilEndOfShift) {
      // Can complete within today's shift
      current = addMinutes(current, remainingMinutes);
      remainingMinutes = 0;
    } else {
      // Use up today's remaining shift time and move to next working day
      remainingMinutes -= minutesUntilEndOfShift;
      current = addDays(current, 1);
      current = skipToWorkingDay(current, workDays);
      current = setHours(current, SHIFT_START_HOUR);
      current = setMinutes(current, 0);
      current = setSeconds(current, 0);
      current = setMilliseconds(current, 0);
    }
  }
  
  return current;
}

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

  app.put(api.parts.update.path, async (req, res) => {
    const input = api.parts.update.input.parse(req.body);
    const updated = await storage.updatePart(Number(req.params.id), input);
    if (!updated) {
      return res.status(404).json({ message: "Part not found" });
    }
    res.json(updated);
  });

  app.delete(api.parts.delete.path, async (req, res) => {
    await storage.deletePart(Number(req.params.id));
    res.status(204).send();
  });

  // === PART-EQUIPMENT COMPATIBILITY ROUTES ===
  app.get("/api/parts/:id/compatibility", async (req, res) => {
    const compatibility = await storage.getPartCompatibility(Number(req.params.id));
    res.json(compatibility);
  });

  app.put("/api/parts/:id/compatibility", async (req, res) => {
    try {
      const body = z.object({
        compatibilities: z.array(z.object({
          equipmentId: z.coerce.number(),
          durationMinutes: z.coerce.number().optional().nullable(),
          changeoverMinutes: z.coerce.number().optional().nullable()
        }))
      }).parse(req.body);
      
      const compatibility = await storage.setPartCompatibility(Number(req.params.id), body.compatibilities);
      res.json(compatibility);
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
  
  // === CHAMBERS ROUTE ===
  app.get("/api/chambers", async (req, res) => {
    const chambers = await storage.getChambers();
    res.json(chambers);
  });

  app.get("/api/compatibility", async (req, res) => {
    const compatibility = await storage.getAllPartCompatibility();
    res.json(compatibility);
  });

  // === BOM / PART DEPENDENCY ROUTES ===
  app.get("/api/parts/:id/dependencies", async (req, res) => {
    const deps = await storage.getPartDependencies(Number(req.params.id));
    res.json(deps);
  });

  app.put("/api/parts/:id/dependencies", async (req, res) => {
    try {
      const body = z.object({
        dependencies: z.array(z.object({
          childPartId: z.coerce.number(),
          quantityRequired: z.coerce.number().min(1).default(1),
        }))
      }).parse(req.body);
      const result = await storage.setPartDependencies(Number(req.params.id), body.dependencies);
      res.json(result);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      throw err;
    }
  });

  app.get("/api/dependencies", async (req, res) => {
    const deps = await storage.getAllPartDependencies();
    res.json(deps);
  });

  // === STEP ROUTES ===
  app.post(api.steps.create.path, async (req, res) => {
    try {
      const body = z.object({
        partNumberId: z.coerce.number(),
        name: z.string().optional().nullable(),
        equipmentRequirements: z.array(z.object({
          equipmentId: z.coerce.number(),
          quantityRequired: z.coerce.number().default(1),
          durationMinutes: z.coerce.number().optional().nullable()
        })),
        durationMinutes: z.coerce.number(),
        batchSize: z.coerce.number(),
        stepOrder: z.coerce.number(),
        chamberRequired: z.coerce.boolean().default(false),
      }).parse(req.body);
      
      const step = await storage.createStep({
        partNumberId: body.partNumberId,
        name: body.name || null,
        durationMinutes: body.durationMinutes,
        batchSize: body.batchSize,
        stepOrder: body.stepOrder,
        chamberRequired: body.chamberRequired
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
        name: z.string().optional().nullable(),
        durationMinutes: z.coerce.number().optional(),
        batchSize: z.coerce.number().optional(),
        stepOrder: z.coerce.number().optional(),
        chamberRequired: z.coerce.boolean().optional(),
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
      const workOrderNumber = req.body.workOrderNumber || null;
      const partNumberId = Number(req.body.partNumberId);
      const quantity = Number(req.body.quantity);
      const priority = Number(req.body.priority) || 1;
      const dueDate = req.body.dueDate ? new Date(req.body.dueDate) : null;
      const status = req.body.status || "pending";
      const stepOffsets = req.body.stepOffsets || [];

      if (isNaN(partNumberId) || isNaN(quantity)) {
        return res.status(400).json({ message: "Invalid partNumberId or quantity" });
      }

      const order = await storage.createOrder({
        workOrderNumber,
        partNumberId,
        quantity,
        priority,
        dueDate,
        status,
        stepOffsets
      });

      res.status(201).json(order);
    } catch (err: any) {
      console.error("Error creating work order:", err);
      res.status(500).json({ message: err.message || "Internal server error" });
    }
  });

  app.put("/api/orders/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const body = req.body;
      const updated = await storage.updateOrder(id, {
        workOrderNumber: body.workOrderNumber,
        partNumberId: body.partNumberId,
        quantity: body.quantity,
        priority: body.priority,
        status: body.status,
        dueDate: body.dueDate ? new Date(body.dueDate) : null,
        stepOffsets: body.stepOffsets
      });
      if (!updated) {
        return res.status(404).json({ message: "Work order not found" });
      }
      res.json(updated);
    } catch (err: any) {
      console.error("Error updating work order:", err);
      res.status(500).json({ message: err.message || "Internal server error" });
    }
  });

  app.delete(api.orders.delete.path, async (req, res) => {
    try {
      await storage.deleteOrder(Number(req.params.id));
      res.status(204).send();
    } catch (err: any) {
      console.error("Error deleting work order:", err);
      res.status(500).json({ message: err.message || "Internal server error" });
    }
  });

  // === SCHEDULER LOGIC ===
  // Greedy scheduler that maximizes equipment utilization while respecting priorities
  app.get(api.schedule.calculate.path, async (req, res) => {
    const shiftsParam = parseInt(req.query.shifts as string) || 3;
    const shifts: 1 | 2 | 3 = shiftsParam === 1 ? 1 : shiftsParam === 2 ? 2 : 3;
    
    const workDaysParam = parseInt(req.query.workDays as string) || 7;
    const workDays: 5 | 6 | 7 = workDaysParam === 5 ? 5 : workDaysParam === 6 ? 6 : 7;
    
    const allOrders = await storage.getOrders();
    const orders = allOrders.filter(o => o.status === "scheduled");
    const equipmentList = await storage.getEquipment();
    const allCompatibility = await storage.getAllPartCompatibility();
    const chambers = await storage.getChambers();
    const allBomDeps = await storage.getAllPartDependencies();
    const allParts = await storage.getParts();
    const partsMap = new Map<number, typeof allParts[number]>();
    for (const part of allParts) {
      partsMap.set(part.id, part);
    }

    // Build BOM lookup: parentPartId -> [{ childPartId, quantityRequired }]
    const bomMap: Record<number, { childPartId: number; quantityRequired: number }[]> = {};
    const seenDeps = new Set<string>();
    for (const dep of allBomDeps) {
      const key = `${dep.parentPartId}-${dep.childPartId}`;
      if (seenDeps.has(key)) continue;
      seenDeps.add(key);
      if (!bomMap[dep.parentPartId]) bomMap[dep.parentPartId] = [];
      bomMap[dep.parentPartId].push({ childPartId: dep.childPartId, quantityRequired: dep.quantityRequired });
    }

    // For each active WO, track its partNumberId so we can find sub-assembly WOs
    // ordersByPartId: partNumberId -> WorkOrders that produce that part
    const ordersByPartId: Record<number, typeof orders> = {};
    for (const order of orders) {
      if (!ordersByPartId[order.partNumberId]) ordersByPartId[order.partNumberId] = [];
      ordersByPartId[order.partNumberId].push(order);
    }

    // Pre-scheduling shortage check
    // 1. Calculate supply: sum up quantity produced by all active child work orders
    const supplyByPartId: Record<number, number> = {};
    for (const part of allParts) {
      const childWOs = ordersByPartId[part.id] || [];
      supplyByPartId[part.id] = childWOs.reduce((sum, wo) => sum + wo.quantity, 0);
    }

    // 2. Calculate demand: sum up child units needed across all active parent work orders
    const demandByChildId: Record<number, number> = {};
    // Track affected orders per child ID
    const affectedOrdersByChildId: Record<number, {
      workOrderId: number;
      workOrderNumber: string | null;
      parentPartNumber: string;
      parentPartId: number;
      quantityRequired: number;
    }[]> = {};

    for (const order of orders) {
      const deps = bomMap[order.partNumberId] || [];
      const parentPart = partsMap.get(order.partNumberId);
      const parentPartNumber = parentPart?.partNumber || "Unknown";

      for (const dep of deps) {
        const childPartId = dep.childPartId;
        const qtyNeeded = order.quantity * dep.quantityRequired;
        
        demandByChildId[childPartId] = (demandByChildId[childPartId] || 0) + qtyNeeded;

        if (!affectedOrdersByChildId[childPartId]) {
          affectedOrdersByChildId[childPartId] = [];
        }
        affectedOrdersByChildId[childPartId].push({
          workOrderId: order.id,
          workOrderNumber: order.workOrderNumber ?? null,
          parentPartNumber,
          parentPartId: order.partNumberId,
          quantityRequired: qtyNeeded
        });
      }
    }

    // 3. Compare supply vs demand to identify shortages
    const shortageWarnings: import("../shared/schema").ShortageWarning[] = [];
    for (const childIdStr of Object.keys(demandByChildId)) {
      const childId = Number(childIdStr);
      const demand = demandByChildId[childId];
      const supply = supplyByPartId[childId] || 0;
      if (supply < demand) {
        const childPart = partsMap.get(childId);
        shortageWarnings.push({
          childPartId: childId,
          childPartNumber: childPart?.partNumber || "Unknown",
          totalDemand: demand,
          totalSupply: supply,
          shortage: demand - supply,
          affectedOrders: affectedOrdersByChildId[childId] || []
        });
      }
    }
    
    // Build compatibility lookup (includes changeover time)
    const compatibilityMap: Record<number, { equipmentId: number; durationMinutes: number | null; changeoverMinutes: number | null }[]> = {};
    for (const c of allCompatibility) {
      if (!compatibilityMap[c.partNumberId]) {
        compatibilityMap[c.partNumberId] = [];
      }
      compatibilityMap[c.partNumberId].push({ 
        equipmentId: c.equipmentId, 
        durationMinutes: c.durationMinutes,
        changeoverMinutes: c.changeoverMinutes ?? null
      });
    }
    
    // Build changeover lookup: partNumberId -> equipmentId -> changeoverMinutes
    const changeoverMap: Record<number, Record<number, number>> = {};
    for (const c of allCompatibility) {
      if (c.changeoverMinutes && c.changeoverMinutes > 0) {
        if (!changeoverMap[c.partNumberId]) {
          changeoverMap[c.partNumberId] = {};
        }
        changeoverMap[c.partNumberId][c.equipmentId] = c.changeoverMinutes;
      }
    }
    
    const chamberIds = new Set(chambers.map(c => c.id));
    
    // Initialize machine availability
    const now = new Date();
    const workingStartTime = getNextWorkingTime(now, shifts, workDays);
    
    const machineAvailability: Record<number, Date[]> = {};
    equipmentList.forEach(eq => {
      machineAvailability[eq.id] = Array(eq.quantity).fill(workingStartTime); 
    });
    
    // Track last part run on each chamber unit for changeover calculation
    // equipmentId -> unitIdx -> partNumberId
    const chamberLastPart: Record<number, Record<number, number | null>> = {};
    for (const chamber of chambers) {
      chamberLastPart[chamber.id] = {};
      for (let i = 0; i < chamber.quantity; i++) {
        chamberLastPart[chamber.id][i] = null;  // No previous part at start
      }
    }

    // Build list of all pending batch tasks (order-step-batch combinations)
    // This enables pipeline scheduling where batches can overlap between steps
    interface PendingBatch {
      orderId: number;
      orderPriority: number;
      partNumberId: number;
      partNumber: string;
      stepId: number;
      stepOrder: number;
      step: any;
      batchIndex: number;      // Which batch this is (0-based)
      unitsInBatch: number;    // How many units in this specific batch
      totalBatches: number;    // Total batches for this step
    }
    
    const pendingBatches: PendingBatch[] = [];
    
    // Track batch completions with their unit counts: orderId -> stepOrder -> array of {endTime, unitsCompleted}
    const batchCompletions: Record<number, Record<number, { endTime: Date; unitsCompleted: number }[]>> = {};
    
    for (const order of orders) {
      const part = partsMap.get(order.partNumberId);
      if (!part || !part.steps || part.steps.length === 0) continue;
      
      batchCompletions[order.id] = {};
      
      // Initialize batchCompletions with pre-completed units from stepOffsets
      const offsetsMap: Record<number, number> = {};
      if (order.stepOffsets) {
        order.stepOffsets.forEach(offset => {
          offsetsMap[offset.stepId] = offset.quantityCompleted;
        });
      }
      
      for (const step of part.steps) {
        batchCompletions[order.id][step.stepOrder] = [];
        
        const completedCount = offsetsMap[step.id] || 0;
        
        // IMPORTANT: If a LATER step has completions, it implies EARLIER steps 
        // are also completed for those units.
        let impliedCompletedCount = completedCount;
        for (const otherStep of part.steps) {
          if (otherStep.stepOrder > step.stepOrder) {
            const otherCompleted = offsetsMap[otherStep.id] || 0;
            if (otherCompleted > impliedCompletedCount) {
              impliedCompletedCount = otherCompleted;
            }
          }
        }

        if (impliedCompletedCount > 0) {
          // Add a "virtual" completion at the start time for the already finished units
          batchCompletions[order.id][step.stepOrder].push({
            endTime: workingStartTime,
            unitsCompleted: impliedCompletedCount
          });
        }

        const remainingQtyToProcess = order.quantity - impliedCompletedCount;
        if (remainingQtyToProcess <= 0) continue;

        const batchSize = step.batchSize;
        const totalBatches = Math.ceil(remainingQtyToProcess / batchSize);
        
        for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
          const unitsInThisBatch = Math.min(batchSize, remainingQtyToProcess - (batchIdx * batchSize));
          
          pendingBatches.push({
            orderId: order.id,
            orderPriority: order.priority ?? 0,
            partNumberId: order.partNumberId,
            partNumber: part.partNumber,
            stepId: step.id,
            stepOrder: step.stepOrder,
            step,
            batchIndex: batchIdx,
            unitsInBatch: unitsInThisBatch,
            totalBatches
          });
        }
      }
    }
    
    // Helper: Calculate when enough units are ready for a batch to start
    // For step N batch B, we need enough units from step N-1 to fill this batch
    function getMinStartTimeForBatch(batch: PendingBatch, ignoreBOM = false): Date {
      if (batch.stepOrder === 1) {
        if (ignoreBOM) {
          return new Date(workingStartTime);
        }
        // BOM pipeline constraint: this parent batch can start as soon as enough
        // child sub-assembly units are done to satisfy THIS specific batch position.
        // Uses the same chronological accumulation pattern as intra-order step pipelining.
        let minTime = new Date(workingStartTime);
        const deps = bomMap[batch.partNumberId] || [];

        for (const dep of deps) {
          const childOrders = ordersByPartId[dep.childPartId] || [];
          if (childOrders.length === 0) continue;

          // Cumulative parent units produced up to and including this batch
          const parentUnitsCumulative = batch.batchIndex * batch.step.batchSize + batch.unitsInBatch;
          // Child units needed before this parent batch can start
          const childUnitsNeeded = parentUnitsCumulative * dep.quantityRequired;

          // Collect last-step completions from all child WOs that produce this child part
          const allChildCompletions: { endTime: Date; unitsCompleted: number }[] = [];
          for (const childOrder of childOrders) {
            const childComps = batchCompletions[childOrder.id];
            if (!childComps) continue;
            const stepKeys = Object.keys(childComps).map(Number);
            if (stepKeys.length === 0) continue;
            const lastStep = Math.max(...stepKeys);
            allChildCompletions.push(...(childComps[lastStep] || []));
          }

          if (allChildCompletions.length === 0) {
            return new Date(8640000000000000); // No child units scheduled yet
          }

          // Walk completions chronologically; stop when enough child units have been done
          const sorted = [...allChildCompletions].sort((a, b) => a.endTime.getTime() - b.endTime.getTime());
          let accumulated = 0;
          let readyAt: Date | null = null;
          for (const c of sorted) {
            accumulated += c.unitsCompleted;
            if (accumulated >= childUnitsNeeded) {
              readyAt = c.endTime;
              break;
            }
          }

          if (!readyAt) {
            return new Date(8640000000000000); // Not enough child units will be produced
          }

          if (readyAt > minTime) minTime = readyAt;
        }

        return minTime;
      }
      
      // For subsequent steps, need to wait for enough units from previous step
      const prevStepCompletions = batchCompletions[batch.orderId][batch.stepOrder - 1] || [];
      
      // If no previous step batches have completed yet, this batch isn't ready
      if (prevStepCompletions.length === 0) {
        return new Date(8640000000000000); // Far future - not ready yet
      }
      
      // Calculate how many units we need for this batch to start
      // We need enough completed units to fill this batch entirely
      const currentStepBatchSize = batch.step.batchSize;
      const unitsNeededForThisBatch = (batch.batchIndex + 1) * currentStepBatchSize;
      
      // Sort completions by end time and accumulate units to find when we have enough
      const sortedCompletions = [...prevStepCompletions].sort((a, b) => a.endTime.getTime() - b.endTime.getTime());
      
      let unitsCompleted = 0;
      for (const completion of sortedCompletions) {
        // Add the units from this completed batch (tracked when it was scheduled)
        unitsCompleted += completion.unitsCompleted;
        
        // Check if we have enough units to start this batch
        // Need enough to fill this batch (or at least the actual units in this batch for last batch)
        if (unitsCompleted >= Math.min(unitsNeededForThisBatch, batch.unitsInBatch + batch.batchIndex * currentStepBatchSize)) {
          return completion.endTime;
        }
      }
      
      // Not enough units completed yet
      return new Date(8640000000000000); // Far future - not ready yet
    }

    const tasks: ScheduledTask[] = [];
    
    // Helper function to find earliest equipment availability for a single batch
    function findEarliestSlotForBatch(batch: PendingBatch, minStartTime: Date): {
      startTime: Date;
      endTime: Date;
      selectedUnits: { eqId: number; unitIdx: number; durationMinutes: number | null }[];
      chamberDuration: number | null;
    } | null {
      const step = batch.step;
      const partCompatibleChambers = compatibilityMap[batch.partNumberId] || [];
      const hasCompatibilityRestrictions = partCompatibleChambers.length > 0;
      
      // For batch scheduling, we only schedule 1 batch at a time
      const batchesNeeded = 1;
      
      const eqRequirements = (step.equipmentRequirements || []).filter(
        (req: any) => !chamberIds.has(req.equipmentId)
      );

      let selectedUnits: { eqId: number; unitIdx: number; durationMinutes: number | null }[] = [];
      // Start with minStartTime so equipment slots are compared against unit availability too
      let machinesReadyAt = new Date(minStartTime);
      
      // Find non-chamber equipment
      for (const req of eqRequirements) {
        const eqId = req.equipmentId;
        const slots = machineAvailability[eqId];
        if (!slots) continue;
        
        const unitsNeeded = req.quantityRequired || 1;
        const slotIndices = slots.map((time: Date, idx: number) => ({ idx, time }))
          .sort((a: any, b: any) => a.time.getTime() - b.time.getTime());
        
        const selectedSlots = slotIndices.slice(0, Math.min(unitsNeeded, slots.length));
        
        if (selectedSlots.length > 0) {
          const lastSlotTime = selectedSlots[selectedSlots.length - 1].time;
          if (lastSlotTime > machinesReadyAt) {
            machinesReadyAt = lastSlotTime;
          }
        }
        
        for (const slot of selectedSlots) {
          selectedUnits.push({ eqId, unitIdx: slot.idx, durationMinutes: req.durationMinutes ?? null });
        }
      }
      
      // Handle chamber requirement
      let chamberDuration: number | null = null;
      
      if (step.chamberRequired) {
        let availableChambers: { equipmentId: number; durationMinutes: number | null; changeoverMinutes: number | null }[];
        
        if (hasCompatibilityRestrictions) {
          availableChambers = partCompatibleChambers;
        } else {
          availableChambers = chambers.map(c => ({ equipmentId: c.id, durationMinutes: null, changeoverMinutes: null }));
        }
        
        if (availableChambers.length === 0) return null;
        
        let selectedChamber: { eqId: number; unitIdx: number; durationMinutes: number | null; availableAt: Date; changeoverApplied: number } | null = null;
        
        for (const chamberInfo of availableChambers) {
          const eqId = chamberInfo.equipmentId;
          const slots = machineAvailability[eqId];
          if (!slots) continue;
          
          for (let i = 0; i < slots.length; i++) {
            // Check if changeover time applies (different part from last run on this unit)
            let changeoverTime = 0;
            const lastPartOnUnit = chamberLastPart[eqId]?.[i];
            if (lastPartOnUnit !== null && lastPartOnUnit !== batch.partNumberId) {
              // Different part - apply changeover time if configured
              const partChangeoverConfig = changeoverMap[batch.partNumberId]?.[eqId];
              if (partChangeoverConfig) {
                changeoverTime = partChangeoverConfig;
              }
            }
            
            // Calculate effective available time: max of chamber slot, non-chamber machines ready, and unit readiness
            const baseAvailableAt = new Date(Math.max(slots[i].getTime(), machinesReadyAt.getTime(), minStartTime.getTime()));
            // Apply changeover using working minutes and then ensure start is in working hours
            // (Chamber steps must START during working hours, but changeover is setup time)
            const afterChangeover = changeoverTime > 0 
              ? addWorkingMinutes(baseAvailableAt, changeoverTime, shifts, workDays)
              : baseAvailableAt;
            // Ensure the start time is within working hours (chamber rule)
            const slotAvailableAt = getNextWorkingTime(afterChangeover, shifts, workDays);
            
            if (!selectedChamber || slotAvailableAt < selectedChamber.availableAt) {
              selectedChamber = { 
                eqId, 
                unitIdx: i, 
                durationMinutes: chamberInfo.durationMinutes,
                availableAt: slotAvailableAt,
                changeoverApplied: changeoverTime
              };
            }
          }
        }
        
        if (!selectedChamber) return null;
        
        if (selectedChamber.availableAt > machinesReadyAt) {
          machinesReadyAt = selectedChamber.availableAt;
        }
        selectedUnits.push({ 
          eqId: selectedChamber.eqId, 
          unitIdx: selectedChamber.unitIdx, 
          durationMinutes: selectedChamber.durationMinutes 
        });
        chamberDuration = selectedChamber.durationMinutes;
      }
      
      if (selectedUnits.length === 0) return null;
      
      let effectiveDuration = step.durationMinutes;
      if (step.chamberRequired && chamberDuration !== null) {
        effectiveDuration = chamberDuration;
      }
      
      const totalDuration = batchesNeeded * effectiveDuration;
      const actualStartTime = getNextWorkingTime(machinesReadyAt, shifts, workDays);
      
      // Chamber steps: must START during working hours but can run continuously to completion
      // Non-chamber steps: must be fully completed within working hours
      const actualEndTime = step.chamberRequired 
        ? addMinutes(actualStartTime, totalDuration)  // Continuous time for chambers
        : addWorkingMinutes(actualStartTime, totalDuration, shifts, workDays);  // Working time only
      
      return { startTime: actualStartTime, endTime: actualEndTime, selectedUnits, chamberDuration };
    }
    
    // Greedy scheduling loop - schedule batches until none remain
    // This enables pipeline scheduling where subsequent step batches can start
    // as soon as enough units have completed the previous step
    while (pendingBatches.length > 0) {
      // Find all batches that are ready to be scheduled
      // A batch is ready if:
      // 1. It's step 1 (no dependencies), OR
      // 2. Enough units have completed the previous step to fill this batch
      const readyBatches: PendingBatch[] = [];
      
      for (const batch of pendingBatches) {
        const minTime = getMinStartTimeForBatch(batch);
        // If minTime is in the far future, this batch isn't ready yet
        if (minTime.getTime() < 8640000000000000) {
          readyBatches.push(batch);
        }
      }
      
      if (readyBatches.length === 0) break; // No more batches can be scheduled
      
      // For each ready batch, calculate when it could start
      const batchOptions: { batch: PendingBatch; slot: ReturnType<typeof findEarliestSlotForBatch>; minTime: Date }[] = [];
      
      for (const batch of readyBatches) {
        const minStartTime = getMinStartTimeForBatch(batch);
        const slot = findEarliestSlotForBatch(batch, minStartTime);
        if (slot) {
          batchOptions.push({ batch, slot, minTime: minStartTime });
        }
      }
      
      if (batchOptions.length === 0) break;
      
      // Sort by: earliest start time, then by priority (P1 = highest, lower number first), then by step order
      batchOptions.sort((a, b) => {
        const timeDiff = a.slot!.startTime.getTime() - b.slot!.startTime.getTime();
        if (timeDiff !== 0) return timeDiff;
        const priorityDiff = a.batch.orderPriority - b.batch.orderPriority; // lower number = higher priority
        if (priorityDiff !== 0) return priorityDiff;
        // Prefer earlier steps to maximize pipeline throughput
        return a.batch.stepOrder - b.batch.stepOrder;
      });
      
      // Schedule the best batch
      const best = batchOptions[0];
      const { batch, slot } = best;
      
      const usedEquipmentNames = slot!.selectedUnits.map(u => {
        const eq = equipmentList.find(e => e.id === u.eqId);
        return eq?.name || "Unknown";
      }).join(", ");

      // === DIAGNOSTIC LOGGING ===
      const minTimeForLog = getMinStartTimeForBatch(batch);
      const isChamberStep = batch.step.chamberRequired;
      if (isChamberStep) {
        const nonChamberEqIds = (batch.step.equipmentRequirements || [])
          .filter((r: any) => !chamberIds.has(r.equipmentId))
          .map((r: any) => {
            const eq = equipmentList.find(e => e.id === r.equipmentId);
            const avail = machineAvailability[r.equipmentId];
            return `${eq?.name || r.equipmentId}[avail=${avail?.map(d => d.toISOString().slice(11,16)).join('|')}]`;
          }).join(', ');
        console.log(
          `[SCHED] ${batch.partNumber} step${batch.stepOrder}(${batch.step.name||'?'}) b${batch.batchIndex}` +
          ` | minStart=${minTimeForLog.toISOString().slice(5,16)}` +
          ` | start=${slot!.startTime.toISOString().slice(5,16)}` +
          ` | end=${slot!.endTime.toISOString().slice(5,16)}` +
          ` | eq=[${usedEquipmentNames}]` +
          ` | nonChamberEq: ${nonChamberEqIds || 'none'}`
        );
      }
      // === END DIAGNOSTIC LOGGING ===
      
      // Create task ID that includes batch info for multi-batch steps
      const taskId = batch.totalBatches > 1 
        ? `wo-${batch.orderId}-step-${batch.stepId}-b${batch.batchIndex + 1}`
        : `wo-${batch.orderId}-step-${batch.stepId}`;
      
      tasks.push({
        id: taskId,
        workOrderId: batch.orderId,
        partNumber: batch.partNumber,
        stepId: batch.stepId,
        stepOrder: batch.stepOrder,
        stepName: batch.step.name || undefined,
        equipmentIds: slot!.selectedUnits.map(u => u.eqId),
        equipmentNames: usedEquipmentNames,
        startTime: formatISO(slot!.startTime),
        endTime: formatISO(slot!.endTime),
        type: "test_run",
        progress: 0,
        dependencies: [],
        unitsCount: batch.unitsInBatch
      });
      
      // Update machine availability and track chamber last part for changeover
      for (const unit of slot!.selectedUnits) {
        machineAvailability[unit.eqId][unit.unitIdx] = slot!.endTime;
        
        // If this is a chamber, track which part was last run on it
        if (chamberIds.has(unit.eqId)) {
          chamberLastPart[unit.eqId][unit.unitIdx] = batch.partNumberId;
        }
      }
      
      // Record this batch's completion time and unit count for pipeline tracking
      batchCompletions[batch.orderId][batch.stepOrder].push({
        endTime: slot!.endTime,
        unitsCompleted: batch.unitsInBatch
      });
      
      // Remove batch from pending
      const idx = pendingBatches.findIndex(b => 
        b.orderId === batch.orderId && 
        b.stepId === batch.stepId && 
        b.batchIndex === batch.batchIndex
      );
      if (idx >= 0) pendingBatches.splice(idx, 1);
    }

    // Second pass: Schedule remaining batches as shortage placeholders (ignoring BOM constraints)
    while (pendingBatches.length > 0) {
      const readyBatches: PendingBatch[] = [];
      for (const batch of pendingBatches) {
        const minTime = getMinStartTimeForBatch(batch, true);
        if (minTime.getTime() < 8640000000000000) {
          readyBatches.push(batch);
        }
      }
      
      if (readyBatches.length === 0) {
        break; // Prevent infinite loop if something is unresolvable
      }
      
      const batchOptions: { batch: PendingBatch; slot: ReturnType<typeof findEarliestSlotForBatch>; minTime: Date }[] = [];
      for (const batch of readyBatches) {
        const minStartTime = getMinStartTimeForBatch(batch, true);
        const slot = findEarliestSlotForBatch(batch, minStartTime);
        if (slot) {
          batchOptions.push({ batch, slot, minTime: minStartTime });
        }
      }
      
      if (batchOptions.length === 0) {
        break;
      }
      
      batchOptions.sort((a, b) => {
        const timeDiff = a.slot!.startTime.getTime() - b.slot!.startTime.getTime();
        if (timeDiff !== 0) return timeDiff;
        const priorityDiff = a.batch.orderPriority - b.batch.orderPriority;
        if (priorityDiff !== 0) return priorityDiff;
        return a.batch.stepOrder - b.batch.stepOrder;
      });
      
      const best = batchOptions[0];
      const { batch, slot } = best;
      
      const usedEquipmentNames = slot!.selectedUnits.map(u => {
        const eq = equipmentList.find(e => e.id === u.eqId);
        return eq?.name || "Unknown";
      }).join(", ");
      
      const taskId = batch.totalBatches > 1 
        ? `wo-${batch.orderId}-step-${batch.stepId}-b${batch.batchIndex + 1}-shortage`
        : `wo-${batch.orderId}-step-${batch.stepId}-shortage`;
        
      tasks.push({
        id: taskId,
        workOrderId: batch.orderId,
        partNumber: batch.partNumber,
        stepId: batch.stepId,
        stepOrder: batch.stepOrder,
        stepName: batch.step.name || undefined,
        equipmentIds: slot!.selectedUnits.map(u => u.eqId),
        equipmentNames: usedEquipmentNames,
        startTime: formatISO(slot!.startTime),
        endTime: formatISO(slot!.endTime),
        type: "shortage_placeholder",
        progress: 0,
        dependencies: [],
        unitsCount: batch.unitsInBatch
      });
      
      for (const unit of slot!.selectedUnits) {
        machineAvailability[unit.eqId][unit.unitIdx] = slot!.endTime;
        if (chamberIds.has(unit.eqId)) {
          chamberLastPart[unit.eqId][unit.unitIdx] = batch.partNumberId;
        }
      }
      
      batchCompletions[batch.orderId][batch.stepOrder].push({
        endTime: slot!.endTime,
        unitsCompleted: batch.unitsInBatch
      });
      
      const idx = pendingBatches.findIndex(b => 
        b.orderId === batch.orderId && 
        b.stepId === batch.stepId && 
        b.batchIndex === batch.batchIndex
      );
      if (idx >= 0) pendingBatches.splice(idx, 1);
    }

    // Merge consecutive batches of the same work order and step into single timeline items
    const mergedTasks: ScheduledTask[] = [];
    
    // Group tasks by work order, step, AND equipment used
    // This ensures batches on different chambers are NOT merged together
    const taskGroups = new Map<string, ScheduledTask[]>();
    for (const task of tasks) {
      const match = task.id.match(/^(wo-\d+-step-\d+)/);
      if (match) {
        const chamberEqIds = task.equipmentIds.filter(id => chamberIds.has(id)).sort().join(',');
        const key = `${task.workOrderId}-${task.stepId}-eq${chamberEqIds}-${task.type}`;
        if (!taskGroups.has(key)) {
          taskGroups.set(key, []);
        }
        taskGroups.get(key)!.push(task);
      } else {
        mergedTasks.push(task);
      }
    }
    
    // Count how many equipment groups exist per base step (workOrderId-stepId)
    const baseStepGroupCounts = new Map<string, number>();
    for (const key of Array.from(taskGroups.keys())) {
      const baseKey = key.replace(/-eq.*$/, '');
      baseStepGroupCounts.set(baseKey, (baseStepGroupCounts.get(baseKey) || 0) + 1);
    }
    
    // For each group, merge consecutive tasks
    // Track segment counts per base step (not per equipment group) for unique IDs
    const baseStepSegmentCounts = new Map<string, number>();
    
    Array.from(taskGroups.entries()).forEach(([key, groupTasks]) => {
      const baseKey = key.replace(/-eq.*$/, '');
      
      groupTasks.sort((a: ScheduledTask, b: ScheduledTask) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
      
      let currentMerged: ScheduledTask | null = null;
      
      for (const task of groupTasks) {
        if (currentMerged === null) {
          const count = (baseStepSegmentCounts.get(baseKey) || 0) + 1;
          baseStepSegmentCounts.set(baseKey, count);
          const newTask = { ...task };
          const baseId = newTask.id.replace(/-b\d+$/, '');
          newTask.id = count > 1 ? `${baseId}-s${count}` : baseId;
          currentMerged = newTask;
        } else {
          const prevEnd = new Date(currentMerged.endTime).getTime();
          const currStart = new Date(task.startTime).getTime();
          
          if (currStart <= prevEnd) {
            currentMerged.unitsCount = (currentMerged.unitsCount || 0) + (task.unitsCount || 0);
            const currEnd = new Date(task.endTime).getTime();
            if (currEnd > prevEnd) {
              currentMerged.endTime = task.endTime;
            }
          } else {
            mergedTasks.push(currentMerged);
            const count = (baseStepSegmentCounts.get(baseKey) || 0) + 1;
            baseStepSegmentCounts.set(baseKey, count);
            const newTask = { ...task };
            const baseId = newTask.id.replace(/-b\d+$/, '');
            newTask.id = `${baseId}-s${count}`;
            currentMerged = newTask;
          }
        }
      }
      
      if (currentMerged) {
        mergedTasks.push(currentMerged);
      }
    });
    
    // Sort merged tasks by start time for consistent output
    mergedTasks.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

    // Compute per-order projected completion (latest endTime across all tasks)
    const orderCompletionMap: Record<number, Date> = {};
    for (const task of mergedTasks) {
      const end = new Date(task.endTime);
      if (!orderCompletionMap[task.workOrderId] || end > orderCompletionMap[task.workOrderId]) {
        orderCompletionMap[task.workOrderId] = end;
      }
    }

    // Build due-date warnings for orders whose projected completion exceeds their due date
    const dueDateWarnings: import("../shared/schema").DueDateWarning[] = [];
    for (const order of orders) {
      if (!order.dueDate) continue;
      const projected = orderCompletionMap[order.id];
      if (!projected) continue;
      const due = new Date(order.dueDate);
      if (projected > due) {
        const daysLate = Math.ceil((projected.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
        const part = partsMap.get(order.partNumberId);
        dueDateWarnings.push({
          workOrderId: order.id,
          workOrderNumber: order.workOrderNumber ?? null,
          partNumber: part?.partNumber ?? "Unknown",
          dueDate: formatISO(due),
          projectedCompletion: formatISO(projected),
          daysLate,
        });
      }
    }

    // Sort warnings by most days late first
    dueDateWarnings.sort((a, b) => b.daysLate - a.daysLate);

    // Chronological shortage impact calculation on mergedTasks
    const orderPartMap = new Map<number, number>();
    for (const o of allOrders) {
      orderPartMap.set(o.id, o.partNumberId);
    }

    const runningConsumption: Record<number, number> = {};
    const sortedMergedTasks = [...mergedTasks].sort((a, b) => 
      new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
    );

    for (const task of sortedMergedTasks) {
      const partId = orderPartMap.get(task.workOrderId);
      if (!partId) continue;

      const deps = bomMap[partId] || [];
      let isAffected = false;

      for (const dep of deps) {
        const childPartId = dep.childPartId;
        const qtyNeeded = (task.unitsCount || 0) * dep.quantityRequired;
        if (qtyNeeded === 0) continue;

        const currentConsumed = runningConsumption[childPartId] || 0;
        const newConsumed = currentConsumed + qtyNeeded;
        runningConsumption[childPartId] = newConsumed;

        const totalSupply = supplyByPartId[childPartId] || 0;
        
        // If we don't have enough supply to cover this task's consumption, it is affected!
        if (newConsumed > totalSupply) {
          isAffected = true;
        }
      }

      if (isAffected) {
        const ref = mergedTasks.find(mt => mt.id === task.id);
        if (ref) {
          ref.isShortageAffected = true;
        }
      }
    }

    res.json({
      tasks: mergedTasks,
      equipmentUsage: {},
      dueDateWarnings,
      shortageWarnings,
    });
  });

  return httpServer;
}

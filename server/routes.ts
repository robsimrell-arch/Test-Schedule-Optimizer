import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api, errorSchemas } from "@shared/routes";
import { z } from "zod";
import { addMinutes, formatISO, setHours, setMinutes, setSeconds, setMilliseconds, addDays, isBefore, isAfter } from "date-fns";
import { seedDatabase } from "./seed";
import type { ScheduledTask, ScheduleResponse } from "@shared/schema";

// Shift configuration
const SHIFT_START_HOUR = 6; // 6 AM
const HOURS_PER_SHIFT = 8;

// Helper: Get the next available working time based on shift schedule
function getNextWorkingTime(date: Date, shifts: 1 | 2): Date {
  const hoursPerDay = shifts * HOURS_PER_SHIFT; // 8 or 16 hours
  const shiftEndHour = SHIFT_START_HOUR + hoursPerDay; // 14 (2pm) or 22 (10pm)
  
  let result = new Date(date);
  const currentHour = result.getHours();
  
  // If before shift start, move to shift start
  if (currentHour < SHIFT_START_HOUR) {
    result = setHours(result, SHIFT_START_HOUR);
    result = setMinutes(result, 0);
    result = setSeconds(result, 0);
    result = setMilliseconds(result, 0);
    return result;
  }
  
  // If after shift end, move to next day's shift start
  if (currentHour >= shiftEndHour) {
    result = addDays(result, 1);
    result = setHours(result, SHIFT_START_HOUR);
    result = setMinutes(result, 0);
    result = setSeconds(result, 0);
    result = setMilliseconds(result, 0);
    return result;
  }
  
  // Within working hours
  return result;
}

// Helper: Add working minutes (skipping non-working hours)
function addWorkingMinutes(startDate: Date, minutes: number, shifts: 1 | 2): Date {
  const hoursPerDay = shifts * HOURS_PER_SHIFT;
  const minutesPerDay = hoursPerDay * 60;
  const shiftEndHour = SHIFT_START_HOUR + hoursPerDay;
  
  // Ensure we start at a valid working time
  let current = getNextWorkingTime(startDate, shifts);
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
      // Use up today's remaining shift time and move to next day
      remainingMinutes -= minutesUntilEndOfShift;
      current = addDays(current, 1);
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
          durationMinutes: z.coerce.number().optional().nullable()
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
        chamberRequired: z.coerce.boolean().default(false),
      }).parse(req.body);
      
      const step = await storage.createStep({
        partNumberId: body.partNumberId,
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

      if (isNaN(partNumberId) || isNaN(quantity)) {
        return res.status(400).json({ message: "Invalid partNumberId or quantity" });
      }

      const order = await storage.createOrder({
        workOrderNumber,
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
        dueDate: body.dueDate ? new Date(body.dueDate) : null
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

  // === SCHEDULER LOGIC ===
  // Greedy scheduler that maximizes equipment utilization while respecting priorities
  app.get(api.schedule.calculate.path, async (req, res) => {
    const shiftsParam = parseInt(req.query.shifts as string) || 2;
    const shifts: 1 | 2 = shiftsParam === 1 ? 1 : 2;
    
    const orders = await storage.getOrders();
    const equipmentList = await storage.getEquipment();
    const allCompatibility = await storage.getAllPartCompatibility();
    const chambers = await storage.getChambers();
    
    // Build compatibility lookup
    const compatibilityMap: Record<number, { equipmentId: number; durationMinutes: number | null }[]> = {};
    for (const c of allCompatibility) {
      if (!compatibilityMap[c.partNumberId]) {
        compatibilityMap[c.partNumberId] = [];
      }
      compatibilityMap[c.partNumberId].push({ equipmentId: c.equipmentId, durationMinutes: c.durationMinutes });
    }
    
    const chamberIds = new Set(chambers.map(c => c.id));
    
    // Initialize machine availability
    const now = new Date();
    const workingStartTime = getNextWorkingTime(now, shifts);
    
    const machineAvailability: Record<number, Date[]> = {};
    equipmentList.forEach(eq => {
      machineAvailability[eq.id] = Array(eq.quantity).fill(workingStartTime); 
    });

    // Build list of all pending tasks (order-step combinations)
    interface PendingTask {
      orderId: number;
      orderPriority: number;
      partNumberId: number;
      partNumber: string;
      stepId: number;
      stepOrder: number;
      step: any;
      quantity: number;
    }
    
    const pendingTasks: PendingTask[] = [];
    const orderStepCompletion: Record<number, Date> = {}; // orderId -> when last step finished
    
    for (const order of orders) {
      const part = await storage.getPart(order.partNumberId);
      if (!part || !part.steps || part.steps.length === 0) continue;
      
      orderStepCompletion[order.id] = new Date(workingStartTime);
      
      for (const step of part.steps) {
        pendingTasks.push({
          orderId: order.id,
          orderPriority: order.priority ?? 0,
          partNumberId: order.partNumberId,
          partNumber: part.partNumber,
          stepId: step.id,
          stepOrder: step.stepOrder,
          step,
          quantity: order.quantity
        });
      }
    }
    
    // Track which step each order is currently on
    const orderCurrentStep: Record<number, number> = {};
    for (const order of orders) {
      orderCurrentStep[order.id] = 1; // Start at step 1
    }

    const tasks: ScheduledTask[] = [];
    
    // Helper function to find earliest equipment availability for a task
    function findEarliestSlot(task: PendingTask, minStartTime: Date): {
      startTime: Date;
      endTime: Date;
      selectedUnits: { eqId: number; unitIdx: number; durationMinutes: number | null }[];
      chamberDuration: number | null;
    } | null {
      const step = task.step;
      const partCompatibleChambers = compatibilityMap[task.partNumberId] || [];
      const hasCompatibilityRestrictions = partCompatibleChambers.length > 0;
      
      const totalUnits = task.quantity;
      const batchSize = step.batchSize;
      const batchesNeeded = Math.ceil(totalUnits / batchSize);
      
      const eqRequirements = (step.equipmentRequirements || []).filter(
        (req: any) => !chamberIds.has(req.equipmentId)
      );

      let selectedUnits: { eqId: number; unitIdx: number; durationMinutes: number | null }[] = [];
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
        let availableChambers: { equipmentId: number; durationMinutes: number | null }[];
        
        if (hasCompatibilityRestrictions) {
          availableChambers = partCompatibleChambers;
        } else {
          availableChambers = chambers.map(c => ({ equipmentId: c.id, durationMinutes: null }));
        }
        
        if (availableChambers.length === 0) return null;
        
        let selectedChamber: { eqId: number; unitIdx: number; durationMinutes: number | null; availableAt: Date } | null = null;
        
        for (const chamberInfo of availableChambers) {
          const eqId = chamberInfo.equipmentId;
          const slots = machineAvailability[eqId];
          if (!slots) continue;
          
          for (let i = 0; i < slots.length; i++) {
            const slotAvailableAt = new Date(Math.max(slots[i].getTime(), machinesReadyAt.getTime()));
            
            if (!selectedChamber || slotAvailableAt < selectedChamber.availableAt) {
              selectedChamber = { 
                eqId, 
                unitIdx: i, 
                durationMinutes: chamberInfo.durationMinutes,
                availableAt: slotAvailableAt 
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
      const actualStartTime = getNextWorkingTime(machinesReadyAt, shifts);
      const actualEndTime = addWorkingMinutes(actualStartTime, totalDuration, shifts);
      
      return { startTime: actualStartTime, endTime: actualEndTime, selectedUnits, chamberDuration };
    }
    
    // Greedy scheduling loop - schedule tasks until none remain
    while (pendingTasks.length > 0) {
      // Find all tasks that are ready (correct step order for their order)
      const readyTasks = pendingTasks.filter(t => t.stepOrder === orderCurrentStep[t.orderId]);
      
      if (readyTasks.length === 0) break; // No more tasks can be scheduled
      
      // For each ready task, calculate when it could start
      const taskOptions: { task: PendingTask; slot: ReturnType<typeof findEarliestSlot> }[] = [];
      
      for (const task of readyTasks) {
        const minStartTime = orderStepCompletion[task.orderId];
        const slot = findEarliestSlot(task, minStartTime);
        if (slot) {
          taskOptions.push({ task, slot });
        }
      }
      
      if (taskOptions.length === 0) break;
      
      // Sort by: earliest start time, then by priority (higher priority first)
      taskOptions.sort((a, b) => {
        const timeDiff = a.slot!.startTime.getTime() - b.slot!.startTime.getTime();
        if (timeDiff !== 0) return timeDiff;
        return b.task.orderPriority - a.task.orderPriority; // Higher priority wins ties
      });
      
      // Schedule the best task
      const best = taskOptions[0];
      const { task, slot } = best;
      
      const usedEquipmentNames = slot!.selectedUnits.map(u => {
        const eq = equipmentList.find(e => e.id === u.eqId);
        return eq?.name || "Unknown";
      }).join(", ");
      
      tasks.push({
        id: `wo-${task.orderId}-step-${task.stepId}`,
        workOrderId: task.orderId,
        partNumber: task.partNumber,
        stepId: task.stepId,
        stepOrder: task.stepOrder,
        equipmentIds: slot!.selectedUnits.map(u => u.eqId),
        equipmentNames: usedEquipmentNames,
        startTime: formatISO(slot!.startTime),
        endTime: formatISO(slot!.endTime),
        type: "test_run",
        progress: 0,
        dependencies: []
      });
      
      // Update machine availability
      for (const unit of slot!.selectedUnits) {
        machineAvailability[unit.eqId][unit.unitIdx] = slot!.endTime;
      }
      
      // Update order tracking
      orderStepCompletion[task.orderId] = slot!.endTime;
      orderCurrentStep[task.orderId] = task.stepOrder + 1;
      
      // Remove task from pending
      const idx = pendingTasks.findIndex(t => t.orderId === task.orderId && t.stepId === task.stepId);
      if (idx >= 0) pendingTasks.splice(idx, 1);
    }

    res.json({
      tasks,
      equipmentUsage: {}
    });
  });

  return httpServer;
}

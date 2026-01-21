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
  app.get(api.schedule.calculate.path, async (req, res) => {
    // Parse shifts parameter (1 or 2, default to 2)
    const shiftsParam = parseInt(req.query.shifts as string) || 2;
    const shifts: 1 | 2 = shiftsParam === 1 ? 1 : 2;
    
    const orders = await storage.getOrders();
    const equipmentList = await storage.getEquipment();
    const allCompatibility = await storage.getAllPartCompatibility();
    const chambers = await storage.getChambers();
    
    // Build compatibility lookup: partNumberId -> array of { equipmentId, durationMinutes }
    const compatibilityMap: Record<number, { equipmentId: number; durationMinutes: number | null }[]> = {};
    for (const c of allCompatibility) {
      if (!compatibilityMap[c.partNumberId]) {
        compatibilityMap[c.partNumberId] = [];
      }
      compatibilityMap[c.partNumberId].push({ equipmentId: c.equipmentId, durationMinutes: c.durationMinutes });
    }
    
    // Get all chamber IDs
    const chamberIds = new Set(chambers.map(c => c.id));
    
    // Heuristic Scheduler Implementation
    // 1. Initialize machine availability (start at next working time)
    const now = new Date();
    const workingStartTime = getNextWorkingTime(now, shifts);
    
    const machineAvailability: Record<number, Date[]> = {};
    equipmentList.forEach(eq => {
      machineAvailability[eq.id] = Array(eq.quantity).fill(workingStartTime); 
    });

    const tasks: ScheduledTask[] = [];
    
    // 2. Process orders by priority
    for (const order of orders) {
      const part = await storage.getPart(order.partNumberId);
      if (!part || !part.steps) continue;

      // Get compatible chambers for this part (empty array means all chambers allowed)
      const partCompatibleChambers = compatibilityMap[order.partNumberId] || [];
      const hasCompatibilityRestrictions = partCompatibleChambers.length > 0;

      let currentBatchStartTime = new Date(workingStartTime);
      
      for (const step of part.steps) {
        const totalUnits = order.quantity;
        const batchSize = step.batchSize;
        const batchesNeeded = Math.ceil(totalUnits / batchSize);
        
        // Get non-chamber equipment requirements from step
        const eqRequirements = (step.equipmentRequirements || []).filter(
          req => !chamberIds.has(req.equipmentId)
        );

        // Find earliest time where all required equipment are available
        let selectedUnits: { eqId: number, unitIdx: number, durationMinutes: number | null }[] = [];
        let machinesReadyAt = new Date(currentBatchStartTime);
        
        // For non-chamber equipment: require quantityRequired units of each
        for (const req of eqRequirements) {
          const eqId = req.equipmentId;
          const slots = machineAvailability[eqId];
          if (!slots) continue;
          
          const unitsNeeded = req.quantityRequired || 1;
          
          // Sort slot indices by availability time to find the N earliest
          const slotIndices = slots.map((time, idx) => ({ idx, time }))
            .sort((a, b) => a.time.getTime() - b.time.getTime());
          
          // Take the first unitsNeeded slots
          const selectedSlots = slotIndices.slice(0, Math.min(unitsNeeded, slots.length));
          
          // The time when all required units are ready is when the last of them becomes available
          if (selectedSlots.length > 0) {
            const lastSlotTime = selectedSlots[selectedSlots.length - 1].time;
            if (lastSlotTime > machinesReadyAt) {
              machinesReadyAt = lastSlotTime;
            }
          }
          
          // Add all selected units
          for (const slot of selectedSlots) {
            selectedUnits.push({ eqId, unitIdx: slot.idx, durationMinutes: req.durationMinutes ?? null });
          }
        }
        
        // Handle chamber requirement based on chamberRequired flag
        let chamberDuration: number | null = null;
        
        if (step.chamberRequired) {
          // Get compatible chambers for this part, or all chambers if no restrictions
          let availableChambers: { equipmentId: number; durationMinutes: number | null }[];
          
          if (hasCompatibilityRestrictions) {
            availableChambers = partCompatibleChambers;
          } else {
            // No restrictions - use all chambers with no specific duration
            availableChambers = chambers.map(c => ({ equipmentId: c.id, durationMinutes: null }));
          }
          
          // Skip step if chamber is required but none are available/compatible
          if (availableChambers.length === 0) continue;
          
          // Select ONE chamber from the available options (earliest available)
          let selectedChamber: { eqId: number, unitIdx: number, durationMinutes: number | null, availableAt: Date } | null = null;
          
          for (const chamberInfo of availableChambers) {
            const eqId = chamberInfo.equipmentId;
            const slots = machineAvailability[eqId];
            if (!slots) continue;
            
            // Find earliest slot for this chamber
            for(let i=0; i < slots.length; i++) {
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
          
          if (selectedChamber) {
            if (selectedChamber.availableAt > machinesReadyAt) {
              machinesReadyAt = selectedChamber.availableAt;
            }
            selectedUnits.push({ 
              eqId: selectedChamber.eqId, 
              unitIdx: selectedChamber.unitIdx, 
              durationMinutes: selectedChamber.durationMinutes 
            });
            chamberDuration = selectedChamber.durationMinutes;
          } else {
            // No chamber slot found - skip step
            continue;
          }
        }
        
        // Skip if no equipment selected at all
        if (selectedUnits.length === 0) continue;
        
        // Get equipment names for task display
        const usedEquipmentNames = selectedUnits.map(u => {
          const eq = equipmentList.find(e => e.id === u.eqId);
          return eq?.name || "Unknown";
        }).join(", ");

        // Calculate duration: 
        // - If chamberRequired and chamber has specific duration, use that
        // - Else use step default duration
        let effectiveDuration = step.durationMinutes;
        
        if (step.chamberRequired && chamberDuration !== null) {
          effectiveDuration = chamberDuration;
        }
        
        const totalDuration = batchesNeeded * effectiveDuration;

        // Ensure start time is within working hours
        let actualStartTime = getNextWorkingTime(machinesReadyAt, shifts);
        // Calculate end time accounting for shift hours (skipping non-working hours)
        let actualEndTime = addWorkingMinutes(actualStartTime, totalDuration, shifts);

        tasks.push({
          id: `wo-${order.id}-step-${step.id}`,
          workOrderId: order.id,
          partNumber: part.partNumber,
          stepId: step.id,
          stepOrder: step.stepOrder,
          equipmentIds: selectedUnits.map(u => u.eqId),
          equipmentNames: usedEquipmentNames,
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

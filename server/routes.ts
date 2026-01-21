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

  // === PART-EQUIPMENT COMPATIBILITY ROUTES ===
  app.get("/api/parts/:id/compatibility", async (req, res) => {
    const compatibility = await storage.getPartCompatibility(Number(req.params.id));
    res.json(compatibility);
  });

  app.put("/api/parts/:id/compatibility", async (req, res) => {
    try {
      const body = z.object({
        equipmentIds: z.array(z.coerce.number())
      }).parse(req.body);
      
      const compatibility = await storage.setPartCompatibility(Number(req.params.id), body.equipmentIds);
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
    const allCompatibility = await storage.getAllPartCompatibility();
    
    // Build compatibility lookup: partNumberId -> set of compatible equipmentIds
    const compatibilityMap: Record<number, Set<number>> = {};
    for (const c of allCompatibility) {
      if (!compatibilityMap[c.partNumberId]) {
        compatibilityMap[c.partNumberId] = new Set();
      }
      compatibilityMap[c.partNumberId].add(c.equipmentId);
    }
    
    // Identify ESS Chambers (equipment with "chamber" in the name)
    const essChamberIds = new Set(
      equipmentList
        .filter(eq => eq.name.toLowerCase().includes("chamber"))
        .map(eq => eq.id)
    );
    
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

      // Get compatible chambers for this part (empty set means all chambers allowed)
      const partCompatibleChambers = compatibilityMap[order.partNumberId] || new Set();
      const hasCompatibilityRestrictions = partCompatibleChambers.size > 0;

      let currentBatchStartTime = new Date();
      
      for (const step of part.steps) {
        const totalUnits = order.quantity;
        const batchSize = step.batchSize;
        const batchesNeeded = Math.ceil(totalUnits / batchSize);
        
        const eqRequirements = step.equipmentRequirements || [];
        if (eqRequirements.length === 0) continue;

        // Separate ESS chambers from other equipment
        const essChamberRequirements = eqRequirements.filter(req => essChamberIds.has(req.equipmentId));
        const nonEssChamberRequirements = eqRequirements.filter(req => !essChamberIds.has(req.equipmentId));
        
        // Filter ESS chambers by compatibility
        let compatibleChambers = essChamberRequirements;
        if (hasCompatibilityRestrictions && essChamberRequirements.length > 0) {
          compatibleChambers = essChamberRequirements.filter(req => 
            partCompatibleChambers.has(req.equipmentId)
          );
        }
        
        // Skip step if ESS chamber is required but none are compatible
        if (essChamberRequirements.length > 0 && compatibleChambers.length === 0) continue;

        // Find earliest time where all required equipment are available
        let startWindow = new Date(currentBatchStartTime);
        let selectedUnits: { eqId: number, unitIdx: number, durationMinutes: number | null }[] = [];
        let machinesReadyAt = new Date(startWindow);
        
        // For non-ESS equipment: require all of them
        for (const req of nonEssChamberRequirements) {
          const eqId = req.equipmentId;
          const slots = machineAvailability[eqId];
          
          let earliestSlotIdx = 0;
          for(let i=1; i < slots.length; i++) {
            if (slots[i] < slots[earliestSlotIdx]) earliestSlotIdx = i;
          }
          
          if (slots[earliestSlotIdx] > machinesReadyAt) {
            machinesReadyAt = slots[earliestSlotIdx];
          }
          selectedUnits.push({ eqId, unitIdx: earliestSlotIdx, durationMinutes: req.durationMinutes ?? null });
        }
        
        // For ESS chambers: select ONE from the compatible options (earliest available)
        let selectedChamber: { eqId: number, unitIdx: number, durationMinutes: number | null, availableAt: Date } | null = null;
        
        if (compatibleChambers.length > 0) {
          for (const req of compatibleChambers) {
            const eqId = req.equipmentId;
            const slots = machineAvailability[eqId];
            
            // Find earliest slot for this chamber
            for(let i=0; i < slots.length; i++) {
              const slotAvailableAt = new Date(Math.max(slots[i].getTime(), machinesReadyAt.getTime()));
              
              if (!selectedChamber || slotAvailableAt < selectedChamber.availableAt) {
                selectedChamber = { 
                  eqId, 
                  unitIdx: i, 
                  durationMinutes: req.durationMinutes ?? null,
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
          }
        }
        
        // Get equipment names for task display
        const usedEquipmentNames = selectedUnits.map(u => {
          const eq = equipmentList.find(e => e.id === u.eqId);
          return eq?.name || "Unknown";
        }).join(", ");

        // Calculate duration: use equipment-specific duration if available, otherwise use step default
        // If multiple equipment have specific durations, use the maximum (all must complete)
        let effectiveDuration = step.durationMinutes;
        const equipmentDurations = selectedUnits
          .filter(u => u.durationMinutes !== null)
          .map(u => u.durationMinutes as number);
        
        if (equipmentDurations.length > 0) {
          // Use the maximum equipment-specific duration (limiting factor)
          effectiveDuration = Math.max(...equipmentDurations);
        }
        
        const totalDuration = batchesNeeded * effectiveDuration;

        let actualStartTime = new Date(machinesReadyAt);
        let actualEndTime = addMinutes(actualStartTime, totalDuration);

        tasks.push({
          id: `wo-${order.id}-step-${step.id}`,
          workOrderId: order.id,
          partNumber: part.partNumber,
          stepId: step.id,
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

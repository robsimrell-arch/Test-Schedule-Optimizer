import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api, errorSchemas } from "../shared/routes";
import fs from "fs";
import { z } from "zod";
import { addMinutes, formatISO, setHours, setMinutes, setSeconds, setMilliseconds, addDays, isBefore, isAfter } from "date-fns";
import { seedDatabase } from "./seed";
import type { ScheduledTask, ScheduleResponse } from "../shared/schema";

// Shift configuration
const SHIFT_START_HOUR = 7; // 7 AM
const HOURS_PER_SHIFT = 8;

// Cache for solved optimal supply rates
const optimalRatesCache = new Map<string, any>();

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

// Helper: Count working days between two dates inclusive
function countWorkingDaysBetween(start: Date, end: Date, workDays: 5 | 6 | 7): number {
  let count = 0;
  let curr = new Date(start.getTime());
  curr.setHours(12, 0, 0, 0); // avoid DST issues
  const endMid = new Date(end.getTime());
  endMid.setHours(12, 0, 0, 0);
  
  while (curr.getTime() <= endMid.getTime()) {
    if (isWorkingDay(curr, workDays)) {
      count++;
    }
    curr.setDate(curr.getDate() + 1);
  }
  return Math.max(1, count);
}


// Helper: Check if time is within shift schedule working hours
function isWorkingTime(date: Date, shifts: 1 | 2 | 3, workDays: 5 | 6 | 7): boolean {
  const day = date.getDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
  
  // Check work days
  if (workDays === 5 && (day === 0 || day === 6)) return false;
  if (workDays === 6 && day === 0) return false;
  
  const hour = date.getHours();
  const minute = date.getMinutes();
  const timeInMinutes = hour * 60 + minute;
  
  if (shifts === 1) {
    // 1st shift: 6am - 2pm (360 - 840)
    return timeInMinutes >= 360 && timeInMinutes < 840;
  } else if (shifts === 2) {
    // 2 shifts: 6am - 10pm (360 - 1320)
    return timeInMinutes >= 360 && timeInMinutes < 1320;
  }
  return true; // 3 shifts / 24h
}

// Helper: Get the next available working time based on shift schedule
function getNextWorkingTime(date: Date, shifts: 1 | 2 | 3, workDays: 5 | 6 | 7 = 7): Date {
  if (date.getSeconds() === 0 && date.getMilliseconds() === 0 && isWorkingTime(date, shifts, workDays)) {
    return new Date(date.getTime());
  }
  let current = new Date(date.getTime());
  current.setSeconds(0, 0);
  current.setMilliseconds(0);
  
  while (true) {
    const day = current.getDay();
    
    // 1. Handle non-working days (weekends)
    if (workDays === 5 && (day === 0 || day === 6)) {
      const daysToAdd = day === 6 ? 2 : 1;
      current.setDate(current.getDate() + daysToAdd);
      current.setHours(6, 0, 0, 0);
      continue;
    }
    if (workDays === 6 && day === 0) {
      current.setDate(current.getDate() + 1);
      current.setHours(6, 0, 0, 0);
      continue;
    }
    
    // 2. Handle working day hours
    const hour = current.getHours();
    const minute = current.getMinutes();
    const timeInMinutes = hour * 60 + minute;
    
    if (shifts === 1) {
      if (timeInMinutes < 360) {
        current.setHours(6, 0, 0, 0);
        return current;
      } else if (timeInMinutes >= 840) {
        current.setDate(current.getDate() + 1);
        current.setHours(6, 0, 0, 0);
        continue;
      } else {
        return current;
      }
    } else if (shifts === 2) {
      if (timeInMinutes < 360) {
        current.setHours(6, 0, 0, 0);
        return current;
      } else if (timeInMinutes >= 1320) {
        current.setDate(current.getDate() + 1);
        current.setHours(6, 0, 0, 0);
        continue;
      } else {
        return current;
      }
    } else {
      // shifts === 3 (24h working day)
      return current;
    }
  }
}

// Helper: Add working minutes (skipping non-working hours and non-working days)
function addWorkingMinutes(startDate: Date, minutes: number, shifts: 1 | 2 | 3, workDays: 5 | 6 | 7 = 7): Date {
  if (shifts === 3) {
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
        current.setHours(0, 0, 0, 0);

        const fullDays = Math.floor(remainingMinutes / (24 * 60));
        if (fullDays > 0) {
          remainingMinutes -= fullDays * (24 * 60);
          for (let d = 0; d < fullDays; d++) {
            current = addDays(current, 1);
            current = skipToWorkingDay(current, workDays);
          }
        }
      }
    }
    return current;
  }
  const hoursPerDay = shifts * HOURS_PER_SHIFT;
  const minutesPerDay = hoursPerDay * 60;
  const shiftEndHour = SHIFT_START_HOUR + hoursPerDay;
  
  let current = getNextWorkingTime(startDate, shifts, workDays);
  let remainingMinutes = minutes;
  
  while (remainingMinutes > 0) {
    const currentHour = current.getHours();
    const currentMinute = current.getMinutes();
    
    const minutesUntilEndOfShift = (shiftEndHour * 60) - (currentHour * 60 + currentMinute);
    
    if (remainingMinutes <= minutesUntilEndOfShift) {
      current = addMinutes(current, remainingMinutes);
      remainingMinutes = 0;
    } else {
      remainingMinutes -= minutesUntilEndOfShift;
      current = addDays(current, 1);
      current = skipToWorkingDay(current, workDays);
      current.setHours(SHIFT_START_HOUR, 0, 0, 0);

      const fullDays = Math.floor(remainingMinutes / minutesPerDay);
      if (fullDays > 0) {
        remainingMinutes -= fullDays * minutesPerDay;
        for (let d = 0; d < fullDays; d++) {
          current = addDays(current, 1);
          current = skipToWorkingDay(current, workDays);
        }
      }
    }
  }
  return current;
}

function addWorkingDays(startDate: Date, days: number, workDays: 5 | 6 | 7): Date {
  let result = new Date(startDate.getTime());
  if (days <= 0) return result;

  const dayOfWeek = result.getDay();
  
  if (workDays === 7) {
    result.setDate(result.getDate() + days);
    return result;
  }
  
  if (workDays === 6) {
    const weeks = Math.floor(days / 6);
    let remaining = days % 6;
    result.setDate(result.getDate() + weeks * 7);
    
    while (remaining > 0) {
      result.setDate(result.getDate() + 1);
      if (result.getDay() !== 0) { // skip Sunday
        remaining--;
      }
    }
    return result;
  }
  
  const weeks = Math.floor(days / 5);
  let remaining = days % 5;
  result.setDate(result.getDate() + weeks * 7);
  
  while (remaining > 0) {
    result.setDate(result.getDate() + 1);
    const day = result.getDay();
    if (day !== 0 && day !== 6) { // skip Sat/Sun
      remaining--;
    }
  }
  return result;
}

function getSupplyTimeFromEventsAndRate(
  expectedRate: number,
  initialEvents: { time: number; qty: number }[],
  unitsNeeded: number,
  workingStartTime: Date,
  shifts: 1 | 2 | 3,
  workDays: 5 | 6 | 7,
  startHour: number
): Date {
  if (unitsNeeded <= 0) return new Date(workingStartTime);
  
  // Sort events chronologically
  const sortedEvents = [...initialEvents].sort((a, b) => a.time - b.time);
  
  // Accumulate all events that happen at or before workingStartTime
  let accumulated = 0;
  for (const ev of sortedEvents) {
    if (ev.time <= workingStartTime.getTime()) {
      accumulated += ev.qty;
    }
  }
  if (accumulated >= unitsNeeded) {
    return new Date(workingStartTime);
  }
  
  // Future events (happen after workingStartTime)
  const futureEvents = sortedEvents.filter(e => e.time > workingStartTime.getTime());
  let futureEvIdx = 0;
  
  // If there is no daily rate, we only rely on the discrete events
  if (expectedRate <= 0) {
    for (const ev of futureEvents) {
      accumulated += ev.qty;
      if (accumulated >= unitsNeeded) {
        return new Date(ev.time);
      }
    }
    return new Date(8640000000000000); // Far future
  }
  
  // Otherwise, simulate daily drops at startHour on working days
  let currentDay = new Date(workingStartTime.getTime());
  currentDay = setHours(currentDay, startHour);
  currentDay = setMinutes(currentDay, 0);
  currentDay = setSeconds(currentDay, 0);
  currentDay = setMilliseconds(currentDay, 0);
  
  let attempts = 0;
  const maxDays = 10000;
  
  while (accumulated < unitsNeeded && attempts < maxDays) {
    if (isWorkingDay(currentDay, workDays)) {
      const dropTime = currentDay.getTime();
      
      // Process any future discrete events that happen before this dropTime
      while (futureEvIdx < futureEvents.length && futureEvents[futureEvIdx].time < dropTime) {
        const ev = futureEvents[futureEvIdx++];
        accumulated += ev.qty;
        if (accumulated >= unitsNeeded) {
          return new Date(ev.time);
        }
      }
      
      // Apply the daily drop
      accumulated += expectedRate;
      if (accumulated >= unitsNeeded) {
        return new Date(Math.max(dropTime, workingStartTime.getTime()));
      }

      // OPTIMIZATION: If no more future discrete events exist, we can jump directly mathematically
      if (futureEvIdx >= futureEvents.length) {
        const remaining = unitsNeeded - accumulated;
        const dropsNeeded = Math.ceil(remaining / expectedRate);
        const targetDay = addWorkingDays(currentDay, dropsNeeded, workDays);
        return new Date(Math.max(targetDay.getTime(), workingStartTime.getTime()));
      }
    }
    
    currentDay = addDays(currentDay, 1);
    attempts++;
  }
  
  // Process any remaining future events if still not met
  while (accumulated < unitsNeeded && futureEvIdx < futureEvents.length) {
    const ev = futureEvents[futureEvIdx++];
    accumulated += ev.qty;
    if (accumulated >= unitsNeeded) {
      return new Date(ev.time);
    }
  }
  
  if (accumulated >= unitsNeeded) {
    return new Date(workingStartTime);
  }
  
  return new Date(8640000000000000);
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

  // === SUB-ASSEMBLY SUPPLY RULES ENDPOINTS ===
  app.get(api.parts.getSupplyRules.path, async (req, res) => {
    try {
      const rules = await storage.getPartSupplyRules();
      res.json(rules);
    } catch (err: any) {
      console.error("Error fetching supply rules:", err);
      res.status(500).json({ message: err.message || "Internal server error" });
    }
  });

  app.post(api.parts.saveSupplyRule.path, async (req, res) => {
    try {
      const parsed = api.parts.saveSupplyRule.input.parse(req.body);
      const rule = await storage.setPartSupplyRule(parsed.partNumberId, {
        expectedSupplyRate: parsed.expectedSupplyRate,
        fixedSupplies: parsed.fixedSupplies,
      });
      res.json(rule);
    } catch (err: any) {
      console.error("Error saving supply rule:", err);
      res.status(500).json({ message: err.message || "Internal server error" });
    }
  });

  // === SCHEDULER LOGIC ===
  // Greedy scheduler that maximizes equipment utilization while respecting priorities
  app.get(api.schedule.calculate.path, async (req, res) => {
    try {
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
      const allSupplyRules = await storage.getPartSupplyRules();
      
      const partsMap = new Map<number, typeof allParts[number]>();
      for (const part of allParts) {
        partsMap.set(part.id, part);
      }

      const supplyRulesMap = new Map<number, typeof allSupplyRules[number]>();
      for (const rule of allSupplyRules) {
        supplyRulesMap.set(rule.partNumberId, rule);
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
      const ordersByPartId: Record<number, typeof orders> = {};
      for (const order of orders) {
        if (!ordersByPartId[order.partNumberId]) ordersByPartId[order.partNumberId] = [];
        ordersByPartId[order.partNumberId].push(order);
      }

      // Build compatibility lookup (includes changeover time)
      let compatibilityMap: Record<number, { equipmentId: number; durationMinutes: number | null; changeoverMinutes: number | null }[]> = {};
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
      let changeoverMap: Record<number, Record<number, number>> = {};
      for (const c of allCompatibility) {
        if (c.changeoverMinutes && c.changeoverMinutes > 0) {
          if (!changeoverMap[c.partNumberId]) {
            changeoverMap[c.partNumberId] = {};
          }
          changeoverMap[c.partNumberId][c.equipmentId] = c.changeoverMinutes;
        }
      }
      
      const chamberIds = new Set(chambers.map(c => c.id));
      const vibeEquipment = equipmentList.find(e => e.name.toLowerCase().includes("vibration"));
      const vibeEquipmentId = vibeEquipment ? vibeEquipment.id : 10;
      const mainEquipmentIds = new Set([...chamberIds, vibeEquipmentId]);
      const now = new Date();
      const workingStartTime = getNextWorkingTime(now, shifts, workDays);

      // Build a map of work order ID -> work order number to lookup numbers for combinedOrders
      const workOrderNumberMap = new Map<number, string | null>();
      for (const order of allOrders) {
        workOrderNumberMap.set(order.id, order.workOrderNumber);
      }

      // Helper to identify the main equipment unit for task grouping
      const getEquipmentUnitKey = (task: ScheduledTask) => {
        if (!task.equipmentIds || task.equipmentIds.length === 0) return "no-equipment";
        const mainEq = task.equipmentIds.find(id => mainEquipmentIds.has(id));
        if (mainEq !== undefined) {
          const idx = task.equipmentIds.indexOf(mainEq);
          const unitIdx = task.equipmentUnitIndices?.[idx] ?? 0;
          return `${mainEq}_${unitIdx}`;
        }
        const units = task.equipmentIds.map((id, idx) => {
          const unitIdx = task.equipmentUnitIndices?.[idx] ?? 0;
          return `${id}_${unitIdx}`;
        });
        return units.sort().join(",");
      };

      // Helper to merge tasks list
      const getMergedTasks = (tasksList: ScheduledTask[]): ScheduledTask[] => {
        const tasksByEquipmentUnit = new Map<string, ScheduledTask[]>();
        for (const task of tasksList) {
          const eqKey = getEquipmentUnitKey(task);
          if (!tasksByEquipmentUnit.has(eqKey)) {
            tasksByEquipmentUnit.set(eqKey, []);
          }
          tasksByEquipmentUnit.get(eqKey)!.push(task);
        }

        const merged: ScheduledTask[] = [];

        for (const [eqKey, unitTasks] of tasksByEquipmentUnit.entries()) {
          // Sort chronologically by start time
          unitTasks.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

          let currentMerged: ScheduledTask | null = null;
          for (const task of unitTasks) {
            if (currentMerged === null) {
              const newTask = { ...task };
              newTask.combinedOrders = [{
                workOrderId: task.workOrderId,
                workOrderNumber: workOrderNumberMap.get(task.workOrderId) ?? null,
                quantity: task.unitsCount || 0
              }];
              currentMerged = newTask;
            } else {
              const canMerge = 
                currentMerged.partNumber === task.partNumber &&
                currentMerged.stepId === task.stepId &&
                currentMerged.type === task.type;

              if (canMerge) {
                const prevEnd = new Date(currentMerged.endTime).getTime();
                const currEnd = new Date(task.endTime).getTime();
                if (currEnd > prevEnd) {
                  currentMerged.endTime = task.endTime;
                }
                currentMerged.unitsCount = (currentMerged.unitsCount || 0) + (task.unitsCount || 0);
                if (task.isShortageAffected) {
                  currentMerged.isShortageAffected = true;
                }
                if (task.constrainingSubassemblyName) {
                  currentMerged.constrainingSubassemblyName = task.constrainingSubassemblyName;
                }
                
                if (!currentMerged.combinedOrders) currentMerged.combinedOrders = [];
                const existingOrder = currentMerged.combinedOrders.find(co => co.workOrderId === task.workOrderId);
                if (existingOrder) {
                  existingOrder.quantity += task.unitsCount || 0;
                } else {
                  currentMerged.combinedOrders.push({
                    workOrderId: task.workOrderId,
                    workOrderNumber: workOrderNumberMap.get(task.workOrderId) ?? null,
                    quantity: task.unitsCount || 0
                  });
                }
              } else {
                merged.push(currentMerged);
                const newTask = { ...task };
                newTask.combinedOrders = [{
                  workOrderId: task.workOrderId,
                  workOrderNumber: workOrderNumberMap.get(task.workOrderId) ?? null,
                  quantity: task.unitsCount || 0
                }];
                currentMerged = newTask;
              }
            }
          }
          if (currentMerged) {
            merged.push(currentMerged);
          }
        }
        return merged;
      };

      // Pre-scheduling shortage check (updated to include supply rules)
      const supplyByPartId: Record<number, number> = {};
      for (const part of allParts) {
        const childWOs = ordersByPartId[part.id] || [];
        let supply = childWOs.reduce((sum, wo) => sum + wo.quantity, 0);

        const rule = supplyRulesMap.get(part.id);
        if (rule) {
          if (rule.fixedSupplies) {
            try {
              const fixed = JSON.parse(rule.fixedSupplies);
              if (Array.isArray(fixed)) {
                supply += fixed.reduce((sum, f) => sum + (Number(f.quantity) || 0), 0);
              }
            } catch (e) {}
          }
          if (rule.expectedSupplyRate) {
            supply += rule.expectedSupplyRate * 30; // 30 days projection
          }
        }
        supplyByPartId[part.id] = supply;
      }

      // Calculate demand: sum up child units needed across all active parent work orders
      const demandByChildId: Record<number, number> = {};
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

      // Compare supply vs demand to identify shortages
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

      const rawSupplyCache = new Map<string, Date>();
      const childReadyCache = new Map<string, Date>();

      // Helper to find when raw incoming subassemblies are supplied from vendor/pre-production
      function _getRawPartSupplyTime(partId: number, unitsNeeded: number, ignoreRateLimit = false, customRates?: Record<number, number>): Date {
        if (unitsNeeded <= 0) return new Date(workingStartTime);
        
        const rule = supplyRulesMap.get(partId);
        if (!rule) {
          return new Date(workingStartTime);
        }
        
        const initialEvents: { time: number; qty: number }[] = [];
        let expectedRate: number;
        if (ignoreRateLimit) {
          expectedRate = Infinity;
        } else if (customRates && customRates[partId] !== undefined) {
          expectedRate = customRates[partId];
        } else {
          expectedRate = rule.expectedSupplyRate || 0;
        }
        
        if (rule.fixedSupplies) {
          try {
            const fixed = JSON.parse(rule.fixedSupplies);
            if (Array.isArray(fixed)) {
              for (const f of fixed) {
                if (f.date && f.quantity) {
                  initialEvents.push({
                    time: new Date(f.date).getTime(),
                    qty: Number(f.quantity)
                  });
                }
              }
            }
          } catch (e) {}
        }
        
        const startHour = shifts === 3 ? 0 : SHIFT_START_HOUR;
        return getSupplyTimeFromEventsAndRate(expectedRate, initialEvents, unitsNeeded, workingStartTime, shifts, workDays, startHour);
      }

      function getRawPartSupplyTime(partId: number, unitsNeeded: number, ignoreRateLimit = false, customRates?: Record<number, number>): Date {
        const cacheKey = `${partId}-${unitsNeeded}-${ignoreRateLimit}`;
        const cached = rawSupplyCache.get(cacheKey);
        if (cached) return cached;
        const res = _getRawPartSupplyTime(partId, unitsNeeded, ignoreRateLimit, customRates);
        rawSupplyCache.set(cacheKey, res);
        return res;
      }

      // Helper to find the earliest time when we have enough child units
      function _getChildReadyTime(
        childPartId: number, 
        childUnitsNeeded: number, 
        batchCompletions: Record<number, Record<number, { endTime: Date; unitsCompleted: number }[]>>
      ): Date {
        if (childUnitsNeeded <= 0) return new Date(workingStartTime);

        const childOrders = ordersByPartId[childPartId] || [];
        const initialEvents: { time: number; qty: number }[] = [];

        // 1. Gather discrete completions from child WOs
        for (const childOrder of childOrders) {
          const childComps = batchCompletions[childOrder.id];
          if (!childComps) continue;
          const stepKeys = Object.keys(childComps).map(Number);
          if (stepKeys.length === 0) continue;
          const lastStep = Math.max(...stepKeys);
          for (const comp of (childComps[lastStep] || [])) {
            initialEvents.push({
              time: comp.endTime.getTime(),
              qty: comp.unitsCompleted
            });
          }
        }

        // 2. Gather fixed supplies from rules ONLY if there are no active child WOs
        const rule = supplyRulesMap.get(childPartId);
        let expectedRate = 0;
        if (rule && childOrders.length === 0) {
          expectedRate = rule.expectedSupplyRate || 0;
          if (rule.fixedSupplies) {
            try {
              const fixed = JSON.parse(rule.fixedSupplies);
              if (Array.isArray(fixed)) {
                for (const f of fixed) {
                  if (f.date && f.quantity) {
                    initialEvents.push({
                      time: new Date(f.date).getTime(),
                      qty: Number(f.quantity)
                    });
                  }
                }
              }
            } catch (e) {}
          }
        }

        const startHour = shifts === 3 ? 0 : SHIFT_START_HOUR;
        return getSupplyTimeFromEventsAndRate(expectedRate, initialEvents, childUnitsNeeded, workingStartTime, shifts, workDays, startHour);
      }

      function getChildReadyTime(
        childPartId: number, 
        childUnitsNeeded: number, 
        batchCompletions: Record<number, Record<number, { endTime: Date; unitsCompleted: number }[]>>
      ): Date {
        const cacheKey = `${childPartId}-${childUnitsNeeded}`;
        const cached = childReadyCache.get(cacheKey);
        if (cached) return cached;
        const res = _getChildReadyTime(childPartId, childUnitsNeeded, batchCompletions);
        childReadyCache.set(cacheKey, res);
        return res;
      }

      // Helper function to simulate scheduling
      function runSimulation(
        ignoreBOM: boolean, 
        unconstrainedStartTimes?: Record<string, Date>,
        sortingRule: 'priority' | 'edd' | 'spt' = 'priority',
        vibeGroupingWindowMs: number = 28800000,
        ignoreRateLimit = false,
        customRates?: Record<number, number>,
        skipShortagePass = false
      ) {
        rawSupplyCache.clear();
        childReadyCache.clear();
        const machineAvailability: Record<number, Date[]> = {};
        equipmentList.forEach(eq => {
          machineAvailability[eq.id] = Array(eq.quantity).fill(workingStartTime); 
        });
        
        const equipmentLastPart: Record<number, Record<number, number | null>> = {};
        equipmentList.forEach(eq => {
          equipmentLastPart[eq.id] = {};
          for (let i = 0; i < eq.quantity; i++) {
            equipmentLastPart[eq.id][i] = null;
          }
        });

        interface PendingBatch {
          orderId: number;
          orderPriority: number;
          dueDateMs: number;
          processingTimeMinutes: number;
          partNumberId: number;
          partNumber: string;
          stepId: number;
          stepOrder: number;
          step: any;
          batchIndex: number;
          unitsInBatch: number;
          totalBatches: number;
        }
        
        const pendingBatches: PendingBatch[] = [];
        const batchCompletions: Record<number, Record<number, { endTime: Date; unitsCompleted: number }[]>> = {};
        const globalConsumed: Record<number, number> = {};
        const orderStepImpliedCompleted = new Map<number, Map<number, number>>();
        
        for (const order of orders) {
          const part = partsMap.get(order.partNumberId);
          if (!part || !part.steps || part.steps.length === 0) continue;
          
          batchCompletions[order.id] = {};
          const offsetsMap: Record<number, number> = {};
          if (order.stepOffsets) {
            order.stepOffsets.forEach(offset => {
              offsetsMap[offset.stepId] = offset.quantityCompleted;
            });
          }
          
          for (const step of part.steps) {
            batchCompletions[order.id][step.stepOrder] = [];
            const completedCount = offsetsMap[step.id] || 0;
            
            let impliedCompletedCount = completedCount;
            for (const otherStep of part.steps) {
              if (otherStep.stepOrder > step.stepOrder) {
                const otherCompleted = offsetsMap[otherStep.id] || 0;
                if (otherCompleted > impliedCompletedCount) {
                  impliedCompletedCount = otherCompleted;
                }
              }
            }

            if (!orderStepImpliedCompleted.has(order.id)) {
              orderStepImpliedCompleted.set(order.id, new Map<number, number>());
            }
            orderStepImpliedCompleted.get(order.id)!.set(step.id, impliedCompletedCount);

            if (impliedCompletedCount > 0) {
              batchCompletions[order.id][step.stepOrder].push({
                endTime: workingStartTime,
                unitsCompleted: impliedCompletedCount
              });
            }

            const remainingQtyToProcess = order.quantity - impliedCompletedCount;
            if (remainingQtyToProcess <= 0) continue;

            const batchSize = step.batchSize;
            const totalBatches = Math.ceil(remainingQtyToProcess / batchSize);
            
            const durationMinutes = step.durationMinutes || (step.equipmentRequirements?.[0]?.durationMinutes || 30);
            for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
              const unitsInThisBatch = Math.min(batchSize, remainingQtyToProcess - (batchIdx * batchSize));
              pendingBatches.push({
                orderId: order.id,
                orderPriority: order.priority ?? 0,
                dueDateMs: order.dueDate ? new Date(order.dueDate).getTime() : Infinity,
                processingTimeMinutes: durationMinutes,
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

        function getMinStartTimeForBatch(batch: PendingBatch, ignoreBOMOverride = false): { time: Date; constrainingChildPartId: number | null } {
          if (batch.stepOrder === 1) {
            if (ignoreBOM || ignoreBOMOverride) {
              return { time: new Date(workingStartTime), constrainingChildPartId: null };
            }

            let minTime = new Date(workingStartTime);
            let constrainingChildPartId: number | null = null;
            
            // Constrain by raw part supply if this part has a supply rule
            const rawSupplyTime = getRawPartSupplyTime(batch.partNumberId, (batch.batchIndex * batch.step.batchSize) + batch.unitsInBatch, ignoreRateLimit, customRates);
            if (rawSupplyTime.getTime() === 8640000000000000) {
              return { time: new Date(8640000000000000), constrainingChildPartId: batch.partNumberId };
            }
            if (rawSupplyTime > minTime) {
              minTime = rawSupplyTime;
              constrainingChildPartId = batch.partNumberId;
            }

            const deps = bomMap[batch.partNumberId] || [];

            for (const dep of deps) {
              const neededFromThisBatch = batch.unitsInBatch * dep.quantityRequired;
              const childUnitsNeeded = (globalConsumed[dep.childPartId] || 0) + neededFromThisBatch;

              const readyAt = getChildReadyTime(dep.childPartId, childUnitsNeeded, batchCompletions);
              if (readyAt.getTime() === 8640000000000000) {
                return { time: new Date(8640000000000000), constrainingChildPartId: dep.childPartId };
              }
              if (readyAt > minTime) {
                minTime = readyAt;
                constrainingChildPartId = dep.childPartId;
              }
            }
            return { time: minTime, constrainingChildPartId };
          }
          
          const prevStepCompletions = batchCompletions[batch.orderId][batch.stepOrder - 1] || [];
          if (prevStepCompletions.length === 0) return { time: new Date(8640000000000000), constrainingChildPartId: null };
          
          const currentStepBatchSize = batch.step.batchSize;
          const completedThisStep = orderStepImpliedCompleted.get(batch.orderId)?.get(batch.stepId) || 0;
          const unitsNeededForThisBatch = completedThisStep + batch.batchIndex * currentStepBatchSize + batch.unitsInBatch;
          
          let unitsCompleted = 0;
          for (const completion of prevStepCompletions) {
            unitsCompleted += completion.unitsCompleted;
            if (unitsCompleted >= unitsNeededForThisBatch) {
              return { time: completion.endTime, constrainingChildPartId: null };
            }
          }
          return { time: new Date(8640000000000000), constrainingChildPartId: null };
        }

        function findEarliestSlotForBatch(batch: PendingBatch, minStartTime: Date) {
          const step = batch.step;
          const partCompatibleChambers = compatibilityMap[batch.partNumberId] || [];
          const hasCompatibilityRestrictions = partCompatibleChambers.length > 0;
          const eqRequirements = (step.equipmentRequirements || []).filter((req: any) => !chamberIds.has(req.equipmentId));

          let selectedUnits: { eqId: number; unitIdx: number; durationMinutes: number | null }[] = [];
          let machinesReadyAtMs = minStartTime.getTime();
          const minStartTimeMs = minStartTime.getTime();
          
          for (const req of eqRequirements) {
            const eqId = req.equipmentId;
            const slots = machineAvailability[eqId];
            if (!slots) continue;
            
            const unitsNeeded = req.quantityRequired || 1;
            
            const slotIndices = slots.map((time: Date, idx: number) => {
              let changeoverTime = 0;
              const lastPartOnUnit = equipmentLastPart[eqId]?.[idx];
              if (eqId === vibeEquipmentId) {
                if (lastPartOnUnit !== null) {
                  if (lastPartOnUnit === batch.partNumberId) {
                    changeoverTime = 15;
                  } else {
                    changeoverTime = 45;
                  }
                }
              } else {
                if (lastPartOnUnit !== null && lastPartOnUnit !== batch.partNumberId) {
                  const partChangeoverConfig = changeoverMap[batch.partNumberId]?.[eqId];
                  if (partChangeoverConfig) changeoverTime = partChangeoverConfig;
                }
              }
              
              const timeMs = time.getTime();
              const baseAvailableMs = Math.max(timeMs, minStartTimeMs);
              
              let afterChangeoverMs = baseAvailableMs;
              if (changeoverTime > 0) {
                const baseAvailableDate = new Date(baseAvailableMs);
                const afterChangeoverDate = addWorkingMinutes(baseAvailableDate, changeoverTime, shifts, workDays);
                afterChangeoverMs = afterChangeoverDate.getTime();
              }
              
              return { idx, timeMs: afterChangeoverMs };
            }).sort((a: any, b: any) => a.timeMs - b.timeMs);
            
            const selectedSlots = slotIndices.slice(0, Math.min(unitsNeeded, slots.length));
            if (selectedSlots.length > 0) {
              const lastSlotTimeMs = selectedSlots[selectedSlots.length - 1].timeMs;
              if (lastSlotTimeMs > machinesReadyAtMs) machinesReadyAtMs = lastSlotTimeMs;
            }
            for (const slot of selectedSlots) {
              selectedUnits.push({ eqId, unitIdx: slot.idx, durationMinutes: req.durationMinutes ?? null });
            }
          }
          
          let chamberDuration: number | null = null;
          if (step.chamberRequired) {
            let availableChambers = hasCompatibilityRestrictions
              ? partCompatibleChambers
              : chambers.map(c => ({ equipmentId: c.id, durationMinutes: null, changeoverMinutes: null }));
            
            if (availableChambers.length === 0) return null;
            let selectedChamber: { eqId: number; unitIdx: number; durationMinutes: number | null; availableAtMs: number } | null = null;
            
            for (const chamberInfo of availableChambers) {
              const eqId = chamberInfo.equipmentId;
              const slots = machineAvailability[eqId];
              if (!slots) continue;
              
              for (let i = 0; i < slots.length; i++) {
                let changeoverTime = 0;
                const lastPartOnUnit = equipmentLastPart[eqId]?.[i];
                if (eqId === vibeEquipmentId) {
                  if (lastPartOnUnit !== null) {
                    if (lastPartOnUnit === batch.partNumberId) {
                      changeoverTime = 15;
                    } else {
                      changeoverTime = 45;
                    }
                  }
                } else {
                  if (lastPartOnUnit !== null && lastPartOnUnit !== batch.partNumberId) {
                    const partChangeoverConfig = changeoverMap[batch.partNumberId]?.[eqId];
                    if (partChangeoverConfig) changeoverTime = partChangeoverConfig;
                  }
                }
                
                const slotTimeMs = slots[i].getTime();
                const baseAvailableMs = Math.max(slotTimeMs, machinesReadyAtMs, minStartTimeMs);
                
                let afterChangeoverMs = baseAvailableMs;
                if (changeoverTime > 0) {
                  const baseAvailableDate = new Date(baseAvailableMs);
                  const afterChangeoverDate = addWorkingMinutes(baseAvailableDate, changeoverTime, shifts, workDays);
                  afterChangeoverMs = afterChangeoverDate.getTime();
                }
                
                if (!selectedChamber || afterChangeoverMs < selectedChamber.availableAtMs) {
                  selectedChamber = { eqId, unitIdx: i, durationMinutes: chamberInfo.durationMinutes, availableAtMs: afterChangeoverMs };
                }
              }
            }
            
            if (!selectedChamber) return null;
            if (selectedChamber.availableAtMs > machinesReadyAtMs) machinesReadyAtMs = selectedChamber.availableAtMs;
            selectedUnits.push({ eqId: selectedChamber.eqId, unitIdx: selectedChamber.unitIdx, durationMinutes: selectedChamber.durationMinutes });
            chamberDuration = selectedChamber.durationMinutes;
          }
          
          if (selectedUnits.length === 0) return null;
          let effectiveDuration = step.durationMinutes;
          if (step.chamberRequired && chamberDuration !== null) effectiveDuration = chamberDuration;
          
          const machinesReadyAt = new Date(machinesReadyAtMs);
          const actualStartTime = getNextWorkingTime(machinesReadyAt, shifts, workDays);
          const actualEndTime = step.chamberRequired 
            ? addMinutes(actualStartTime, effectiveDuration)
            : addWorkingMinutes(actualStartTime, effectiveDuration, shifts, workDays);
          
          return { startTime: actualStartTime, endTime: actualEndTime, selectedUnits };
        }

        const tasksList: ScheduledTask[] = [];

        interface CachedSlot {
          minTime: Date;
          constrainingChildPartId: number | null;
          slot: ReturnType<typeof findEarliestSlotForBatch> | null;
          dirty: boolean;
        }

        const slotCache = new Map<string, CachedSlot>();
        const batchBottleneckMap = new Map<string, number>();

        // Greedy scheduling passes
        const passes = skipShortagePass ? [false] : [false, true];
        for (const passIgnoreBOM of passes) {
          slotCache.clear();
          childReadyCache.clear();
          while (pendingBatches.length > 0) {
            const readyBatches: PendingBatch[] = [];
            for (const batch of pendingBatches) {
              const batchKey = `${batch.orderId}-${batch.stepId}-${batch.batchIndex}`;
              let cached = slotCache.get(batchKey);
              if (!cached || cached.dirty) {
                const { time: minTime, constrainingChildPartId } = getMinStartTimeForBatch(batch, passIgnoreBOM);
                if (minTime.getTime() < 8640000000000000) {
                  const slot = findEarliestSlotForBatch(batch, minTime);
                  cached = { minTime, constrainingChildPartId, slot, dirty: false };
                } else {
                  cached = { minTime, constrainingChildPartId, slot: null, dirty: false };
                }
                slotCache.set(batchKey, cached);
              }

              if (cached.minTime.getTime() < 8640000000000000) {
                readyBatches.push(batch);
              } else {
                if (!passIgnoreBOM && cached.constrainingChildPartId !== null) {
                  batchBottleneckMap.set(batchKey, cached.constrainingChildPartId);
                }
              }
            }
            if (readyBatches.length === 0) break;
            
            const batchOptions: { batch: PendingBatch; slot: ReturnType<typeof findEarliestSlotForBatch>; constrainingChildPartId: number | null; baseTimeMs: number; biasedTimeMs: number }[] = [];
            for (const batch of readyBatches) {
              const batchKey = `${batch.orderId}-${batch.stepId}-${batch.batchIndex}`;
              const cached = slotCache.get(batchKey)!;
              if (cached.slot) {
                let hasChangeover = false;
                let isVibe = false;
                for (const unit of cached.slot.selectedUnits) {
                  if (unit.eqId === vibeEquipmentId) {
                    isVibe = true;
                  }
                  const lastPartOnUnit = equipmentLastPart[unit.eqId]?.[unit.unitIdx];
                  if (lastPartOnUnit !== null && lastPartOnUnit !== batch.partNumberId) {
                    hasChangeover = true;
                  }
                }
                const baseTimeMs = cached.slot.startTime.getTime();
                let biasedTimeMs = baseTimeMs;
                if (!hasChangeover) {
                  // Apply dynamic Vibe grouping window and 1-hour bias for other equipment
                  biasedTimeMs = isVibe ? baseTimeMs - vibeGroupingWindowMs : baseTimeMs - 3600000;
                }
                
                batchOptions.push({ batch, slot: cached.slot, constrainingChildPartId: cached.constrainingChildPartId, baseTimeMs, biasedTimeMs });
              }
            }
            if (batchOptions.length === 0) break;
            
            batchOptions.sort((a, b) => {
              const timeDiff = Math.abs(a.baseTimeMs - b.baseTimeMs);
              if (timeDiff <= 14400000) { // 4 * 60 * 60 * 1000
                if (sortingRule === 'edd') {
                  if (a.batch.dueDateMs !== b.batch.dueDateMs) {
                    return a.batch.dueDateMs - b.batch.dueDateMs;
                  }
                } else if (sortingRule === 'spt') {
                  if (a.batch.processingTimeMinutes !== b.batch.processingTimeMinutes) {
                    return a.batch.processingTimeMinutes - b.batch.processingTimeMinutes;
                  }
                } else {
                  const priorityDiff = a.batch.orderPriority - b.batch.orderPriority;
                  if (priorityDiff !== 0) return priorityDiff;
                }
              }
              
              if (a.biasedTimeMs !== b.biasedTimeMs) return a.biasedTimeMs - b.biasedTimeMs;
              
              if (sortingRule === 'edd') {
                if (a.batch.dueDateMs !== b.batch.dueDateMs) {
                  return a.batch.dueDateMs - b.batch.dueDateMs;
                }
              } else if (sortingRule === 'spt') {
                if (a.batch.processingTimeMinutes !== b.batch.processingTimeMinutes) {
                  return a.batch.processingTimeMinutes - b.batch.processingTimeMinutes;
                }
              } else {
                const priorityDiff = a.batch.orderPriority - b.batch.orderPriority;
                if (priorityDiff !== 0) return priorityDiff;
              }
              return a.batch.batchIndex - b.batch.batchIndex;
            });
            
            const best = batchOptions[0];
            const { batch, slot, constrainingChildPartId } = best;
            const usedEquipmentNames = slot!.selectedUnits.map(u => {
              const eq = equipmentList.find(e => e.id === u.eqId);
              return eq?.name || "Unknown";
            }).join(", ");

            const taskId = batch.totalBatches > 1 
              ? `wo-${batch.orderId}-step-${batch.stepId}-b${batch.batchIndex + 1}`
              : `wo-${batch.orderId}-step-${batch.stepId}`;
            
            const batchKey = `${batch.orderId}-${batch.stepId}-${batch.batchIndex}`;
            let isShortageAffected = false;
            
            const parentDeps = bomMap[batch.partNumberId] || [];
            if (!ignoreBOM && !passIgnoreBOM && unconstrainedStartTimes && unconstrainedStartTimes[batchKey]) {
              const uStart = unconstrainedStartTimes[batchKey];
              if (slot!.startTime.getTime() > uStart.getTime()) {
                if (constrainingChildPartId !== null) {
                  const rule = supplyRulesMap.get(constrainingChildPartId);
                  const expectedRate = rule?.expectedSupplyRate || 0;
                  const optimalRate = optimalSupplyRates[constrainingChildPartId] || 0;
                  if (expectedRate < optimalRate) {
                    if (constrainingChildPartId === batch.partNumberId) {
                      const parentUnitsCumulative = batch.batchIndex * batch.step.batchSize + batch.unitsInBatch;
                      const rawSupplyTime = getRawPartSupplyTime(constrainingChildPartId, parentUnitsCumulative, ignoreRateLimit, customRates);
                      if (rawSupplyTime.getTime() > uStart.getTime()) {
                        isShortageAffected = true;
                      }
                    } else {
                      const dep = parentDeps.find(d => d.childPartId === constrainingChildPartId);
                      if (dep) {
                        const neededFromThisBatch = batch.unitsInBatch * dep.quantityRequired;
                        const childUnitsNeeded = (globalConsumed[dep.childPartId] || 0) + neededFromThisBatch;
                        const rawSupplyTime = getRawPartSupplyTime(constrainingChildPartId, childUnitsNeeded, ignoreRateLimit, customRates);
                        if (rawSupplyTime.getTime() > uStart.getTime()) {
                          isShortageAffected = true;
                        }
                      }
                    }
                  }
                }
              }
            }

            let constrainingSubassemblyName: string | undefined = undefined;
            if (passIgnoreBOM) {
              const bPartId = batchBottleneckMap.get(batchKey);
              if (bPartId) {
                const childPart = partsMap.get(bPartId);
                if (childPart) constrainingSubassemblyName = childPart.partNumber;
              }
            } else if (isShortageAffected && constrainingChildPartId) {
              const childPart = partsMap.get(constrainingChildPartId);
              if (childPart) constrainingSubassemblyName = childPart.partNumber;
            }

            tasksList.push({
              id: passIgnoreBOM ? `${taskId}-shortage` : taskId,
              workOrderId: batch.orderId,
              partNumber: batch.partNumber,
              stepId: batch.stepId,
              stepOrder: batch.stepOrder,
              stepName: batch.step.name || undefined,
              equipmentIds: slot!.selectedUnits.map(u => u.eqId),
              equipmentUnitIndices: slot!.selectedUnits.map(u => u.unitIdx),
              equipmentNames: usedEquipmentNames,
              startTime: formatISO(slot!.startTime),
              endTime: formatISO(slot!.endTime),
              type: passIgnoreBOM ? "shortage_placeholder" : "test_run",
              progress: 0,
              dependencies: [],
              unitsCount: batch.unitsInBatch,
              isShortageAffected: isShortageAffected || undefined,
              constrainingSubassemblyName
            });
            
            for (const unit of slot!.selectedUnits) {
              machineAvailability[unit.eqId][unit.unitIdx] = slot!.endTime;
              equipmentLastPart[unit.eqId][unit.unitIdx] = batch.partNumberId;
            }
            
            batchCompletions[batch.orderId][batch.stepOrder].push({
              endTime: slot!.endTime,
              unitsCompleted: batch.unitsInBatch
            });

            if (batch.stepOrder === 1) {
              const deps = bomMap[batch.partNumberId] || [];
              for (const dep of deps) {
                globalConsumed[dep.childPartId] = (globalConsumed[dep.childPartId] || 0) + batch.unitsInBatch * dep.quantityRequired;
              }
            }

            // Invalidate cache for dirty batches BEFORE removing best from pendingBatches
            const updatedEqIds = new Set<number>(slot!.selectedUnits.map(u => u.eqId));
            const updatedPartIds = new Set<number>([batch.partNumberId]);
            const updatedOrderId = batch.orderId;
            const updatedStepOrder = batch.stepOrder;

            for (const b of pendingBatches) {
              const bKey = `${b.orderId}-${b.stepId}-${b.batchIndex}`;
              const cached = slotCache.get(bKey);
              if (!cached || cached.dirty) continue;

              let isDirty = false;

              // 1. Check equipment overlap
              const bEqReqs = b.step.equipmentRequirements || [];
              for (const req of bEqReqs) {
                if (updatedEqIds.has(req.equipmentId)) {
                  isDirty = true;
                  break;
                }
              }
              if (!isDirty && b.step.chamberRequired) {
                const bChambers = compatibilityMap[b.partNumberId] || [];
                if (bChambers.length > 0) {
                  for (const c of bChambers) {
                    if (updatedEqIds.has(c.equipmentId)) {
                      isDirty = true;
                      break;
                    }
                  }
                } else {
                  for (const c of chambers) {
                    if (updatedEqIds.has(c.id)) {
                      isDirty = true;
                      break;
                    }
                  }
                }
              }

              // 2. Check BOM dependencies
              if (!isDirty && b.stepOrder === 1) {
                const deps = bomMap[b.partNumberId] || [];
                for (const dep of deps) {
                  if (updatedPartIds.has(dep.childPartId)) {
                    isDirty = true;
                    break;
                  }
                }
              }

              // 3. Check previous step completions
              if (!isDirty && b.stepOrder > 1) {
                if (b.orderId === updatedOrderId && b.stepOrder - 1 === updatedStepOrder) {
                  isDirty = true;
                }
              }

              if (isDirty) {
                cached.dirty = true;
              }
            }
            
            const idx = pendingBatches.findIndex(b => 
              b.orderId === batch.orderId && b.stepId === batch.stepId && b.batchIndex === batch.batchIndex
            );
            if (idx >= 0) pendingBatches.splice(idx, 1);
            
            childReadyCache.clear();
          }
        }

        return { tasksList, batchCompletions };
      }

      // --- SIMULATION RUNS & CACHE CHECK ---
      // Compute cache key for optimal rates cache (optimal rates do not change unless shifts, workDays, orders, or compatibility change)
      const ordersKey = JSON.stringify(orders.map(o => ({ id: o.id, q: o.quantity, p: o.priority, d: o.dueDate, offsets: o.stepOffsets })));
      const compatKey = JSON.stringify(allCompatibility.map(c => ({ p: c.partNumberId, e: c.equipmentId, d: c.durationMinutes, co: c.changeoverMinutes })));
      const cacheKey = `${shifts}-${workDays}-${ordersKey}-${compatKey}`;
      
      const optimalSupplyRates: Record<number, number> = {};
      let unconstrainedStartTimes: Record<string, Date> = {};
      let bestCandidate: any = null;

      if (optimalRatesCache.has(cacheKey)) {
        const cached = optimalRatesCache.get(cacheKey)!;
        Object.assign(optimalSupplyRates, cached.optimalSupplyRates);
        unconstrainedStartTimes = { ...cached.unconstrainedStartTimes };
        bestCandidate = { ...cached.bestCandidate };
      } else {
        const tStart = Date.now();
        // Define candidates for Multi-Heuristic Optimizer Search
        const candidates: { rule: 'priority' | 'edd' | 'spt'; windowMs: number }[] = [
          { rule: 'priority', windowMs: 28800000 },
          { rule: 'edd', windowMs: 28800000 },
          { rule: 'spt', windowMs: 28800000 }
        ];

        // --- STEP 1: COMPATIBILITY PRUNING PHASE ---
        // For each part with multiple compatible chambers, test whether removing
        // any chamber improves the overall schedule makespan. This prevents a
        // situation where adding a "helpful" chamber actually starves other parts
        // that depend on that chamber, causing the overall schedule to balloon.
        const partsWithMultipleChambers: number[] = [];
        for (const partIdStr of Object.keys(compatibilityMap)) {
          const partId = Number(partIdStr);
          const chamberCompats = compatibilityMap[partId];
          const partName = partsMap.get(partId)?.partNumber || '';
          if (chamberCompats && chamberCompats.length > 1 && partName.includes('LRU')) {
            partsWithMultipleChambers.push(partId);
          }
        }

        const initialSupplyRates: Record<number, number> = {};
        for (const part of allParts) {
          const rule = supplyRulesMap.get(part.id);
          initialSupplyRates[part.id] = rule?.expectedSupplyRate || 10;
        }

        function evaluateSingleCandidatePruning(cand: typeof candidates[0]): { days: number; score: number } {
          const { tasksList } = runSimulation(false, {}, cand.rule, cand.windowMs, false, initialSupplyRates, true);
          const merged = getMergedTasks(tasksList);
          let maxEndMs = workingStartTime.getTime();
          for (const t of merged) {
            const endMs = new Date(t.endTime).getTime();
            if (endMs > maxEndMs) maxEndMs = endMs;
          }
          const days = countWorkingDaysBetween(workingStartTime, new Date(maxEndMs), workDays);
          const score = days * 1000 + merged.length * 10;
          return { days, score };
        }

        function evaluateAllCandidatesPruning(): { bestScore: number; bestDays: number; bestCand: typeof candidates[0] } {
          const cand = candidates[0];
          const res = evaluateSingleCandidatePruning(cand);
          return { bestScore: res.score, bestDays: res.days, bestCand: cand };
        }

        if (partsWithMultipleChambers.length > 0) {
          let pruningImproved = true;
          let pruningIteration = 0;
          const maxPruningIterations = 1;

          while (pruningImproved && pruningIteration < maxPruningIterations) {
            pruningImproved = false;
            pruningIteration++;

            const baseline = evaluateAllCandidatesPruning();
            let currentBestDays = baseline.bestDays;
            let currentBestCand = baseline.bestCand;
            console.log(`[PRUNING] Current baseline: ${currentBestDays} days (rule=${currentBestCand.rule}, window=${currentBestCand.windowMs})`);

            for (const partId of partsWithMultipleChambers) {
              const currentChambers = compatibilityMap[partId];
              if (!currentChambers || currentChambers.length <= 1) continue;
              const partName = partsMap.get(partId)?.partNumber || 'unknown';

              let bestChamberConfig = currentChambers;
              let bestPartDays = currentBestDays;

              for (let removeIdx = 0; removeIdx < currentChambers.length; removeIdx++) {
                const testChambers = currentChambers.filter((_, idx) => idx !== removeIdx);
                if (testChambers.length === 0) continue;

                compatibilityMap[partId] = testChambers;
                delete changeoverMap[partId];
                for (const c of testChambers) {
                  if (c.changeoverMinutes && c.changeoverMinutes > 0) {
                    if (!changeoverMap[partId]) changeoverMap[partId] = {};
                    changeoverMap[partId][c.equipmentId] = c.changeoverMinutes;
                  }
                }

                const result = evaluateSingleCandidatePruning(currentBestCand);
                const testDays = result.days;
                const testCand = currentBestCand;

                console.log(`[PRUNING]   Part ${partId} (${partName}): remove chamber ${currentChambers[removeIdx].equipmentId} -> ${testDays} days (rule=${testCand.rule})`);

                if (testDays < bestPartDays) {
                  bestPartDays = testDays;
                  bestChamberConfig = testChambers;
                }
              }

              compatibilityMap[partId] = bestChamberConfig;
              delete changeoverMap[partId];
              for (const c of bestChamberConfig) {
                if (c.changeoverMinutes && c.changeoverMinutes > 0) {
                  if (!changeoverMap[partId]) changeoverMap[partId] = {};
                  changeoverMap[partId][c.equipmentId] = c.changeoverMinutes;
                }
              }

              if (bestPartDays < currentBestDays) {
                pruningImproved = true;
                console.log(`[PRUNING]   => IMPROVED: Part ${partId} (${partName}): ${currentBestDays} -> ${bestPartDays} days, kept chambers: ${JSON.stringify(bestChamberConfig.map(c => c.equipmentId))}`);
                currentBestDays = bestPartDays;
              }
            }
          }
        }
        console.log(`[TIMING] Pruning phase completed in: ${Date.now() - tStart} ms`);

        // STEP 2: Run 1: Unconstrained (ideal schedule) using the pruned compatibility map
        const { tasksList: unconstrainedTasks } = runSimulation(true, undefined, 'priority', 28800000, true);
        unconstrainedStartTimes = {};
        
        for (const t of unconstrainedTasks) {
          const bMatch = t.id.match(/^wo-(\d+)-step-(\d+)-b(\d+)/);
          if (bMatch) {
            const key = `${bMatch[1]}-${bMatch[2]}-${Number(bMatch[3]) - 1}`;
            unconstrainedStartTimes[key] = new Date(t.startTime);
          } else {
            const sMatch = t.id.match(/^wo-(\d+)-step-(\d+)/);
            if (sMatch) {
              const key = `${sMatch[1]}-${sMatch[2]}-0`;
              unconstrainedStartTimes[key] = new Date(t.startTime);
            }
          }
        }

      // Calculate optimal supply rates for subassemblies
      // Two approaches combined:
      // 1. For parent parts WITH scheduled tasks: use simulation timing for peak rate
      // 2. For parent parts WITHOUT tasks (no test steps): use order demand / schedule span

      // First, find the schedule span from unconstrained tasks
      let unconstrainedEndTimeMs = workingStartTime.getTime();
      for (const t of unconstrainedTasks) {
        const endMs = new Date(t.endTime).getTime();
        if (endMs > unconstrainedEndTimeMs) unconstrainedEndTimeMs = endMs;
      }
      const scheduleDurationDays = countWorkingDaysBetween(workingStartTime, new Date(unconstrainedEndTimeMs), workDays);

      // Helper function to calculate maximum testing capacity of a part (units/day)
      function getMaxTestCapacity(partId: number): number {
        const part = partsMap.get(partId);
        if (!part || !part.steps || part.steps.length === 0) return 0;
        
        let minStepThroughput = Infinity;
        
        for (const step of part.steps) {
          if (step.chamberRequired) {
            const partCompatibleChambers = compatibilityMap[partId] || [];
            
            // 1. Calculate how many parallel runs are allowed by non-chamber equipment constraints (like cables and backplanes)
            const eqRequirements = (step.equipmentRequirements || []).filter((req: any) => !chamberIds.has(req.equipmentId));
            let maxParallelStepRuns = Infinity;
            
            for (const req of eqRequirements) {
              const eq = equipmentList.find(e => e.id === req.equipmentId);
              if (!eq) continue;
              const limit = Math.floor(eq.quantity / (req.quantityRequired || 1));
              if (limit < maxParallelStepRuns) {
                maxParallelStepRuns = limit;
              }
            }
            
            // 2. Gather all compatible chambers and their capacities
            const chambersList = partCompatibleChambers.length > 0
              ? partCompatibleChambers
              : chambers.map(c => ({ equipmentId: c.id, durationMinutes: step.durationMinutes || 0 }));
              
            const chamberCapacities: number[] = [];
            for (const cInfo of chambersList) {
              const eq = equipmentList.find(e => e.id === cInfo.equipmentId);
              if (!eq) continue;
              const duration = cInfo.durationMinutes || step.durationMinutes || 1;
              const unitCapacity = (1440 / duration) * step.batchSize;
              // Add capacity for each unit of this chamber type
              for (let i = 0; i < eq.quantity; i++) {
                chamberCapacities.push(unitCapacity);
              }
            }
            
            // Sort capacities descending so we pick the fastest chambers
            chamberCapacities.sort((a, b) => b - a);
            
            // 3. Sum up the capacities of the top N chambers, where N is the limit on parallel runs
            const parallelLimit = isFinite(maxParallelStepRuns) ? maxParallelStepRuns : Infinity;
            const chambersToUse = Math.min(chamberCapacities.length, parallelLimit);
            
            let stepChamberThroughput = 0;
            for (let i = 0; i < chambersToUse; i++) {
              stepChamberThroughput += chamberCapacities[i];
            }
            
            if (stepChamberThroughput > 0 && stepChamberThroughput < minStepThroughput) {
              minStepThroughput = stepChamberThroughput;
            }
          } else {
            const eqRequirements = (step.equipmentRequirements || []).filter((req: any) => !chamberIds.has(req.equipmentId));
            let minEqThroughput = Infinity;
            
            // Non-chamber active fraction based on shifts and work days
            const activeFraction = (shifts * 8 / 24) * (workDays / 7);
            
            if (eqRequirements.length === 0) {
              const vibeId = vibeEquipmentId;
              const eq = equipmentList.find(e => e.id === vibeId);
              if (eq) {
                const duration = step.durationMinutes || 1;
                const capacity = (1440 * activeFraction / duration) * step.batchSize * eq.quantity;
                if (capacity < minStepThroughput) {
                  minStepThroughput = capacity;
                }
              }
              continue;
            }
            
            for (const req of eqRequirements) {
              const eq = equipmentList.find(e => e.id === req.equipmentId);
              if (!eq) continue;
              const duration = req.durationMinutes || step.durationMinutes || 1;
              const unitCapacity = (1440 * activeFraction / duration) * step.batchSize;
              const totalEqCapacity = (unitCapacity * eq.quantity) / (req.quantityRequired || 1);
              if (totalEqCapacity < minEqThroughput) {
                minEqThroughput = totalEqCapacity;
              }
            }
            if (minEqThroughput < minStepThroughput) {
              minStepThroughput = minEqThroughput;
            }
          }
        }
        
        return isFinite(minStepThroughput) ? minStepThroughput : 0;
      }

      function getMaxFeasibleThroughput(childPartId: number): number {
        const subCapacity = getMaxTestCapacity(childPartId);
        let totalParentCapacity = 0;
        let hasParentDeps = false;
        
        for (const parentIdStr of Object.keys(bomMap)) {
          const parentId = Number(parentIdStr);
          const deps = bomMap[parentId] || [];
          const dep = deps.find(d => d.childPartId === childPartId);
          if (dep) {
            hasParentDeps = true;
            const parentCap = getMaxTestCapacity(parentId);
            totalParentCapacity += parentCap * dep.quantityRequired;
          }
        }
        
        if (hasParentDeps && totalParentCapacity > 0) {
          return Math.min(subCapacity, totalParentCapacity);
        }
        return subCapacity;
      }

      // Track which parent part IDs had simulation tasks (step 1)
      const partsWithSimTasks = new Set<number>();
      const subassemblyDemands: Record<number, { time: number; qty: number }[]> = {};
      
      for (const t of unconstrainedTasks) {
        if (t.stepOrder !== 1) continue;
        const orderPartId = allOrders.find(o => o.id === t.workOrderId)?.partNumberId;
        if (!orderPartId) continue;
        partsWithSimTasks.add(orderPartId);
        const deps = bomMap[orderPartId] || [];
        for (const dep of deps) {
          const childPartId = dep.childPartId;
          const qty = (t.unitsCount || 0) * dep.quantityRequired;
          if (qty <= 0) continue;
          if (!subassemblyDemands[childPartId]) subassemblyDemands[childPartId] = [];
          subassemblyDemands[childPartId].push({
            time: new Date(t.startTime).getTime(),
            qty
          });
        }
      }

      // Fallback: For parent parts that have BOM deps but NO simulation tasks (no test steps),
      // aggregate total quantity per parent part that has no sim tasks
      const noSimParentDemand: Record<number, { totalQty: number; earliestDue: number | null }> = {};
      for (const order of orders) {
        if (partsWithSimTasks.has(order.partNumberId)) continue;
        const deps = bomMap[order.partNumberId] || [];
        if (deps.length === 0) continue;
        
        if (!noSimParentDemand[order.partNumberId]) {
          noSimParentDemand[order.partNumberId] = { totalQty: 0, earliestDue: null };
        }
        noSimParentDemand[order.partNumberId].totalQty += order.quantity;
        if (order.dueDate) {
          const dueMs = new Date(order.dueDate).getTime();
          const existing = noSimParentDemand[order.partNumberId].earliestDue;
          if (existing === null || dueMs < existing) {
            noSimParentDemand[order.partNumberId].earliestDue = dueMs;
          }
        }
      }






      bestCandidate = null;
      let minScore = Infinity;
      let bestUnconstrainedTasks: ScheduledTask[] = [];

      for (const cand of candidates) {
        const { tasksList } = runSimulation(false, unconstrainedStartTimes, cand.rule, cand.windowMs, true, undefined, true);
        const merged = getMergedTasks(tasksList);
        
        let maxEndMs = workingStartTime.getTime();
        for (const t of merged) {
          const endMs = new Date(t.endTime).getTime();
          if (endMs > maxEndMs) maxEndMs = endMs;
        }
        
        const workingDays = countWorkingDaysBetween(workingStartTime, new Date(maxEndMs), workDays);
        
        // Objective score: Completion days has high priority weight, followed by task count
        const score = workingDays * 1000 + merged.length * 10;
        
        if (score < minScore) {
          minScore = score;
          bestCandidate = {
            rule: cand.rule,
            windowMs: cand.windowMs,
            workingDays,
            taskCount: merged.length,
            endMs: maxEndMs
          };
          bestUnconstrainedTasks = tasksList;
        }
      }



      // Collect all part IDs that have supply demand from the unconstrained simulation
      const supplyDemandPartIds = new Set<number>();
      for (const t of bestUnconstrainedTasks) {
        if (t.stepOrder !== 1) continue;
        const orderPartId = allOrders.find(o => o.id === t.workOrderId)?.partNumberId;
        if (!orderPartId) continue;
        
        // Direct raw part supply
        if (supplyRulesMap.has(orderPartId)) {
          supplyDemandPartIds.add(orderPartId);
        }
        
        // BOM child part supply
        const deps = bomMap[orderPartId] || [];
        for (const dep of deps) {
          if (supplyRulesMap.has(dep.childPartId)) {
            supplyDemandPartIds.add(dep.childPartId);
          }
        }
      }
      
      // Also add fallback parent parts with no sim tasks
      for (const parentPartIdStr of Object.keys(noSimParentDemand)) {
        const parentPartId = Number(parentPartIdStr);
        const deps = bomMap[parentPartId] || [];
        for (const dep of deps) {
          if (supplyRulesMap.has(dep.childPartId)) {
            supplyDemandPartIds.add(dep.childPartId);
          }
        }
      }

      const targetEndMs = bestCandidate.endMs;
      const targetTasks = bestCandidate.taskCount;
      
      // Compute total demand per part
      const totalDemandPerPart: Record<number, number> = {};
      for (const t of bestUnconstrainedTasks) {
        if (t.stepOrder !== 1) continue;
        const orderPartId = allOrders.find(o => o.id === t.workOrderId)?.partNumberId;
        if (!orderPartId) continue;
        const qty = t.unitsCount || 0;
        if (qty > 0 && supplyDemandPartIds.has(orderPartId)) {
          totalDemandPerPart[orderPartId] = (totalDemandPerPart[orderPartId] || 0) + qty;
        }
        const deps = bomMap[orderPartId] || [];
        for (const dep of deps) {
          if (supplyDemandPartIds.has(dep.childPartId)) {
            totalDemandPerPart[dep.childPartId] = (totalDemandPerPart[dep.childPartId] || 0) + qty * dep.quantityRequired;
          }
        }
      }

      // --- Binary Search Solver for Minimum Feasible Supply Rates ---
      // Helper to check if a given set of rates achieves the target schedule
      function isFeasible(testRates: Record<number, number>): boolean {
        const { tasksList } = runSimulation(false, unconstrainedStartTimes, bestCandidate.rule, bestCandidate.windowMs, false, testRates, true);
        const merged = getMergedTasks(tasksList);
        
        let maxEndMs = workingStartTime.getTime();
        for (const t of merged) {
          const endMs = new Date(t.endTime).getTime();
          if (endMs > maxEndMs) maxEndMs = endMs;
        }
        
        return maxEndMs <= targetEndMs && merged.length <= targetTasks;
      }

      // Initialize all rates to max test capacity or total demand (guaranteed feasible upper bound)
      const solvedRates: Record<number, number> = {};
      // Sort part IDs deterministically to ensure coordinate descent is stable and predictable
      const sortedPartIds = Array.from(supplyDemandPartIds).sort((a, b) => a - b);
      for (const partId of sortedPartIds) {
        const cap = Math.ceil(getMaxTestCapacity(partId));
        const demand = totalDemandPerPart[partId] || 1;
        solvedRates[partId] = (cap > 0 && cap < demand) ? cap : demand;
      }

      // Binary search each part's rate independently (coordinate descent in stable order)
      for (const partId of sortedPartIds) {
        let lo = 1;
        let hi = solvedRates[partId];
        let bestRate = hi;
        let iters = 0;
        
        while (lo <= hi && iters < 3) {
          iters++;
          const mid = Math.ceil((lo + hi) / 2);
          const testRates = { ...solvedRates, [partId]: mid };
          
          if (isFeasible(testRates)) {
            bestRate = mid;
            hi = mid - 1;
          } else {
            lo = mid + 1;
          }
        }
        
        solvedRates[partId] = bestRate;
      }
      
      // Set the final optimal supply rates (capped by maximum testing capacity to prevent equipment piling up)
      for (const partId of sortedPartIds) {
        const cap = getMaxTestCapacity(partId);
        if (cap > 0 && solvedRates[partId] > cap) {
          solvedRates[partId] = Math.ceil(cap);
        }
      }
      
      console.log(`[TIMING] Binary search solver phase completed in: ${Date.now() - tStart} ms`);

      // Cache the solved optimal supply rates and schedule metadata
      optimalRatesCache.set(cacheKey, {
        optimalSupplyRates: { ...solvedRates },
        unconstrainedStartTimes: { ...unconstrainedStartTimes },
        bestCandidate: { ...bestCandidate }
      });
      
      Object.assign(optimalSupplyRates, solvedRates);
      }

      // Run final pass with ignoreRateLimit=false for the Gantt chart (constrained by actual supply rules)
      rawSupplyCache.clear();
      const { tasksList: finalRealTasks } = runSimulation(false, unconstrainedStartTimes, bestCandidate.rule, bestCandidate.windowMs, false);
      const mergedTasks = getMergedTasks(finalRealTasks);

      // Generate unique IDs for each merged task to ensure the Gantt chart can render them as separate rows
      const segmentCounter = new Map<string, number>();
      for (const task of mergedTasks) {
        const key = `${task.partNumber}-${task.stepId}`;
        const count = (segmentCounter.get(key) || 0) + 1;
        segmentCounter.set(key, count);
        task.id = `merged-${task.partNumber}-${task.stepId}-s${count}`;
      }
      
      mergedTasks.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

      // Compute projected completion times
      const orderCompletionMap: Record<number, Date> = {};
      for (const task of mergedTasks) {
        const end = new Date(task.endTime);
        if (!orderCompletionMap[task.workOrderId] || end > orderCompletionMap[task.workOrderId]) {
          orderCompletionMap[task.workOrderId] = end;
        }
      }

      // Build due-date warnings
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
      dueDateWarnings.sort((a, b) => b.daysLate - a.daysLate);

      res.json({
        tasks: mergedTasks,
        equipmentUsage: {},
        dueDateWarnings,
        shortageWarnings,
        optimalSupplyRates,
        partSupplyRules: allSupplyRules,
        subassemblyDemandTotals: demandByChildId,
      });
    } catch (err: any) {
      console.error("Scheduler calculate endpoint error:", err);
      res.status(500).json({ message: err.message || "Internal server error" });
    }
  });

  // === WORK ORDER CONFIGURATIONS (named scenarios) ===

  // GET /api/configurations — list all saved configurations
  app.get(api.configurations.list.path, async (_req, res) => {
    try {
      const configs = await storage.listConfigurations();
      res.json(configs);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // POST /api/configurations — save current work orders + settings as a new named configuration
  app.post(api.configurations.create.path, async (req, res) => {
    try {
      const { name, shiftMode, workDays, snapshot } = req.body;
      if (!name || !snapshot) return res.status(400).json({ message: "name and snapshot are required" });
      const config = await storage.createConfiguration(name, shiftMode ?? 1, workDays ?? 5, snapshot);
      res.status(201).json(config);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // PATCH /api/configurations/:id — rename a saved configuration
  app.patch("/api/configurations/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { name } = req.body;
      if (!name) return res.status(400).json({ message: "name is required" });
      const updated = await storage.renameConfiguration(id, name);
      if (!updated) return res.status(404).json({ message: "Configuration not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // DELETE /api/configurations/:id — delete a saved configuration
  app.delete("/api/configurations/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const existing = await storage.getConfiguration(id);
      if (!existing) return res.status(404).json({ message: "Configuration not found" });
      await storage.deleteConfiguration(id);
      res.status(204).send();
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // POST /api/configurations/:id/load — replace live work orders with a saved configuration
  app.post("/api/configurations/:id/load", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const result = await storage.loadConfiguration(id);
      if (!result) return res.status(404).json({ message: "Configuration not found" });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  return httpServer;
}

import { db } from "../server/db";
import { workOrders, partNumbers, testEquipment, partEquipmentCompatibility, partDependencies, partSupplyRules } from "../shared/schema";
import { eq } from "drizzle-orm";
import { formatISO } from "date-fns";

import { performance } from "perf_hooks";

export let tSupply = 0;
export let tEarliestSlot = 0;
export let tMinStartTime = 0;
export let tNextWorkTime = 0;
export let tWorkingMin = 0;
export let tCacheInvalidation = 0;

export let cSupply = 0;
export let cEarliestSlot = 0;
export let cMinStartTime = 0;
export let cNextWorkTime = 0;
export let cWorkingMin = 0;

// Helper functions copied from server/routes.ts
function isWorkingTime(date: Date, shifts: number, workDays: number): boolean {
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

function _getNextWorkingTime(date: Date, shifts: number, workDays: number): Date {
  if (date.getSeconds() === 0 && date.getMilliseconds() === 0 && isWorkingTime(date, shifts, workDays)) {
    return new Date(date.getTime());
  }
  let current = new Date(date.getTime());
  current.setSeconds(0, 0);
  
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

function getNextWorkingTime(date: Date, shifts: number, workDays: number): Date {
  const start = performance.now();
  const res = _getNextWorkingTime(date, shifts, workDays);
  tNextWorkTime += performance.now() - start;
  cNextWorkTime++;
  return res;
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function _addWorkingMinutes(start: Date, minutes: number, shifts: number, workDays: number): Date {
  let current = getNextWorkingTime(start, shifts, workDays);
  let remaining = minutes;
  
  while (remaining > 0) {
    if (isWorkingTime(current, shifts, workDays)) {
      // Find how much working time is left in the current block/day
      const day = current.getDay();
      const hour = current.getHours();
      const minute = current.getMinutes();
      const timeInMinutes = hour * 60 + minute;
      
      let endOfBlockMinutes = 24 * 60; // default for 24h
      if (shifts === 1) {
        endOfBlockMinutes = 840; // 2pm
      } else if (shifts === 2) {
        endOfBlockMinutes = 1320; // 10pm
      } else {
        // 3 shifts. If weekend is restricted, end of block is Friday 10pm or midnight?
        // Let's check routes.ts:
        if (workDays === 5 && day === 5) {
          endOfBlockMinutes = 24 * 60; // end of Friday
        } else if (workDays === 6 && day === 6) {
          endOfBlockMinutes = 24 * 60; // end of Saturday
        }
      }
      
      const currentBlockRemaining = endOfBlockMinutes - timeInMinutes;
      const step = Math.min(remaining, currentBlockRemaining);
      
      current.setTime(current.getTime() + step * 60 * 1000);
      remaining -= step;
      
      if (remaining > 0) {
        current = getNextWorkingTime(current, shifts, workDays);
      }
    } else {
      current = getNextWorkingTime(current, shifts, workDays);
    }
  }
  return current;
}

function addWorkingMinutes(start: Date, minutes: number, shifts: number, workDays: number): Date {
  const tStart = performance.now();
  const res = _addWorkingMinutes(start, minutes, shifts, workDays);
  tWorkingMin += performance.now() - tStart;
  cWorkingMin++;
  return res;
}

async function run() {
  const shifts: 1 | 2 | 3 = 1; // Looking at the timeline screenshot, shifts is 1 (6am-2pm) or 3? Let's run with 3 or whatever matches the DB. Let's retrieve what parameters the app uses, or look at the active orders in the database.
  // Wait, let's look at the query parameters from the screenshot, it shows "Work Weeks" at the top but doesn't tell shifts. But we can simulate shifts = 3 and shifts = 1 to see. Let's do shifts = 3 first, and 7 days.
  const workDays: 5 | 6 | 7 = 7;

  const allOrders = await db.query.workOrders.findMany({
    with: {
      partNumber: true,
      stepOffsets: true,
    }
  });
  const orders = allOrders.filter(o => o.status === "scheduled");
  const equipmentList = await db.select().from(testEquipment);
  const allCompatibility = await db.select().from(partEquipmentCompatibility);
  const allBomDeps = await db.select().from(partDependencies);
  const allParts = await db.query.partNumbers.findMany({
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
  const allSupplyRules = await db.select().from(partSupplyRules);

  const partsMap = new Map();
  for (const part of allParts) {
    partsMap.set(part.id, part);
  }

  const supplyRulesMap = new Map();
  for (const rule of allSupplyRules) {
    supplyRulesMap.set(rule.partNumberId, rule);
  }

  const bomMap: Record<number, { childPartId: number; quantityRequired: number }[]> = {};
  const seenDeps = new Set<string>();
  for (const dep of allBomDeps) {
    const key = `${dep.parentPartId}-${dep.childPartId}`;
    if (seenDeps.has(key)) continue;
    seenDeps.add(key);
    if (!bomMap[dep.parentPartId]) bomMap[dep.parentPartId] = [];
    bomMap[dep.parentPartId].push({ childPartId: dep.childPartId, quantityRequired: dep.quantityRequired });
  }

  const ordersByPartId: Record<number, any[]> = {};
  for (const order of orders) {
    if (!ordersByPartId[order.partNumberId]) ordersByPartId[order.partNumberId] = [];
    ordersByPartId[order.partNumberId].push(order);
  }

  const compatibilityMap: Record<number, any[]> = {};
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

  const changeoverMap: Record<number, Record<number, number>> = {};
  for (const c of allCompatibility) {
    if (c.changeoverMinutes && c.changeoverMinutes > 0) {
      if (!changeoverMap[c.partNumberId]) {
        changeoverMap[c.partNumberId] = {};
      }
      changeoverMap[c.partNumberId][c.equipmentId] = c.changeoverMinutes;
    }
  }

  const chambers = equipmentList.filter(e => e.name.toLowerCase().includes("chamber"));
  const chamberIds = new Set(chambers.map(c => c.id));
  const vibeEquipment = equipmentList.find(e => e.name.toLowerCase().includes("vibration"));
  const vibeEquipmentId = vibeEquipment ? vibeEquipment.id : 6;
  const now = new Date();
  const workingStartTime = getNextWorkingTime(now, shifts, workDays);

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
        supply += rule.expectedSupplyRate * 30;
      }
    }
    supplyByPartId[part.id] = supply;
  }

  // Supply rules map and helpers
  // Supply rules map and helpers
  function isWorkingDay(date: Date, workDays: number): boolean {
    const day = date.getDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
    if (workDays === 5 && (day === 0 || day === 6)) return false;
    if (workDays === 6 && day === 0) return false;
    return true;
  }

  function addWorkingDays(startDate: Date, days: number, workDays: number): Date {
    let result = new Date(startDate.getTime());
    if (days <= 0) return result;
    
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

  function _getSupplyTimeFromEventsAndRate(
    expectedRate: number,
    initialEvents: { time: number; qty: number }[],
    unitsNeeded: number,
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
    const currentDay = new Date(workingStartTime.getTime());
    currentDay.setHours(startHour, 0, 0, 0); // startHour local time
    
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
      
      currentDay.setDate(currentDay.getDate() + 1);
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

  function getSupplyTimeFromEventsAndRate(
    expectedRate: number,
    initialEvents: { time: number; qty: number }[],
    unitsNeeded: number,
    startHour: number
  ): Date {
    const start = performance.now();
    const res = _getSupplyTimeFromEventsAndRate(expectedRate, initialEvents, unitsNeeded, startHour);
    tSupply += performance.now() - start;
    cSupply++;
    return res;
  }

  const rawSupplyCache = new Map<string, Date>();
  const childReadyCache = new Map<string, Date>();

  function getRawPartSupplyTime(partId: number, unitsNeeded: number): Date {
    if (unitsNeeded <= 0) return new Date(workingStartTime);
    const cacheKey = `${partId}-${unitsNeeded}`;
    const cached = rawSupplyCache.get(cacheKey);
    if (cached) return cached;

    const rule = supplyRulesMap.get(partId);
    if (!rule) {
      const res = new Date(workingStartTime);
      rawSupplyCache.set(cacheKey, res);
      return res;
    }
    
    const initialEvents: { time: number; qty: number }[] = [];
    const expectedRate = rule.expectedSupplyRate || 0;
    
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
    const startHour = shifts === 3 ? 0 : 6;
    const res = getSupplyTimeFromEventsAndRate(expectedRate, initialEvents, unitsNeeded, startHour);
    rawSupplyCache.set(cacheKey, res);
    return res;
  }

  function getChildReadyTime(childPartId: number, childUnitsNeeded: number, batchCompletions: any): Date {
    if (childUnitsNeeded <= 0) return new Date(workingStartTime);
    const cacheKey = `${childPartId}-${childUnitsNeeded}`;
    const cached = childReadyCache.get(cacheKey);
    if (cached) return cached;

    const childOrders = ordersByPartId[childPartId] || [];
    const initialEvents: { time: number; qty: number }[] = [];
    
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
    const startHour = shifts === 3 ? 0 : 6;
    const res = getSupplyTimeFromEventsAndRate(expectedRate, initialEvents, childUnitsNeeded, startHour);
    childReadyCache.set(cacheKey, res);
    return res;
  }

  // Simulation run logic
  function runSimulation(ignoreBOM: boolean) {
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
    
    for (const order of orders) {
      const part = partsMap.get(order.partNumberId);
      if (!part || !part.steps || part.steps.length === 0) continue;
      
      batchCompletions[order.id] = {};
      
      for (const step of part.steps) {
        batchCompletions[order.id][step.stepOrder] = [];
        
        const remainingQtyToProcess = order.quantity;
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

    function _getMinStartTimeForBatch(batch: PendingBatch, ignoreBOMOverride = false): { time: Date; constrainingChildPartId: number | null } {
      if (batch.stepOrder === 1) {
        if (ignoreBOM || ignoreBOMOverride) {
          return { time: new Date(workingStartTime), constrainingChildPartId: null };
        }
        let minTime = new Date(workingStartTime);
        let constrainingChildPartId: number | null = null;
        
        const rawSupplyTime = getRawPartSupplyTime(batch.partNumberId, (batch.batchIndex * batch.step.batchSize) + batch.unitsInBatch);
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
      const unitsNeededForThisBatch = (batch.batchIndex + 1) * currentStepBatchSize;
      let unitsCompleted = 0;
      for (const completion of prevStepCompletions) {
        unitsCompleted += completion.unitsCompleted;
        if (unitsCompleted >= Math.min(unitsNeededForThisBatch, batch.unitsInBatch + batch.batchIndex * currentStepBatchSize)) {
          return { time: completion.endTime, constrainingChildPartId: null };
        }
      }
      return { time: new Date(8640000000000000), constrainingChildPartId: null };
    }

    function getMinStartTimeForBatch(batch: PendingBatch, ignoreBOMOverride = false) {
      const start = performance.now();
      const res = _getMinStartTimeForBatch(batch, ignoreBOMOverride);
      tMinStartTime += performance.now() - start;
      cMinStartTime++;
      return res;
    }

    function _findEarliestSlotForBatch(batch: PendingBatch, minStartTime: Date) {
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
          if (lastPartOnUnit !== null && lastPartOnUnit !== batch.partNumberId) {
            if (eqId === vibeEquipmentId) {
              changeoverTime = 30; // 30 min hardcoded for Vibration
            } else {
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
            if (lastPartOnUnit !== null && lastPartOnUnit !== batch.partNumberId) {
              if (eqId === vibeEquipmentId) {
                changeoverTime = 30; // 30 min hardcoded for Vibration
              } else {
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

    function findEarliestSlotForBatch(batch: PendingBatch, minStartTime: Date) {
      const start = performance.now();
      const res = _findEarliestSlotForBatch(batch, minStartTime);
      tEarliestSlot += performance.now() - start;
      cEarliestSlot++;
      return res;
    }

    const tasksList: any[] = [];
    const passes = [false, true];

    interface CachedSlot {
      minTime: Date;
      slot: ReturnType<typeof findEarliestSlotForBatch> | null;
      dirty: boolean;
    }

    const slotCache = new Map<string, CachedSlot>();
    
    for (const passIgnoreBOM of passes) {
      console.log(`\n--- PASS: ignoreBOM=${passIgnoreBOM} ---`);
      slotCache.clear();
      let round = 0;
      while (pendingBatches.length > 0) {
        round++;
        const readyBatches: PendingBatch[] = [];
        for (const batch of pendingBatches) {
          const batchKey = `${batch.orderId}-${batch.stepId}-${batch.batchIndex}`;
          let cached = slotCache.get(batchKey);
          if (!cached || cached.dirty) {
            const { time: minTime } = getMinStartTimeForBatch(batch, passIgnoreBOM);
            if (minTime.getTime() < 8640000000000000) {
              const slot = findEarliestSlotForBatch(batch, minTime);
              cached = { minTime, slot, dirty: false };
            } else {
              cached = { minTime, slot: null, dirty: false };
            }
            slotCache.set(batchKey, cached);
          }

          if (cached.minTime.getTime() < 8640000000000000) {
            readyBatches.push(batch);
          }
        }
        if (readyBatches.length === 0) {
          console.log(`[Round ${round}] No ready batches found. Break.`);
          break;
        }
        
        const batchOptions: { batch: PendingBatch; slot: any; baseTimeMs: number; biasedTimeMs: number }[] = [];
        for (const batch of readyBatches) {
          const batchKey = `${batch.orderId}-${batch.stepId}-${batch.batchIndex}`;
          const cached = slotCache.get(batchKey)!;
          if (cached.slot) {
            let hasChangeover = false;
            for (const unit of cached.slot.selectedUnits) {
              const lastPartOnUnit = equipmentLastPart[unit.eqId]?.[unit.unitIdx];
              if (lastPartOnUnit !== null && lastPartOnUnit !== batch.partNumberId) {
                hasChangeover = true;
                break;
              }
            }
            const baseTimeMs = cached.slot.startTime.getTime();
            const biasedTimeMs = hasChangeover ? baseTimeMs : baseTimeMs - 3600000;
            
            batchOptions.push({ batch, slot: cached.slot, baseTimeMs, biasedTimeMs });
          }
        }
        if (batchOptions.length === 0) {
          console.log(`[Round ${round}] No feasible slots for any ready batches. Break.`);
          break;
        }

        // Detailed logging for the first 5 rounds of passIgnoreBOM === false
        if (round <= 5 && !passIgnoreBOM) {
          console.log(`[Round ${round}] Ready options:`);
          for (const opt of batchOptions) {
            console.log(`  - Part: ${opt.batch.partNumber}, Step: ${opt.batch.step.name || opt.batch.step.stepOrder}, BatchIdx: ${opt.batch.batchIndex}, Priority: ${opt.batch.orderPriority}, slotStart: ${opt.slot.startTime.toISOString()}, slotEnd: ${opt.slot.endTime.toISOString()}`);
          }
        }

        batchOptions.sort((a, b) => {
          const timeDiff = Math.abs(a.baseTimeMs - b.baseTimeMs);
          if (timeDiff <= 14400000) { // 4 * 60 * 60 * 1000
            const priorityDiff = a.batch.orderPriority - b.batch.orderPriority;
            if (priorityDiff !== 0) return priorityDiff;
          }
          
          if (a.biasedTimeMs !== b.biasedTimeMs) return a.biasedTimeMs - b.biasedTimeMs;
          
          const priorityDiff = a.batch.orderPriority - b.batch.orderPriority;
          if (priorityDiff !== 0) return priorityDiff;
          return a.batch.stepOrder - b.batch.stepOrder;
        });

        const best = batchOptions[0];
        const { batch, slot } = best;
        
        if (round <= 5 && !passIgnoreBOM) {
          console.log(`[Round ${round}] CHOSEN: Part: ${batch.partNumber}, Batch: ${batch.batchIndex}`);
        }

        const taskId = batch.totalBatches > 1 
          ? `wo-${batch.orderId}-step-${batch.stepId}-b${batch.batchIndex + 1}`
          : `wo-${batch.orderId}-step-${batch.stepId}`;
        
        tasksList.push({
          id: passIgnoreBOM ? `${taskId}-shortage` : taskId,
          workOrderId: batch.orderId,
          partNumber: batch.partNumber,
          stepId: batch.stepId,
          stepOrder: batch.stepOrder,
          startTime: slot.startTime,
          endTime: slot.endTime,
          priority: batch.orderPriority
        });
        
        for (const unit of slot.selectedUnits) {
          machineAvailability[unit.eqId][unit.unitIdx] = slot.endTime;
          equipmentLastPart[unit.eqId][unit.unitIdx] = batch.partNumberId;
        }
        
        batchCompletions[batch.orderId][batch.stepOrder].push({
          endTime: slot.endTime,
          unitsCompleted: batch.unitsInBatch
        });

        if (batch.stepOrder === 1) {
          const deps = bomMap[batch.partNumberId] || [];
          for (const dep of deps) {
            globalConsumed[dep.childPartId] = (globalConsumed[dep.childPartId] || 0) + batch.unitsInBatch * dep.quantityRequired;
          }
        }

        // Invalidate cache for dirty batches BEFORE removing best from pendingBatches
        const startInvalidate = performance.now();
        const updatedEqIds = new Set<number>(slot!.selectedUnits.map((u: any) => u.eqId));
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
        tCacheInvalidation += performance.now() - startInvalidate;
        
        const idx = pendingBatches.findIndex(b => 
          b.orderId === batch.orderId && b.stepId === batch.stepId && b.batchIndex === batch.batchIndex
        );
        if (idx >= 0) pendingBatches.splice(idx, 1);
        
        childReadyCache.clear();
      }
    }
    return { tasksList, batchCompletions };
  }

  console.time("SimulationExecution");
  const result = runSimulation(false);
  console.timeEnd("SimulationExecution");
  if (result) {
    console.log("\n=== PROFILING RESULTS ===");
    console.log(`tSupply: ${tSupply.toFixed(2)}ms (calls: ${cSupply})`);
    console.log(`tEarliestSlot: ${tEarliestSlot.toFixed(2)}ms (calls: ${cEarliestSlot})`);
    console.log(`tMinStartTime: ${tMinStartTime.toFixed(2)}ms (calls: ${cMinStartTime})`);
    console.log(`tNextWorkTime: ${tNextWorkTime.toFixed(2)}ms (calls: ${cNextWorkTime})`);
    console.log(`tWorkingMin: ${tWorkingMin.toFixed(2)}ms (calls: ${cWorkingMin})`);
    console.log(`tCacheInvalidation: ${tCacheInvalidation.toFixed(2)}ms`);

    const sortedTasks = [...result.tasksList].sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    console.log("\n=== FIRST 20 SCHEDULED TASKS ===");
    sortedTasks.slice(0, 20).forEach((t, idx) => {
      console.log(`${idx + 1}. Part: ${t.partNumber}, Step: ${t.stepName || t.stepOrder}, Qty: ${t.unitsCount}, Start: ${t.startTime}, End: ${t.endTime}, Priority: ${t.priority}`);
    });
  }
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});

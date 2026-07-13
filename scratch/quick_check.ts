import { db } from "../server/db";
import { workOrders, partNumbers, testEquipment, partEquipmentCompatibility, partDependencies, partSupplyRules } from "../shared/schema";
import { eq } from "drizzle-orm";
import { formatISO } from "date-fns";

// Helper functions copied from server/routes.ts
function isWorkingTime(date: Date, shifts: number, workDays: number): boolean {
  const day = date.getDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
  if (workDays === 5 && (day === 0 || day === 6)) return false;
  if (workDays === 6 && day === 0) return false;
  
  const hour = date.getHours();
  const minute = date.getMinutes();
  const timeInMinutes = hour * 60 + minute;
  
  if (shifts === 1) {
    return timeInMinutes >= 360 && timeInMinutes < 840;
  } else if (shifts === 2) {
    return timeInMinutes >= 360 && timeInMinutes < 1320;
  }
  return true;
}

function getNextWorkingTime(date: Date, shifts: number, workDays: number): Date {
  let current = new Date(date.getTime());
  current.setSeconds(0, 0);
  let attempts = 0;
  const maxAttempts = 10000;
  
  while (!isWorkingTime(current, shifts, workDays) && attempts < maxAttempts) {
    attempts++;
    const day = current.getDay();
    const hour = current.getHours();
    const minute = current.getMinutes();
    const timeInMinutes = hour * 60 + minute;
    
    if (shifts === 1) {
      if (timeInMinutes >= 840) {
        current.setDate(current.getDate() + 1);
        current.setHours(6, 0, 0, 0);
      } else if (timeInMinutes < 360) {
        current.setHours(6, 0, 0, 0);
      } else {
        current.setTime(current.getTime() + 60 * 1000);
      }
    } else if (shifts === 2) {
      if (timeInMinutes >= 1320) {
        current.setDate(current.getDate() + 1);
        current.setHours(6, 0, 0, 0);
      } else if (timeInMinutes < 360) {
        current.setHours(6, 0, 0, 0);
      } else {
        current.setTime(current.getTime() + 60 * 1000);
      }
    } else {
      if (workDays === 5 && day === 6) {
        current.setDate(current.getDate() + 2);
        current.setHours(6, 0, 0, 0);
      } else if (workDays === 5 && day === 0) {
        current.setDate(current.getDate() + 1);
        current.setHours(6, 0, 0, 0);
      } else if (workDays === 6 && day === 0) {
        current.setDate(current.getDate() + 1);
        current.setHours(6, 0, 0, 0);
      } else {
        current.setTime(current.getTime() + 60 * 1000);
      }
    }
  }
  return current;
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function addWorkingMinutes(start: Date, minutes: number, shifts: number, workDays: number): Date {
  let current = getNextWorkingTime(start, shifts, workDays);
  let remaining = minutes;
  
  while (remaining > 0) {
    if (isWorkingTime(current, shifts, workDays)) {
      const day = current.getDay();
      const hour = current.getHours();
      const minute = current.getMinutes();
      const timeInMinutes = hour * 60 + minute;
      
      let endOfBlockMinutes = 24 * 60;
      if (shifts === 1) {
        endOfBlockMinutes = 840;
      } else if (shifts === 2) {
        endOfBlockMinutes = 1320;
      } else {
        if (workDays === 5 && day === 5) {
          endOfBlockMinutes = 24 * 60;
        } else if (workDays === 6 && day === 6) {
          endOfBlockMinutes = 24 * 60;
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

async function run() {
  const shifts = 1;
  const workDays = 5;

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
  const mainEquipmentIds = new Set([...chamberIds, vibeEquipmentId]);
  const now = new Date();
  const workingStartTime = getNextWorkingTime(now, shifts, workDays);

  function getRawPartSupplyTime(partId: number, unitsNeeded: number): Date {
    if (unitsNeeded <= 0) return new Date(workingStartTime);
    const rule = supplyRulesMap.get(partId);
    if (!rule) return new Date(workingStartTime);
    const discreteCompletions: { time: number; qty: number }[] = [];
    let expectedRate = rule.expectedSupplyRate || 0;
    if (rule.fixedSupplies) {
      try {
        const fixed = JSON.parse(rule.fixedSupplies);
        if (Array.isArray(fixed)) {
          for (const f of fixed) {
            if (f.date && f.quantity) {
              discreteCompletions.push({
                time: new Date(f.date).getTime(),
                qty: Number(f.quantity)
              });
            }
          }
        }
      } catch (e) {}
    }
    discreteCompletions.sort((a, b) => a.time - b.time);
    let accumulated = 0;
    let prevTime = workingStartTime.getTime();
    const R_ms = expectedRate / (24 * 60 * 60 * 1000);
    
    for (const comp of discreteCompletions) {
      const compTime = comp.time;
      const duration = Math.max(0, compTime - Math.max(prevTime, workingStartTime.getTime()));
      const ramp = duration * R_ms;
      if (accumulated + ramp >= unitsNeeded) {
        const neededFromRamp = unitsNeeded - accumulated;
        return new Date(Math.max(prevTime, workingStartTime.getTime()) + (neededFromRamp / R_ms));
      }
      accumulated += ramp;
      accumulated += comp.qty;
      if (accumulated >= unitsNeeded) return new Date(Math.max(compTime, workingStartTime.getTime()));
      prevTime = compTime;
    }
    if (expectedRate > 0) {
      const neededFromRamp = unitsNeeded - accumulated;
      return new Date(Math.max(prevTime, workingStartTime.getTime()) + (neededFromRamp / R_ms));
    }
    return new Date(8640000000000000);
  }

  function getChildReadyTime(childPartId: number, childUnitsNeeded: number, batchCompletions: any): Date {
    if (childUnitsNeeded <= 0) return new Date(workingStartTime);
    const childOrders = ordersByPartId[childPartId] || [];
    const discreteCompletions: { time: number; qty: number }[] = [];
    for (const childOrder of childOrders) {
      const childComps = batchCompletions[childOrder.id];
      if (!childComps) continue;
      const stepKeys = Object.keys(childComps).map(Number);
      if (stepKeys.length === 0) continue;
      const lastStep = Math.max(...stepKeys);
      for (const comp of (childComps[lastStep] || [])) {
        discreteCompletions.push({ time: comp.endTime.getTime(), qty: comp.unitsCompleted });
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
                discreteCompletions.push({ time: new Date(f.date).getTime(), qty: Number(f.quantity) });
              }
            }
          }
        } catch (e) {}
      }
    }
    discreteCompletions.sort((a, b) => a.time - b.time);
    let accumulated = 0;
    let prevTime = workingStartTime.getTime();
    const R_ms = expectedRate / (24 * 60 * 60 * 1000);
    for (const comp of discreteCompletions) {
      const compTime = comp.time;
      const duration = Math.max(0, compTime - Math.max(prevTime, workingStartTime.getTime()));
      const ramp = duration * R_ms;
      if (accumulated + ramp >= childUnitsNeeded) {
        const neededFromRamp = childUnitsNeeded - accumulated;
        return new Date(Math.max(prevTime, workingStartTime.getTime()) + (neededFromRamp / R_ms));
      }
      accumulated += ramp;
      accumulated += comp.qty;
      if (accumulated >= childUnitsNeeded) return new Date(Math.max(compTime, workingStartTime.getTime()));
      prevTime = compTime;
    }
    if (expectedRate > 0) {
      const neededFromRamp = childUnitsNeeded - accumulated;
      return new Date(Math.max(prevTime, workingStartTime.getTime()) + (neededFromRamp / R_ms));
    }
    return new Date(8640000000000000);
  }

  function runSimulation(ignoreBOM: boolean, unconstrainedStartTimes?: any) {
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

    function getMinStartTimeForBatch(batch: PendingBatch, ignoreBOMOverride = false): { time: Date; constrainingChildPartId: number | null } {
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
      const sortedCompletions = [...prevStepCompletions].sort((a, b) => a.endTime.getTime() - b.endTime.getTime());
      let unitsCompleted = 0;
      for (const completion of sortedCompletions) {
        unitsCompleted += completion.unitsCompleted;
        if (unitsCompleted >= Math.min(unitsNeededForThisBatch, batch.unitsInBatch + batch.batchIndex * currentStepBatchSize)) {
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
      let selectedUnits: any[] = [];
      let machinesReadyAt = new Date(minStartTime);
      
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
              changeoverTime = 30;
            } else {
              const partChangeoverConfig = changeoverMap[batch.partNumberId]?.[eqId];
              if (partChangeoverConfig) changeoverTime = partChangeoverConfig;
            }
          }
          const baseAvailableAt = new Date(Math.max(time.getTime(), minStartTime.getTime()));
          const afterChangeover = changeoverTime > 0 
            ? addWorkingMinutes(baseAvailableAt, changeoverTime, shifts, workDays)
            : baseAvailableAt;
          const slotAvailableAt = getNextWorkingTime(afterChangeover, shifts, workDays);
          return { idx, time: slotAvailableAt };
        }).sort((a: any, b: any) => a.time.getTime() - b.time.getTime());
        
        const selectedSlots = slotIndices.slice(0, Math.min(unitsNeeded, slots.length));
        if (selectedSlots.length > 0) {
          const lastSlotTime = selectedSlots[selectedSlots.length - 1].time;
          if (lastSlotTime > machinesReadyAt) machinesReadyAt = lastSlotTime;
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
        let selectedChamber: any = null;
        for (const chamberInfo of availableChambers) {
          const eqId = chamberInfo.equipmentId;
          const slots = machineAvailability[eqId];
          if (!slots) continue;
          for (let i = 0; i < slots.length; i++) {
            let changeoverTime = 0;
            const lastPartOnUnit = equipmentLastPart[eqId]?.[i];
            if (lastPartOnUnit !== null && lastPartOnUnit !== batch.partNumberId) {
              if (eqId === vibeEquipmentId) {
                changeoverTime = 30;
              } else {
                const partChangeoverConfig = changeoverMap[batch.partNumberId]?.[eqId];
                if (partChangeoverConfig) changeoverTime = partChangeoverConfig;
              }
            }
            const baseAvailableAt = new Date(Math.max(slots[i].getTime(), machinesReadyAt.getTime(), minStartTime.getTime()));
            const afterChangeover = changeoverTime > 0 
              ? addWorkingMinutes(baseAvailableAt, changeoverTime, shifts, workDays)
              : baseAvailableAt;
            const slotAvailableAt = getNextWorkingTime(afterChangeover, shifts, workDays);
            if (!selectedChamber || slotAvailableAt < selectedChamber.availableAt) {
              selectedChamber = { eqId, unitIdx: i, durationMinutes: chamberInfo.durationMinutes, availableAt: slotAvailableAt };
            }
          }
        }
        if (!selectedChamber) return null;
        if (selectedChamber.availableAt > machinesReadyAt) machinesReadyAt = selectedChamber.availableAt;
        selectedUnits.push({ eqId: selectedChamber.eqId, unitIdx: selectedChamber.unitIdx, durationMinutes: selectedChamber.durationMinutes });
        chamberDuration = selectedChamber.durationMinutes;
      }
      if (selectedUnits.length === 0) return null;
      let effectiveDuration = step.durationMinutes;
      if (step.chamberRequired && chamberDuration !== null) effectiveDuration = chamberDuration;
      const actualStartTime = getNextWorkingTime(machinesReadyAt, shifts, workDays);
      const actualEndTime = step.chamberRequired 
        ? addMinutes(actualStartTime, effectiveDuration)
        : addWorkingMinutes(actualStartTime, effectiveDuration, shifts, workDays);
      return { startTime: actualStartTime, endTime: actualEndTime, selectedUnits };
    }

    const tasksList: any[] = [];
    const passes = [false, true];
    for (const passIgnoreBOM of passes) {
      if (passIgnoreBOM && ignoreBOM) break;
      while (pendingBatches.length > 0) {
        const readyBatches: PendingBatch[] = [];
        for (const batch of pendingBatches) {
          const { time: minTime } = getMinStartTimeForBatch(batch, passIgnoreBOM);
          if (minTime.getTime() < 8640000000000000) readyBatches.push(batch);
        }
        if (readyBatches.length === 0) break;
        const batchOptions: any[] = [];
        for (const batch of readyBatches) {
          const { time: minStartTime } = getMinStartTimeForBatch(batch, passIgnoreBOM);
          const slot = findEarliestSlotForBatch(batch, minStartTime);
          if (slot) batchOptions.push({ batch, slot });
        }
        if (batchOptions.length === 0) break;

        batchOptions.sort((a, b) => {
          const timeDiff = Math.abs(a.slot!.startTime.getTime() - b.slot!.startTime.getTime());
          if (timeDiff <= 4 * 60 * 60 * 1000) {
            const priorityDiff = a.batch.orderPriority - b.batch.orderPriority;
            if (priorityDiff !== 0) return priorityDiff;
          }
          const getBiasedTime = (opt: any) => {
            let hasChangeover = false;
            for (const unit of opt.slot!.selectedUnits) {
              const lastPartOnUnit = equipmentLastPart[unit.eqId]?.[unit.unitIdx];
              if (lastPartOnUnit !== null && lastPartOnUnit !== opt.batch.partNumberId) {
                hasChangeover = true;
                break;
              }
            }
            const baseTime = opt.slot!.startTime.getTime();
            return hasChangeover ? baseTime : baseTime - 60 * 60 * 1000;
          };
          const biasedA = getBiasedTime(a);
          const biasedB = getBiasedTime(b);
          if (biasedA !== biasedB) return biasedA - biasedB;
          const priorityDiff = a.batch.orderPriority - b.batch.orderPriority;
          if (priorityDiff !== 0) return priorityDiff;
          return a.batch.stepOrder - b.batch.stepOrder;
        });

        const best = batchOptions[0];
        const { batch, slot } = best;
        const taskId = batch.totalBatches > 1 
          ? `wo-${batch.orderId}-step-${batch.stepId}-b${batch.batchIndex + 1}`
          : `wo-${batch.orderId}-step-${batch.stepId}`;
        
        tasksList.push({
          id: passIgnoreBOM ? `${taskId}-shortage` : taskId,
          workOrderId: batch.orderId,
          partNumber: batch.partNumber,
          stepId: batch.stepId,
          stepOrder: batch.stepOrder,
          stepName: batch.step.name || undefined,
          equipmentIds: slot!.selectedUnits.map((u: any) => u.eqId),
          equipmentUnitIndices: slot!.selectedUnits.map((u: any) => u.unitIdx),
          startTime: formatISO(slot!.startTime),
          endTime: formatISO(slot!.endTime),
          type: passIgnoreBOM ? "shortage_placeholder" : "test_run",
          unitsCount: batch.unitsInBatch,
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
        const idx = pendingBatches.findIndex(b => 
          b.orderId === batch.orderId && b.stepId === batch.stepId && b.batchIndex === batch.batchIndex
        );
        if (idx >= 0) pendingBatches.splice(idx, 1);
      }
      return { tasksList, batchCompletions };
    }
  }

  const { tasksList: unconstrainedTasks } = runSimulation(true);
  const unconstrainedStartTimes: Record<string, Date> = {};
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

  const { tasksList: realTasks } = runSimulation(false, unconstrainedStartTimes);

  const getEquipmentUnitKey = (task: any) => {
    if (!task.equipmentIds || task.equipmentIds.length === 0) return "no-equipment";
    const mainEq = task.equipmentIds.find((id: number) => mainEquipmentIds.has(id));
    if (mainEq !== undefined) {
      const idx = task.equipmentIds.indexOf(mainEq);
      const unitIdx = task.equipmentUnitIndices?.[idx] ?? 0;
      return `${mainEq}_${unitIdx}`;
    }
    const units = task.equipmentIds.map((id: number, idx: number) => {
      const unitIdx = task.equipmentUnitIndices?.[idx] ?? 0;
      return `${id}_${unitIdx}`;
    });
    return units.sort().join(",");
  };

  const tasksByEquipmentUnit = new Map<string, any[]>();
  for (const task of realTasks) {
    const eqKey = getEquipmentUnitKey(task);
    if (!tasksByEquipmentUnit.has(eqKey)) {
      tasksByEquipmentUnit.set(eqKey, []);
    }
    tasksByEquipmentUnit.get(eqKey)!.push(task);
  }

  const mergedTasks: any[] = [];
  for (const [eqKey, unitTasks] of tasksByEquipmentUnit.entries()) {
    unitTasks.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    let currentMerged: any = null;
    for (const task of unitTasks) {
      if (currentMerged === null) {
        currentMerged = { ...task };
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
          currentMerged.unitsCount += task.unitsCount;
        } else {
          mergedTasks.push(currentMerged);
          currentMerged = { ...task };
        }
      }
    }
    if (currentMerged) {
      mergedTasks.push(currentMerged);
    }
  }

  mergedTasks.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

  console.log("\n=== MERGED TASKS AS RETURNED BY API ===");
  mergedTasks.forEach((t, idx) => {
    console.log(`${idx + 1}. Part: ${t.partNumber}, Step: ${t.stepName || t.stepId}, Start: ${t.startTime}, End: ${t.endTime}, Qty: ${t.unitsCount}, Priority: ${t.priority}`);
  });
  
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});

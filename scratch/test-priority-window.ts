import { storage } from "../server/storage";
import { formatISO } from "date-fns";

// Helper functions copied from routes.ts
function getNextWorkingTime(date: Date, shifts: 1 | 2 | 3, workDays: 5 | 6 | 7): Date {
  const d = new Date(date);
  while (true) {
    const dayOfWeek = d.getDay();
    if (workDays === 5 && (dayOfWeek === 0 || dayOfWeek === 6)) {
      d.setDate(d.getDate() + 1);
      d.setHours(7, 0, 0, 0);
      continue;
    }
    if (workDays === 6 && dayOfWeek === 0) {
      d.setDate(d.getDate() + 1);
      d.setHours(7, 0, 0, 0);
      continue;
    }
    const hour = d.getHours();
    const min = d.getMinutes();
    const timeInMins = hour * 60 + min;
    
    let startMins = 7 * 60;
    let endMins = (7 + shifts * 8) * 60;
    
    if (endMins > 24 * 60) {
      const extraMins = endMins - 24 * 60;
      if (timeInMins >= startMins || timeInMins < extraMins) {
        return d;
      }
    } else {
      if (timeInMins >= startMins && timeInMins < endMins) {
        return d;
      }
    }
    d.setMinutes(d.getMinutes() + 15);
  }
}

function addWorkingMinutes(date: Date, minutes: number, shifts: 1 | 2 | 3, workDays: 5 | 6 | 7): Date {
  let d = new Date(date);
  let remaining = minutes;
  while (remaining > 0) {
    d = getNextWorkingTime(d, shifts, workDays);
    d.setMinutes(d.getMinutes() + 15);
    remaining -= 15;
  }
  return d;
}

async function runTest(windowHours: number) {
  console.log(`\n=== RUNNING SIMULATION WITH ${windowHours}-HOUR WINDOW ===`);
  const shifts = 3;
  const workDays = 7;

  const allOrders = await storage.getOrders();
  const orders = allOrders.filter(o => o.status === "scheduled");
  const equipmentList = await storage.getEquipment();
  const allCompatibility = await storage.getAllPartCompatibility();
  const chambers = await storage.getChambers();
  const allBomDeps = await storage.getAllPartDependencies();
  const allParts = await storage.getParts();
  const allSupplyRules = await storage.getPartSupplyRules();
  
  const partsMap = new Map<number, any>();
  for (const part of allParts) {
    partsMap.set(part.id, part);
  }

  const supplyRulesMap = new Map<number, any>();
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
    compatibilityMap[c.partNumberId].push(c);
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
  
  const chamberIds = new Set(chambers.map(c => c.id));
  const vibeEquipment = equipmentList.find(e => e.name.toLowerCase().includes("vibration"));
  const vibeEquipmentId = vibeEquipment ? vibeEquipment.id : 10;
  const mainEquipmentIds = new Set([...chamberIds, vibeEquipmentId]);
  const now = new Date("2026-07-11T10:49:47-05:00");
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

  function getChildReadyTime(
    childPartId: number, 
    childUnitsNeeded: number, 
    batchCompletions: Record<number, Record<number, { endTime: Date; unitsCompleted: number }[]>>
  ): Date {
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
        discreteCompletions.push({
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
                discreteCompletions.push({
                  time: new Date(f.date).getTime(),
                  qty: Number(f.quantity)
                });
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
      if (accumulated >= childUnitsNeeded) {
        return new Date(Math.max(compTime, workingStartTime.getTime()));
      }
      prevTime = compTime;
    }
    if (expectedRate > 0) {
      const neededFromRamp = childUnitsNeeded - accumulated;
      return new Date(Math.max(prevTime, workingStartTime.getTime()) + (neededFromRamp / R_ms));
    }
    return new Date(8640000000000000);
  }

  function getMinStartTimeForBatch(batch: any, ignoreBOM: boolean) {
    let minStartTime = new Date(workingStartTime);
    let constrainingChildPartId: number | null = null;
    
    if (batch.stepOrder > 1) {
      return { time: minStartTime, constrainingChildPartId };
    }
    
    if (!ignoreBOM && batch.stepOrder === 1) {
      const deps = bomMap[batch.partNumberId] || [];
      let maxChildReadyTime = new Date(workingStartTime);
      for (const dep of deps) {
        const qtyNeeded = batch.unitsInBatch * dep.quantityRequired;
        const readyTime = getRawPartSupplyTime(dep.childPartId, qtyNeeded);
        if (readyTime > maxChildReadyTime) {
          maxChildReadyTime = readyTime;
          constrainingChildPartId = dep.childPartId;
        }
      }
      if (maxChildReadyTime > minStartTime) {
        minStartTime = maxChildReadyTime;
      }
    }
    return { time: minStartTime, constrainingChildPartId };
  }

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
      if (accumulated >= unitsNeeded) {
        return new Date(Math.max(compTime, workingStartTime.getTime()));
      }
      prevTime = compTime;
    }
    if (expectedRate > 0) {
      const neededFromRamp = unitsNeeded - accumulated;
      return new Date(Math.max(prevTime, workingStartTime.getTime()) + (neededFromRamp / R_ms));
    }
    return new Date(8640000000000000);
  }

  function findEarliestSlotForBatch(batch: any, minStartTime: Date, machineAvailability: any, equipmentLastPart: any) {
    const step = batch.step;
    const eqRequirements = (step.equipmentRequirements || []).filter((req: any) => !chamberIds.has(req.equipmentId));
    const selectedUnits: any[] = [];
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
      const compat = compatibilityMap[batch.partNumberId] || [];
      const availableChambers = compat.filter(c => chamberIds.has(c.equipmentId));
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
            selectedChamber = { eqId, unitIdx: i, durationMinutes: chamberInfo.durationMinutes ?? null, availableAt: slotAvailableAt };
          }
        }
      }
      if (selectedChamber) {
        selectedUnits.push({ eqId: selectedChamber.eqId, unitIdx: selectedChamber.unitIdx, durationMinutes: selectedChamber.durationMinutes });
        if (selectedChamber.availableAt > machinesReadyAt) {
          machinesReadyAt = selectedChamber.availableAt;
        }
        chamberDuration = selectedChamber.durationMinutes;
      }
    }
    
    let taskDurationMins = step.durationMinutes || 0;
    if (taskDurationMins === 0 && chamberDuration !== null) {
      taskDurationMins = chamberDuration;
    }
    if (taskDurationMins === 0) {
      const reqWithDuration = eqRequirements.find((r: any) => r.durationMinutes);
      if (reqWithDuration) taskDurationMins = reqWithDuration.durationMinutes;
    }
    if (taskDurationMins === 0) taskDurationMins = 60;
    
    const startTime = machinesReadyAt;
    const endTime = addWorkingMinutes(startTime, taskDurationMins, shifts, workDays);
    
    return { startTime, endTime, selectedUnits };
  }

  function runSimulation() {
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
    
    for (const order of orders) {
      const part = partsMap.get(order.partNumberId);
      if (!part || !part.steps || part.steps.length === 0) continue;
      
      batchCompletions[order.id] = {};
      const sortedSteps = [...part.steps].sort((a, b) => a.stepOrder - b.stepOrder);
      
      for (const step of sortedSteps) {
        batchCompletions[order.id][step.stepOrder] = [];
        const bSize = step.batchSize || 1;
        const totalBatches = Math.ceil(order.quantity / bSize);
        
        for (let b = 0; b < totalBatches; b++) {
          const qty = (b === totalBatches - 1) 
            ? (order.quantity - b * bSize) 
            : bSize;
            
          pendingBatches.push({
            orderId: order.id,
            orderPriority: order.priority || 1,
            partNumberId: order.partNumberId,
            partNumber: part.partNumber,
            stepId: step.id,
            stepOrder: step.stepOrder,
            step,
            batchIndex: b,
            unitsInBatch: qty,
            totalBatches
          });
        }
      }
    }

    const tasksList: any[] = [];

    while (pendingBatches.length > 0) {
      const readyBatches: PendingBatch[] = [];
      for (const batch of pendingBatches) {
        if (batch.stepOrder > 1) {
          const prevComps = batchCompletions[batch.orderId][batch.stepOrder - 1];
          if (prevComps && prevComps.length > batch.batchIndex) {
            readyBatches.push(batch);
          }
        } else {
          readyBatches.push(batch);
        }
      }
      
      if (readyBatches.length === 0) break;
      
      const batchOptions: { batch: PendingBatch; slot: any }[] = [];
      for (const batch of readyBatches) {
        let minStartTime = new Date(workingStartTime);
        if (batch.stepOrder > 1) {
          const prevComp = batchCompletions[batch.orderId][batch.stepOrder - 1][batch.batchIndex];
          if (prevComp.endTime > minStartTime) minStartTime = prevComp.endTime;
        }
        const slot = findEarliestSlotForBatch(batch, minStartTime, machineAvailability, equipmentLastPart);
        if (slot) batchOptions.push({ batch, slot });
      }
      
      if (batchOptions.length === 0) break;
      
      // Sort candidates using the priority window logic
      batchOptions.sort((a, b) => {
        const timeDiff = Math.abs(a.slot!.startTime.getTime() - b.slot!.startTime.getTime());
        if (timeDiff <= windowHours * 60 * 60 * 1000) {
          const priorityDiff = a.batch.orderPriority - b.batch.orderPriority;
          if (priorityDiff !== 0) return priorityDiff;
        }
        
        const getBiasedTime = (opt: typeof batchOptions[0]) => {
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
      
      const chosen = batchOptions[0];
      const batch = chosen.batch;
      const slot = chosen.slot;

      tasksList.push({
        workOrderId: batch.orderId,
        partNumber: batch.partNumber,
        stepName: batch.step.name || undefined,
        startTime: formatISO(slot!.startTime),
        endTime: formatISO(slot!.endTime),
        unitsCount: batch.unitsInBatch,
      });
      
      for (const unit of slot!.selectedUnits) {
        machineAvailability[unit.eqId][unit.unitIdx] = slot!.endTime;
        equipmentLastPart[unit.eqId][unit.unitIdx] = batch.partNumberId;
      }
      
      batchCompletions[batch.orderId][batch.stepOrder].push({
        endTime: slot!.endTime,
        unitsCompleted: batch.unitsInBatch
      });
      
      const idx = pendingBatches.findIndex(b => 
        b.orderId === batch.orderId && b.stepId === batch.stepId && b.batchIndex === batch.batchIndex
      );
      if (idx >= 0) pendingBatches.splice(idx, 1);
    }

    return tasksList;
  }

  const tasks = runSimulation();
  
  // Print first 10 scheduled tasks chronologically
  tasks.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  console.log(`First 15 scheduled tasks:`);
  tasks.slice(0, 15).forEach((t, i) => {
    console.log(`[${i}] Part: ${t.partNumber}, Step: ${t.stepName}, Start: ${t.startTime}, End: ${t.endTime}, Qty: ${t.unitsCount}`);
  });
}

async function main() {
  await runTest(0);   // Standard logic (0-hour window)
  await runTest(4);   // 4-hour priority window
  await runTest(12);  // 12-hour priority window
}

main().catch(console.error);

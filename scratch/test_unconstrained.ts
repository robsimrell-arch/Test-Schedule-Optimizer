import { db } from "../server/db";
import { workOrders, partNumbers, testEquipment, partEquipmentCompatibility, partDependencies, partSupplyRules } from "../shared/schema";
import { formatISO } from "date-fns";

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

  const partsMap = new Map();
  for (const part of allParts) {
    partsMap.set(part.id, part);
  }

  const bomMap: Record<number, { childPartId: number; quantityRequired: number }[]> = {};
  for (const dep of allBomDeps) {
    if (!bomMap[dep.parentPartId]) bomMap[dep.parentPartId] = [];
    bomMap[dep.parentPartId].push({ childPartId: dep.childPartId, quantityRequired: dep.quantityRequired });
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

  const chambers = equipmentList.filter(e => e.name.toLowerCase().includes("chamber"));
  const chamberIds = new Set(chambers.map(c => c.id));
  const vibeEquipment = equipmentList.find(e => e.name.toLowerCase().includes("vibration"));
  const vibeEquipmentId = vibeEquipment ? vibeEquipment.id : 6;
  const mainEquipmentIds = new Set([...chamberIds, vibeEquipmentId]);
  
  // Base workingStartTime (e.g. Monday Jul 13 2026 06:00:00)
  const workingStartTime = new Date("2026-07-13T11:00:00.000Z"); // Monday 6am CDT (UTC-5)

  function isWorkingTime(date: Date): boolean {
    const day = date.getDay();
    if (day === 0 || day === 6) return false;
    const hour = date.getHours();
    const minute = date.getMinutes();
    const timeInMinutes = hour * 60 + minute;
    return timeInMinutes >= 360 && timeInMinutes < 840; // Shift 1: 6am - 2pm
  }

  function getNextWorkingTime(date: Date): Date {
    let current = new Date(date.getTime());
    current.setSeconds(0, 0);
    let attempts = 0;
    while (!isWorkingTime(current) && attempts < 10000) {
      attempts++;
      const hour = current.getHours();
      const minute = current.getMinutes();
      const timeInMinutes = hour * 60 + minute;
      if (timeInMinutes >= 840) {
        current.setDate(current.getDate() + 1);
        current.setHours(6, 0, 0, 0);
      } else if (timeInMinutes < 360) {
        current.setHours(6, 0, 0, 0);
      } else {
        current.setTime(current.getTime() + 60 * 1000);
      }
    }
    return current;
  }

  function addMinutes(date: Date, minutes: number): Date {
    return new Date(date.getTime() + minutes * 60 * 1000);
  }

  function addWorkingMinutes(start: Date, minutes: number): Date {
    let current = getNextWorkingTime(start);
    let remaining = minutes;
    while (remaining > 0) {
      if (isWorkingTime(current)) {
        const hour = current.getHours();
        const minute = current.getMinutes();
        const timeInMinutes = hour * 60 + minute;
        const currentBlockRemaining = 840 - timeInMinutes;
        const step = Math.min(remaining, currentBlockRemaining);
        current.setTime(current.getTime() + step * 60 * 1000);
        remaining -= step;
        if (remaining > 0) {
          current = getNextWorkingTime(current);
        }
      } else {
        current = getNextWorkingTime(current);
      }
    }
    return current;
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

    function getMinStartTimeForBatch(batch: PendingBatch): Date {
      if (batch.stepOrder === 1) {
        return new Date(workingStartTime); // No BOM or supply constraints!
      }
      const prevStepCompletions = batchCompletions[batch.orderId][batch.stepOrder - 1] || [];
      if (prevStepCompletions.length === 0) return new Date(8640000000000000);
      const currentStepBatchSize = batch.step.batchSize;
      const unitsNeededForThisBatch = (batch.batchIndex + 1) * currentStepBatchSize;
      const sortedCompletions = [...prevStepCompletions].sort((a, b) => a.endTime.getTime() - b.endTime.getTime());
      let unitsCompleted = 0;
      for (const completion of sortedCompletions) {
        unitsCompleted += completion.unitsCompleted;
        if (unitsCompleted >= Math.min(unitsNeededForThisBatch, batch.unitsInBatch + batch.batchIndex * currentStepBatchSize)) {
          return completion.endTime;
        }
      }
      return new Date(8640000000000000);
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
            changeoverTime = 30; // vibration setup changeover
          }
          const baseAvailableAt = new Date(Math.max(time.getTime(), minStartTime.getTime()));
          const afterChangeover = changeoverTime > 0 
            ? addWorkingMinutes(baseAvailableAt, changeoverTime)
            : baseAvailableAt;
          const slotAvailableAt = getNextWorkingTime(afterChangeover);
          return { idx, time: slotAvailableAt };
        }).sort((a: any, b: any) => a.time.getTime() - b.time.getTime());
        
        const selectedSlots = slotIndices.slice(0, Math.min(unitsNeeded, slots.length));
        if (selectedSlots.length > 0) {
          const lastSlotTime = selectedSlots[selectedSlots.length - 1].time;
          if (lastSlotTime > machinesReadyAt) machinesReadyAt = lastSlotTime;
        }
        for (const slot of selectedSlots) {
          selectedUnits.push({ eqId, unitIdx: slot.idx });
        }
      }
      
      let chamberDuration: number | null = null;
      if (step.chamberRequired) {
        let availableChambers = hasCompatibilityRestrictions
          ? partCompatibleChambers
          : chambers.map(c => ({ equipmentId: c.id, durationMinutes: null }));
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
              changeoverTime = 30;
            }
            const baseAvailableAt = new Date(Math.max(slots[i].getTime(), machinesReadyAt.getTime(), minStartTime.getTime()));
            const afterChangeover = changeoverTime > 0 
              ? addWorkingMinutes(baseAvailableAt, changeoverTime)
              : baseAvailableAt;
            const slotAvailableAt = getNextWorkingTime(afterChangeover);
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
      const actualStartTime = getNextWorkingTime(machinesReadyAt);
      const actualEndTime = step.chamberRequired 
        ? addMinutes(actualStartTime, effectiveDuration)
        : addWorkingMinutes(actualStartTime, effectiveDuration);
      return { startTime: actualStartTime, endTime: actualEndTime, selectedUnits };
    }

    const tasksList: any[] = [];
    let round = 0;
    while (pendingBatches.length > 0) {
      round++;
      const readyBatches: PendingBatch[] = [];
      for (const batch of pendingBatches) {
        const minTime = getMinStartTimeForBatch(batch);
        if (minTime.getTime() < 8640000000000000) readyBatches.push(batch);
      }
      if (readyBatches.length === 0) break;
      const batchOptions: any[] = [];
      for (const batch of readyBatches) {
        const minStartTime = getMinStartTimeForBatch(batch);
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
      
      if (round <= 10) {
        console.log(`[Round ${round}] Selected: ${batch.partNumber}, Step: ${batch.stepOrder}, Priority: ${batch.orderPriority}, Start: ${slot.startTime.toISOString()}`);
      }

      const taskId = batch.totalBatches > 1 
        ? `wo-${batch.orderId}-step-${batch.stepId}-b${batch.batchIndex + 1}`
        : `wo-${batch.orderId}-step-${batch.stepId}`;
      
      tasksList.push({
        id: taskId,
        workOrderId: batch.orderId,
        partNumber: batch.partNumber,
        stepId: batch.stepId,
        stepOrder: batch.stepOrder,
        startTime: formatISO(slot!.startTime),
        endTime: formatISO(slot!.endTime),
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
      const idx = pendingBatches.findIndex(b => 
        b.orderId === batch.orderId && b.stepId === batch.stepId && b.batchIndex === batch.batchIndex
      );
      if (idx >= 0) pendingBatches.splice(idx, 1);
    }
    return tasksList;
  }

  const tasks = runSimulation();
  console.log("=== COMPLETED SIMULATION ===");
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});

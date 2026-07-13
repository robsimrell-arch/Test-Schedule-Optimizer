import { db } from "../server/db";
import { testSteps, partNumbers, partEquipmentCompatibility, testEquipment } from "../shared/schema";

async function run() {
  const parts = await db.select().from(partNumbers);
  const steps = await db.select().from(testSteps);
  const compat = await db.select().from(partEquipmentCompatibility);
  const equipment = await db.select().from(testEquipment);

  const partsMap = new Map(parts.map(p => [p.id, p]));
  const stepsByPartId: Record<number, typeof steps> = {};
  steps.forEach(s => {
    if (!stepsByPartId[s.partNumberId]) stepsByPartId[s.partNumberId] = [];
    stepsByPartId[s.partNumberId].push(s);
  });

  const compatByPartId: Record<number, typeof compat> = {};
  compat.forEach(c => {
    if (!compatByPartId[c.partNumberId]) compatByPartId[c.partNumberId] = [];
    compatByPartId[c.partNumberId].push(c);
  });

  const eqMap = new Map(equipment.map(e => [e.id, e]));

  // Calculate getMaxTestCapacity(partId)
  function getMaxTestCapacity(partId: number): number {
    const part = partsMap.get(partId);
    if (!part) return 0;
    const partStepsList = stepsByPartId[partId] || [];
    if (partStepsList.length === 0) return 0;

    let minStepThroughput = Infinity;

    for (const step of partStepsList) {
      if (step.chamberRequired) {
        const partCompatibleChambers = compatByPartId[partId] || [];
        let totalChamberThroughput = 0;

        // If no compatibility records, fall back to all chambers in equipmentList
        const chambersList = partCompatibleChambers.length > 0
          ? partCompatibleChambers
          : equipment.filter(e => e.name.toLowerCase().includes("chamber")).map(c => ({ equipmentId: c.id, durationMinutes: step.durationMinutes }));

        for (const cInfo of chambersList) {
          const eq = eqMap.get(cInfo.equipmentId);
          if (!eq) continue;
          const duration = cInfo.durationMinutes || step.durationMinutes || 1;
          const unitCapacity = (1440 / duration) * step.batchSize;
          totalChamberThroughput += unitCapacity * eq.quantity;
        }
        if (totalChamberThroughput > 0 && totalChamberThroughput < minStepThroughput) {
          minStepThroughput = totalChamberThroughput;
        }
      } else {
        // Non-chamber step
        // In the database schema, helper equipment requirements are in stepEquipment table
        // But wait! Do parent parts have step equipment requirements?
        // Let's assume vibe table is the main non-chamber equipment.
        // We know Vibe batch size and duration from the step itself.
        // If step requires Vibe: Vibe is quantity 1.
        // Let's assume active fraction = 1.0 (for 3 shifts, 7 days).
        const duration = step.durationMinutes || 1;
        const vibeCapacity = (1440 / duration) * step.batchSize;
        if (vibeCapacity < minStepThroughput) {
          minStepThroughput = vibeCapacity;
        }
      }
    }

    return isFinite(minStepThroughput) ? minStepThroughput : 0;
  }

  console.log("=== CALCULATED TEST CAPACITIES ===");
  parts.forEach(p => {
    console.log(`Part: ${p.partNumber} (ID: ${p.id}) -> Max Capacity: ${getMaxTestCapacity(p.id).toFixed(2)} units/day`);
  });
}

run().catch(console.error);

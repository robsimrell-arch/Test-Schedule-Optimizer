import { db } from "../server/db";
import { testSteps, partNumbers, partEquipmentCompatibility, testEquipment } from "../shared/schema";
import { eq } from "drizzle-orm";

async function run() {
  const parts = await db.select().from(partNumbers);
  const psPart = parts.find(p => p.partNumber.includes("Power Supply"));
  if (!psPart) {
    console.error("Power Supply part not found");
    return;
  }
  console.log(`Part: ${psPart.partNumber} (ID: ${psPart.id})`);

  const steps = await db.select().from(testSteps).where(eq(testSteps.partNumberId, psPart.id));
  console.log("Steps:");
  steps.forEach(s => {
    console.log(`  Step ID: ${s.id}, Name: ${s.name}, Order: ${s.stepOrder}, BatchSize: ${s.batchSize}, Duration: ${s.durationMinutes} min, ChamberReq: ${s.chamberRequired}`);
  });

  const compat = await db.select().from(partEquipmentCompatibility).where(eq(partEquipmentCompatibility.partNumberId, psPart.id));
  const equipment = await db.select().from(testEquipment);
  const eqMap = new Map(equipment.map(e => [e.id, e]));
  
  console.log("Compatibility:");
  compat.forEach(c => {
    const eq = eqMap.get(c.equipmentId);
    console.log(`  Equipment ID: ${c.equipmentId}, Name: ${eq?.name}, Duration: ${c.durationMinutes} min, Changeover: ${c.changeoverMinutes} min`);
  });
}

run().catch(console.error);

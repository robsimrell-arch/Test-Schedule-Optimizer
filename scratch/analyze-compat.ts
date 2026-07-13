import { db } from "../server/db";
import { partEquipmentCompatibility, testEquipment } from "../shared/schema";
import { eq } from "drizzle-orm";

async function run() {
  const compat = await db.select().from(partEquipmentCompatibility).where(eq(partEquipmentCompatibility.partNumberId, 6));
  const equipment = await db.select().from(testEquipment);
  const eqMap = new Map(equipment.map(e => [e.id, e]));
  
  console.log("Compatibility for Part ID 6:");
  compat.forEach(c => {
    const eq = eqMap.get(c.equipmentId);
    console.log(`  Equipment ID: ${c.equipmentId}, Name: ${eq?.name}, Duration: ${c.durationMinutes} min, Changeover: ${c.changeoverMinutes} min`);
  });
}

run().catch(console.error);

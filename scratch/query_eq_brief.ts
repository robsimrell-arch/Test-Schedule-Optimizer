import { db } from "../server/db";
import { testEquipment } from "../shared/schema";

async function run() {
  const eq = await db.select().from(testEquipment);
  console.log("=== EQUIPMENT ===");
  console.log(JSON.stringify(eq, null, 2));

  const parts = await db.query.partNumbers.findMany({
    with: {
      steps: {
        with: {
          equipmentRequirements: {
            with: {
              equipment: true
            }
          }
        }
      }
    }
  });

  console.log("=== PARTS BRIEF ===");
  for (const part of parts) {
    console.log(`Part: ${part.partNumber} (ID: ${part.id})`);
    for (const step of part.steps) {
      console.log(`  Step ${step.stepOrder}: ${step.name} (ID: ${step.id}), batchSize: ${step.batchSize}`);
      for (const req of step.equipmentRequirements) {
        console.log(`    Requires eqId ${req.equipmentId} (${req.equipment.name}), qty: ${req.quantityRequired}`);
      }
    }
  }
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});

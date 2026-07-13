import { db } from "../server/db";
import { partNumbers, testSteps, partEquipmentCompatibility, partDependencies } from "../shared/schema";

async function run() {
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

  const compatibilities = await db.select().from(partEquipmentCompatibility);
  const dependencies = await db.select().from(partDependencies);

  console.log("=== PARTS AND STEPS ===");
  console.log(JSON.stringify(parts, null, 2));
  console.log("=== COMPATIBILITY ===");
  console.log(JSON.stringify(compatibilities, null, 2));
  console.log("=== BOM DEPENDENCIES ===");
  console.log(JSON.stringify(dependencies, null, 2));
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});

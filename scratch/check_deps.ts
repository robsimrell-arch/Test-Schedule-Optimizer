import { db } from "../server/db";
import { partDependencies, partNumbers } from "../shared/schema";

async function run() {
  const deps = await db.select().from(partDependencies);
  const parts = await db.select().from(partNumbers);
  
  const partsMap = new Map();
  for (const p of parts) {
    partsMap.set(p.id, p.partNumber);
  }
  
  console.log("=== BOM DEPENDENCIES ===");
  for (const dep of deps) {
    const parent = partsMap.get(dep.parentPartId) || `ID ${dep.parentPartId}`;
    const child = partsMap.get(dep.childPartId) || `ID ${dep.childPartId}`;
    console.log(`  - Parent: ${parent} -> Child: ${child} (Qty: ${dep.quantityRequired})`);
  }
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});

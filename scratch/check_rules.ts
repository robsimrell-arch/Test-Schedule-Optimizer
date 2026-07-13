import { db } from "../server/db";
import { partSupplyRules, partNumbers } from "../shared/schema";

async function run() {
  const rules = await db.select().from(partSupplyRules);
  const parts = await db.select().from(partNumbers);
  
  console.log("=== PARTS ===");
  console.log(JSON.stringify(parts, null, 2));
  console.log("=== SUPPLY RULES ===");
  console.log(JSON.stringify(rules, null, 2));
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});

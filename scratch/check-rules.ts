import { storage } from "../server/storage";

async function run() {
  const rules = await storage.getPartSupplyRules();
  console.log("=== DB PART SUPPLY RULES ===");
  rules.forEach(r => {
    console.log(`ID: ${r.id}, PartID: ${r.partNumberId}, Rate: ${r.expectedSupplyRate}, Fixed: ${r.fixedSupplies}`);
  });
}

run().catch(console.error);

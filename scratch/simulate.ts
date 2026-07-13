import { db } from "../server/db";
import { workOrders, partNumbers, testEquipment, partEquipmentCompatibility, partDependencies, partSupplyRules } from "../shared/schema";
import { eq } from "drizzle-orm";

// We can run the same queries that server/routes.ts does
async function run() {
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
  const allParts = await db.select().from(partNumbers);
  const allSupplyRules = await db.select().from(partSupplyRules);

  console.log("Active orders count:", orders.length);
  for (const o of orders) {
    console.log(`Order ID: ${o.id}, Part: ${o.partNumber.partNumber} (ID: ${o.partNumberId}), Qty: ${o.quantity}, Priority: ${o.priority}`);
  }

  // We can write a quick summary of when vibration (eq 6) is scheduled.
  // Wait, let's run the actual simulation function if possible, or just copy the sorting / selection logic to see why PCM3 is selected first.
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});

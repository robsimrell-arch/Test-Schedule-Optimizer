import { db } from "../server/db";
import { workOrders, workOrderStepOffsets, partNumbers } from "../shared/schema";
import { eq } from "drizzle-orm";

async function run() {
  const allOrders = await db.select().from(workOrders);
  const parts = await db.select().from(partNumbers);
  const partMap = new Map(parts.map(p => [p.id, p]));

  console.log("=== WORK ORDERS ===");
  for (const order of allOrders) {
    const offsets = await db.select().from(workOrderStepOffsets).where(eq(workOrderStepOffsets.workOrderId, order.id));
    console.log(`WO ID: ${order.id}, Part: ${partMap.get(order.partNumberId)?.partNumber}, Qty: ${order.quantity}, Status: ${order.status}`);
    offsets.forEach(off => {
      console.log(`  - Step ID: ${off.stepId}, Completed Qty: ${off.quantityCompleted}`);
    });
  }
}

run().catch(console.error);

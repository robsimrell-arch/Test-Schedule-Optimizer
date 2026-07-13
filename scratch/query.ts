import { db } from "../server/db";
import { workOrders, partNumbers } from "../shared/schema";
import { eq } from "drizzle-orm";

async function run() {
  const allOrders = await db.query.workOrders.findMany({
    with: {
      partNumber: true
    }
  });
  console.log("=== WORK ORDERS ===");
  console.log(JSON.stringify(allOrders, null, 2));
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});

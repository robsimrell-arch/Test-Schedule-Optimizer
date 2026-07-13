import { db } from "../server/db";
import { workOrders, partNumbers } from "../shared/schema";

async function run() {
  const orders = await db.query.workOrders.findMany({
    with: {
      partNumber: true
    }
  });
  console.log("=== WORK ORDERS ===");
  console.log(JSON.stringify(orders, null, 2));
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});

import { storage } from "../server/storage";

async function run() {
  const allBomDeps = await storage.getAllPartDependencies();
  const allParts = await storage.getParts();
  const allSupplyRules = await storage.getPartSupplyRules();
  const allOrders = await storage.getOrders();
  const orders = allOrders.filter(o => o.status === "scheduled");

  const partsMap = new Map(allParts.map(p => [p.id, p]));
  const wildcardPart = allParts.find(p => p.partNumber.includes("WildCard"));
  if (!wildcardPart) {
    console.error("Wildcard part not found");
    return;
  }
  const wildcardId = wildcardPart.id;
  console.log(`Wildcard ID: ${wildcardId}`);

  // Find all dependencies where wildcard is the child
  const parentDeps = allBomDeps.filter(d => d.childPartId === wildcardId);
  console.log("Parents depending on Wildcard:");
  parentDeps.forEach(d => {
    const parentPart = partsMap.get(d.parentPartId);
    console.log(`  - Parent: ${parentPart?.partNumber} (ID: ${d.parentPartId}), Qty per Parent: ${d.quantityRequired}`);
  });

  // Calculate total demand by parent work orders
  let totalWildcardDemand = 0;
  console.log("\nWork orders requiring Wildcard:");
  for (const order of orders) {
    const dep = parentDeps.find(d => d.parentPartId === order.partNumberId);
    if (dep) {
      const parentNeeded = order.quantity;
      const childNeeded = parentNeeded * dep.quantityRequired;
      totalWildcardDemand += childNeeded;
      console.log(`  WO ID: ${order.id}, Part: ${partsMap.get(order.partNumberId)?.partNumber}, Qty: ${parentNeeded}, Wildcards Needed: ${childNeeded}`);
    }
  }
  console.log(`\nTotal Wildcard demand: ${totalWildcardDemand} units`);

  // Check current supply rule for Wildcard
  const rule = allSupplyRules.find(r => r.partNumberId === wildcardId);
  console.log("\nWildcard Supply Rule:");
  if (rule) {
    console.log(`  Expected Constant Rate: ${rule.expectedSupplyRate} / day`);
    console.log(`  Fixed Supplies JSON: ${rule.fixedSupplies}`);
  } else {
    console.log("  No supply rule found");
  }
}

run().catch(console.error);

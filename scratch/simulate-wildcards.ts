import { storage } from "../server/storage";

async function run() {
  const allParts = await storage.getParts();
  const allOrders = await storage.getOrders();
  const orders = allOrders.filter(o => o.status === "scheduled");
  const partsMap = new Map(allParts.map(p => [p.id, p]));

  // Find WildCard part and its parents
  const wildcardPart = allParts.find(p => p.partNumber.includes("WildCard"));
  if (!wildcardPart) return;
  const wildcardId = wildcardPart.id;

  const allBomDeps = await storage.getAllPartDependencies();
  const parentDeps = allBomDeps.filter(d => d.childPartId === wildcardId);

  // We know the scheduled delivery is 232 units on July 12, 2026.
  // Let's fetch the actual computed tasks from the server endpoint to see when WildCard was produced
  // and when parent LRUs were scheduled.
  const url = "http://localhost:5000/api/schedule?shifts=3&workDays=7";
  const res = await fetch(url);
  if (!res.ok) {
    console.error("Failed to query schedule endpoint");
    return;
  }
  const data = await res.json();
  const tasks = data.tasks;

  console.log("=== CHRONOLOGICAL CONSUMPTION OF WILDCARD PARTS ===");
  let wildcardInventory = 0;
  
  // WildCard is produced by WO #8 (CML-WildCard-CCA). Let's trace it and its parent consumption.
  // Sort all tasks chronologically
  const sortedTasks = [...tasks].sort((a: any, b: any) => 
    new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );

  sortedTasks.forEach((t: any) => {
    // 1. Production of WildCards
    if (t.partNumber === "CML-WildCard-CCA" && t.stepOrder === 2) { // Step 2 (Thermal) completes the subassembly
      wildcardInventory += t.unitsCount;
      console.log(`[PRODUCED] +${t.unitsCount} Wildcards by WO #8 (${t.partNumber} Thermal), End: ${t.endTime}. Balance: ${wildcardInventory}`);
    }

    // 2. Consumption of WildCards by parent LRUs
    const parentDep = parentDeps.find(d => partsMap.get(d.parentPartId)?.partNumber === t.partNumber);
    if (parentDep && t.stepOrder === 1) { // Consumed at the first step of the parent LRU
      const consumed = t.unitsCount * parentDep.quantityRequired;
      wildcardInventory -= consumed;
      console.log(`[CONSUMED] -${consumed} Wildcards by parent ${t.partNumber} Vibe (WO #${t.workOrderId}), Start: ${t.startTime}. Balance: ${wildcardInventory}`);
    }
  });

  console.log(`\nFinal balance: ${wildcardInventory}`);
}

run().catch(console.error);

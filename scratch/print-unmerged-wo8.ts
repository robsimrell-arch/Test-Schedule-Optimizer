import { storage } from "./server/storage";

async function run() {
  const url = "http://localhost:5000/api/schedule?shifts=3&workDays=7";
  const res = await fetch(url);
  if (!res.ok) {
    console.error("Failed to query schedule endpoint");
    return;
  }
  const data = await res.json();
  const tasks = data.tasks;

  // Let's filter for tasks related to CML-WildCard-CCA (WO #8)
  console.log("=== WILDCARD MERGED TASKS ===");
  const wcTasks = tasks.filter((t: any) => t.partNumber === "CML-WildCard-CCA");
  wcTasks.forEach((t: any) => {
    console.log(`Task: ${t.id}, Step: ${t.stepName}, Start: ${t.startTime}, End: ${t.endTime}, Qty: ${t.unitsCount}, Equip: ${t.equipmentNames}, Units: ${t.equipmentUnitIndices}`);
    if (t.combinedOrders) {
      console.log("  Combined orders:", t.combinedOrders);
    }
  });
}

run().catch(console.error);

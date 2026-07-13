import { storage } from "./server/storage";

async function run() {
  const url = "http://localhost:5000/api/schedule?shifts=3&workDays=7";
  const res = await fetch(url);
  if (!res.ok) return;
  const data = await res.json();

  const wildcardTasks = data.tasks.filter((t: any) => t.partNumber === "CML-WildCard-CCA" && t.stepName === "Thermal");
  wildcardTasks.forEach((t: any) => {
    console.log(`Thermal task: ${t.id}, Start: ${t.startTime}, End: ${t.endTime}, Qty: ${t.unitsCount}, Equip: ${t.equipmentNames}, Units: ${t.equipmentUnitIndices}`);
  });
}

run().catch(console.error);

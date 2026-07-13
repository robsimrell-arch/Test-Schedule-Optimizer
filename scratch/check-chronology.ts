import { storage } from "./server/storage";

async function run() {
  const url = "http://localhost:5000/api/schedule?shifts=3&workDays=7";
  const res = await fetch(url);
  if (!res.ok) return;
  const data = await res.json();
  
  console.log("=== FIRST 40 TASKS ===");
  data.tasks.slice(0, 40).forEach((t: any) => {
    console.log(`Task: ${t.partNumber} - ${t.stepName}, Start: ${t.startTime}, End: ${t.endTime}, Qty: ${t.unitsCount}, ShortageAffected: ${t.isShortageAffected}, ConstrainedBy: ${t.constrainingSubassemblyName}`);
  });
}

run().catch(console.error);

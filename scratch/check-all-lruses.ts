import { storage } from "./server/storage";

async function run() {
  const url = "http://localhost:5000/api/schedule?shifts=3&workDays=7";
  const res = await fetch(url);
  if (!res.ok) return;
  const data = await res.json();

  const parentParts = ["CML-GCU-LRU", "CML-SCB-LRU", "CML-CSCP-LRU", "CML-GSCP-LRU", "CML-ETDIB2-LRU"];
  
  console.log("=== PARENT LRU VIBE TASKS IN MAIN RUN ===");
  data.tasks
    .filter((t: any) => parentParts.includes(t.partNumber) && t.stepName === "Vibe" && t.type !== "shortage_placeholder")
    .forEach((t: any) => {
      console.log(`LRU: ${t.partNumber}, Start: ${t.startTime}, End: ${t.endTime}, Qty: ${t.unitsCount}, ShortageAffected: ${t.isShortageAffected}`);
    });
}

run().catch(console.error);

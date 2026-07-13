import { storage } from "./server/storage";

async function run() {
  const url = "http://localhost:5000/api/schedule?shifts=3&workDays=7";
  const res = await fetch(url);
  if (!res.ok) return;
  const data = await res.json();

  console.log("=== OPTIMAL SUPPLY RATES ===");
  console.log(data.optimalSupplyRates);

  console.log("\n=== SUBASSEMBLY DEMAND TOTALS ===");
  console.log(data.subassemblyDemandTotals);
}

run().catch(console.error);

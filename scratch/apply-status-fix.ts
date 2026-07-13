import * as fs from "fs";
import * as path from "path";

const filePath = path.join(process.cwd(), "client/src/pages/Dashboard.tsx");
let content = fs.readFileSync(filePath, "utf8");

// Normalize CRLF to LF
content = content.replace(/\r\n/g, "\n");

const target = `    const optimalRate = schedule?.optimalSupplyRates?.[part.id] || 0;
    const status = totalDemand === 0 
      ? "No Demand" 
      : (optimalRate > 0 && expectedRate >= optimalRate) 
        ? "Optimized" 
        : "Bottleneck";`;

const replacement = `    const optimalRate = schedule?.optimalSupplyRates?.[part.id] || 0;
    const status = totalDemand === 0 
      ? "No Demand" 
      : (fixedQty >= totalDemand || (optimalRate > 0 && expectedRate >= optimalRate)) 
        ? "Optimized" 
        : "Bottleneck";`;

if (content.includes(target)) {
  content = content.replace(target, replacement);
  fs.writeFileSync(filePath, content, "utf8");
  console.log("Successfully replaced status logic in Dashboard.tsx");
} else {
  console.error("Target content not found in Dashboard.tsx!");
}

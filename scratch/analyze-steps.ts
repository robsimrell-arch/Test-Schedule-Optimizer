import { db } from "../server/db";
import { testSteps, partNumbers } from "../shared/schema";
import { eq } from "drizzle-orm";

async function run() {
  const wildcardPart = await db.select().from(partNumbers).where(eq(partNumbers.partNumber, "CML-WildCard-CCA"));
  if (wildcardPart.length === 0) {
    console.error("Wildcard part not found");
    return;
  }
  const wildcard = wildcardPart[0];
  console.log(`Part: ${wildcard.partNumber} (ID: ${wildcard.id})`);
  
  const steps = await db.select().from(testSteps).where(eq(testSteps.partNumberId, wildcard.id));
  console.log("Steps:");
  steps.forEach(s => {
    console.log(`  Step ID: ${s.id}, Name: ${s.name}, Order: ${s.stepOrder}, BatchSize: ${s.batchSize}, Duration: ${s.durationMinutes} min, ChamberReq: ${s.chamberRequired}`);
  });
}

run().catch(console.error);

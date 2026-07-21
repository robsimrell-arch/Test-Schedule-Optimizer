import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function main() {
  console.log("Truncating all database tables to clear state...");
  try {
    await db.execute(sql`
      TRUNCATE TABLE 
        test_equipment, 
        part_numbers, 
        test_steps, 
        step_equipment, 
        work_order_step_offsets, 
        work_orders, 
        part_equipment_compatibility, 
        part_dependencies, 
        part_supply_rules 
      RESTART IDENTITY CASCADE;
    `);
    console.log("All tables cleared successfully! The next time you start the app, it will re-seed automatically.");
  } catch (error) {
    console.error("Failed to truncate tables:", error);
  }
  process.exit(0);
}

main();

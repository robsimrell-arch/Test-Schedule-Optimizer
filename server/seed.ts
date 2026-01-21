import { storage } from "./storage";

export async function seedDatabase() {
  const existingEquipment = await storage.getEquipment();
  if (existingEquipment.length > 0) return;

  console.log("Seeding database...");

  // 1. Create Equipment
  const tester = await storage.createEquipment({ name: "Circuit Tester A", quantity: 2, description: "Standard circuit board tester" });
  const oven = await storage.createEquipment({ name: "Burn-in Oven", quantity: 1, description: "Heat treatment oven" });
  const inspection = await storage.createEquipment({ name: "Final Inspection Station", quantity: 3, description: "Manual visual inspection" });
  const powerSupply = await storage.createEquipment({ name: "Programmable DC Power Supply", quantity: 2, description: "Provides power for testing" });

  // 2. Create Parts
  const pcb = await storage.createPart({ partNumber: "PCB-101", description: "Main Controller Board" });
  const sensor = await storage.createPart({ partNumber: "Sensor-X200", description: "High-precision thermal sensor" });

  // 3. Create Steps with Multiple Equipment
  // PCB-101
  await storage.createStep({ 
    partNumberId: pcb.id, 
    stepOrder: 1, 
    durationMinutes: 5, 
    batchSize: 1 
  }, [tester.id, powerSupply.id]); // Requires both Tester and Power Supply

  await storage.createStep({ 
    partNumberId: pcb.id, 
    stepOrder: 2, 
    durationMinutes: 60, 
    batchSize: 10 
  }, [oven.id]);

  await storage.createStep({ 
    partNumberId: pcb.id, 
    stepOrder: 3, 
    durationMinutes: 2, 
    batchSize: 1 
  }, [inspection.id]);

  // Sensor-X200
  await storage.createStep({ 
    partNumberId: sensor.id, 
    stepOrder: 1, 
    durationMinutes: 3, 
    batchSize: 1 
  }, [tester.id]);

  await storage.createStep({ 
    partNumberId: sensor.id, 
    stepOrder: 2, 
    durationMinutes: 2, 
    batchSize: 1 
  }, [inspection.id]);

  // 4. Create Initial Work Order
  await storage.createOrder({ 
    partNumberId: pcb.id, 
    quantity: 25, 
    priority: 1 
  });

  console.log("Database seeded successfully!");
}

import { storage } from "./storage";

export async function seedDatabase() {
  try {
    console.log("Checking if database needs seeding...");
    const existingEquipment = await storage.getEquipment();
    if (existingEquipment.length > 0) {
      console.log(`Database already has ${existingEquipment.length} equipment items, skipping seed.`);
      return;
    }

    console.log("Database is empty. Seeding with manufacturing equipment and parts...");

  // 1. Create Equipment
  const essTestStation = await storage.createEquipment({ name: "ESS Test Station", quantity: 4, description: "" });
  const essCableGCU = await storage.createEquipment({ name: "ESS Cable (GCU)", quantity: 12, description: "Cable required to test 1 GCU" });
  const essCableSCB = await storage.createEquipment({ name: "ESS Cable (SCB)", quantity: 12, description: "Cable required to test 1 SCB" });
  const essCableCSCP = await storage.createEquipment({ name: "ESS Cable (CSCP)", quantity: 12, description: "Cable required to test 1 SCB" });
  const essCableGSCP = await storage.createEquipment({ name: "ESS Cable (GSCP)", quantity: 12, description: "Cable required to test 1 GSCP" });
  const vibration = await storage.createEquipment({ name: "Vibration", quantity: 1, description: "Vibration Test System" });
  const essChamber1 = await storage.createEquipment({ name: "ESS Chamber 1", quantity: 1, description: "Environmental Stress Screening Chamber 1" });
  const essChamber2 = await storage.createEquipment({ name: "ESS Chamber 2", quantity: 1, description: "Environmental Stress Screening Chamber 2" });
  const essChamber3 = await storage.createEquipment({ name: "ESS Chamber 3", quantity: 1, description: "Environmental Stress Screening Chamber 3" });
  const essCableWildCard = await storage.createEquipment({ name: "ESS Cable (WildCard)", quantity: 12, description: "" });
  const essCablePowerSupply = await storage.createEquipment({ name: "ESS Cable (Power Supply)", quantity: 12, description: "" });
  const essCableETDIB = await storage.createEquipment({ name: "ESS Cable (ETDIB)", quantity: 12, description: "Cable required to test 1 ETDIB" });
  const essCPowerCart = await storage.createEquipment({ name: "ESS-C Power Cart", quantity: 1, description: "Power cart required to test GCU" });
  const wildcardBackplane = await storage.createEquipment({ name: "Wildcard Backplane", quantity: 14, description: "Backplane required to test Wildcard CCA" });
  const powerSupplyBackplane = await storage.createEquipment({ name: "Power Supply Backplane", quantity: 14, description: "Backplane required to test Power Supply CCA" });

  // 2. Create Part Numbers
  const gscp = await storage.createPart({ partNumber: "GSCP", description: "GSCP LRU" });
  const scb = await storage.createPart({ partNumber: "SCB", description: "SCB LRU" });
  const cscp = await storage.createPart({ partNumber: "CSCP", description: "CSCP LRU" });
  const gcu = await storage.createPart({ partNumber: "GCU", description: "GCU LRU" });
  const etdib = await storage.createPart({ partNumber: "ETDIB", description: "ETDIB LRU" });
  const wildcardCCA = await storage.createPart({ partNumber: "WildCard CCA", description: "Wildcard Circuit Card" });
  const powerSupplyCCA = await storage.createPart({ partNumber: "Power Supply CCA", description: "Power Supply Circuit Card" });

  // 3. Create Test Steps with Equipment Requirements
  // GSCP Steps
  await storage.createStep({ 
    partNumberId: gscp.id, 
    stepOrder: 1, 
    durationMinutes: 15, 
    batchSize: 4,
    chamberRequired: false,
    name: "Vibe"
  }, [
    { equipmentId: essTestStation.id, quantityRequired: 1 },
    { equipmentId: essCableGSCP.id, quantityRequired: 4 },
    { equipmentId: vibration.id, quantityRequired: 1 }
  ]);

  await storage.createStep({ 
    partNumberId: gscp.id, 
    stepOrder: 2, 
    durationMinutes: 0, 
    batchSize: 12,
    chamberRequired: true,
    name: "Thermal"
  }, [
    { equipmentId: essCableGSCP.id, quantityRequired: 12 },
    { equipmentId: essTestStation.id, quantityRequired: 1 }
  ]);

  // SCB Steps
  await storage.createStep({ 
    partNumberId: scb.id, 
    stepOrder: 1, 
    durationMinutes: 15, 
    batchSize: 2,
    chamberRequired: false,
    name: "Vibe"
  }, [
    { equipmentId: vibration.id, quantityRequired: 1 },
    { equipmentId: essTestStation.id, quantityRequired: 1 },
    { equipmentId: essCableSCB.id, quantityRequired: 1 }
  ]);

  await storage.createStep({ 
    partNumberId: scb.id, 
    stepOrder: 2, 
    durationMinutes: 0, 
    batchSize: 12,
    chamberRequired: true,
    name: "Thermal"
  }, [
    { equipmentId: essTestStation.id, quantityRequired: 1 },
    { equipmentId: essCableSCB.id, quantityRequired: 10 }
  ]);

  // CSCP Steps
  await storage.createStep({ 
    partNumberId: cscp.id, 
    stepOrder: 1, 
    durationMinutes: 15, 
    batchSize: 2,
    chamberRequired: false,
    name: "Vibe"
  }, [
    { equipmentId: vibration.id, quantityRequired: 1 },
    { equipmentId: essTestStation.id, quantityRequired: 1 },
    { equipmentId: essCableCSCP.id, quantityRequired: 4 }
  ]);

  await storage.createStep({ 
    partNumberId: cscp.id, 
    stepOrder: 2, 
    durationMinutes: 0, 
    batchSize: 12,
    chamberRequired: true,
    name: "Thermal"
  }, [
    { equipmentId: essCableCSCP.id, quantityRequired: 12 },
    { equipmentId: essTestStation.id, quantityRequired: 1 }
  ]);

  // GCU Steps
  await storage.createStep({ 
    partNumberId: gcu.id, 
    stepOrder: 1, 
    durationMinutes: 15, 
    batchSize: 2,
    chamberRequired: false,
    name: "Vibe"
  }, [
    { equipmentId: vibration.id, quantityRequired: 1 },
    { equipmentId: essCPowerCart.id, quantityRequired: 1 },
    { equipmentId: essCableGCU.id, quantityRequired: 1 },
    { equipmentId: essTestStation.id, quantityRequired: 1 }
  ]);

  await storage.createStep({ 
    partNumberId: gcu.id, 
    stepOrder: 2, 
    durationMinutes: 0, 
    batchSize: 12,
    chamberRequired: true
  }, [
    { equipmentId: essTestStation.id, quantityRequired: 1 },
    { equipmentId: essCableGCU.id, quantityRequired: 12 },
    { equipmentId: essCPowerCart.id, quantityRequired: 1 }
  ]);

  // ETDIB Steps
  await storage.createStep({ 
    partNumberId: etdib.id, 
    stepOrder: 1, 
    durationMinutes: 15, 
    batchSize: 2,
    chamberRequired: false,
    name: "Vibe"
  }, [
    { equipmentId: essCableETDIB.id, quantityRequired: 1 },
    { equipmentId: essTestStation.id, quantityRequired: 1 },
    { equipmentId: vibration.id, quantityRequired: 1 }
  ]);

  // WildCard CCA Steps
  await storage.createStep({ 
    partNumberId: wildcardCCA.id, 
    stepOrder: 1, 
    durationMinutes: 15, 
    batchSize: 4,
    chamberRequired: false
  }, [
    { equipmentId: essTestStation.id, quantityRequired: 1 },
    { equipmentId: essCableWildCard.id, quantityRequired: 4 },
    { equipmentId: wildcardBackplane.id, quantityRequired: 4 },
    { equipmentId: vibration.id, quantityRequired: 1 }
  ]);

  await storage.createStep({ 
    partNumberId: wildcardCCA.id, 
    stepOrder: 2, 
    durationMinutes: 0, 
    batchSize: 12,
    chamberRequired: true
  }, [
    { equipmentId: essTestStation.id, quantityRequired: 1 },
    { equipmentId: wildcardBackplane.id, quantityRequired: 12 },
    { equipmentId: essCableWildCard.id, quantityRequired: 12 }
  ]);

  // Power Supply CCA Steps
  await storage.createStep({ 
    partNumberId: powerSupplyCCA.id, 
    stepOrder: 1, 
    durationMinutes: 15, 
    batchSize: 4,
    chamberRequired: false,
    name: "Vibe"
  }, [
    { equipmentId: essCablePowerSupply.id, quantityRequired: 1 },
    { equipmentId: essTestStation.id, quantityRequired: 1 },
    { equipmentId: powerSupplyBackplane.id, quantityRequired: 1 },
    { equipmentId: vibration.id, quantityRequired: 1 }
  ]);

  await storage.createStep({ 
    partNumberId: powerSupplyCCA.id, 
    stepOrder: 2, 
    durationMinutes: 0, 
    batchSize: 12,
    chamberRequired: true
  }, [
    { equipmentId: powerSupplyBackplane.id, quantityRequired: 1 },
    { equipmentId: essTestStation.id, quantityRequired: 1 },
    { equipmentId: essCablePowerSupply.id, quantityRequired: 1 }
  ]);

  // 4. Set Part-Chamber Compatibility with durations
  await storage.setPartCompatibility(cscp.id, [
    { equipmentId: essChamber1.id, durationMinutes: 1360 }
  ]);
  await storage.setPartCompatibility(gcu.id, [
    { equipmentId: essChamber1.id, durationMinutes: 1360 }
  ]);
  await storage.setPartCompatibility(gscp.id, [
    { equipmentId: essChamber2.id, durationMinutes: 1360 },
    { equipmentId: essChamber3.id, durationMinutes: 1360 }
  ]);
  await storage.setPartCompatibility(powerSupplyCCA.id, [
    { equipmentId: essChamber1.id, durationMinutes: 720 },
    { equipmentId: essChamber2.id, durationMinutes: 880 },
    { equipmentId: essChamber3.id, durationMinutes: 1040 }
  ]);
  await storage.setPartCompatibility(scb.id, [
    { equipmentId: essChamber1.id, durationMinutes: 1280 }
  ]);
  await storage.setPartCompatibility(wildcardCCA.id, [
    { equipmentId: essChamber1.id, durationMinutes: 720 }
  ]);

  // 5. Create Sample Work Orders
  await storage.createOrder({ 
    partNumberId: gscp.id, 
    quantity: 30, 
    priority: 1,
    dueDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000)
  });

  await storage.createOrder({ 
    partNumberId: scb.id, 
    quantity: 75, 
    priority: 1,
    dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
  });

  console.log("Database seeded successfully with manufacturing data!");
  } catch (error) {
    console.error("Error seeding database:", error);
    throw error;
  }
}

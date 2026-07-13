import { storage } from "../server/storage";

async function check() {
  const orders = await storage.getOrders();
  const parts = await storage.getParts();
  
  console.log("=== WORK ORDERS ===");
  orders.forEach(o => {
    const part = parts.find(p => p.id === o.partNumberId);
    console.log(`WO ID: ${o.id}, Num: ${o.workOrderNumber}, Part: ${part?.partNumber}, Qty: ${o.quantity}, Priority: ${o.priority}, Status: ${o.status}`);
  });
}

check().catch(console.error);

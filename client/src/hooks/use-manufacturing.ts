import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl, type InsertTestEquipment, type InsertPartNumber, type InsertTestStep, type InsertWorkOrder } from "@shared/routes";
import { useToast } from "@/hooks/use-toast";

// ============================================
// EQUIPMENT HOOKS
// ============================================

export function useEquipment() {
  return useQuery({
    queryKey: [api.equipment.list.path],
    queryFn: async () => {
      const res = await fetch(api.equipment.list.path);
      if (!res.ok) throw new Error("Failed to fetch equipment");
      return api.equipment.list.responses[200].parse(await res.json());
    },
  });
}

export function useCreateEquipment() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: InsertTestEquipment) => {
      const res = await fetch(api.equipment.create.path, {
        method: api.equipment.create.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create equipment");
      return api.equipment.create.responses[201].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.equipment.list.path] });
      toast({ title: "Success", description: "Test equipment added successfully" });
    },
    onError: (error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });
}

export function useDeleteEquipment() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: number) => {
      const url = buildUrl(api.equipment.delete.path, { id });
      const res = await fetch(url, { method: api.equipment.delete.method });
      if (!res.ok) throw new Error("Failed to delete equipment");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.equipment.list.path] });
      toast({ title: "Success", description: "Equipment deleted" });
    },
  });
}

export function useUpdateEquipment() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<InsertTestEquipment> }) => {
      const url = buildUrl(api.equipment.update.path, { id });
      const res = await fetch(url, {
        method: api.equipment.update.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update equipment");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.equipment.list.path] });
      toast({ title: "Success", description: "Equipment updated" });
    },
  });
}

// ============================================
// PART NUMBERS HOOKS
// ============================================

export function useParts() {
  return useQuery({
    queryKey: [api.parts.list.path],
    queryFn: async () => {
      const res = await fetch(api.parts.list.path);
      if (!res.ok) throw new Error("Failed to fetch parts");
      return api.parts.list.responses[200].parse(await res.json());
    },
  });
}

export function usePart(id: number | null) {
  return useQuery({
    queryKey: [api.parts.get.path, id],
    enabled: !!id,
    queryFn: async () => {
      if (!id) throw new Error("No ID provided");
      const url = buildUrl(api.parts.get.path, { id });
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch part details");
      return api.parts.get.responses[200].parse(await res.json());
    },
  });
}

export function useCreatePart() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: InsertPartNumber) => {
      const res = await fetch(api.parts.create.path, {
        method: api.parts.create.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create part number");
      return api.parts.create.responses[201].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.parts.list.path] });
      toast({ title: "Success", description: "Part number created" });
    },
  });
}

export function useDeletePart() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: number) => {
      const url = buildUrl(api.parts.delete.path, { id });
      const res = await fetch(url, { method: api.parts.delete.method });
      if (!res.ok) throw new Error("Failed to delete part");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.parts.list.path] });
      toast({ title: "Success", description: "Part number deleted" });
    },
  });
}

// ============================================
// TEST STEPS HOOKS
// ============================================

export function useCreateStep() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: any) => {
      const res = await fetch(api.steps.create.path, {
        method: api.steps.create.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to add test step");
      return api.steps.create.responses[201].parse(await res.json());
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [api.parts.get.path, data.partNumberId] });
      queryClient.invalidateQueries({ queryKey: [api.parts.list.path] });
      queryClient.invalidateQueries({ queryKey: [api.schedule.calculate.path] });
      toast({ title: "Success", description: "Test step added" });
    },
  });
}

export function useDeleteStep() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, partId }: { id: number; partId: number }) => {
      const url = buildUrl(api.steps.delete.path, { id });
      const res = await fetch(url, { method: api.steps.delete.method });
      if (!res.ok) throw new Error("Failed to delete step");
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: [api.parts.get.path, variables.partId] });
      queryClient.invalidateQueries({ queryKey: [api.parts.list.path] });
      queryClient.invalidateQueries({ queryKey: [api.schedule.calculate.path] });
      toast({ title: "Success", description: "Test step removed" });
    },
  });
}

export function useUpdateStep() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, partId, data }: { id: number; partId: number; data: any }) => {
      const url = buildUrl(api.steps.update.path, { id });
      const res = await fetch(url, {
        method: api.steps.update.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update step");
      return { result: await res.json(), partId };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [api.parts.get.path, data.partId] });
      queryClient.invalidateQueries({ queryKey: [api.parts.list.path] });
      queryClient.invalidateQueries({ queryKey: [api.schedule.calculate.path] });
      toast({ title: "Success", description: "Test step updated" });
    },
  });
}

// ============================================
// WORK ORDERS HOOKS
// ============================================

export function useWorkOrders() {
  return useQuery({
    queryKey: [api.orders.list.path],
    queryFn: async () => {
      const res = await fetch(api.orders.list.path);
      if (!res.ok) throw new Error("Failed to fetch work orders");
      return api.orders.list.responses[200].parse(await res.json());
    },
  });
}

export function useCreateWorkOrder() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: InsertWorkOrder) => {
      const res = await fetch(api.orders.create.path, {
        method: api.orders.create.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create work order");
      return api.orders.create.responses[201].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.orders.list.path] });
      queryClient.invalidateQueries({ queryKey: [api.schedule.calculate.path] });
      toast({ title: "Success", description: "Work order created" });
    },
  });
}

export function useDeleteWorkOrder() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: number) => {
      const url = buildUrl(api.orders.delete.path, { id });
      const res = await fetch(url, { method: api.orders.delete.method });
      if (!res.ok) throw new Error("Failed to delete work order");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.orders.list.path] });
      queryClient.invalidateQueries({ queryKey: [api.schedule.calculate.path] });
      toast({ title: "Success", description: "Work order deleted" });
    },
  });
}

// ============================================
// SCHEDULE HOOKS
// ============================================

export function useSchedule() {
  return useQuery({
    queryKey: [api.schedule.calculate.path],
    queryFn: async () => {
      const res = await fetch(api.schedule.calculate.path);
      if (!res.ok) throw new Error("Failed to calculate schedule");
      return api.schedule.calculate.responses[200].parse(await res.json());
    },
  });
}

// ============================================
// PART-EQUIPMENT COMPATIBILITY HOOKS
// ============================================

export function usePartCompatibility(partId: number | null) {
  return useQuery({
    queryKey: ["/api/parts", partId, "compatibility"],
    enabled: !!partId,
    queryFn: async () => {
      if (!partId) return [];
      const res = await fetch(`/api/parts/${partId}/compatibility`);
      if (!res.ok) throw new Error("Failed to fetch compatibility");
      return res.json() as Promise<{ partNumberId: number; equipmentId: number }[]>;
    },
  });
}

export function useSetPartCompatibility() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ partId, equipmentIds }: { partId: number; equipmentIds: number[] }) => {
      const res = await fetch(`/api/parts/${partId}/compatibility`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ equipmentIds }),
      });
      if (!res.ok) throw new Error("Failed to update compatibility");
      return res.json();
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/parts", variables.partId, "compatibility"] });
      queryClient.invalidateQueries({ queryKey: [api.schedule.calculate.path] });
      toast({ title: "Success", description: "Chamber compatibility updated" });
    },
  });
}

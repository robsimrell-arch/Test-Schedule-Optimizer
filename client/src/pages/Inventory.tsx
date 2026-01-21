import { useState } from "react";
import { Layout } from "@/components/Layout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, Search, Settings2, Clock, Box, Pencil, Thermometer } from "lucide-react";
import { useEquipment, useParts, useCreateEquipment, useDeleteEquipment, useUpdateEquipment, useCreatePart, useDeletePart, useCreateStep, useDeleteStep, useUpdateStep, usePartCompatibility, useSetPartCompatibility, useChambers, useAllCompatibility } from "@/hooks/use-manufacturing";
import type { TestEquipment } from "@shared/schema";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertTestEquipmentSchema, insertPartNumberSchema } from "@shared/routes";
import { z } from "zod";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";

// --- FORMS & SCHEMAS ---

function EquipmentForm({ onSuccess }: { onSuccess: () => void }) {
  const create = useCreateEquipment();
  const form = useForm<z.infer<typeof insertTestEquipmentSchema>>({
    resolver: zodResolver(insertTestEquipmentSchema),
    defaultValues: { quantity: 1, name: "", description: "" },
  });

  const onSubmit = (data: any) => {
    create.mutate(data, { onSuccess });
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-2">
        <Label>Equipment Name</Label>
        <Input {...form.register("name")} placeholder="e.g. Thermal Chamber A" />
        {form.formState.errors.name && <p className="text-xs text-red-500">{form.formState.errors.name.message}</p>}
      </div>
      <div className="space-y-2">
        <Label>Quantity Available</Label>
        <Input type="number" {...form.register("quantity", { valueAsNumber: true })} />
      </div>
      <div className="space-y-2">
        <Label>Description</Label>
        <Input {...form.register("description")} placeholder="Optional details..." />
      </div>
      <DialogFooter>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? "Adding..." : "Add Equipment"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function EditEquipmentForm({ equipment, onSuccess }: { equipment: TestEquipment; onSuccess: () => void }) {
  const update = useUpdateEquipment();
  const form = useForm({
    defaultValues: { 
      name: equipment.name, 
      quantity: equipment.quantity, 
      description: equipment.description || "" 
    },
  });

  const onSubmit = (data: any) => {
    update.mutate({ id: equipment.id, data }, { onSuccess });
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-2">
        <Label>Equipment Name</Label>
        <Input {...form.register("name")} data-testid="input-edit-equipment-name" />
      </div>
      <div className="space-y-2">
        <Label>Quantity Available</Label>
        <Input type="number" {...form.register("quantity", { valueAsNumber: true })} data-testid="input-edit-equipment-qty" />
      </div>
      <div className="space-y-2">
        <Label>Description</Label>
        <Input {...form.register("description")} data-testid="input-edit-equipment-desc" />
      </div>
      <DialogFooter>
        <Button type="submit" disabled={update.isPending} data-testid="button-save-equipment">
          {update.isPending ? "Saving..." : "Save Changes"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function PartForm({ onSuccess }: { onSuccess: () => void }) {
  const create = useCreatePart();
  const form = useForm<z.infer<typeof insertPartNumberSchema>>({
    resolver: zodResolver(insertPartNumberSchema),
    defaultValues: { partNumber: "", description: "" },
  });

  const onSubmit = (data: any) => {
    create.mutate(data, { onSuccess });
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-2">
        <Label>Part Number</Label>
        <Input {...form.register("partNumber")} placeholder="e.g. PCB-101-REV-A" />
      </div>
      <div className="space-y-2">
        <Label>Description</Label>
        <Input {...form.register("description")} placeholder="Main controller board..." />
      </div>
      <DialogFooter>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? "Creating..." : "Create Part Number"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function StepForm({ partId, onSuccess }: { partId: number; onSuccess: () => void }) {
  const create = useCreateStep();
  const { data: equipment } = useEquipment();
  
  const form = useForm({
    defaultValues: {
      partNumberId: partId,
      stepOrder: 1,
      durationMinutes: 60,
      batchSize: 1,
      chamberRequired: false,
      equipmentRequirements: [] as { equipmentId: number; quantityRequired: number; durationMinutes: number | null }[],
    },
  });

  const equipmentReqs = form.watch("equipmentRequirements");
  const chamberRequired = form.watch("chamberRequired");

  const nonChamberEquipment = equipment?.filter(eq => 
    !eq.name.toLowerCase().includes("chamber")
  ) || [];

  const toggleEquipment = (eqId: number, checked: boolean) => {
    const current = form.getValues("equipmentRequirements");
    if (checked) {
      form.setValue("equipmentRequirements", [...current, { equipmentId: eqId, quantityRequired: 1, durationMinutes: null }]);
    } else {
      form.setValue("equipmentRequirements", current.filter(r => r.equipmentId !== eqId));
    }
  };

  const updateQuantity = (eqId: number, qty: number) => {
    const current = form.getValues("equipmentRequirements");
    form.setValue("equipmentRequirements", current.map(r => 
      r.equipmentId === eqId ? { ...r, quantityRequired: qty } : r
    ));
  };

  const updateEquipmentDuration = (eqId: number, duration: number | null) => {
    const current = form.getValues("equipmentRequirements");
    form.setValue("equipmentRequirements", current.map(r => 
      r.equipmentId === eqId ? { ...r, durationMinutes: duration } : r
    ));
  };

  const onSubmit = (data: any) => {
    create.mutate({ ...data, partNumberId: partId }, { onSuccess: () => {
      form.reset();
      onSuccess();
    } });
  };

  if (!equipment) return null;

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 border p-4 rounded-lg bg-muted/20">
      <h4 className="font-semibold text-sm mb-2">Add New Test Step</h4>
      <div className="space-y-4">
        <div className="p-3 rounded-lg border bg-primary/5 border-primary/20">
          <div className="flex items-center gap-3">
            <Checkbox
              id="chamberRequired"
              data-testid="checkbox-chamber-required"
              checked={chamberRequired}
              onCheckedChange={(checked) => form.setValue("chamberRequired", !!checked)}
            />
            <label htmlFor="chamberRequired" className="text-sm font-medium cursor-pointer flex items-center gap-2">
              <Thermometer className="w-4 h-4 text-primary" />
              ESS Chamber Required
            </label>
          </div>
          <p className="text-xs text-muted-foreground ml-6 mt-1">
            If checked, the scheduler will assign a compatible ESS Chamber based on the Chamber Compatibility settings.
          </p>
        </div>

        <div className="space-y-2">
          <Label>Required Equipment (non-chamber)</Label>
          <div className="space-y-2 mt-2">
            {nonChamberEquipment.map((eq) => {
              const isSelected = equipmentReqs.some(r => r.equipmentId === eq.id);
              const currentReq = equipmentReqs.find(r => r.equipmentId === eq.id);
              const currentQty = currentReq?.quantityRequired || 1;
              const currentDuration = currentReq?.durationMinutes ?? "";
              
              return (
                <div key={eq.id} className="p-2 rounded border bg-card space-y-2">
                  <div className="flex items-center gap-3">
                    <Checkbox
                      id={`eq-${eq.id}`}
                      data-testid={`checkbox-equipment-${eq.id}`}
                      checked={isSelected}
                      onCheckedChange={(checked) => toggleEquipment(eq.id, !!checked)}
                    />
                    <label
                      htmlFor={`eq-${eq.id}`}
                      className="text-sm font-medium leading-none cursor-pointer flex-1"
                    >
                      {eq.name}
                      <span className="text-xs text-muted-foreground ml-2">({eq.quantity} available)</span>
                    </label>
                  </div>
                  {isSelected && (
                    <div className="flex items-center gap-4 ml-6">
                      <div className="flex items-center gap-2">
                        <Label className="text-xs text-muted-foreground whitespace-nowrap">Qty:</Label>
                        <Input
                          type="number"
                          min={1}
                          max={eq.quantity}
                          value={currentQty}
                          onChange={(e) => updateQuantity(eq.id, Math.max(1, parseInt(e.target.value) || 1))}
                          className="w-16 h-8"
                          data-testid={`input-equipment-qty-${eq.id}`}
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <Label className="text-xs text-muted-foreground whitespace-nowrap">Duration (min):</Label>
                        <Input
                          type="number"
                          min={1}
                          value={currentDuration}
                          onChange={(e) => {
                            const val = e.target.value;
                            updateEquipmentDuration(eq.id, val === "" ? null : parseInt(val) || null);
                          }}
                          placeholder="Default"
                          className="w-20 h-8"
                          data-testid={`input-equipment-duration-${eq.id}`}
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label>Step Order</Label>
            <Input type="number" {...form.register("stepOrder", { valueAsNumber: true })} data-testid="input-step-order" />
          </div>
          <div className="space-y-2">
            <Label>Duration (min)</Label>
            <Input type="number" {...form.register("durationMinutes", { valueAsNumber: true })} data-testid="input-duration" />
          </div>
          <div className="space-y-2">
            <Label>Batch Size</Label>
            <Input type="number" {...form.register("batchSize", { valueAsNumber: true })} data-testid="input-batch-size" />
          </div>
        </div>
      </div>
      <Button size="sm" type="submit" className="w-full" disabled={create.isPending || (equipmentReqs.length === 0 && !chamberRequired)} data-testid="button-add-step">
        {create.isPending ? "Adding Step..." : "Add Step"}
      </Button>
    </form>
  );
}

function EditStepForm({ step, partId, onSuccess }: { step: any; partId: number; onSuccess: () => void }) {
  const update = useUpdateStep();
  const { data: equipment } = useEquipment();
  
  const initialEquipmentReqs = step.equipmentRequirements?.filter((r: any) => 
    !r.equipment?.name?.toLowerCase().includes("chamber")
  ).map((r: any) => ({
    equipmentId: r.equipmentId,
    quantityRequired: r.quantityRequired || 1,
    durationMinutes: r.durationMinutes ?? null
  })) || [];
  
  const form = useForm({
    defaultValues: {
      stepOrder: step.stepOrder,
      durationMinutes: step.durationMinutes,
      batchSize: step.batchSize,
      chamberRequired: step.chamberRequired || false,
      equipmentRequirements: initialEquipmentReqs as { equipmentId: number; quantityRequired: number; durationMinutes: number | null }[],
    },
  });

  const equipmentReqs = form.watch("equipmentRequirements");
  const chamberRequired = form.watch("chamberRequired");

  const nonChamberEquipment = equipment?.filter(eq => 
    !eq.name.toLowerCase().includes("chamber")
  ) || [];

  const toggleEquipment = (eqId: number, checked: boolean) => {
    const current = form.getValues("equipmentRequirements");
    if (checked) {
      form.setValue("equipmentRequirements", [...current, { equipmentId: eqId, quantityRequired: 1, durationMinutes: null }]);
    } else {
      form.setValue("equipmentRequirements", current.filter(r => r.equipmentId !== eqId));
    }
  };

  const updateQuantity = (eqId: number, qty: number) => {
    const current = form.getValues("equipmentRequirements");
    form.setValue("equipmentRequirements", current.map(r => 
      r.equipmentId === eqId ? { ...r, quantityRequired: qty } : r
    ));
  };

  const updateEquipmentDuration = (eqId: number, duration: number | null) => {
    const current = form.getValues("equipmentRequirements");
    form.setValue("equipmentRequirements", current.map(r => 
      r.equipmentId === eqId ? { ...r, durationMinutes: duration } : r
    ));
  };

  const onSubmit = (data: any) => {
    update.mutate({ id: step.id, partId, data }, { onSuccess });
  };

  if (!equipment) return null;

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      <div className="p-3 rounded-lg border bg-primary/5 border-primary/20">
        <div className="flex items-center gap-3">
          <Checkbox
            id="edit-chamberRequired"
            data-testid="checkbox-edit-chamber-required"
            checked={chamberRequired}
            onCheckedChange={(checked) => form.setValue("chamberRequired", !!checked)}
          />
          <label htmlFor="edit-chamberRequired" className="text-sm font-medium cursor-pointer flex items-center gap-2">
            <Thermometer className="w-4 h-4 text-primary" />
            ESS Chamber Required
          </label>
        </div>
        <p className="text-xs text-muted-foreground ml-6 mt-1">
          If checked, the scheduler will assign a compatible ESS Chamber.
        </p>
      </div>

      <div className="space-y-2">
        <Label>Required Equipment (non-chamber)</Label>
        <div className="space-y-2 mt-2 max-h-48 overflow-y-auto">
          {nonChamberEquipment.map((eq) => {
            const isSelected = equipmentReqs.some(r => r.equipmentId === eq.id);
            const currentReq = equipmentReqs.find(r => r.equipmentId === eq.id);
            const currentQty = currentReq?.quantityRequired || 1;
            const currentDuration = currentReq?.durationMinutes ?? "";
            
            return (
              <div key={eq.id} className="p-2 rounded border bg-card space-y-2">
                <div className="flex items-center gap-3">
                  <Checkbox
                    id={`edit-eq-${eq.id}`}
                    data-testid={`checkbox-edit-equipment-${eq.id}`}
                    checked={isSelected}
                    onCheckedChange={(checked) => toggleEquipment(eq.id, !!checked)}
                  />
                  <label htmlFor={`edit-eq-${eq.id}`} className="text-sm font-medium leading-none cursor-pointer flex-1">
                    {eq.name}
                  </label>
                </div>
                {isSelected && (
                  <div className="flex items-center gap-4 ml-6">
                    <div className="flex items-center gap-2">
                      <Label className="text-xs text-muted-foreground whitespace-nowrap">Qty:</Label>
                      <Input
                        type="number"
                        min={1}
                        max={eq.quantity}
                        value={currentQty}
                        onChange={(e) => updateQuantity(eq.id, Math.max(1, parseInt(e.target.value) || 1))}
                        className="w-16 h-8"
                        data-testid={`input-edit-equipment-qty-${eq.id}`}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <Label className="text-xs text-muted-foreground whitespace-nowrap">Duration (min):</Label>
                      <Input
                        type="number"
                        min={1}
                        value={currentDuration}
                        onChange={(e) => {
                          const val = e.target.value;
                          updateEquipmentDuration(eq.id, val === "" ? null : parseInt(val) || null);
                        }}
                        placeholder="Default"
                        className="w-20 h-8"
                        data-testid={`input-edit-equipment-duration-${eq.id}`}
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label>Step Order</Label>
          <Input type="number" {...form.register("stepOrder", { valueAsNumber: true })} data-testid="input-edit-step-order" />
        </div>
        <div className="space-y-2">
          <Label>Duration (min)</Label>
          <Input type="number" {...form.register("durationMinutes", { valueAsNumber: true })} data-testid="input-edit-duration" />
        </div>
        <div className="space-y-2">
          <Label>Batch Size</Label>
          <Input type="number" {...form.register("batchSize", { valueAsNumber: true })} data-testid="input-edit-batch-size" />
        </div>
      </div>
      <DialogFooter>
        <Button type="submit" disabled={update.isPending || (equipmentReqs.length === 0 && !chamberRequired)} data-testid="button-save-step">
          {update.isPending ? "Saving..." : "Save Changes"}
        </Button>
      </DialogFooter>
    </form>
  );
}

// --- CHAMBER COMPATIBILITY SECTION ---

function ChamberCompatibilitySection({ partId }: { partId: number }) {
  const { data: equipment } = useEquipment();
  const { data: compatibility, isLoading } = usePartCompatibility(partId);
  const setCompatibility = useSetPartCompatibility();
  
  const essChambers = equipment?.filter(eq => 
    eq.name.toLowerCase().includes("chamber")
  ) || [];
  
  const compatibleIds = compatibility?.map(c => c.equipmentId) || [];
  
  const toggleChamber = (eqId: number, checked: boolean) => {
    const currentCompatibilities = compatibility || [];
    let newCompatibilities;
    if (checked) {
      newCompatibilities = [...currentCompatibilities.map(c => ({ equipmentId: c.equipmentId, durationMinutes: c.durationMinutes })), { equipmentId: eqId, durationMinutes: null }];
    } else {
      newCompatibilities = currentCompatibilities.filter(c => c.equipmentId !== eqId).map(c => ({ equipmentId: c.equipmentId, durationMinutes: c.durationMinutes }));
    }
    setCompatibility.mutate({ partId, compatibilities: newCompatibilities });
  };

  if (essChambers.length === 0) {
    return null;
  }

  return (
    <div>
      <h3 className="text-sm font-semibold mb-4 flex items-center gap-2 text-primary">
        <Thermometer className="w-4 h-4" /> ESS Chamber Compatibility
      </h3>
      <p className="text-xs text-muted-foreground mb-3">
        Select which ESS Chambers this part can be tested in. If none are selected, the part can use any chamber.
      </p>
      
      {isLoading ? (
        <div className="h-12 bg-muted rounded animate-pulse" />
      ) : (
        <div className="flex flex-wrap gap-2">
          {essChambers.map((eq) => {
            const isCompatible = compatibleIds.includes(eq.id);
            return (
              <div
                key={eq.id}
                className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-colors ${
                  isCompatible 
                    ? "bg-primary/10 border-primary" 
                    : "bg-card hover:bg-muted/50"
                }`}
                onClick={() => toggleChamber(eq.id, !isCompatible)}
                data-testid={`chamber-compat-${eq.id}`}
              >
                <Checkbox
                  checked={isCompatible}
                  onCheckedChange={(checked) => toggleChamber(eq.id, !!checked)}
                  data-testid={`checkbox-chamber-${eq.id}`}
                />
                <span className="text-sm font-medium">{eq.name}</span>
              </div>
            );
          })}
        </div>
      )}
      
      {compatibleIds.length === 0 && !isLoading && (
        <p className="text-xs text-muted-foreground mt-2 italic">
          No chambers selected - this part can use any available ESS Chamber.
        </p>
      )}
    </div>
  );
}

// --- CHAMBER COMPATIBILITY TAB ---

function ChamberCompatibilityTab() {
  const { data: parts, isLoading: isLoadingParts } = useParts();
  const { data: rawChambers, isLoading: isLoadingChambers } = useChambers();
  const { data: allCompatibility, isLoading: isLoadingCompat } = useAllCompatibility();
  const setCompatibility = useSetPartCompatibility();

  const isLoading = isLoadingParts || isLoadingChambers || isLoadingCompat;
  
  // Sort chambers by name so ESS Chamber 1 comes before ESS Chamber 2, etc.
  const chambers = rawChambers?.slice().sort((a, b) => a.name.localeCompare(b.name));

  const getCompatibility = (partId: number, chamberId: number) => {
    return allCompatibility?.find(c => c.partNumberId === partId && c.equipmentId === chamberId);
  };

  const toggleCompatibility = (partId: number, chamberId: number, isCurrentlyCompatible: boolean) => {
    const partCompat = allCompatibility?.filter(c => c.partNumberId === partId) || [];
    let newCompatibilities;
    
    if (isCurrentlyCompatible) {
      newCompatibilities = partCompat
        .filter(c => c.equipmentId !== chamberId)
        .map(c => ({ equipmentId: c.equipmentId, durationMinutes: c.durationMinutes }));
    } else {
      newCompatibilities = [
        ...partCompat.map(c => ({ equipmentId: c.equipmentId, durationMinutes: c.durationMinutes })),
        { equipmentId: chamberId, durationMinutes: null }
      ];
    }
    
    setCompatibility.mutate({ partId, compatibilities: newCompatibilities });
  };

  const updateDuration = (partId: number, chamberId: number, duration: number | null) => {
    const partCompat = allCompatibility?.filter(c => c.partNumberId === partId) || [];
    const newCompatibilities = partCompat.map(c => ({
      equipmentId: c.equipmentId,
      durationMinutes: c.equipmentId === chamberId ? duration : c.durationMinutes
    }));
    
    setCompatibility.mutate({ partId, compatibilities: newCompatibilities });
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-8">
          <div className="space-y-4">
            <div className="h-8 bg-muted rounded animate-pulse" />
            <div className="h-32 bg-muted rounded animate-pulse" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!chambers || chambers.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <Thermometer className="w-12 h-12 mx-auto mb-4 opacity-20" />
          <p className="text-muted-foreground">No ESS Chambers found in the equipment list.</p>
          <p className="text-xs text-muted-foreground mt-2">Add equipment with "Chamber" in the name to see them here.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Thermometer className="w-5 h-5" /> Chamber Compatibility Matrix
        </CardTitle>
        <CardDescription>
          Configure which parts can be tested in which ESS chambers and set chamber-specific test durations.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[150px]">Part Number</TableHead>
                {chambers.map(chamber => (
                  <TableHead key={chamber.id} className="text-center min-w-[180px]">
                    {chamber.name}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {parts?.map(part => (
                <TableRow key={part.id}>
                  <TableCell className="font-medium">{part.partNumber}</TableCell>
                  {chambers.map(chamber => {
                    const compat = getCompatibility(part.id, chamber.id);
                    const isCompatible = !!compat;
                    
                    return (
                      <TableCell key={chamber.id} className="text-center">
                        <div className="flex flex-col items-center gap-2">
                          <div
                            className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-colors ${
                              isCompatible 
                                ? "bg-primary/10 border-primary" 
                                : "bg-muted/30 hover:bg-muted/50"
                            }`}
                            onClick={() => toggleCompatibility(part.id, chamber.id, isCompatible)}
                            data-testid={`compat-${part.id}-${chamber.id}`}
                          >
                            <Checkbox
                              checked={isCompatible}
                              onCheckedChange={() => toggleCompatibility(part.id, chamber.id, isCompatible)}
                              data-testid={`checkbox-compat-${part.id}-${chamber.id}`}
                            />
                            <span className="text-xs">{isCompatible ? "Compatible" : "Not Compatible"}</span>
                          </div>
                          
                          {isCompatible && (
                            <div className="flex items-center gap-1">
                              <Label className="text-xs text-muted-foreground">Duration:</Label>
                              <Input
                                type="number"
                                min={1}
                                value={compat.durationMinutes ?? ""}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  updateDuration(part.id, chamber.id, val === "" ? null : parseInt(val) || null);
                                }}
                                placeholder="Default"
                                className="w-20 h-7 text-xs"
                                data-testid={`duration-${part.id}-${chamber.id}`}
                              />
                              <span className="text-xs text-muted-foreground">min</span>
                            </div>
                          )}
                        </div>
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
              {(!parts || parts.length === 0) && (
                <TableRow>
                  <TableCell colSpan={1 + (chambers?.length || 0)} className="text-center py-8 text-muted-foreground">
                    No part numbers defined yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        
        <div className="mt-4 p-3 bg-muted/30 rounded-lg">
          <p className="text-sm text-muted-foreground">
            <strong>How it works:</strong> Check which chambers each part can use. If no chambers are selected, the part can use any chamber.
            Set chamber-specific durations to override the default test step duration.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// --- MAIN PAGE COMPONENT ---

export default function Inventory() {
  const [selectedPart, setSelectedPart] = useState<number | null>(null);
  const [isEqOpen, setIsEqOpen] = useState(false);
  const [isPartOpen, setIsPartOpen] = useState(false);
  const [editingEquipment, setEditingEquipment] = useState<TestEquipment | null>(null);
  const [editingStep, setEditingStep] = useState<any | null>(null);

  // Queries
  const { data: equipment, isLoading: isLoadingEq } = useEquipment();
  const { data: parts, isLoading: isLoadingParts } = useParts();
  
  // Mutations
  const deleteEq = useDeleteEquipment();
  const deletePart = useDeletePart();
  const deleteStep = useDeleteStep();

  // Derived state for detail view
  const activePart = parts?.find(p => p.id === selectedPart);
  const activePartSteps = activePart?.steps || [];

  return (
    <Layout>
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Inventory Management</h1>
          <p className="text-muted-foreground mt-2">Manage test equipment, part numbers, and process definitions.</p>
        </div>
      </div>

      <Tabs defaultValue="equipment" className="space-y-6">
        <TabsList className="bg-card border border-border/50 p-1 rounded-xl shadow-sm">
          <TabsTrigger value="equipment" className="px-6 py-2 rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Test Equipment</TabsTrigger>
          <TabsTrigger value="parts" className="px-6 py-2 rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Part Numbers</TabsTrigger>
          <TabsTrigger value="chambers" className="px-6 py-2 rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground" data-testid="tab-chambers">Chamber Compatibility</TabsTrigger>
        </TabsList>

        {/* EQUIPMENT TAB */}
        <TabsContent value="equipment">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Test Equipment List</CardTitle>
                <CardDescription>Available machines and workstations.</CardDescription>
              </div>
              <Dialog open={isEqOpen} onOpenChange={setIsEqOpen}>
                <DialogTrigger asChild>
                  <Button className="gap-2">
                    <Plus className="w-4 h-4" /> Add Equipment
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Add Test Equipment</DialogTitle>
                    <DialogDescription>Define a new resource type for testing.</DialogDescription>
                  </DialogHeader>
                  <EquipmentForm onSuccess={() => setIsEqOpen(false)} />
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent>
              {isLoadingEq ? (
                <div className="space-y-2">
                  <div className="h-12 bg-muted rounded animate-pulse" />
                  <div className="h-12 bg-muted rounded animate-pulse" />
                  <div className="h-12 bg-muted rounded animate-pulse" />
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Quantity</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {equipment?.map((eq) => (
                      <TableRow key={eq.id}>
                        <TableCell className="font-medium">{eq.name}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="px-2 py-0.5">{eq.quantity} units</Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{eq.description || "-"}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button 
                              variant="ghost" 
                              size="icon"
                              onClick={() => setEditingEquipment(eq)}
                              data-testid={`button-edit-equipment-${eq.id}`}
                            >
                              <Pencil className="w-4 h-4" />
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="text-red-500 hover:text-red-700 hover:bg-red-50"
                              onClick={() => {
                                  if (confirm("Delete this equipment?")) deleteEq.mutate(eq.id);
                              }}
                              data-testid={`button-delete-equipment-${eq.id}`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {equipment?.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                          No equipment defined yet.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
          
          {/* Edit Equipment Dialog */}
          <Dialog open={!!editingEquipment} onOpenChange={(open) => !open && setEditingEquipment(null)}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Edit Equipment</DialogTitle>
                <DialogDescription>Update equipment details.</DialogDescription>
              </DialogHeader>
              {editingEquipment && (
                <EditEquipmentForm equipment={editingEquipment} onSuccess={() => setEditingEquipment(null)} />
              )}
            </DialogContent>
          </Dialog>
        </TabsContent>

        {/* PARTS TAB */}
        <TabsContent value="parts" className="flex gap-6 items-start flex-col lg:flex-row">
          {/* Part List */}
          <Card className="flex-1 w-full lg:w-1/3">
            <CardHeader className="flex flex-row items-center justify-between pb-4">
              <CardTitle className="text-lg">Part Numbers</CardTitle>
              <Dialog open={isPartOpen} onOpenChange={setIsPartOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" variant="outline"><Plus className="w-4 h-4" /></Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>New Part Number</DialogTitle>
                  </DialogHeader>
                  <PartForm onSuccess={() => setIsPartOpen(false)} />
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[500px]">
                <div className="divide-y divide-border">
                  {parts?.map((part) => (
                    <div 
                      key={part.id}
                      onClick={() => setSelectedPart(part.id)}
                      className={`p-4 cursor-pointer transition-colors hover:bg-muted/50 flex justify-between items-center group ${selectedPart === part.id ? "bg-muted border-l-4 border-l-primary" : "border-l-4 border-l-transparent"}`}
                    >
                      <div>
                        <div className="font-medium">{part.partNumber}</div>
                        <div className="text-xs text-muted-foreground truncate max-w-[180px]">{part.description || "No description"}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="text-xs">{part.steps?.length || 0} steps</Badge>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={(e) => {
                            e.stopPropagation();
                            if(confirm("Delete part?")) deletePart.mutate(part.id);
                          }}
                        >
                           <Trash2 className="w-3 h-3 text-red-500" />
                        </Button>
                      </div>
                    </div>
                  ))}
                  {parts?.length === 0 && <div className="p-4 text-center text-sm text-muted-foreground">No parts found</div>}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          {/* Details & Steps Configuration */}
          <Card className="flex-[2] w-full">
            {activePart ? (
              <>
                <CardHeader>
                  <div className="flex justify-between items-start">
                    <div>
                      <CardTitle className="text-xl flex items-center gap-2">
                        {activePart.partNumber}
                        <Badge>Active</Badge>
                      </CardTitle>
                      <CardDescription className="mt-1">{activePart.description}</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div>
                    <h3 className="text-sm font-semibold mb-4 flex items-center gap-2 text-primary">
                      <Settings2 className="w-4 h-4" /> Process Definition
                    </h3>
                    
                    <div className="space-y-3">
                      {activePartSteps.sort((a: any, b: any) => a.stepOrder - b.stepOrder).map((step: any) => {
                        const nonChamberEquipment = step.equipmentRequirements?.filter((r: any) => 
                          !r.equipment?.name?.toLowerCase().includes("chamber")
                        ) || [];
                        
                        return (
                          <div key={step.id} className="flex items-center justify-between p-3 rounded-lg border bg-card shadow-sm hover:shadow-md transition-shadow">
                            <div className="flex items-center gap-4">
                              <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm">
                                {step.stepOrder}
                              </div>
                              <div>
                                <div className="font-medium flex items-center gap-2">
                                  {step.chamberRequired && (
                                    <Badge variant="outline" className="text-xs border-primary text-primary">
                                      <Thermometer className="w-3 h-3 mr-1" />
                                      ESS Chamber
                                    </Badge>
                                  )}
                                  {nonChamberEquipment.map((r: any) => 
                                    r.quantityRequired > 1 
                                      ? `${r.equipment?.name} (x${r.quantityRequired})` 
                                      : r.equipment?.name
                                  ).filter(Boolean).join(", ") || (step.chamberRequired ? "" : "No Equipment Required")}
                                </div>
                                <div className="text-xs text-muted-foreground flex gap-3 mt-1">
                                  <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {step.durationMinutes}m</span>
                                  <span className="flex items-center gap-1"><Box className="w-3 h-3" /> Batch: {step.batchSize}</span>
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                              <Button 
                                variant="ghost" 
                                size="icon"
                                onClick={() => setEditingStep(step)}
                                data-testid={`button-edit-step-${step.id}`}
                              >
                                <Pencil className="w-4 h-4" />
                              </Button>
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                className="text-red-500 hover:text-red-600"
                                onClick={() => deleteStep.mutate({ id: step.id, partId: activePart.id })}
                                data-testid={`button-delete-step-${step.id}`}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                      
                      {activePartSteps.length === 0 && (
                        <div className="text-center py-8 bg-muted/20 rounded-lg border border-dashed border-muted-foreground/30">
                          <p className="text-sm text-muted-foreground">No test steps defined for this part.</p>
                        </div>
                      )}
                    </div>
                  </div>

                  <Separator />

                  <ChamberCompatibilitySection partId={activePart.id} />

                  <Separator />
                  
                  <StepForm partId={activePart.id} onSuccess={() => {}} />
                </CardContent>
              </>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-muted-foreground p-12">
                <Search className="w-12 h-12 mb-4 opacity-20" />
                <p>Select a part number to view and edit its test process.</p>
              </div>
            )}
          </Card>
          
          {/* Edit Step Dialog */}
          <Dialog open={!!editingStep} onOpenChange={(open) => !open && setEditingStep(null)}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Edit Test Step</DialogTitle>
                <DialogDescription>Update step configuration.</DialogDescription>
              </DialogHeader>
              {editingStep && activePart && (
                <EditStepForm step={editingStep} partId={activePart.id} onSuccess={() => setEditingStep(null)} />
              )}
            </DialogContent>
          </Dialog>
        </TabsContent>

        {/* CHAMBER COMPATIBILITY TAB */}
        <TabsContent value="chambers">
          <ChamberCompatibilityTab />
        </TabsContent>
      </Tabs>
    </Layout>
  );
}

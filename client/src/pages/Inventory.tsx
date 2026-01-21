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
import { Plus, Trash2, Search, Settings2, Clock, Box } from "lucide-react";
import { useEquipment, useParts, useCreateEquipment, useDeleteEquipment, useCreatePart, useDeletePart, useCreateStep, useDeleteStep } from "@/hooks/use-manufacturing";
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
      equipmentIds: [] as number[],
    },
  });

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
        <div className="space-y-2">
          <Label>Required Equipment</Label>
          <div className="grid grid-cols-2 gap-2 mt-2">
            <Controller
              control={form.control}
              name="equipmentIds"
              render={({ field }) => (
                <>
                  {equipment.map((eq) => (
                    <div key={eq.id} className="flex items-center space-x-2">
                      <Checkbox
                        id={`eq-${eq.id}`}
                        checked={field.value.includes(eq.id)}
                        onCheckedChange={(checked) => {
                          const current = field.value || [];
                          if (checked) {
                            field.onChange([...current, eq.id]);
                          } else {
                            field.onChange(current.filter((id) => id !== eq.id));
                          }
                        }}
                      />
                      <label
                        htmlFor={`eq-${eq.id}`}
                        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                      >
                        {eq.name}
                      </label>
                    </div>
                  ))}
                </>
              )}
            />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label>Step Order</Label>
            <Input type="number" {...form.register("stepOrder", { valueAsNumber: true })} />
          </div>
          <div className="space-y-2">
            <Label>Duration (min)</Label>
            <Input type="number" {...form.register("durationMinutes", { valueAsNumber: true })} />
          </div>
          <div className="space-y-2">
            <Label>Batch Size</Label>
            <Input type="number" {...form.register("batchSize", { valueAsNumber: true })} />
          </div>
        </div>
      </div>
      <Button size="sm" type="submit" className="w-full" disabled={create.isPending || form.watch("equipmentIds").length === 0}>
        {create.isPending ? "Adding Step..." : "Add Step"}
      </Button>
    </form>
  );
}

// --- MAIN PAGE COMPONENT ---

export default function Inventory() {
  const [selectedPart, setSelectedPart] = useState<number | null>(null);
  const [isEqOpen, setIsEqOpen] = useState(false);
  const [isPartOpen, setIsPartOpen] = useState(false);

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
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="text-red-500 hover:text-red-700 hover:bg-red-50"
                            onClick={() => {
                                if (confirm("Delete this equipment?")) deleteEq.mutate(eq.id);
                            }}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
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
                      {activePartSteps.sort((a: any, b: any) => a.stepOrder - b.stepOrder).map((step: any) => (
                        <div key={step.id} className="flex items-center justify-between p-3 rounded-lg border bg-card shadow-sm hover:shadow-md transition-shadow">
                          <div className="flex items-center gap-4">
                            <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm">
                              {step.stepOrder}
                            </div>
                            <div>
                              <div className="font-medium">
                                {step.equipmentRequirements?.map((r: any) => r.equipment.name).join(", ") || "No Equipment Required"}
                              </div>
                              <div className="text-xs text-muted-foreground flex gap-3 mt-1">
                                <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {step.durationMinutes}m</span>
                                <span className="flex items-center gap-1"><Box className="w-3 h-3" /> Batch: {step.batchSize}</span>
                              </div>
                            </div>
                          </div>
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="text-red-500 hover:text-red-600"
                            onClick={() => deleteStep.mutate({ id: step.id, partId: activePart.id })}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      ))}
                      
                      {activePartSteps.length === 0 && (
                        <div className="text-center py-8 bg-muted/20 rounded-lg border border-dashed border-muted-foreground/30">
                          <p className="text-sm text-muted-foreground">No test steps defined for this part.</p>
                        </div>
                      )}
                    </div>
                  </div>

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
        </TabsContent>
      </Tabs>
    </Layout>
  );
}

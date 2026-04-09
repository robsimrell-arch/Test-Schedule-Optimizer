import { useState } from "react";
import { Layout } from "@/components/Layout";
import { useWorkOrders, useCreateWorkOrder, useUpdateWorkOrder, useDeleteWorkOrder, useParts } from "@/hooks/use-manufacturing";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { Plus, Trash2, Calendar, AlertCircle, ChevronDown, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

// ─── Create Order Form (modal) ────────────────────────────────────────────────

function CreateOrderForm({ onSuccess }: { onSuccess: () => void }) {
  const create = useCreateWorkOrder();
  const { data: parts } = useParts();
  const [selectedPart, setSelectedPart] = useState<any>(null);

  const form = useForm<any>({
    defaultValues: {
      workOrderNumber: "",
      partNumberId: "",
      quantity: 1,
      priority: 1,
      dueDate: "",
      stepOffsets: {},
    },
  });

  const onSubmit = (data: any) => {
    if (!data.partNumberId) { alert("Please select a part number"); return; }
    const stepOffsets = Object.entries(data.stepOffsets || {})
      .filter(([_, qty]) => Number(qty) > 0)
      .map(([stepId, qty]) => ({ stepId: Number(stepId), quantityCompleted: Number(qty) }));
    create.mutate(
      { workOrderNumber: data.workOrderNumber || null, partNumberId: Number(data.partNumberId), quantity: Number(data.quantity), priority: Number(data.priority), dueDate: data.dueDate ? new Date(data.dueDate).toISOString() : null, status: "pending", stepOffsets },
      { onSuccess: () => { form.reset(); onSuccess(); }, onError: (e: any) => alert("Failed: " + e.message) }
    );
  };

  const partNumberId = form.watch("partNumberId");
  const handlePartChange = (val: string) => {
    form.setValue("partNumberId", val);
    setSelectedPart(parts?.find(p => p.id.toString() === val));
    form.setValue("stepOffsets", {});
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col h-full">
      <div className="space-y-4 max-h-[60vh] overflow-y-auto px-1 flex-1">
        <div className="space-y-2">
          <Label>Work Order Number (optional)</Label>
          <Input {...form.register("workOrderNumber")} placeholder="e.g., WO-2024-001" data-testid="input-work-order-number" />
        </div>
        <div className="space-y-2">
          <Label>Part Number</Label>
          <Select value={partNumberId} onValueChange={handlePartChange}>
            <SelectTrigger data-testid="select-part-number"><SelectValue placeholder="Select part..." /></SelectTrigger>
            <SelectContent>{parts?.map(p => <SelectItem key={p.id} value={p.id.toString()}>{p.partNumber}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Total Quantity</Label>
            <Input type="number" {...form.register("quantity")} min={1} data-testid="input-quantity" />
          </div>
          <div className="space-y-2">
            <Label>Priority (1 = Highest)</Label>
            <Input type="number" {...form.register("priority")} min={1} max={5} placeholder="1-5" data-testid="input-priority" />
          </div>
        </div>
        {selectedPart?.steps?.length > 0 && (
          <div className="space-y-3 pt-2 border-t mt-4">
            <Label className="text-sm font-semibold">Units Already Completed Per Step</Label>
            <div className="grid grid-cols-1 gap-3">
              {selectedPart.steps.map((step: any) => (
                <div key={step.id} className="flex items-center justify-between gap-4 p-2 rounded-md bg-muted/50">
                  <p className="text-sm font-medium truncate flex-1">Step {step.stepOrder}: {step.name || "Unnamed Step"}</p>
                  <div className="w-24">
                    <Input type="number" size={1} className="h-8 text-right" {...form.register(`stepOffsets.${step.id}`)} min={0} max={form.watch("quantity")} placeholder="Qty" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="space-y-2 pb-2">
          <Label>Due Date</Label>
          <Input type="date" {...form.register("dueDate")} data-testid="input-due-date" />
        </div>
      </div>
      <DialogFooter className="pt-4 mt-auto">
        <Button type="submit" disabled={create.isPending} className="w-full" data-testid="button-submit-work-order">
          {create.isPending ? "Creating..." : "Create Work Order"}
        </Button>
      </DialogFooter>
    </form>
  );
}

// ─── Inline Step Offsets Row ──────────────────────────────────────────────────

function StepOffsetRow({ order, colSpan }: { order: any; colSpan: number }) {
  const updateOrder = useUpdateWorkOrder();
  const { data: parts } = useParts();
  const part = parts?.find((p: any) => p.id === order.partNumberId);
  const steps = (part as any)?.steps ?? [];

  const offsetsMap: Record<number, number> = {};
  order.stepOffsets?.forEach((o: any) => { offsetsMap[o.stepId] = o.quantityCompleted; });

  const [localOffsets, setLocalOffsets] = useState<Record<number, string>>(
    () => Object.fromEntries(steps.map((s: any) => [s.id, String(offsetsMap[s.id] ?? 0)]))
  );

  const saveOffsets = () => {
    const stepOffsets = steps
      .map((s: any) => ({ stepId: s.id, quantityCompleted: Number(localOffsets[s.id]) || 0 }))
      .filter((o: any) => o.quantityCompleted > 0);
    updateOrder.mutate({
      id: order.id,
      data: { ...order, dueDate: order.dueDate ? new Date(order.dueDate) : null, stepOffsets },
    });
  };

  if (steps.length === 0) {
    return (
      <TableRow>
        <TableCell colSpan={colSpan} className="bg-muted/30 text-muted-foreground text-xs italic px-8 py-2">
          No test steps defined for this part.
        </TableCell>
      </TableRow>
    );
  }

  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="bg-muted/20 px-8 py-3">
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Units Completed Per Step</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {steps.map((step: any) => (
              <div key={step.id} className="flex items-center gap-3 p-2 rounded-md bg-background border text-sm">
                <span className="flex-1 truncate text-xs">Step {step.stepOrder}: {step.name || "Unnamed"}</span>
                <input
                  type="number"
                  min={0}
                  max={order.quantity}
                  value={localOffsets[step.id] ?? "0"}
                  onChange={e => setLocalOffsets(prev => ({ ...prev, [step.id]: e.target.value }))}
                  onBlur={saveOffsets}
                  onKeyDown={e => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                  className="w-16 h-7 text-right text-xs rounded border bg-muted/50 px-2 focus:outline-none focus:ring-1 focus:ring-primary"
                  data-testid={`offset-${order.id}-${step.id}`}
                />
                <span className="text-xs text-muted-foreground">/ {order.quantity}</span>
              </div>
            ))}
          </div>
        </div>
      </TableCell>
    </TableRow>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function WorkOrders() {
  const [isOpen, setIsOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [cyclingId, setCyclingId] = useState<number | null>(null);
  const [cyclingPriorityId, setCyclingPriorityId] = useState<number | null>(null);
  const { data: orders, isLoading } = useWorkOrders();
  const { data: parts } = useParts();
  const deleteOrder = useDeleteWorkOrder();
  const updateOrder = useUpdateWorkOrder();

  const STATUS_CYCLE: Record<string, string> = { pending: "scheduled", scheduled: "completed", completed: "pending" };

  const saveField = (order: any, patch: Record<string, any>) => {
    updateOrder.mutate({ id: order.id, data: { ...order, dueDate: order.dueDate ? new Date(order.dueDate) : null, ...patch } });
  };

  const cycleStatus = (order: any) => {
    if (cyclingId === order.id) return;
    setCyclingId(order.id);
    updateOrder.mutate(
      { id: order.id, data: { ...order, status: STATUS_CYCLE[order.status] ?? "pending", dueDate: order.dueDate ? new Date(order.dueDate) : null } },
      { onSettled: () => setCyclingId(null) }
    );
  };

  const cyclePriority = (order: any) => {
    if (cyclingPriorityId === order.id) return;
    const next = (order.priority ?? 1) >= 5 ? 1 : (order.priority ?? 1) + 1;
    setCyclingPriorityId(order.id);
    updateOrder.mutate(
      { id: order.id, data: { ...order, priority: next, dueDate: order.dueDate ? new Date(order.dueDate) : null } },
      { onSettled: () => setCyclingPriorityId(null) }
    );
  };

  const getStatusColor = (s: string) => {
    if (s === "completed") return "bg-green-100 text-green-700 border-green-200";
    if (s === "scheduled") return "bg-blue-100 text-blue-700 border-blue-200";
    if (s === "pending")   return "bg-yellow-100 text-yellow-700 border-yellow-200";
    return "bg-gray-100 text-gray-700";
  };

  const getPriorityColor = (p: number) => {
    if (p <= 1) return "border-red-300 text-red-700 bg-red-50 font-bold";
    if (p <= 2) return "border-orange-300 text-orange-600 bg-orange-50 font-semibold";
    if (p <= 3) return "border-yellow-300 text-yellow-700 bg-yellow-50";
    return "border-gray-200 text-gray-600 bg-gray-50";
  };

  const getDisplayId = (order: any) =>
    order.workOrderNumber || `WO-${order.id.toString().padStart(4, "0")}`;

  const COL_SPAN = 8;

  return (
    <Layout>
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Work Orders</h1>
          <p className="text-muted-foreground mt-2">Create and manage production batches.</p>
        </div>
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button size="lg" className="shadow-lg shadow-primary/20">
              <Plus className="w-5 h-5 mr-2" /> New Order
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>New Work Order</DialogTitle>
              <DialogDescription>Schedule a new production run.</DialogDescription>
            </DialogHeader>
            <CreateOrderForm onSuccess={() => setIsOpen(false)} />
          </DialogContent>
        </Dialog>
      </div>

      <Card className="border-border/60 shadow-sm">
        <CardHeader>
          <CardTitle>Active Orders</CardTitle>
          <CardDescription>All fields are editable inline. Click the chevron to edit step offsets.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map(i => <div key={i} className="h-16 bg-muted rounded-lg animate-pulse" />)}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>Order ID / WO#</TableHead>
                  <TableHead>Part Number</TableHead>
                  <TableHead>Quantity</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Due Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders?.map((order) => {
                  const expanded = expandedId === order.id;
                  return (
                    <>
                      <TableRow key={order.id} className="group">

                        {/* Expand toggle */}
                        <TableCell className="p-1 w-8">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-muted-foreground hover:text-primary"
                            onClick={() => setExpandedId(expanded ? null : order.id)}
                            title="Edit step offsets"
                            data-testid={`expand-${order.id}`}
                          >
                            {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                          </Button>
                        </TableCell>

                        {/* WO Number — inline text */}
                        <TableCell className="font-mono text-xs">
                          <input
                            type="text"
                            defaultValue={order.workOrderNumber ?? ""}
                            placeholder={`WO-${order.id.toString().padStart(4, "0")}`}
                            onBlur={e => saveField(order, { workOrderNumber: e.target.value.trim() || null })}
                            onKeyDown={e => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                            className="bg-transparent border-0 border-b border-transparent hover:border-input focus:border-primary focus:outline-none w-[120px] text-xs"
                            data-testid={`input-wo-${order.id}`}
                          />
                        </TableCell>

                        {/* Part Number — inline select */}
                        <TableCell>
                          <Select
                            value={order.partNumberId?.toString()}
                            onValueChange={val => saveField(order, { partNumberId: Number(val) })}
                          >
                            <SelectTrigger className="h-8 text-sm border-transparent hover:border-input bg-transparent w-[140px]" data-testid={`select-part-${order.id}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {parts?.map(p => <SelectItem key={p.id} value={p.id.toString()}>{p.partNumber}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </TableCell>

                        {/* Quantity — inline number */}
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              min={1}
                              defaultValue={order.quantity}
                              onBlur={e => saveField(order, { quantity: Number(e.target.value) || 1 })}
                              onKeyDown={e => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                              className="bg-transparent border-0 border-b border-transparent hover:border-input focus:border-primary focus:outline-none w-14 text-sm text-right"
                              data-testid={`input-qty-${order.id}`}
                            />
                            <span className="text-xs text-muted-foreground">units</span>
                          </div>
                        </TableCell>

                        {/* Priority — click to cycle P1–P5 */}
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={`${getPriorityColor(order.priority ?? 1)} border cursor-pointer select-none hover:opacity-80 active:scale-95 transition-all`}
                            onClick={() => cyclePriority(order)}
                            title="Click to change priority"
                            data-testid={`badge-priority-${order.id}`}
                          >
                            {cyclingPriorityId === order.id ? "…" : `P${order.priority}`}
                          </Badge>
                        </TableCell>

                        {/* Due Date — inline date picker */}
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Calendar className="w-3 h-3 text-muted-foreground shrink-0" />
                            <input
                              type="date"
                              defaultValue={order.dueDate ? format(new Date(order.dueDate), "yyyy-MM-dd") : ""}
                              onBlur={e => saveField(order, { dueDate: e.target.value ? new Date(e.target.value) : null })}
                              className="text-sm bg-transparent border-0 border-b border-transparent hover:border-input focus:border-primary focus:outline-none w-[130px] cursor-pointer"
                              data-testid={`date-due-${order.id}`}
                            />
                          </div>
                        </TableCell>

                        {/* Status — click to cycle */}
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={`${getStatusColor(order.status)} border capitalize cursor-pointer select-none hover:opacity-80 active:scale-95 transition-all`}
                            onClick={() => cycleStatus(order)}
                            title="Click to change status"
                            data-testid={`badge-status-${order.id}`}
                          >
                            {cyclingId === order.id ? "…" : order.status}
                          </Badge>
                        </TableCell>

                        {/* Delete */}
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-muted-foreground hover:text-red-500 transition-colors"
                            onClick={() => { if (confirm("Delete this work order?")) deleteOrder.mutate(order.id); }}
                            data-testid={`button-delete-order-${order.id}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </TableCell>
                      </TableRow>

                      {/* Expandable step offsets row */}
                      {expanded && <StepOffsetRow order={order} colSpan={COL_SPAN} />}
                    </>
                  );
                })}
                {orders?.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={COL_SPAN} className="h-32 text-center text-muted-foreground">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <AlertCircle className="w-8 h-8 opacity-20" />
                        <p>No active work orders found.</p>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </Layout>
  );
}

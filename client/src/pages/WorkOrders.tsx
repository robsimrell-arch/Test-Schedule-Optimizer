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
import { Plus, Trash2, Calendar, AlertCircle, Pencil } from "lucide-react";
import { format } from "date-fns";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

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
    if (!data.partNumberId) {
      alert("Please select a part number");
      return;
    }

    const stepOffsets = Object.entries(data.stepOffsets || {})
      .filter(([_, qty]) => Number(qty) > 0)
      .map(([stepId, qty]) => ({
        stepId: Number(stepId),
        quantityCompleted: Number(qty)
      }));

    const payload: any = {
      workOrderNumber: data.workOrderNumber || null,
      partNumberId: Number(data.partNumberId),
      quantity: Number(data.quantity),
      priority: Number(data.priority),
      dueDate: data.dueDate ? new Date(data.dueDate).toISOString() : null,
      status: "pending",
      stepOffsets
    };

    create.mutate(payload, { 
      onSuccess: () => {
        form.reset();
        onSuccess();
      },
      onError: (error: any) => {
        alert("Failed to create work order: " + (error.message || "Unknown error"));
      }
    });
  };

  const partNumberId = form.watch("partNumberId");

  const handlePartChange = (val: string) => {
    form.setValue("partNumberId", val);
    const part = parts?.find(p => p.id.toString() === val);
    setSelectedPart(part);
    form.setValue("stepOffsets", {});
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col h-full">
      <div className="space-y-4 max-h-[60vh] overflow-y-auto px-1 flex-1">
        <div className="space-y-2">
          <Label>Work Order Number (optional)</Label>
          <Input 
            {...form.register("workOrderNumber")} 
            placeholder="e.g., WO-2024-001"
            data-testid="input-work-order-number"
          />
        </div>

        <div className="space-y-2">
          <Label>Part Number</Label>
          <Select 
            value={partNumberId} 
            onValueChange={handlePartChange}
          >
            <SelectTrigger data-testid="select-part-number">
              <SelectValue placeholder="Select part..." />
            </SelectTrigger>
            <SelectContent>
              {parts?.map((p) => (
                <SelectItem key={p.id} value={p.id.toString()}>
                  {p.partNumber}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Total Quantity</Label>
            <Input 
              type="number" 
              {...form.register("quantity")} 
              min={1} 
              data-testid="input-quantity"
            />
          </div>
          <div className="space-y-2">
            <Label>Priority</Label>
            <Input 
              type="number" 
              {...form.register("priority")} 
              min={1} 
              max={10} 
              placeholder="1-10"
              data-testid="input-priority"
            />
          </div>
        </div>

        {selectedPart && selectedPart.steps && selectedPart.steps.length > 0 && (
          <div className="space-y-3 pt-2 border-t mt-4">
            <Label className="text-sm font-semibold">Units Already Completed Per Step</Label>
            <div className="grid grid-cols-1 gap-3">
              {selectedPart.steps.map((step: any) => (
                <div key={step.id} className="flex items-center justify-between gap-4 p-2 rounded-md bg-muted/50">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      Step {step.stepOrder}: {step.name || "Unnamed Step"}
                    </p>
                  </div>
                  <div className="w-24">
                    <Input
                      type="number"
                      size={1}
                      className="h-8 text-right"
                      {...form.register(`stepOffsets.${step.id}`)}
                      min={0}
                      max={form.watch("quantity")}
                      placeholder="Qty"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-2 pb-2">
          <Label>Due Date</Label>
          <Input 
            type="date" 
            {...form.register("dueDate")}
            data-testid="input-due-date"
          />
        </div>
      </div>

      <DialogFooter className="pt-4 mt-auto">
        <Button 
          type="submit" 
          disabled={create.isPending} 
          className="w-full"
          data-testid="button-submit-work-order"
        >
          {create.isPending ? "Creating..." : "Create Work Order"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function EditOrderForm({ order, onSuccess }: { order: any; onSuccess: () => void }) {
  const update = useUpdateWorkOrder();
  const { data: parts } = useParts();
  const selectedPart = parts?.find(p => p.id === order.partNumberId);

  const initialOffsets: Record<string, number> = {};
  if (order.stepOffsets) {
    order.stepOffsets.forEach((offset: any) => {
      initialOffsets[offset.stepId.toString()] = offset.quantityCompleted;
    });
  }

  const form = useForm<any>({
    defaultValues: {
      workOrderNumber: order.workOrderNumber || "",
      partNumberId: order.partNumberId?.toString() || "",
      quantity: order.quantity || 1,
      priority: order.priority || 1,
      status: order.status || "pending",
      dueDate: order.dueDate ? format(new Date(order.dueDate), "yyyy-MM-dd") : "",
      stepOffsets: initialOffsets,
    },
  });

  const onSubmit = (data: any) => {
    if (!data.partNumberId) {
      alert("Please select a part number");
      return;
    }

    const stepOffsets = Object.entries(data.stepOffsets || {})
      .filter(([_, qty]) => Number(qty) > 0)
      .map(([stepId, qty]) => ({
        stepId: Number(stepId),
        quantityCompleted: Number(qty)
      }));

    const payload: any = {
      workOrderNumber: data.workOrderNumber || null,
      partNumberId: Number(data.partNumberId),
      quantity: Number(data.quantity),
      priority: Number(data.priority),
      status: data.status,
      dueDate: data.dueDate ? new Date(data.dueDate).toISOString() : null,
      stepOffsets
    };

    update.mutate({ id: order.id, data: payload }, { 
      onSuccess: () => {
        onSuccess();
      },
      onError: (error: any) => {
        alert("Failed to update work order: " + (error.message || "Unknown error"));
      }
    });
  };

  const partNumberId = form.watch("partNumberId");
  const status = form.watch("status");

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col h-full">
      <div className="space-y-4 max-h-[60vh] overflow-y-auto px-1 flex-1">
        <div className="space-y-2">
          <Label>Work Order Number (optional)</Label>
          <Input 
            {...form.register("workOrderNumber")} 
            placeholder="e.g., WO-2024-001"
            data-testid="input-edit-work-order-number"
          />
        </div>

        <div className="space-y-2">
          <Label>Part Number</Label>
          <Select 
            value={partNumberId} 
            onValueChange={(val) => form.setValue("partNumberId", val)}
            disabled
          >
            <SelectTrigger data-testid="select-edit-part-number">
              <SelectValue placeholder="Select part..." />
            </SelectTrigger>
            <SelectContent>
              {parts?.map((p) => (
                <SelectItem key={p.id} value={p.id.toString()}>
                  {p.partNumber}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Total Quantity</Label>
            <Input 
              type="number" 
              {...form.register("quantity")} 
              min={1} 
              data-testid="input-edit-quantity"
            />
          </div>
          <div className="space-y-2">
            <Label>Priority</Label>
            <Input 
              type="number" 
              {...form.register("priority")} 
              min={1} 
              max={10} 
              placeholder="1-10"
              data-testid="input-edit-priority"
            />
          </div>
        </div>

        {selectedPart && selectedPart.steps && selectedPart.steps.length > 0 && (
          <div className="space-y-3 pt-2 border-t mt-4">
            <Label className="text-sm font-semibold">Units Already Completed Per Step</Label>
            <div className="grid grid-cols-1 gap-3">
              {selectedPart.steps.map((step: any) => (
                <div key={step.id} className="flex items-center justify-between gap-4 p-2 rounded-md bg-muted/50">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      Step {step.stepOrder}: {step.name || "Unnamed Step"}
                    </p>
                  </div>
                  <div className="w-24">
                    <Input
                      type="number"
                      size={1}
                      className="h-8 text-right"
                      {...form.register(`stepOffsets.${step.id}`)}
                      min={0}
                      max={form.watch("quantity")}
                      placeholder="Qty"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-2">
          <Label>Status</Label>
          <Select 
            value={status} 
            onValueChange={(val) => form.setValue("status", val)}
          >
            <SelectTrigger data-testid="select-edit-status">
              <SelectValue placeholder="Select status..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="scheduled">Scheduled</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2 pb-2">
          <Label>Due Date</Label>
          <Input 
            type="date" 
            {...form.register("dueDate")}
            data-testid="input-edit-due-date"
          />
        </div>
      </div>

      <DialogFooter className="pt-4 mt-auto flex flex-row gap-2">
        <Button 
          variant="outline"
          type="button"
          onClick={() => onSuccess()}
          disabled={update.isPending}
          className="flex-1"
        >
          Cancel
        </Button>
        <Button 
          type="submit" 
          disabled={update.isPending} 
          className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
          data-testid="button-update-work-order"
        >
          {update.isPending ? "Saving..." : "Save Changes"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export default function WorkOrders() {
  const [isOpen, setIsOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<any>(null);
  const { data: orders, isLoading } = useWorkOrders();
  const deleteOrder = useDeleteWorkOrder();

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed": return "bg-green-100 text-green-700 border-green-200";
      case "scheduled": return "bg-blue-100 text-blue-700 border-blue-200";
      case "pending": return "bg-yellow-100 text-yellow-700 border-yellow-200";
      default: return "bg-gray-100 text-gray-700";
    }
  };

  const getDisplayId = (order: any) => {
    if (order.workOrderNumber) {
      return order.workOrderNumber;
    }
    return `WO-${order.id.toString().padStart(4, '0')}`;
  };

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

      <Dialog open={!!editingOrder} onOpenChange={(open) => !open && setEditingOrder(null)}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Edit Work Order</DialogTitle>
            <DialogDescription>Update work order details.</DialogDescription>
          </DialogHeader>
          {editingOrder && (
            <EditOrderForm order={editingOrder} onSuccess={() => setEditingOrder(null)} />
          )}
        </DialogContent>
      </Dialog>

      <Card className="border-border/60 shadow-sm">
        <CardHeader>
          <CardTitle>Active Orders</CardTitle>
          <CardDescription>List of all pending and active jobs in the queue.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
             <div className="space-y-4">
               {[1,2,3].map(i => <div key={i} className="h-16 bg-muted rounded-lg animate-pulse" />)}
             </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order ID</TableHead>
                  <TableHead>Part Number</TableHead>
                  <TableHead>Quantity</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Due Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders?.map((order) => (
                  <TableRow key={order.id} className="group">
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {getDisplayId(order)}
                    </TableCell>
                    <TableCell className="font-medium">{order.partNumber?.partNumber || "Unknown"}</TableCell>
                    <TableCell>{order.quantity} units</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={order.priority && order.priority > 5 ? "border-orange-200 text-orange-600 bg-orange-50" : ""}>
                        P{order.priority}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {order.dueDate ? (
                        <div className="flex items-center gap-2 text-sm">
                          <Calendar className="w-3 h-3 text-muted-foreground" />
                          {format(new Date(order.dueDate), "MMM dd, yyyy")}
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-xs italic">No date</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`${getStatusColor(order.status)} border capitalize`}>
                        {order.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-muted-foreground hover:text-primary transition-colors"
                          onClick={() => setEditingOrder(order)}
                          data-testid={`button-edit-order-${order.id}`}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-muted-foreground hover:text-red-500 transition-colors"
                          onClick={() => {
                            if (confirm("Delete this work order?")) deleteOrder.mutate(order.id);
                          }}
                          data-testid={`button-delete-order-${order.id}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {orders?.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
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

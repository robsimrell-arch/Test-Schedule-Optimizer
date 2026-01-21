import { useState } from "react";
import { Layout } from "@/components/Layout";
import { useWorkOrders, useCreateWorkOrder, useDeleteWorkOrder, useParts } from "@/hooks/use-manufacturing";
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
import { zodResolver } from "@hookform/resolvers/zod";
import { insertWorkOrderSchema } from "@shared/routes";
import { z } from "zod";
import { Plus, Trash2, Calendar, AlertCircle } from "lucide-react";
import { format } from "date-fns";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

function CreateOrderForm({ onSuccess }: { onSuccess: () => void }) {
  const create = useCreateWorkOrder();
  const { data: parts } = useParts();

  const form = useForm<any>({
    defaultValues: {
      partNumberId: "",
      quantity: 1,
      priority: 1,
      dueDate: "",
    },
  });

  const onSubmit = (data: any) => {
    if (!data.partNumberId) {
      alert("Please select a part number");
      return;
    }

    const payload: any = {
      partNumberId: Number(data.partNumberId),
      quantity: Number(data.quantity),
      priority: Number(data.priority),
      dueDate: data.dueDate ? new Date(data.dueDate).toISOString() : null,
      status: "pending"
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

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-2">
        <Label>Part Number</Label>
        <Select 
          value={partNumberId} 
          onValueChange={(val) => form.setValue("partNumberId", val)}
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
          <Label>Quantity</Label>
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

      <div className="space-y-2">
        <Label>Due Date</Label>
        <Input 
          type="date" 
          {...form.register("dueDate")}
          data-testid="input-due-date"
        />
      </div>

      <DialogFooter className="pt-4">
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

export default function WorkOrders() {
  const [isOpen, setIsOpen] = useState(false);
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
          <DialogContent>
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
                    <TableCell className="font-mono text-xs text-muted-foreground">WO-{order.id.toString().padStart(4, '0')}</TableCell>
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
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-red-500 transition-colors"
                        onClick={() => {
                          if (confirm("Delete this work order?")) deleteOrder.mutate(order.id);
                        }}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
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

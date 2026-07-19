import React, { useState } from "react";
import { Layout } from "@/components/Layout";
import { ActiveConfigBadge } from "@/components/ActiveConfigBadge";
import { useWorkOrders, useCreateWorkOrder, useUpdateWorkOrder, useDeleteWorkOrder, useParts, useConfigurations, useSaveConfiguration, useRenameConfiguration, useDeleteConfiguration, useLoadConfiguration } from "@/hooks/use-manufacturing";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Calendar, AlertCircle, ChevronDown, ChevronRight, BookOpen, Save, FolderOpen, Pencil, Check, X } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

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
      data: { ...order, dueDate: order.dueDate ? new Date(order.dueDate).toISOString() : null, stepOffsets },
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

// Draft order shape (before it's saved to DB)
type DraftOrder = {
  workOrderNumber: string;
  quantity: number;
  priority: number;
  status: string;
  dueDate: Date | null;
};

export default function WorkOrders() {
  const [draft, setDraft] = useState<DraftOrder | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [cyclingId, setCyclingId] = useState<number | null>(null);
  const [cyclingPriorityId, setCyclingPriorityId] = useState<number | null>(null);
  const [configPanelOpen, setConfigPanelOpen] = useState(false);
  const [newConfigName, setNewConfigName] = useState("");
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  // Load-configuration confirm dialog state
  const [loadConfirmOpen, setLoadConfirmOpen] = useState(false);
  const [pendingLoadId, setPendingLoadId] = useState<number | null>(null);
  const [pendingSaveName, setPendingSaveName] = useState("");

  const { data: orders, isLoading } = useWorkOrders();
  const { data: parts } = useParts();
  const { data: configurations = [] } = useConfigurations();
  const deleteOrder = useDeleteWorkOrder();
  const updateOrder = useUpdateWorkOrder();
  const createOrder = useCreateWorkOrder();
  const saveConfiguration = useSaveConfiguration();
  const renameConfiguration = useRenameConfiguration();
  const deleteConfiguration = useDeleteConfiguration();
  const loadConfiguration = useLoadConfiguration();

  // Generate a WO number like WO-2026-0042
  const nextWONumber = () => {
    const year = new Date().getFullYear();
    const seq = String(Math.floor(Math.random() * 9000) + 1000);
    return `WO-${year}-${seq}`;
  };

  const createDraft = () => {
    if (draft) return; // only one draft at a time
    setDraft({ workOrderNumber: nextWONumber(), quantity: 1, priority: 1, status: "pending", dueDate: null });
  };

  const commitDraft = (partNumberId: number) => {
    if (!draft) return;
    createOrder.mutate(
      { workOrderNumber: draft.workOrderNumber || null, partNumberId, quantity: draft.quantity, priority: draft.priority, status: "pending", dueDate: draft.dueDate },
      { onSuccess: () => setDraft(null), onError: (e: any) => alert("Failed: " + e.message) }
    );
  };

  const STATUS_CYCLE: Record<string, string> = { pending: "scheduled", scheduled: "completed", completed: "pending" };

  const saveField = (order: any, patch: Record<string, any>) => {
    updateOrder.mutate({ id: order.id, data: { ...order, dueDate: order.dueDate ? new Date(order.dueDate).toISOString() : null, ...patch } });
  };

  const cycleStatus = (order: any) => {
    if (cyclingId === order.id) return;
    setCyclingId(order.id);
    updateOrder.mutate(
      { id: order.id, data: { ...order, status: STATUS_CYCLE[order.status] ?? "pending", dueDate: order.dueDate ? new Date(order.dueDate).toISOString() : null } },
      { onSettled: () => setCyclingId(null) }
    );
  };

  const cyclePriority = (order: any) => {
    if (cyclingPriorityId === order.id) return;
    const next = (order.priority ?? 1) >= 5 ? 1 : (order.priority ?? 1) + 1;
    setCyclingPriorityId(order.id);
    updateOrder.mutate(
      { id: order.id, data: { ...order, priority: next, dueDate: order.dueDate ? new Date(order.dueDate).toISOString() : null } },
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

  const handleSaveConfiguration = () => {
    if (!newConfigName.trim()) return;
    const shiftMode = Number(localStorage.getItem("ts-optimizer-shiftMode") || "1");
    const workDays = Number(localStorage.getItem("ts-optimizer-workDays") || "5");
    const snapshot = JSON.stringify(
      (orders || []).map((o: any) => ({
        workOrderNumber: o.workOrderNumber ?? null,
        partNumberId: o.partNumberId,
        quantity: o.quantity,
        priority: o.priority,
        status: o.status,
        dueDate: o.dueDate ? new Date(o.dueDate).toISOString() : null,
        stepOffsets: (o.stepOffsets || []).map((s: any) => ({ stepId: s.stepId, quantityCompleted: s.quantityCompleted })),
      }))
    );
    saveConfiguration.mutate({ name: newConfigName.trim(), shiftMode, workDays, snapshot }, {
      onSuccess: () => setNewConfigName(""),
    });
  };

  const handleLoadConfiguration = (id: number) => {
    if ((orders || []).length > 0) {
      // Open the custom Yes/No dialog
      setPendingLoadId(id);
      setPendingSaveName("");
      setLoadConfirmOpen(true);
    } else {
      loadConfiguration.mutate(id);
    }
  };

  const confirmLoad = (saveFirst: boolean) => {
    setLoadConfirmOpen(false);
    if (!pendingLoadId) return;
    const id = pendingLoadId;
    setPendingLoadId(null);

    if (saveFirst && pendingSaveName.trim()) {
      const shiftMode = Number(localStorage.getItem("ts-optimizer-shiftMode") || "1");
      const workDays = Number(localStorage.getItem("ts-optimizer-workDays") || "5");
      const snapshot = JSON.stringify(
        (orders || []).map((o: any) => ({
          workOrderNumber: o.workOrderNumber ?? null,
          partNumberId: o.partNumberId,
          quantity: o.quantity,
          priority: o.priority,
          status: o.status,
          dueDate: o.dueDate ? new Date(o.dueDate).toISOString() : null,
          stepOffsets: (o.stepOffsets || []).map((s: any) => ({ stepId: s.stepId, quantityCompleted: s.quantityCompleted })),
        }))
      );
      saveConfiguration.mutate({ name: pendingSaveName.trim(), shiftMode, workDays, snapshot }, {
        onSuccess: () => loadConfiguration.mutate(id),
      });
    } else {
      loadConfiguration.mutate(id);
    }
  };

  const COL_SPAN = 8;

  return (
    <Layout>
      <div className="flex justify-between items-center mb-8">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight">Work Orders</h1>
            <ActiveConfigBadge />
          </div>
          <p className="text-muted-foreground mt-2">Create and manage production batches.</p>
        </div>
        <Button size="lg" className="shadow-lg shadow-primary/20" onClick={createDraft} disabled={!!draft}>
          <Plus className="w-5 h-5 mr-2" /> New Order
        </Button>
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
              <TableHeader className="sticky top-0 z-30 bg-card shadow-md">
                <TableRow className="border-b-2">
                  <TableHead className="w-8 sticky top-0 bg-inherit"></TableHead>
                  <TableHead className="px-2 text-[10px] uppercase font-bold text-muted-foreground/70 sticky top-0 bg-inherit whitespace-nowrap">Order ID / WO#</TableHead>
                  <TableHead className="min-w-[280px] px-2 text-[10px] uppercase font-bold text-muted-foreground/70 sticky top-0 bg-inherit">Part Number</TableHead>
                  <TableHead className="px-2 text-[10px] uppercase font-bold text-muted-foreground/70 text-right sticky top-0 bg-inherit">Qty</TableHead>
                  <TableHead className="px-2 text-[10px] uppercase font-bold text-muted-foreground/70 text-center sticky top-0 bg-inherit">Pri</TableHead>
                  <TableHead className="px-2 text-[10px] uppercase font-bold text-muted-foreground/70 sticky top-0 bg-inherit">Due Date</TableHead>
                  <TableHead className="px-2 text-[10px] uppercase font-bold text-muted-foreground/70 sticky top-0 bg-inherit">Status</TableHead>
                  <TableHead className="text-right px-2 text-[10px] uppercase font-bold text-muted-foreground/70 sticky top-0 bg-inherit">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* ── Draft row (unsaved) ───────────────────────── */}
                {draft && (
                  <TableRow className="bg-primary/5 border-l-2 border-primary animate-in fade-in">
                    {/* no expand toggle for draft */}
                    <TableCell className="p-1 w-8" />

                    {/* WO Number */}
                    <TableCell className="font-mono text-[10px] px-2">
                      <input
                        type="text"
                        value={draft.workOrderNumber}
                        onChange={e => setDraft(d => d ? { ...d, workOrderNumber: e.target.value } : d)}
                        className="bg-transparent border-0 border-b border-input focus:border-primary focus:outline-none w-[90px] text-[10px]"
                        placeholder="WO-YYYY-NNNN"
                      />
                    </TableCell>

                    {/* Part # — selecting triggers save */}
                    <TableCell className="px-2">
                      <Select onValueChange={val => commitDraft(Number(val))}>
                        <SelectTrigger className="h-7 text-xs border-dashed border-muted-foreground/40 bg-transparent min-w-[280px] text-muted-foreground">
                          <SelectValue placeholder="Part #" />
                        </SelectTrigger>
                        <SelectContent>
                          {parts?.map(p => (
                            <SelectItem key={p.id} value={p.id.toString()}>{p.partNumber}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>

                    {/* Quantity */}
                    <TableCell className="px-2 text-right">
                      <input
                        type="number" min={1}
                        value={draft.quantity}
                        onChange={e => setDraft(d => d ? { ...d, quantity: Number(e.target.value) || 1 } : d)}
                        className="bg-transparent border-0 border-b border-input focus:border-primary focus:outline-none w-10 text-xs text-right"
                      />
                    </TableCell>

                    {/* Priority badge (static for draft) */}
                    <TableCell className="px-2 text-center">
                      <Badge variant="outline" className="border-red-300 text-red-700 bg-red-50 text-[10px] font-bold px-1 h-5">P1</Badge>
                    </TableCell>

                    {/* Due Date */}
                    <TableCell className="px-2">
                      <input
                        type="date"
                        onChange={e => setDraft(d => d ? { ...d, dueDate: e.target.value ? new Date(e.target.value) : null } : d)}
                        className="text-xs bg-transparent border-0 border-b border-transparent hover:border-input focus:border-primary focus:outline-none w-[100px] cursor-pointer"
                      />
                    </TableCell>

                    {/* Status */}
                    <TableCell className="px-2">
                      <Badge variant="outline" className="bg-yellow-100 text-yellow-700 border-yellow-200 border capitalize text-[10px] px-1 h-5">pending</Badge>
                    </TableCell>

                    {/* Discard */}
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-red-500" onClick={() => setDraft(null)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                )}

                {/* ── Saved orders ─────────────────────────────── */}
                {[...(orders || [])]
                  .sort((a, b) => getDisplayId(a).localeCompare(getDisplayId(b)))
                  .map((order) => {
                  const expanded = expandedId === order.id;
                  return (
                    <React.Fragment key={order.id}>
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
                        <TableCell className="font-mono text-[10px] px-2">
                          <input
                            type="text"
                            defaultValue={order.workOrderNumber ?? ""}
                            placeholder={`WO-${order.id.toString().padStart(4, "0")}`}
                            onBlur={e => saveField(order, { workOrderNumber: e.target.value.trim() || null })}
                            onKeyDown={e => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                            className="bg-transparent border-0 border-b border-transparent hover:border-input focus:border-primary focus:outline-none w-[90px] text-[10px]"
                            data-testid={`input-wo-${order.id}`}
                          />
                        </TableCell>

                        {/* Part Number — inline select */}
                        <TableCell className="px-2">
                          <Select
                            value={order.partNumberId?.toString()}
                            onValueChange={val => saveField(order, { partNumberId: Number(val) })}
                          >
                            <SelectTrigger className="h-7 text-xs border-transparent hover:border-input bg-transparent min-w-[280px]" data-testid={`select-part-${order.id}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {parts?.map(p => <SelectItem key={p.id} value={p.id.toString()}>{p.partNumber}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </TableCell>

                        {/* Quantity — inline number */}
                        <TableCell className="px-2 text-right">
                          <input
                            type="number"
                            min={1}
                            defaultValue={order.quantity}
                            onBlur={e => saveField(order, { quantity: Number(e.target.value) || 1 })}
                            onKeyDown={e => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                            className="bg-transparent border-0 border-b border-transparent hover:border-input focus:border-primary focus:outline-none w-10 text-xs text-right"
                            data-testid={`input-qty-${order.id}`}
                          />
                        </TableCell>

                        {/* Priority — click to cycle P1–P5 */}
                        <TableCell className="px-2 text-center">
                          <Badge
                            variant="outline"
                            className={`${getPriorityColor(order.priority ?? 1)} border cursor-pointer select-none hover:opacity-80 active:scale-95 transition-all text-[10px] px-1 h-5`}
                            onClick={() => cyclePriority(order)}
                            title="Click to change priority"
                            data-testid={`badge-priority-${order.id}`}
                          >
                            {cyclingPriorityId === order.id ? "…" : `P${order.priority}`}
                          </Badge>
                        </TableCell>

                        {/* Due Date — inline date picker */}
                        <TableCell className="px-2">
                          <input
                            type="date"
                            defaultValue={order.dueDate ? new Date(order.dueDate).toISOString().split('T')[0] : ""}
                            onBlur={e => saveField(order, { dueDate: e.target.value ? new Date(e.target.value).toISOString() : null })}
                            className="text-xs bg-transparent border-0 border-b border-transparent hover:border-input focus:border-primary focus:outline-none w-[100px] cursor-pointer"
                            data-testid={`date-due-${order.id}`}
                          />
                        </TableCell>

                        {/* Status — click to cycle */}
                        <TableCell className="px-2">
                          <Badge
                            variant="outline"
                            className={`${getStatusColor(order.status)} border capitalize cursor-pointer select-none hover:opacity-80 active:scale-95 transition-all text-[10px] px-1 h-5`}
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
                    </React.Fragment>
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

      {/* ── Configurations Panel ──────────────────────────────────────────── */}
      <Collapsible open={configPanelOpen} onOpenChange={setConfigPanelOpen}>
        <Card className="border-border/60 shadow-sm">
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer select-none hover:bg-muted/30 transition-colors rounded-t-lg">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <BookOpen className="w-5 h-5 text-primary" />
                  <div>
                    <CardTitle className="text-base">Saved Configurations</CardTitle>
                    <CardDescription className="text-xs mt-0.5">Save and recall named work order scenarios</CardDescription>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {configurations.length > 0 && (
                    <Badge variant="outline" className="text-xs">{configurations.length} saved</Badge>
                  )}
                  <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${configPanelOpen ? "rotate-180" : ""}`} />
                </div>
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0 space-y-5">

              {/* Save current */}
              <div className="flex items-center gap-3 pt-1">
                <Input
                  placeholder="Configuration name…"
                  value={newConfigName}
                  onChange={e => setNewConfigName(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleSaveConfiguration()}
                  className="h-8 text-sm max-w-xs"
                />
                <Button
                  size="sm"
                  onClick={handleSaveConfiguration}
                  disabled={!newConfigName.trim() || saveConfiguration.isPending}
                  className="flex items-center gap-2"
                >
                  <Save className="w-4 h-4" />
                  Save Current
                </Button>
              </div>

              {/* Saved list */}
              {configurations.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">No saved configurations yet.</p>
              ) : (
                <div className="space-y-2">
                  {configurations.map((cfg: any) => (
                    <div key={cfg.id} className="flex items-center gap-3 p-3 rounded-lg border bg-muted/20 hover:bg-muted/40 transition-colors">
                      {renamingId === cfg.id ? (
                        // Rename mode
                        <>
                          <Input
                            autoFocus
                            value={renameValue}
                            onChange={e => setRenameValue(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === "Enter") {
                                renameConfiguration.mutate({ id: cfg.id, name: renameValue }, { onSuccess: () => setRenamingId(null) });
                              }
                              if (e.key === "Escape") setRenamingId(null);
                            }}
                            className="h-7 text-sm flex-1"
                          />
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-green-600" onClick={() =>
                            renameConfiguration.mutate({ id: cfg.id, name: renameValue }, { onSuccess: () => setRenamingId(null) })
                          }>
                            <Check className="w-4 h-4" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground" onClick={() => setRenamingId(null)}>
                            <X className="w-4 h-4" />
                          </Button>
                        </>
                      ) : (
                        // Display mode
                        <>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold truncate">{cfg.name}</p>
                            <p className="text-[11px] text-muted-foreground">
                              {cfg.shiftMode} shift{cfg.shiftMode > 1 ? "s" : ""} · {cfg.workDays} day{cfg.workDays > 1 ? "s" : ""}/wk
                              {" · "}{new Date(cfg.createdAt).toLocaleDateString()}
                            </p>
                          </div>
                          <Button size="sm" variant="outline" className="h-7 text-xs flex items-center gap-1"
                            onClick={() => handleLoadConfiguration(cfg.id)}
                            disabled={loadConfiguration.isPending}
                          >
                            <FolderOpen className="w-3.5 h-3.5" />
                            Load
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-primary"
                            onClick={() => { setRenamingId(cfg.id); setRenameValue(cfg.name); }}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-red-500"
                            onClick={() => { if (confirm(`Delete "${cfg.name}"?`)) deleteConfiguration.mutate(cfg.id); }}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* ── Load Configuration Confirm Dialog ─────────────────────────────── */}
      <AlertDialog open={loadConfirmOpen} onOpenChange={setLoadConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Load Configuration</AlertDialogTitle>
            <AlertDialogDescription>
              Do you want to save your current work orders before loading the saved configuration?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="px-1 pb-2">
            <Input
              placeholder="Name for current configuration (optional)"
              value={pendingSaveName}
              onChange={e => setPendingSaveName(e.target.value)}
              className="h-8 text-sm"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => confirmLoad(false)}>No</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmLoad(true)} disabled={!pendingSaveName.trim()}>
              Yes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
}

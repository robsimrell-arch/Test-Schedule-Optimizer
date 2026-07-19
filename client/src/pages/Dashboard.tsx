import { useState, useEffect } from "react";
import { Layout } from "@/components/Layout";
import { ActiveConfigBadge } from "@/components/ActiveConfigBadge";
import { useSchedule } from "@/hooks/use-manufacturing";
import { Gantt, Task, ViewMode } from "gantt-task-react";
import "gantt-task-react/dist/index.css";
import ExcelJS from "exceljs";

const tzOffsetMs = new Date().getTimezoneOffset() * 60 * 1000;
const toFactoryLocal = (iso: string) => new Date(new Date(iso).getTime() + tzOffsetMs);

function fmtFactoryTime(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  let h = d.getHours();
  const min = String(d.getMinutes()).padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${mm}-${dd}-${yy} ${h}:${min} ${ampm}`;
}

const ganttStyles = `
  .barWrapper text,
  .bar text,
  g[class*="bar"] text {
    display: block !important;
    fill: black !important;
    font-size: 11px !important;
    font-weight: 500 !important;
    pointer-events: none;
  }
  .barWrapper text.gantt-chamber-run-text,
  .bar text.gantt-chamber-run-text,
  g[class*="bar"] text.gantt-chamber-run-text {
    font-weight: 800 !important;
  }
`;
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { AlertCircle, AlertTriangle, BarChart3, CalendarDays, Clock, Calendar, Plus, Trash2, HelpCircle, CheckCircle2, Ship, TrendingUp, Gauge, Save, Download } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useParts, useAllPartDependencies, useSavePartSupplyRule, useWorkOrders } from "@/hooks/use-manufacturing";

function ProgressiveLoader() {
  const [progress, setProgress] = useState(0);
  const [stepIndex, setStepIndex] = useState(0);

  const steps = [
    { threshold: 15, text: "Initializing factory simulation parameters..." },
    { threshold: 35, text: "Querying order backlog & equipment inventory..." },
    { threshold: 55, text: "Simulating unconstrained baseline schedule..." },
    { threshold: 75, text: "Solving optimal bottleneck supply rates..." },
    { threshold: 90, text: "Resolving part shortages and dependencies..." },
    { threshold: 97, text: "Generating final production timeline..." },
    { threshold: 100, text: "Rendering Gantt chart..." }
  ];

  useEffect(() => {
    const start = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - start;
      const val = Math.min(98, Math.round(98 * (1 - Math.exp(-elapsed / 4500))));
      setProgress(val);
      
      const activeStepIdx = steps.findIndex(s => val < s.threshold);
      if (activeStepIdx !== -1) {
        setStepIndex(activeStepIdx);
      } else {
        setStepIndex(steps.length - 1);
      }
    }, 150);
    
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] max-w-md mx-auto space-y-8 p-6">
      <div className="text-center space-y-2">
        <h3 className="text-lg font-semibold tracking-tight text-foreground">Calculating Production Schedule</h3>
        <p className="text-sm text-muted-foreground transition-all duration-300 min-h-[20px]">
          {steps[stepIndex]?.text || "Processing..."}
        </p>
      </div>
      
      <div className="w-full space-y-2">
        <Progress value={progress} className="h-2 bg-secondary" />
        <div className="flex justify-between text-xs text-muted-foreground font-mono">
          <span>{progress}%</span>
          <span>ETA: ~10s</span>
        </div>
      </div>
      
      <div className="grid grid-cols-1 w-full gap-3 text-sm">
        {steps.slice(0, 6).map((step, idx) => {
          const isCompleted = progress >= step.threshold;
          const isActive = idx === stepIndex;
          
          return (
            <div
              key={idx}
              className={cn(
                "flex items-center gap-3 p-3 rounded-lg border transition-all duration-300",
                isActive 
                  ? "bg-primary/5 border-primary text-primary font-medium shadow-sm animate-pulse" 
                  : isCompleted 
                    ? "bg-muted/30 border-muted text-muted-foreground" 
                    : "bg-background border-muted/50 text-muted-foreground/60"
              )}
            >
              <div className="flex items-center justify-center w-5 h-5 rounded-full border text-xs">
                {isCompleted ? (
                  <span className="text-green-500 font-bold">✓</span>
                ) : isActive ? (
                  <span className="animate-spin h-2.5 w-2.5 border-2 border-primary border-t-transparent rounded-full" />
                ) : (
                  <span>{idx + 1}</span>
                )}
              </div>
              <span>{step.text}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [shiftMode, setShiftMode] = useState<1 | 2 | 3>(() => {
    const saved = localStorage.getItem("ts-optimizer-shiftMode");
    return saved ? (Number(saved) as 1 | 2 | 3) : 1;
  });
  const [workDays, setWorkDays] = useState<5 | 6 | 7>(() => {
    const saved = localStorage.getItem("ts-optimizer-workDays");
    return saved ? (Number(saved) as 5 | 6 | 7) : 5;
  });
  const { data: schedule, isLoading, isFetching, isError } = useSchedule(shiftMode, workDays);
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem("ts-optimizer-viewMode");
    return saved && Object.values(ViewMode).includes(saved as ViewMode) 
      ? (saved as ViewMode) 
      : ViewMode.Week;
  });

  const [selectedSubassemblyId, setSelectedSubassemblyId] = useState<number | null>(null);
  const [expectedRateInput, setExpectedRateInput] = useState<string>("");
  const [fixedSupplies, setFixedSupplies] = useState<{ date: string; quantity: number }[]>([]);
  const [newDeliveryDate, setNewDeliveryDate] = useState<string>("");
  const [newDeliveryQty, setNewDeliveryQty] = useState<string>("");

  const { data: parts = [] } = useParts();
  const { data: dependencies = [] } = useAllPartDependencies();
  const { data: workOrders = [] } = useWorkOrders();
  const saveSupplyRule = useSavePartSupplyRule();

  useEffect(() => {
    const applyChamberBoldStyle = () => {
      const textElements = document.querySelectorAll('text');
      textElements.forEach(el => {
        if (el.textContent && /\[C\d+\]/.test(el.textContent)) {
          el.classList.add('gantt-chamber-run-text');
        }
      });
    };

    applyChamberBoldStyle();

    const observer = new MutationObserver(() => {
      applyChamberBoldStyle();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    return () => {
      observer.disconnect();
    };
  }, [schedule, viewMode]);

  const handleSelectSubassembly = (partId: number) => {
    setSelectedSubassemblyId(partId);
    const rule = (schedule?.partSupplyRules || []).find((r: any) => r.partNumberId === partId);
    setExpectedRateInput(rule?.expectedSupplyRate ? String(rule.expectedSupplyRate) : "");
    if (rule?.fixedSupplies) {
      try {
        setFixedSupplies(JSON.parse(rule.fixedSupplies));
      } catch (e) {
        setFixedSupplies([]);
      }
    } else {
      setFixedSupplies([]);
    }
    setNewDeliveryDate("");
    setNewDeliveryQty("");
  };

  const handleAddDelivery = () => {
    if (!newDeliveryDate || !newDeliveryQty) return;
    setFixedSupplies(prev => [
      ...prev,
      { date: newDeliveryDate, quantity: Number(newDeliveryQty) }
    ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()));
    setNewDeliveryDate("");
    setNewDeliveryQty("");
  };

  const handleRemoveDelivery = (index: number) => {
    setFixedSupplies(prev => prev.filter((_, idx) => idx !== index));
  };

  const handleSaveRule = () => {
    if (selectedSubassemblyId === null) return;
    
    let suppliesToSave = [...fixedSupplies];
    if (newDeliveryDate && newDeliveryQty) {
      suppliesToSave.push({
        date: newDeliveryDate,
        quantity: Number(newDeliveryQty)
      });
      suppliesToSave.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      setFixedSupplies(suppliesToSave);
      setNewDeliveryDate("");
      setNewDeliveryQty("");
    }

    saveSupplyRule.mutate({
      partNumberId: selectedSubassemblyId,
      expectedSupplyRate: expectedRateInput ? Number(expectedRateInput) : null,
      fixedSupplies: suppliesToSave.length > 0 ? JSON.stringify(suppliesToSave) : null
    });
  };

  const handleShiftChange = (v: string) => {
    const mode = Number(v) as 1 | 2 | 3;
    setShiftMode(mode);
    localStorage.setItem("ts-optimizer-shiftMode", String(mode));
  };

  const handleWorkDaysChange = (v: string) => {
    const days = Number(v) as 5 | 6 | 7;
    setWorkDays(days);
    localStorage.setItem("ts-optimizer-workDays", String(days));
  };

  const handleViewModeChange = (v: string) => {
    const mode = v as ViewMode;
    setViewMode(mode);
    localStorage.setItem("ts-optimizer-viewMode", mode);
  };

  const handleExportToExcel = async () => {
    if (!schedule || !schedule.tasks) return;
    
    try {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("Production Schedule");
      
      // Define columns
      worksheet.columns = [
        { header: "Work Order ID", key: "workOrderId", width: 15 },
        { header: "Part Number", key: "partNumber", width: 25 },
        { header: "Step", key: "step", width: 25 },
        { header: "Equipment", key: "equipment", width: 35 },
        { header: "Start Time", key: "startTime", width: 22 },
        { header: "End Time", key: "endTime", width: 22 },
        { header: "Units", key: "units", width: 10 },
        { header: "Shortage/Delay?", key: "isShortage", width: 18 },
        { header: "Constraining Subassembly", key: "constrainingPart", width: 25 }
      ];
      
      // Style header row
      const headerRow = worksheet.getRow(1);
      headerRow.font = { name: "Segoe UI", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
      headerRow.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF1E3A8A" } // Dark blue
      };
      headerRow.alignment = { vertical: "middle", horizontal: "center" };
      headerRow.height = 25;
      
      headerRow.eachCell((cell) => {
        cell.border = {
          top: { style: "thin", color: { argb: "FF475569" } },
          left: { style: "thin", color: { argb: "FF475569" } },
          bottom: { style: "medium", color: { argb: "FF1E293B" } },
          right: { style: "thin", color: { argb: "FF475569" } }
        };
      });
      
      schedule.tasks.forEach((t: any, idx: number) => {
        const isShortage = t.type === "shortage_placeholder";
        const isAffected = t.isShortageAffected === true;
        const shortageText = isShortage ? "Placeholder" : isAffected ? "Delayed" : "No";
        
        const rowData = {
          workOrderId: t.workOrderId,
          partNumber: t.partNumber,
          step: t.stepName ? `${t.stepName} (Step ${t.stepOrder})` : `Step ${t.stepOrder}`,
          equipment: t.equipmentNames || "None",
          startTime: fmtFactoryTime(toFactoryLocal(t.startTime)),
          endTime: fmtFactoryTime(toFactoryLocal(t.endTime)),
          units: t.unitsCount || 0,
          isShortage: shortageText,
          constrainingPart: t.constrainingSubassemblyName || ""
        };
        
        const row = worksheet.addRow(rowData);
        
        row.font = { name: "Segoe UI", size: 10 };
        row.alignment = { vertical: "middle" };
        row.height = 20;
        
        row.eachCell((cell) => {
          cell.border = {
            top: { style: "thin", color: { argb: "FFE2E8F0" } },
            left: { style: "thin", color: { argb: "FFE2E8F0" } },
            bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
            right: { style: "thin", color: { argb: "FFE2E8F0" } }
          };
        });
        
        if (isShortage || isAffected) {
          row.eachCell((cell) => {
            cell.fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: "FFFFE4E6" } // Light red
            };
            cell.font = { name: "Segoe UI", size: 10, color: { argb: "FF9F1239" } };
          });
        } else if (idx % 2 === 1) {
          row.eachCell((cell) => {
            cell.fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: "FFF8FAFC" } // Zebra-striping
            };
          });
        }
      });
      
      // Auto-fit column widths
      worksheet.columns.forEach((column) => {
        let maxLen = 0;
        column.eachCell!({ includeEmpty: true }, (cell) => {
          const val = cell.value ? String(cell.value) : "";
          if (val.length > maxLen) {
            maxLen = val.length;
          }
        });
        column.width = Math.max(maxLen + 4, 12);
      });
      
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `production_schedule_${workDays}d_${shiftMode}s.xlsx`;
      anchor.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Failed to export schedule to Excel", error);
    }
  };

  if (isLoading || isFetching) {
    return (
      <Layout>
        <ProgressiveLoader key={isFetching ? "refetch" : "initial"} />
      </Layout>
    );
  }

  if (isError || !schedule) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center h-[80vh] text-center space-y-4">
          <div className="w-16 h-16 bg-red-50 text-red-500 rounded-full flex items-center justify-center">
            <AlertCircle className="w-8 h-8" />
          </div>
          <h2 className="text-xl font-bold">Failed to load schedule</h2>
          <p className="text-muted-foreground">There was an error calculating the production schedule.</p>
        </div>
      </Layout>
    );
  }

  const tzOffsetMs = new Date().getTimezoneOffset() * 60 * 1000;
  const toFactoryLocal = (iso: string) => new Date(new Date(iso).getTime() + tzOffsetMs);

  const ganttTasks: Task[] = schedule.tasks.map((t: any) => {
    const chamberMatch = t.equipmentNames?.match(/ESS Chamber (\d+)/);
    const chamberSuffix = chamberMatch ? ` [C${chamberMatch[1]}]` : '';
    const units = t.unitsCount || 0;
    const isShortage = t.type === "shortage_placeholder";
    const isAffected = t.isShortageAffected === true;
    
    let baseName = t.stepName 
      ? `${t.partNumber} - ${t.stepName}` 
      : `${t.partNumber} (Step ${t.stepOrder})`;
      
    if (isShortage || isAffected) {
      baseName = `⚠️ SHORTAGE: ${baseName}`;
    }
    
    const barName = units > 0
      ? `${baseName}${chamberSuffix} (${units})`
      : baseName + chamberSuffix;
    
    return {
      start: toFactoryLocal(t.startTime),
      end: toFactoryLocal(t.endTime),
      name: barName,
      id: t.id,
      type: "task",
      progress: t.progress,
      isDisabled: true,
      styles: (isShortage || isAffected)
        ? { progressColor: "#e11d48", backgroundColor: "#ffe4e6" }
        : { progressColor: "#3b82f6", backgroundColor: "#bfdbfe" },
    };
  });

  function CustomTooltip({ task, fontSize, fontFamily }: { task: Task; fontSize: string; fontFamily: string }) {
    const originalTask = schedule?.tasks.find((t: any) => t.id === task.id || `${t.id}-shortage` === task.id || `${t.id}-s${t.segmentIndex}` === task.id);
    const isAffected = originalTask?.isShortageAffected || originalTask?.type === "shortage_placeholder";
    return (
      <div style={{ fontSize, fontFamily, padding: "8px 12px", background: "white", border: "1px solid #e2e8f0", borderRadius: "6px", boxShadow: "0 2px 8px rgba(0,0,0,0.15)", color: "#1a1a1a", minWidth: "220px" }}>
        <div style={{ fontWeight: 600, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
          {isAffected && <AlertTriangle className="w-4.5 h-4.5 text-red-500 shrink-0" />}
          {task.name}
        </div>
        <div>Start: {fmtFactoryTime(task.start)}</div>
        <div>End: {fmtFactoryTime(task.end)}</div>
        {isAffected && (
          <div className="mt-2 text-xs font-semibold text-rose-600 bg-rose-50 dark:bg-rose-950/20 px-2 py-1 rounded border border-rose-200 dark:border-rose-800">
            <div>⚠️ Delayed due to subassembly supply constraints{originalTask?.constrainingSubassemblyName ? ` (${originalTask.constrainingSubassemblyName})` : ''}.</div>
            <div className="mt-1 text-rose-700 font-normal">Adjusted due to shortage: {originalTask?.unitsCount || 0} units</div>
          </div>
        )}
        {originalTask?.combinedOrders && originalTask.combinedOrders.length > 0 && (
          <div className="mt-2 pt-2 border-t border-slate-100 text-xs text-slate-500">
            <div style={{ fontWeight: 600, color: "#475569", marginBottom: 2 }}>Combined Work Orders:</div>
            <ul style={{ paddingLeft: "14px", margin: 0, listStyleType: "disc" }}>
              {originalTask.combinedOrders.map((co: any, idx: number) => (
                <li key={idx} style={{ marginBottom: 2 }}>
                  WO {co.workOrderNumber || `#${co.workOrderId}`}: {co.quantity} units
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  const subassemblyIds = new Set(dependencies.map(d => d.childPartId));
  const subassemblyParts = parts.filter(p => subassemblyIds.has(p.id));

  const subassemblyStats = subassemblyParts.map(part => {
    // Use server-computed demand totals (handles parent parts without test steps)
    const totalDemand = schedule?.subassemblyDemandTotals?.[part.id] || 0;

    const rule = (schedule?.partSupplyRules || []).find((r: any) => r.partNumberId === part.id);
    const expectedRate = rule?.expectedSupplyRate || 0;
    
    let fixedQty = 0;
    if (rule?.fixedSupplies) {
      try {
        const fixed = JSON.parse(rule.fixedSupplies);
        if (Array.isArray(fixed)) {
          fixedQty = fixed.reduce((sum, f) => sum + (Number(f.quantity) || 0), 0);
        }
      } catch(e) {}
    }
    
    const optimalRate = schedule?.optimalSupplyRates?.[part.id] || 0;
    const status = totalDemand === 0 
      ? "No Demand" 
      : (fixedQty >= totalDemand || (optimalRate > 0 && expectedRate >= optimalRate)) 
        ? "Optimized" 
        : "Bottleneck";

    return {
      part,
      totalDemand,
      expectedRate,
      optimalRate,
      fixedQty,
      status
    };
  });

  return (
    <Layout>
      <style>{ganttStyles}</style>
      <div className="space-y-8">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight">Production Schedule</h1>
            <ActiveConfigBadge />
          </div>
          <p className="text-muted-foreground mt-2">
            Optimized timeline based on equipment availability and order priority.
          </p>
        </div>

        <Tabs defaultValue="timeline" className="space-y-6">
          <TabsList className="grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="timeline">Schedule Timeline</TabsTrigger>
            <TabsTrigger value="supply-chain">Supply Chain &amp; Bottlenecks</TabsTrigger>
          </TabsList>
          
          <TabsContent value="timeline" className="space-y-6">
            {schedule.tasks.some((t: any) => t.isShortageAffected || t.type === "shortage_placeholder") && (
              <div className="bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-800 rounded-lg p-4 flex items-start gap-3 shadow-sm">
                <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-semibold text-rose-800 dark:text-rose-300">Subassembly Shortage Affecting Production</h3>
                  <p className="text-sm text-rose-700 dark:text-rose-400 mt-1">
                    Some tasks are delayed or scheduled as placeholders due to insufficient subassembly parts. Configure expected supply rates and deliveries in the <strong>Supply Chain &amp; Bottlenecks</strong> tab to resolve shortages.
                  </p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <Card className="bg-gradient-to-br from-blue-50 to-white dark:from-slate-900 dark:to-slate-950 border-blue-100 dark:border-slate-800">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <CalendarDays className="w-4 h-4 text-primary" />
                    Scheduled Tasks
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold text-foreground">{schedule.tasks.length}</div>
                  <p className="text-xs text-muted-foreground mt-1">Total operations queued</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Est. Completion</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold text-foreground">
                    {ganttTasks.length > 0
                      ? new Date(Math.max(...ganttTasks.map((t) => t.end.getTime()))).toLocaleDateString()
                      : "-"}
                  </div>
                  {ganttTasks.length > 0 && (() => {
                    const endMs = Math.max(...ganttTasks.map((t) => t.end.getTime()));
                    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
                    const endStart = new Date(endMs); endStart.setHours(0, 0, 0, 0);
                    const diffDays = Math.round((endStart.getTime() - todayStart.getTime()) / (1000 * 60 * 60 * 24));
                    return (
                      <p className="text-xs text-muted-foreground mt-1">
                        {diffDays <= 0 ? "Completing today" : `In ${diffDays} day${diffDays === 1 ? "" : "s"}`}
                      </p>
                    );
                  })()}
                </CardContent>
              </Card>

              <Card className="flex flex-col">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center justify-between">
                    <span>Work Order Estimates</span>
                    <Clock className="w-4 h-4 text-primary" />
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex-1">
                  <div className="space-y-1">
                    {workOrders.length === 0 ? (
                      <div className="text-xs text-muted-foreground italic text-center py-4">No work orders.</div>
                    ) : (
                      (() => {
                        const getWorkOrderEstCompletion = (woId: number) => {
                          if (!schedule?.tasks) return null;
                          const woTasks = schedule.tasks.filter((t: any) => 
                            t.workOrderId === woId || 
                            (t.combinedOrders && t.combinedOrders.some((co: any) => co.workOrderId === woId))
                          );
                          if (woTasks.length === 0) return null;
                          const maxTime = Math.max(...woTasks.map((t: any) => toFactoryLocal(t.endTime).getTime()));
                          return new Date(maxTime);
                        };

                        const sortedWorkOrders = [...workOrders].map((wo: any) => ({
                          ...wo,
                          estCompletion: getWorkOrderEstCompletion(wo.id)
                        })).sort((a: any, b: any) => {
                          if (a.estCompletion && b.estCompletion) {
                            return a.estCompletion.getTime() - b.estCompletion.getTime();
                          }
                          if (a.estCompletion) return -1;
                          if (b.estCompletion) return 1;
                          return 0;
                        });

                        return sortedWorkOrders.map((wo: any) => {
                          const estCompletion = wo.estCompletion;
                          const isLate = wo.dueDate && estCompletion && estCompletion.getTime() > toFactoryLocal(wo.dueDate).getTime();
                          
                          let daysText = "";
                          if (estCompletion) {
                            const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
                            const estStart = new Date(estCompletion); estStart.setHours(0, 0, 0, 0);
                            const diffDays = Math.round((estStart.getTime() - todayStart.getTime()) / (1000 * 60 * 60 * 24));
                            daysText = diffDays <= 0 ? "today" : `in ${diffDays}d`;
                          }

                          let statusBadge = <Badge variant="secondary" className="text-[9px] py-0 px-1 h-3.5 leading-none">Unscheduled</Badge>;
                          if (estCompletion) {
                            if (wo.dueDate) {
                              if (isLate) {
                                const diffMs = estCompletion.getTime() - toFactoryLocal(wo.dueDate).getTime();
                                const daysLate = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
                                statusBadge = <Badge variant="destructive" className="text-[9px] py-0 px-1 h-3.5 leading-none">{daysLate}d late</Badge>;
                              } else {
                                statusBadge = <Badge className="text-[9px] py-0 px-1 h-3.5 leading-none bg-emerald-100 hover:bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400">On Time</Badge>;
                              }
                            } else {
                              statusBadge = <Badge variant="default" className="text-[9px] py-0 px-1 h-3.5 leading-none bg-blue-100 hover:bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-400">Scheduled</Badge>;
                            }
                          }

                          return (
                            <div key={wo.id} className="flex items-center justify-between border-b border-border/40 py-1 last:border-0 text-[11px] gap-2">
                              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                <span className="font-semibold text-foreground shrink-0 text-[11px]">
                                  {wo.workOrderNumber ?? `WO-${String(wo.id).padStart(4, "0")}`}
                                </span>
                                <span className="text-[10px] text-muted-foreground truncate">
                                  ({wo.partNumber?.partNumber ?? "Unknown"})
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                {estCompletion && (
                                  <span className="text-[10px] font-medium text-foreground">
                                    {estCompletion.toLocaleDateString()}{" "}
                                    <span className="text-muted-foreground text-[9px] font-normal">({daysText})</span>
                                  </span>
                                )}
                                {statusBadge}
                              </div>
                            </div>
                          );
                        });
                      })()
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>

            {schedule.dueDateWarnings && schedule.dueDateWarnings.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-red-600 font-semibold text-sm">
                  <AlertTriangle className="w-4 h-4" />
                  {schedule.dueDateWarnings.length} order{schedule.dueDateWarnings.length > 1 ? "s" : ""} projected to miss due date
                </div>
                <div className="space-y-2">
                  {schedule.dueDateWarnings.map((w) => (
                    <div
                      key={w.workOrderId}
                      className="flex flex-wrap items-center gap-x-6 gap-y-1 px-4 py-3 rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-800 text-sm"
                    >
                      <span className="font-semibold text-red-700 dark:text-red-400">
                        {w.workOrderNumber ?? `WO-${String(w.workOrderId).padStart(4, "0")}`}
                      </span>
                      <span className="text-red-700 dark:text-red-400">{w.partNumber}</span>
                      <span className="text-muted-foreground">
                        Due: <span className="font-medium text-foreground">{toFactoryLocal(w.dueDate).toLocaleDateString()}</span>
                      </span>
                      <span className="text-muted-foreground">
                        Projected: <span className="font-medium text-foreground">{toFactoryLocal(w.projectedCompletion).toLocaleDateString()}</span>
                      </span>
                      <span className="ml-auto font-bold text-red-600 dark:text-red-400 whitespace-nowrap">
                        {w.daysLate} day{w.daysLate !== 1 ? "s" : ""} late
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {schedule.shortageWarnings && schedule.shortageWarnings.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-amber-600 dark:text-amber-500 font-semibold text-sm">
                  <AlertCircle className="w-4 h-4" />
                  {schedule.shortageWarnings.length} sub-assembly shortage{schedule.shortageWarnings.length > 1 ? "s" : ""} detected
                </div>
                <div className="grid grid-cols-1 gap-3">
                  {schedule.shortageWarnings.map((w) => (
                    <div
                      key={w.childPartId}
                      className="flex flex-col gap-2 p-4 rounded-lg border border-amber-200 bg-amber-50/50 dark:bg-amber-950/20 dark:border-amber-900/60 text-sm"
                    >
                      <div className="flex items-center gap-x-4 flex-wrap">
                        <span className="font-bold text-amber-800 dark:text-amber-400 text-base">
                          {w.childPartNumber}
                        </span>
                        <span className="text-amber-800 dark:text-amber-400">
                          Shortage: <span className="font-semibold">{w.shortage} units</span>
                        </span>
                        <span className="text-muted-foreground">
                          Demand: <span className="font-medium text-foreground">{w.totalDemand}</span>
                        </span>
                        <span className="text-muted-foreground">
                          Supply: <span className="font-medium text-foreground">{w.totalSupply}</span>
                        </span>
                      </div>
                      
                      {w.affectedOrders && w.affectedOrders.length > 0 && (
                        <div className="mt-1 pt-2 border-t border-amber-100 dark:border-amber-900/40 text-xs text-muted-foreground">
                          <span className="font-medium text-amber-900/80 dark:text-amber-400/80 mr-1">Affects Orders:</span>
                          {w.affectedOrders.map((o, idx) => (
                            <span key={o.workOrderId} className="inline-block bg-amber-100/60 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 px-2 py-0.5 rounded mr-1 mb-1">
                              {o.workOrderNumber ?? `WO-${String(o.workOrderId).padStart(4, "0")}`} ({o.parentPartNumber} - needs {o.quantityRequired})
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <Card className="shadow-lg border-border/60 overflow-hidden">
              <CardHeader className="border-b bg-muted/20 flex flex-row items-center justify-between gap-4 flex-wrap">
                <div>
                  <CardTitle>Timeline</CardTitle>
                  <CardDescription>Visual production roadmap</CardDescription>
                </div>
                <div className="flex items-center gap-6 flex-wrap">
                  <div className="flex items-center gap-3 bg-background/80 px-3 py-2 rounded-lg border">
                    <Calendar className="w-4 h-4 text-muted-foreground" />
                    <Label className="text-sm font-medium">Work Week</Label>
                    <Select 
                      value={String(workDays)} 
                      onValueChange={handleWorkDaysChange}
                    >
                      <SelectTrigger className="w-[100px] h-8" data-testid="select-work-days">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="5">5 Days</SelectItem>
                        <SelectItem value="6">6 Days</SelectItem>
                        <SelectItem value="7">7 Days</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-2 bg-background/80 px-3 py-2 rounded-lg border">
                    <Clock className="w-4 h-4 text-muted-foreground" />
                    <Label className="text-sm font-medium">Shifts</Label>
                    <Select
                      value={String(shiftMode)}
                      onValueChange={handleShiftChange}
                    >
                      <SelectTrigger className="w-[140px]" data-testid="select-shift-mode">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">1 Shift (8h)</SelectItem>
                        <SelectItem value="2">2 Shifts (16h)</SelectItem>
                        <SelectItem value="3">3 Shifts (24h)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Tabs value={viewMode} onValueChange={handleViewModeChange}>
                    <TabsList>
                      <TabsTrigger value={ViewMode.QuarterDay}>Hour</TabsTrigger>
                      <TabsTrigger value={ViewMode.HalfDay}>12h</TabsTrigger>
                      <TabsTrigger value={ViewMode.Day}>Day</TabsTrigger>
                      <TabsTrigger value={ViewMode.Week}>Week</TabsTrigger>
                    </TabsList>
                  </Tabs>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleExportToExcel}
                    className="flex items-center gap-2 h-9"
                  >
                    <Download className="w-4 h-4" />
                    Export to Excel
                  </Button>
                </div>
              </CardHeader>
              <div className="p-4 bg-background overflow-x-auto min-h-[500px]">
                {ganttTasks.length > 0 ? (
                  <Gantt
                    tasks={ganttTasks}
                    viewMode={viewMode}
                    viewDate={new Date()}
                    columnWidth={viewMode === ViewMode.Day ? 100 : 60}
                    listCellWidth=""
                    barBackgroundColor="#3b82f6"
                    barProgressColor="#1d4ed8"
                    barProgressSelectedColor="#1e3a8a"
                    fontFamily="var(--font-sans)"
                    fontSize="12px"
                    rowHeight={40}
                    TooltipContent={CustomTooltip}
                  />
                ) : (
                  <div className="h-full flex items-center justify-center text-muted-foreground italic">
                    No scheduled tasks. Create work orders to populate schedule.
                  </div>
                )}
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="supply-chain" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              <Card className="lg:col-span-2 shadow-sm border-border/60">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-xl font-bold">
                    <TrendingUp className="w-5 h-5 text-primary" />
                    Subassemblies (CCA Parts)
                  </CardTitle>
                  <CardDescription>
                    Monitor demands, expected rates, and calculated optimal rates to prevent starvation.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="rounded-md border overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Part Number</TableHead>
                          <TableHead className="text-right">Total Demand</TableHead>
                          <TableHead className="text-right">Expected Rate</TableHead>
                          <TableHead className="text-right">Optimal Rate</TableHead>
                          <TableHead className="text-right">Fixed Supplies</TableHead>
                          <TableHead className="text-center">Status</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {subassemblyStats.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={7} className="text-center py-6 text-muted-foreground italic">
                              No subassembly parts defined in BOM dependencies.
                            </TableCell>
                          </TableRow>
                        ) : (
                          subassemblyStats.map(({ part, totalDemand, expectedRate, optimalRate, fixedQty, status }) => (
                            <TableRow key={part.id} className={selectedSubassemblyId === part.id ? "bg-muted/40 font-medium" : ""}>
                              <TableCell className="font-semibold text-foreground">
                                {part.partNumber}
                                <div className="text-xs font-normal text-muted-foreground mt-0.5">{part.description || "No description"}</div>
                              </TableCell>
                              <TableCell className="text-right">{totalDemand} units</TableCell>
                              <TableCell className="text-right">{expectedRate ? `${expectedRate} / day` : "-"}</TableCell>
                              <TableCell className="text-right text-primary font-semibold">{optimalRate ? `${optimalRate} / day` : "0 / day"}</TableCell>
                              <TableCell className="text-right">{fixedQty ? `${fixedQty} units` : "-"}</TableCell>
                              <TableCell className="text-center">
                                <Badge 
                                  className={
                                    status === "Bottleneck" 
                                      ? "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-400 dark:border-rose-800" 
                                      : status === "Optimized"
                                        ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800"
                                        : "bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-900 dark:text-slate-400"
                                  } 
                                  variant="outline"
                                >
                                  {status}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right">
                                <Button 
                                  variant="ghost" 
                                  size="sm"
                                  onClick={() => handleSelectSubassembly(part.id)}
                                >
                                  Configure
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>

              <div className="space-y-6">
                {selectedSubassemblyId === null ? (
                  <Card className="border-dashed bg-muted/10 h-full flex flex-col items-center justify-center p-6 text-center text-muted-foreground min-h-[300px]">
                    <Gauge className="w-12 h-12 text-muted-foreground/40 mb-3 animate-pulse" />
                    <p className="font-semibold text-foreground/80">No Part Selected</p>
                    <p className="text-sm mt-1">Select a subassembly from the table to configure expected supply rates and deliveries.</p>
                  </Card>
                ) : (() => {
                  const part = parts.find(p => p.id === selectedSubassemblyId);
                  const stats = subassemblyStats.find(s => s.part.id === selectedSubassemblyId);
                  if (!part) return null;
                  
                  return (
                    <Card className="shadow-md border-border/80">
                      <CardHeader className="border-b bg-muted/10 pb-4">
                        <CardTitle className="text-lg font-bold flex items-center justify-between">
                          <span>Configure Supply: {part.partNumber}</span>
                        </CardTitle>
                        <CardDescription>
                          Set replenishment parameters for this subassembly.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-6 pt-6">
                        
                        {stats && (
                          <div className="bg-primary/5 border border-primary/10 rounded-lg p-3 space-y-1">
                            <div className="text-xs font-semibold text-primary uppercase tracking-wider">Optimal Supply Rate</div>
                            <div className="text-xl font-extrabold text-foreground">
                              {stats.optimalRate} units / day
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">
                              Minimum constant supply rate needed to prevent final assembly line starvation.
                            </p>
                          </div>
                        )}

                        <div className="space-y-2">
                          <Label htmlFor="expected-rate" className="text-sm font-semibold">
                            Expected Constant Supply Rate (units / day)
                          </Label>
                          <div className="flex gap-2">
                            <Input
                              id="expected-rate"
                              type="number"
                              placeholder="e.g. 50"
                              value={expectedRateInput}
                              onChange={(e) => setExpectedRateInput(e.target.value)}
                              className="h-9"
                            />
                          </div>
                          <p className="text-[11px] text-muted-foreground">
                            Rate of continuous parts coming from vendors or pre-production.
                          </p>
                        </div>

                        <div className="border-t pt-4 space-y-4">
                          <h4 className="font-semibold text-sm flex items-center gap-1.5 text-foreground">
                            <Ship className="w-4 h-4 text-primary" />
                            Scheduled Deliveries
                          </h4>
                          
                          {fixedSupplies.length === 0 ? (
                            <p className="text-xs text-muted-foreground italic bg-muted/20 p-3 rounded text-center">
                              No deliveries scheduled.
                            </p>
                          ) : (
                            <div className="max-h-32 overflow-y-auto space-y-1.5 pr-1">
                              {fixedSupplies.map((f, idx) => (
                                <div key={idx} className="flex items-center justify-between text-xs px-2.5 py-1.5 bg-muted/40 rounded border border-border/40">
                                  <span className="font-medium text-foreground">{new Date(f.date + 'T00:00:00').toLocaleDateString()}</span>
                                  <div className="flex items-center gap-2">
                                    <span className="font-semibold">{f.quantity} units</span>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      className="h-5 w-5 text-muted-foreground hover:text-red-500"
                                      onClick={() => handleRemoveDelivery(idx)}
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                          <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-1">
                              <Label className="text-[10px] text-muted-foreground uppercase font-semibold">Date</Label>
                              <Input
                                type="date"
                                value={newDeliveryDate}
                                onChange={(e) => setNewDeliveryDate(e.target.value)}
                                className="h-8 text-xs"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[10px] text-muted-foreground uppercase font-semibold">Qty</Label>
                              <div className="flex gap-1.5">
                                <Input
                                  type="number"
                                  placeholder="Qty"
                                  value={newDeliveryQty}
                                  onChange={(e) => setNewDeliveryQty(e.target.value)}
                                  className="h-8 text-xs"
                                />
                                <Button
                                  type="button"
                                  variant="secondary"
                                  size="icon"
                                  onClick={handleAddDelivery}
                                  className="h-8 w-8 shrink-0"
                                >
                                  <Plus className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="pt-2 border-t">
                          <Button
                            className="w-full flex items-center justify-center gap-2"
                            onClick={handleSaveRule}
                            disabled={saveSupplyRule.isPending}
                          >
                            <Save className="w-4 h-4" />
                            {saveSupplyRule.isPending ? "Saving..." : "Save Config"}
                          </Button>
                        </div>

                      </CardContent>
                    </Card>
                  );
                })()}
              </div>

            </div>
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}

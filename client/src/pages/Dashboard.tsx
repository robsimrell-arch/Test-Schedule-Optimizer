import { useState } from "react";
import { Layout } from "@/components/Layout";
import { useSchedule } from "@/hooks/use-manufacturing";
import { Gantt, Task, ViewMode } from "gantt-task-react";
import "gantt-task-react/dist/index.css";

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

function CustomTooltip({ task, fontSize, fontFamily }: { task: Task; fontSize: string; fontFamily: string }) {
  return (
    <div style={{ fontSize, fontFamily, padding: "8px 12px", background: "white", border: "1px solid #e2e8f0", borderRadius: "6px", boxShadow: "0 2px 8px rgba(0,0,0,0.15)", color: "#1a1a1a" }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{task.name}</div>
      <div>Start: {fmtFactoryTime(task.start)}</div>
      <div>End: {fmtFactoryTime(task.end)}</div>
    </div>
  );
}

const ganttStyles = `
  .barWrapper text,
  .bar text,
  g[class*="bar"] text {
    display: block !important;
    fill: black !important;
    font-size: 11px !important;
    font-weight: 600 !important;
    pointer-events: none;
  }
`;
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, BarChart3, CalendarDays, Clock, Calendar } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function Dashboard() {
  const [shiftMode, setShiftMode] = useState<1 | 2 | 3>(1);
  const [workDays, setWorkDays] = useState<5 | 6 | 7>(5);
  const { data: schedule, isLoading, isError } = useSchedule(shiftMode, workDays);
  const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.Week);

  if (isLoading) {
    return (
      <Layout>
        <div className="space-y-6">
          <div className="h-8 w-48 bg-muted rounded animate-pulse" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Skeleton className="h-32 rounded-xl" />
            <Skeleton className="h-32 rounded-xl" />
            <Skeleton className="h-32 rounded-xl" />
          </div>
          <Skeleton className="h-[500px] rounded-xl" />
        </div>
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

  // The scheduler uses UTC as "factory time". The Gantt library renders bars using
  // the browser's local timezone methods (getHours, getDate, etc). To ensure bars
  // appear at the correct factory-time positions regardless of the user's timezone,
  // we shift dates by the local timezone offset so local rendering matches UTC values.
  const tzOffsetMs = new Date().getTimezoneOffset() * 60 * 1000;
  const toFactoryLocal = (iso: string) => new Date(new Date(iso).getTime() + tzOffsetMs);

  const ganttTasks: Task[] = schedule.tasks.map((t: any) => {
    const chamberMatch = t.equipmentNames?.match(/ESS Chamber (\d+)/);
    const chamberSuffix = chamberMatch ? ` [C${chamberMatch[1]}]` : '';
    const units = t.unitsCount || 0;
    
    let baseName = t.stepName 
      ? `${t.partNumber} - ${t.stepName}` 
      : `${t.partNumber} (Step ${t.stepOrder})`;
    
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
      styles: { progressColor: "#3b82f6", backgroundColor: "#bfdbfe" },
    };
  });

  const equipmentStats = Object.values(schedule.equipmentUsage || {});

  return (
    <Layout>
      <style>{ganttStyles}</style>
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Production Schedule</h1>
          <p className="text-muted-foreground mt-2">
            Optimized timeline based on equipment availability and order priority.
          </p>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
        </div>

        {/* Gantt Chart Section */}
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
                  onValueChange={(v) => setWorkDays(Number(v) as 5 | 6 | 7)}
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
                  onValueChange={(v) => setShiftMode(Number(v) as 1 | 2 | 3)}
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
              <Tabs defaultValue={ViewMode.Week} onValueChange={(v) => setViewMode(v as ViewMode)}>
                <TabsList>
                  <TabsTrigger value={ViewMode.QuarterDay}>Hour</TabsTrigger>
                  <TabsTrigger value={ViewMode.HalfDay}>12h</TabsTrigger>
                  <TabsTrigger value={ViewMode.Day}>Day</TabsTrigger>
                  <TabsTrigger value={ViewMode.Week}>Week</TabsTrigger>
                </TabsList>
              </Tabs>
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
      </div>
    </Layout>
  );
}

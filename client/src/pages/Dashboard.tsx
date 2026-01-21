import { useState } from "react";
import { Layout } from "@/components/Layout";
import { useSchedule } from "@/hooks/use-manufacturing";
import { Gantt, Task, ViewMode } from "gantt-task-react";
import "gantt-task-react/dist/index.css";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, BarChart3, CalendarDays } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { startOfDay } from "date-fns";

export default function Dashboard() {
  const { data: schedule, isLoading, isError } = useSchedule();
  const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.Day);

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

  // Transform tasks for Gantt library
  const ganttTasks: Task[] = schedule.tasks.map((t) => ({
    start: new Date(t.startTime),
    end: new Date(t.endTime),
    name: `${t.partNumber} (${t.equipmentName})`,
    id: t.id,
    type: "task",
    progress: t.progress,
    isDisabled: true,
    styles: { progressColor: "#3b82f6", backgroundColor: "#bfdbfe" },
  }));

  const equipmentStats = Object.values(schedule.equipmentUsage);

  return (
    <Layout>
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Production Schedule</h1>
          <p className="text-muted-foreground mt-2">
            Optimized timeline based on equipment availability and order priority.
          </p>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
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
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-orange-500" />
                Avg Equipment Usage
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-foreground">
                {equipmentStats.length > 0
                  ? Math.round(
                      equipmentStats.reduce((acc, curr) => acc + curr.usage, 0) /
                        equipmentStats.length
                    )
                  : 0}
                %
              </div>
              <p className="text-xs text-muted-foreground mt-1">Across all machines</p>
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
              <p className="text-xs text-muted-foreground mt-1">For all current work orders</p>
            </CardContent>
          </Card>
        </div>

        {/* Gantt Chart Section */}
        <Card className="shadow-lg border-border/60 overflow-hidden">
          <CardHeader className="border-b bg-muted/20 flex flex-row items-center justify-between">
            <div>
              <CardTitle>Timeline</CardTitle>
              <CardDescription>Visual production roadmap</CardDescription>
            </div>
            <Tabs defaultValue={ViewMode.Day} onValueChange={(v) => setViewMode(v as ViewMode)}>
              <TabsList>
                <TabsTrigger value={ViewMode.QuarterDay}>Hour</TabsTrigger>
                <TabsTrigger value={ViewMode.HalfDay}>12h</TabsTrigger>
                <TabsTrigger value={ViewMode.Day}>Day</TabsTrigger>
                <TabsTrigger value={ViewMode.Week}>Week</TabsTrigger>
              </TabsList>
            </Tabs>
          </CardHeader>
          <div className="p-4 bg-background overflow-x-auto min-h-[500px]">
            {ganttTasks.length > 0 ? (
              <Gantt
                tasks={ganttTasks}
                viewMode={viewMode}
                columnWidth={viewMode === ViewMode.Day ? 100 : 60}
                listCellWidth="155px"
                barBackgroundColor="#3b82f6"
                barProgressColor="#1d4ed8"
                barProgressSelectedColor="#1e3a8a"
                fontFamily="var(--font-sans)"
                fontSize="12px"
                rowHeight={40}
              />
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground italic">
                No scheduled tasks. Create work orders to populate schedule.
              </div>
            )}
          </div>
        </Card>

        {/* Equipment Usage Table */}
        <Card>
          <CardHeader>
            <CardTitle>Equipment Utilization</CardTitle>
            <CardDescription>Load balance analysis per machine type</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {equipmentStats.map((eq, i) => (
                <div key={i} className="space-y-1">
                  <div className="flex justify-between text-sm font-medium">
                    <span>{eq.name}</span>
                    <span>{Math.round(eq.usage)}%</span>
                  </div>
                  <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary transition-all duration-500"
                      style={{ width: `${Math.min(eq.usage, 100)}%` }}
                    />
                  </div>
                </div>
              ))}
              {equipmentStats.length === 0 && (
                <div className="text-sm text-muted-foreground">No equipment data available.</div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}

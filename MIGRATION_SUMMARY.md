# OptiFlow Migration Summary

This document explains the core logic and architecture of the OptiFlow Manufacturing Scheduler to help another AI continue development.

---

## Core Logic: The Scheduling Algorithm

### Equipment Queuing System

The scheduler maintains a `machineAvailability` map that tracks when each unit of equipment becomes free:

```typescript
machineAvailability: Record<number, Date[]>
// equipmentId -> array of availability times (one per unit/quantity)
```

When scheduling a batch:
1. For each required equipment, find the earliest available unit(s)
2. The batch can only start when ALL required equipment is ready
3. After scheduling, update each equipment unit's availability to the task's end time

### Batching Formula

```
Total Batches = Math.ceil(Order Quantity / Batch Size)
```

Each batch is scheduled independently, enabling **pipeline scheduling** where:
- Batch 2 of Step 1 can run while Batch 1 of Step 2 is running
- Subsequent step batches can start once enough units complete the previous step

### Batch Readiness Tracking

Critical: We track completions as `{endTime, unitsCompleted}` pairs, NOT by batch index order:

```typescript
batchCompletions[orderId][stepOrder] = { endTime: Date, unitsCompleted: number }[]
```

To check if a batch can start:
1. Sort all previous step completions by endTime
2. Accumulate units in completion-time order
3. The batch can start when accumulated units >= units needed for this batch

### Chamber vs Non-Chamber Equipment

**Non-chamber equipment**: All required units must be available simultaneously. Uses `addWorkingMinutes()` for duration - work pauses during non-working hours.

**Chamber equipment (ESS Chambers)**: 
- Treated as alternatives - scheduler picks the earliest available compatible chamber
- Must START during working hours, but runs continuously to completion (uses `addMinutes()`)
- Part-chamber compatibility matrix determines which chambers each part can use

### Changeover Time Penalty

When a chamber switches from Part A to Part B:
1. Check `chamberLastPart[equipmentId][unitIdx]` to see what ran last
2. If different part, look up changeover time from `changeoverMap[partNumberId][equipmentId]`
3. Add changeover time using `addWorkingMinutes()` (respects shifts)
4. Ensure final start time is in working hours via `getNextWorkingTime()`

Same-part consecutive batches do NOT incur changeover.

### Working Hours Logic

```typescript
function isWorkingTime(date, shifts, workDays): boolean
function getNextWorkingTime(date, shifts, workDays): Date  
function addWorkingMinutes(start, minutes, shifts, workDays): Date
```

- Shifts: 1 = 6am-2pm, 2 = 6am-10pm
- WorkDays: 5 = Mon-Fri, 6 = Mon-Sat, 7 = All days

---

## Data Structure: Key Schema Tables

### Part Numbers (`part_numbers`)
```typescript
id: serial (PK)
partNumber: varchar(50) - unique identifier like "GSCP", "SCB"
description: text
steps: jsonb - array of test step definitions
```

### Test Equipment (`test_equipment`)
```typescript
id: serial (PK)
name: varchar(100) - e.g., "ESS Chamber 1", "Vibration"
quantity: integer - number of units available (capacity)
description: text
```

### Work Orders (`work_orders`)
```typescript
id: serial (PK)
partNumberId: integer (FK)
quantity: integer - units to produce
priority: integer - lower = higher priority (0 is highest)
dueDate: timestamp
```

### Part-Equipment Compatibility (`part_equipment_compatibility`)
```typescript
partNumberId: integer (composite PK)
equipmentId: integer (composite PK)
durationMinutes: integer - chamber-specific test duration
changeoverMinutes: integer - time to switch from different part
```

### Steps Structure (JSONB in part_numbers)
```typescript
{
  id: number,
  stepOrder: number,
  durationMinutes: number,
  batchSize: number,
  name?: string,
  chamberRequired: boolean,
  equipmentRequirements: [{ equipmentId, quantityRequired, durationMinutes? }]
}
```

---

## The 'Gotchas': Bugs Fixed & Complex Configurations

### 1. Batch Readiness Order Bug
**Problem**: Originally assumed batch index order = completion order. This broke when batch sizes varied or equipment had different durations.

**Fix**: Track completions as `{endTime, unitsCompleted}` pairs, sort by endTime, then accumulate.

### 2. Timeline Consolidation Complexity
**Problem**: 100+ individual batch tasks made the Gantt chart unreadable.

**Fix**: Merge consecutive batches of same work order/step into single timeline items. Non-consecutive segments get suffix like `-s2`, `-s3`.

**Key Logic**: Tasks are consecutive if they share equipment AND end time of task A equals start time of task B.

### 3. Chamber Start Time Rule
**Problem**: Chambers run overnight but the scheduler was trying to fit entire duration within working hours.

**Fix**: Chamber steps use `addMinutes()` (continuous) for duration but `getNextWorkingTime()` to ensure they START during working hours.

### 4. Changeover Pushing Into Non-Working Hours
**Problem**: Initial changeover implementation used simple `addMinutes()`, which could push chamber starts into off-hours.

**Fix**: Apply changeover using `addWorkingMinutes()` then normalize with `getNextWorkingTime()`.

### 5. Gantt Chart Library Quirks (gantt-task-react)
- Tasks require unique IDs - use format `wo-{orderId}-step-{stepId}` or with segment suffix
- ViewMode enum must be imported correctly
- Date objects must be actual Date instances, not strings
- Task bar colors are controlled via `styles.progressColor` and `styles.progressSelectedColor`

### 6. Equipment Selection for Chambers
**Problem**: When no compatibility restrictions exist, scheduler would fail.

**Fix**: Fall back to all chambers when `partCompatibleChambers.length === 0`, with null durations (uses step default).

---

## Key Prompts That Defined the App

### 1. Batch Pipeline Scheduling
> "Enable pipeline scheduling where subsequent step batches can start as soon as enough units complete the previous step"

This transformed the scheduler from a simple sequential model to a sophisticated pipeline system that significantly reduces production time by allowing step overlap.

### 2. Chamber Continuous Run Rule
> "Chamber steps must START during working hours but can run continuously to completion (overnight/weekends)"

This models real-world ESS testing where chambers run unattended once started, unlike manual operations that pause at shift end.

### 3. Timeline Consolidation
> "Merge consecutive batches of the same work order/step into single timeline items for cleaner visualization"

This made the Gantt chart usable by reducing visual clutter while preserving accurate scheduling beneath.

---

## File Structure Quick Reference

| File | Purpose |
|------|---------|
| `server/routes.ts` | Scheduler algorithm (lines 379-800+) |
| `server/storage.ts` | Database access layer |
| `shared/schema.ts` | Drizzle table definitions |
| `client/src/pages/Dashboard.tsx` | Gantt chart visualization |
| `client/src/pages/Inventory.tsx` | Part/equipment/compatibility management |
| `client/src/hooks/use-manufacturing.ts` | React Query hooks for data fetching |

---

## Testing Notes

- Scheduler output is logged in workflow logs with full task JSON
- Browser console shows React Query cache updates
- Use `/api/schedule?shifts=1&workDays=5` to test different configurations
- The seed data in `server/seed.ts` creates realistic test scenarios with GSCP and SCB parts

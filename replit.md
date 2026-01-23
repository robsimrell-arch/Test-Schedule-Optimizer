# OptiFlow Manufacturing Scheduler

## Overview

OptiFlow is a manufacturing production scheduling application that helps manage test equipment, part numbers, test steps, and work orders. The system calculates optimal production schedules and visualizes them using Gantt charts. It's designed for manufacturing environments where parts need to go through multiple test steps using shared equipment with limited capacity.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter (lightweight React router)
- **State Management**: TanStack React Query for server state
- **UI Components**: shadcn/ui component library built on Radix UI primitives
- **Styling**: Tailwind CSS with CSS custom properties for theming
- **Form Handling**: React Hook Form with Zod validation
- **Build Tool**: Vite with HMR support

The frontend follows a page-based structure with shared components:
- `client/src/pages/` - Main application pages (Dashboard, Inventory, WorkOrders)
- `client/src/components/` - Reusable components including Layout and Sidebar
- `client/src/components/ui/` - shadcn/ui component library
- `client/src/hooks/` - Custom React hooks for data fetching and mutations

### Backend Architecture
- **Framework**: Express 5 with TypeScript
- **Runtime**: Node.js with tsx for development
- **API Pattern**: RESTful endpoints defined in shared route contracts
- **Database ORM**: Drizzle ORM with PostgreSQL dialect

Key backend files:
- `server/index.ts` - Express app setup and middleware
- `server/routes.ts` - API route handlers
- `server/storage.ts` - Database access layer implementing IStorage interface
- `server/db.ts` - Drizzle database connection
- `server/seed.ts` - Database seeding for initial data

### Shared Code
- `shared/schema.ts` - Drizzle table definitions and TypeScript types
- `shared/routes.ts` - API contract definitions with Zod schemas for type-safe client-server communication

### Data Model
The application tracks:
- **Test Equipment**: Machines/stations with quantity (capacity)
- **Part Numbers**: Products that need testing
- **Test Steps**: Sequential steps linking parts to equipment with duration, batch size, and optional name
- **Step Equipment**: Join table for multiple equipment options per step, with optional equipment-specific duration (allows different test times based on which equipment is used, e.g., different ESS Chambers)
- **Work Orders**: Production orders with quantity, priority, and due dates

### Step Names
Test steps can have optional names for better identification:
- In Inventory: Step names appear above the equipment list (e.g., "Vibration Test")
- In Dashboard Gantt: Named steps show as "PartNumber - StepName" (e.g., "GSCP - Vibration Test")
- Unnamed steps show as "PartNumber (Step N)" format

### Equipment-Specific Durations
Each part number can have different test durations depending on which equipment is used. This is configured in the step equipment requirements:
- When adding/editing a test step, each selected equipment can have its own duration
- If no duration is specified for an equipment, the step's default duration is used
- The scheduler uses equipment-specific durations when calculating the production schedule

### Part-Chamber Compatibility
Each part number can be restricted to specific ESS Chambers:
- The **Chamber Compatibility** tab in Inventory provides a matrix view of all parts vs all ESS Chambers
- Click checkboxes to configure which chambers each part can use
- Each compatibility entry can have a custom duration (minutes) for chamber-specific test times
- Test steps use a "Chamber Required" flag instead of selecting specific chambers
- The scheduler automatically selects the earliest available compatible chamber based on the compatibility matrix
- Non-ESS equipment (e.g., Power Supply, ICT) is treated as required (all must be available)
- ESS Chambers are treated as alternatives (scheduler picks one from compatible options)
- Backend uses diff-based upsert for race-safe compatibility updates

### Shift-Based Scheduling
The scheduler supports shift-based work hours:
- **1 Shift (8 hours/day)**: Work scheduled from 6:00 AM to 2:00 PM only
- **2 Shifts (16 hours/day)**: Work scheduled from 6:00 AM to 10:00 PM
- Toggle between shift modes using the switch in the Dashboard Timeline header
- Tasks starting outside working hours are automatically pushed to the next working period
- Long tasks spanning multiple days correctly skip non-working hours
- Schedule API accepts `?shifts=1` or `?shifts=2` query parameter (default: 2)

### Work Week Configuration
The scheduler supports configurable work weeks:
- **5 Days (Mon-Fri)**: Standard work week, weekends off
- **6 Days (Mon-Sat)**: Extended work week, Sunday off
- **7 Days**: Full week, no days off
- Select work week using the dropdown in the Dashboard Timeline header
- Tasks are automatically scheduled around non-working days
- Schedule API accepts `?workDays=5`, `?workDays=6`, or `?workDays=7` query parameter (default: 7)

### Build System
- Development: Vite dev server with Express backend
- Production: esbuild bundles server code, Vite builds client to `dist/public`
- Database migrations: Drizzle Kit with `db:push` command

## External Dependencies

### Database
- **PostgreSQL**: Primary database via `DATABASE_URL` environment variable
- **Drizzle ORM**: Type-safe database queries and schema management
- **connect-pg-simple**: Session storage (available but sessions not currently implemented)

### Third-Party Libraries
- **gantt-task-react**: Gantt chart visualization for production schedules
- **date-fns**: Date manipulation and formatting
- **Zod**: Runtime schema validation for API contracts
- **Radix UI**: Accessible UI primitives (dialogs, dropdowns, tabs, etc.)

### Development Tools
- **Vite**: Frontend build tool with React plugin
- **tsx**: TypeScript execution for Node.js
- **Drizzle Kit**: Database migration tooling
- **Replit plugins**: Error overlay, cartographer, and dev banner for Replit environment
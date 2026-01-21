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
- **Test Steps**: Sequential steps linking parts to equipment with duration and batch size
- **Step Equipment**: Join table for multiple equipment options per step, with optional equipment-specific duration (allows different test times based on which equipment is used, e.g., different ESS Chambers)
- **Work Orders**: Production orders with quantity, priority, and due dates

### Equipment-Specific Durations
Each part number can have different test durations depending on which equipment is used. This is configured in the step equipment requirements:
- When adding/editing a test step, each selected equipment can have its own duration
- If no duration is specified for an equipment, the step's default duration is used
- The scheduler uses equipment-specific durations when calculating the production schedule

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
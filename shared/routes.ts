import { z } from 'zod';
import { 
  insertTestEquipmentSchema, 
  insertPartNumberSchema, 
  insertTestStepSchema, 
  insertWorkOrderSchema,
  testEquipment,
  partNumbers,
  testSteps,
  workOrders
} from './schema';

export * from './schema';

// ============================================
// SHARED ERROR SCHEMAS
// ============================================
export const errorSchemas = {
  validation: z.object({
    message: z.string(),
    field: z.string().optional(),
  }),
  notFound: z.object({
    message: z.string(),
  }),
  internal: z.object({
    message: z.string(),
  }),
};

// ============================================
// API CONTRACT
// ============================================
export const api = {
  equipment: {
    list: {
      method: 'GET' as const,
      path: '/api/equipment',
      responses: {
        200: z.array(z.custom<typeof testEquipment.$inferSelect>()),
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/equipment',
      input: insertTestEquipmentSchema,
      responses: {
        201: z.custom<typeof testEquipment.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    delete: {
      method: 'DELETE' as const,
      path: '/api/equipment/:id',
      responses: {
        204: z.void(),
        404: errorSchemas.notFound,
      },
    },
    update: {
      method: 'PATCH' as const,
      path: '/api/equipment/:id',
      input: insertTestEquipmentSchema.partial(),
      responses: {
        200: z.custom<typeof testEquipment.$inferSelect>(),
        400: errorSchemas.validation,
        404: errorSchemas.notFound,
      },
    }
  },
  parts: {
    list: {
      method: 'GET' as const,
      path: '/api/parts',
      responses: {
        200: z.array(z.custom<typeof partNumbers.$inferSelect & { steps?: any[] }>()),
      },
    },
    get: {
      method: 'GET' as const,
      path: '/api/parts/:id',
      responses: {
        200: z.custom<typeof partNumbers.$inferSelect & { steps: any[] }>(),
        404: errorSchemas.notFound,
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/parts',
      input: insertPartNumberSchema,
      responses: {
        201: z.custom<typeof partNumbers.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    update: {
      method: 'PUT' as const,
      path: '/api/parts/:id',
      input: insertPartNumberSchema.partial(),
      responses: {
        200: z.custom<typeof partNumbers.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
    delete: {
      method: 'DELETE' as const,
      path: '/api/parts/:id',
      responses: {
        204: z.void(),
        404: errorSchemas.notFound,
      },
    }
  },
  steps: {
    create: {
      method: 'POST' as const,
      path: '/api/steps',
      input: insertTestStepSchema,
      responses: {
        201: z.custom<typeof testSteps.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    delete: {
      method: 'DELETE' as const,
      path: '/api/steps/:id',
      responses: {
        204: z.void(),
        404: errorSchemas.notFound,
      },
    },
    update: {
      method: 'PATCH' as const,
      path: '/api/steps/:id',
      responses: {
        200: z.custom<typeof testSteps.$inferSelect>(),
        400: errorSchemas.validation,
        404: errorSchemas.notFound,
      },
    }
  },
  orders: {
    list: {
      method: 'GET' as const,
      path: '/api/orders',
      responses: {
        200: z.array(z.custom<typeof workOrders.$inferSelect & { partNumber: typeof partNumbers.$inferSelect }>()),
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/orders',
      input: insertWorkOrderSchema,
      responses: {
        201: z.custom<typeof workOrders.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    delete: {
      method: 'DELETE' as const,
      path: '/api/orders/:id',
      responses: {
        204: z.void(),
        404: errorSchemas.notFound,
      },
    }
  },
  schedule: {
    calculate: {
      method: 'GET' as const,
      path: '/api/schedule',
      responses: {
        200: z.object({
          tasks: z.array(z.object({
            id: z.string(),
            workOrderId: z.number(),
            partNumber: z.string(),
            stepId: z.number(),
            stepOrder: z.number(),
            stepName: z.string().optional(),
            equipmentIds: z.array(z.number()),
            equipmentNames: z.string(),
            startTime: z.string(),
            endTime: z.string(),
            type: z.literal("test_run"),
            progress: z.number(),
            dependencies: z.array(z.string()).optional()
          })),
          equipmentUsage: z.record(z.object({
            name: z.string(),
            usage: z.number()
          }))
        }),
      },
    },
  },
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}

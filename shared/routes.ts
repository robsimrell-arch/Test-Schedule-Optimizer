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
    },
    getSupplyRules: {
      method: 'GET' as const,
      path: '/api/parts/supply-rules',
      responses: {
        200: z.array(z.custom<any>()),
      },
    },
    saveSupplyRule: {
      method: 'POST' as const,
      path: '/api/parts/supply-rules',
      input: z.object({
        partNumberId: z.number(),
        expectedSupplyRate: z.number().nullable(),
        fixedSupplies: z.string().nullable(),
      }),
      responses: {
        200: z.custom<any>(),
        400: errorSchemas.validation,
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
            type: z.enum(["test_run", "shortage_placeholder"]),
            progress: z.number(),
            dependencies: z.array(z.string()).optional(),
            unitsCount: z.number().optional(),
            isShortageAffected: z.boolean().optional(),
            constrainingSubassemblyName: z.string().optional(),
            equipmentUnitIndices: z.array(z.number()).optional(),
            combinedOrders: z.array(z.object({
              workOrderId: z.number(),
              workOrderNumber: z.string().nullable(),
              quantity: z.number()
            })).optional()
          })),
          equipmentUsage: z.record(z.object({
            name: z.string(),
            usage: z.number()
          })),
          dueDateWarnings: z.array(z.object({
            workOrderId: z.number(),
            workOrderNumber: z.string().nullable(),
            partNumber: z.string(),
            dueDate: z.string(),
            projectedCompletion: z.string(),
            daysLate: z.number()
          })),
          shortageWarnings: z.array(z.object({
            childPartId: z.number(),
            childPartNumber: z.string(),
            totalDemand: z.number(),
            totalSupply: z.number(),
            shortage: z.number(),
            affectedOrders: z.array(z.object({
              workOrderId: z.number(),
              workOrderNumber: z.string().nullable(),
              parentPartNumber: z.string(),
              parentPartId: z.number(),
              quantityRequired: z.number()
            }))
          })).optional(),
          optimalSupplyRates: z.record(z.string(), z.number()).optional(),
          partSupplyRules: z.array(z.any()).optional(),
          subassemblyDemandTotals: z.record(z.string(), z.number()).optional()
        }),
      },
    },
  },
  configurations: {
    list: {
      method: 'GET' as const,
      path: '/api/configurations',
      responses: { 200: z.array(z.any()) },
    },
    create: {
      method: 'POST' as const,
      path: '/api/configurations',
      input: z.object({
        name: z.string(),
        shiftMode: z.number(),
        workDays: z.number(),
        snapshot: z.string(),
      }),
      responses: { 201: z.any() },
    },
    rename: {
      method: 'PATCH' as const,
      path: '/api/configurations/:id',
      input: z.object({ name: z.string() }),
      responses: { 200: z.any(), 404: errorSchemas.notFound },
    },
    delete: {
      method: 'DELETE' as const,
      path: '/api/configurations/:id',
      responses: { 204: z.void(), 404: errorSchemas.notFound },
    },
    load: {
      method: 'POST' as const,
      path: '/api/configurations/:id/load',
      responses: { 200: z.object({ shiftMode: z.number(), workDays: z.number(), name: z.string() }), 404: errorSchemas.notFound },
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

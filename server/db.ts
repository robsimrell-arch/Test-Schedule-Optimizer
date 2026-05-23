import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "../shared/schema";

const { Pool } = pg;

const dbUrl = process.env.DATABASE_URL || "";

if (!dbUrl) {
  console.warn(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const isNeon = dbUrl.includes("neon.tech");

export const pool = new Pool({
  connectionString: dbUrl || undefined,
  ssl: isNeon ? { rejectUnauthorized: false } : false,
});
export const db = drizzle(pool, { schema });

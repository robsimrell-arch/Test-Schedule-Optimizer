import express from "express";
import { registerRoutes } from "../server/routes";
import { createServer } from "http";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      console.log(`${new Date().toLocaleTimeString()} [express] ${logLine}`);
    }
  });

  next();
});

const httpServer = createServer(app);

// Register routes on startup
let routesRegistered = false;
const initPromise = registerRoutes(httpServer, app)
  .then(() => {
    routesRegistered = true;
  })
  .catch((err) => {
    console.error("Failed to register routes:", err);
  });

// Middleware to block requests until routes are registered
app.use(async (req, res, next) => {
  if (!routesRegistered) {
    await initPromise;
  }
  next();
});

export default app;

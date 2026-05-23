import express from "express";
import { createServer } from "http";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

let startupError: any = null;
let registerRoutesFn: any = null;

try {
  // Dynamically require routes to catch any module load/db initialization crashes
  const routesModule = require("../server/routes");
  registerRoutesFn = routesModule.registerRoutes;
} catch (err: any) {
  startupError = {
    message: err.message,
    stack: err.stack,
    name: err.name
  };
  console.error("Vercel Serverless Function Startup Error:", err);
}

// Global logger and error handler
app.use((req, res, next) => {
  if (startupError) {
    return res.status(500).json({
      error: "StartupError",
      message: startupError.message,
      stack: startupError.stack
    });
  }
  
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

if (!startupError && registerRoutesFn) {
  const httpServer = createServer(app);
  let routesRegistered = false;
  const initPromise = registerRoutesFn(httpServer, app).then(() => {
    routesRegistered = true;
  }).catch((err: any) => {
    console.error("Failed to register routes:", err);
  });

  app.use(async (req, res, next) => {
    if (!routesRegistered) {
      await initPromise;
    }
    next();
  });
}

export default app;

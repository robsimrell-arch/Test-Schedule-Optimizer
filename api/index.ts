import express from "express";
import { createServer } from "http";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

let startupError: any = null;
let routesRegistered = false;

// Dynamically import routes and register them, catching any startup or db initialization errors
const initPromise = import("../server/routes")
  .then((routesModule) => {
    const registerRoutes = routesModule.registerRoutes;
    const httpServer = createServer(app);
    return registerRoutes(httpServer, app);
  })
  .then(() => {
    routesRegistered = true;
  })
  .catch((err: any) => {
    startupError = {
      message: err.message,
      stack: err.stack,
      name: err.name
    };
    console.error("Vercel Serverless Function Startup Error:", err);
  });

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

// Middleware to block requests until routes are fully registered
app.use(async (req, res, next) => {
  if (startupError) {
    return res.status(500).json({
      error: "StartupError",
      message: startupError.message,
      stack: startupError.stack
    });
  }
  
  if (!routesRegistered) {
    await initPromise;
  }
  next();
});

export default app;

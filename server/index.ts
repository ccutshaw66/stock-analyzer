import dotenv from "dotenv";
dotenv.config();
import express, { type Request, Response, NextFunction } from "express";
import cookieParser from "cookie-parser";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";

const app = express();
app.use(cookieParser());

// ─── Stripe Webhook (MUST be before express.json()) ──────────────────────────
// Stripe requires the raw body buffer for signature verification
app.post("/api/stripe/webhook", express.raw({ type: 'application/json' }), async (req, res) => {
  const signature = req.headers['stripe-signature'] as string;
  try {
    const { handleWebhook } = await import('./stripe');
    await handleWebhook(req.body as Buffer, signature);
    res.json({ received: true });
  } catch (err: any) {
    console.error('[stripe] Webhook error:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// ─── GitHub Deploy Webhook ─────────────────────────────────────────────────
import crypto from "crypto";
import { exec } from "child_process";

// Deploy secret — checked against GitHub webhook signature or x-deploy-token header
// Must match what's configured in GitHub webhook settings
const DEPLOY_SECRET = process.env.DEPLOY_WEBHOOK_SECRET || "LJ.QfHwAcRXiJ6Vdq_-tHRMXn";
let deployInProgress = false;

// Deploy health check (no auth needed)
app.get("/api/deploy/health", (_req, res) => {
  res.json({ status: "ok", secret_configured: !!DEPLOY_SECRET, deploy_in_progress: deployInProgress });
});

// Deploy endpoint uses express.raw so we get the exact bytes GitHub signed
app.post("/api/deploy", express.raw({ type: '*/*' }), (req, res) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body || ""));

  console.log("[deploy] Request received. Body size:", rawBody.length, "Headers:", JSON.stringify({
    'x-hub-signature-256': req.headers['x-hub-signature-256'] || 'none',
    'x-deploy-token': req.headers['x-deploy-token'] ? 'present' : 'none',
    'content-type': req.headers['content-type'] || 'none',
  }));

  // Method 1: GitHub webhook signature verification
  const signature = req.headers["x-hub-signature-256"] as string;
  if (signature) {
    const hmac = crypto.createHmac("sha256", DEPLOY_SECRET);
    hmac.update(rawBody);
    const expected = `sha256=${hmac.digest("hex")}`;
    try {
      if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
        console.log("[deploy] Signature mismatch.");
        return res.status(403).json({ error: "Invalid signature" });
      }
    } catch (e: any) {
      console.log("[deploy] Signature error:", e.message);
      return res.status(403).json({ error: "Invalid signature" });
    }
    console.log("[deploy] GitHub signature verified OK");
  } else {
    // Method 2: Token in header OR query param (for manual curl triggers)
    const token = (
      req.headers["x-deploy-token"] as string ||
      req.query.token as string ||
      ""
    ).trim();
    if (token !== DEPLOY_SECRET) {
      console.log(`[deploy] Token mismatch.`);
      return res.status(403).json({ error: "Unauthorized" });
    }
    console.log("[deploy] Token verified OK");
  }

  if (deployInProgress) {
    return res.status(409).json({ error: "Deploy already in progress" });
  }

  deployInProgress = true;
  console.log("[deploy] Webhook received, starting deploy...");
  res.json({ status: "deploying" });

  const cmd = `cd /opt/stock-analyzer && git pull origin main 2>&1 && npm install 2>&1 && npm run build 2>&1 && pm2 restart stock-analyzer 2>&1`;
  exec(cmd, { timeout: 120000 }, (error, stdout, stderr) => {
    deployInProgress = false;
    if (error) {
      console.error(`[deploy] FAILED:`, error.message);
      console.error(stderr);
    } else {
      console.log(`[deploy] SUCCESS:\n${stdout}`);
    }
  });
});

const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

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

      log(logLine);
    }
  });

  next();
});

(async () => {
  // Initialize PostgreSQL tables
  const { storage } = await import("./storage");
  await storage.initialize();

  // Verify SMTP connection
  const { verifyEmailConnection } = await import("./email");
  await verifyEmailConnection();

  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();

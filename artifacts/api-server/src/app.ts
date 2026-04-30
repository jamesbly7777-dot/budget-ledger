import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// Inject Firebase config at runtime so Railway env vars reach the frontend
// without needing Docker build args. Loaded before the main JS bundle.
app.get("/config.js", (_req, res) => {
  res.type("application/javascript");
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  const config = {
    VITE_FIREBASE_API_KEY: process.env.VITE_FIREBASE_API_KEY ?? "",
    VITE_FIREBASE_AUTH_DOMAIN: process.env.VITE_FIREBASE_AUTH_DOMAIN ?? "",
    VITE_FIREBASE_PROJECT_ID: process.env.VITE_FIREBASE_PROJECT_ID ?? "",
    VITE_FIREBASE_STORAGE_BUCKET: process.env.VITE_FIREBASE_STORAGE_BUCKET ?? "",
    VITE_FIREBASE_MESSAGING_SENDER_ID: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? "",
    VITE_FIREBASE_APP_ID: process.env.VITE_FIREBASE_APP_ID ?? "",
    VITE_FIREBASE_MEASUREMENT_ID: process.env.VITE_FIREBASE_MEASUREMENT_ID ?? "",
  };
  res.send(`window.__CONFIG__ = ${JSON.stringify(config)};`);
});

// Serve the ledger-app static build with SPA fallback
// Use import.meta.url so the path works regardless of cwd (dev vs production)
// Bundle lives at artifacts/api-server/dist/index.mjs → go up 2 dirs → artifacts/
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const staticDir = path.resolve(__dirname, "../../ledger-app/dist/public");
if (fs.existsSync(staticDir)) {
  app.use(express.static(staticDir, {
    setHeaders(res, filePath) {
      if (filePath.endsWith(".html")) {
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        res.setHeader("Pragma", "no-cache");
        res.setHeader("Expires", "0");
      }
    },
  }));
  app.use((_req, res) => {
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.sendFile(path.join(staticDir, "index.html"));
  });
}

export default app;

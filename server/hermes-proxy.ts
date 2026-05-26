/**
 * HERMES internal API proxy.
 *
 * HERMES (the auto-trading FastAPI dashboard) runs on a separate VM on
 * Chris's internal network and is NOT exposed to the public internet —
 * Stockotter's Express server is the only gateway. Browser requests hit
 * `/api/hermes/*` here; we forward them over the LAN to the wazuh box
 * at HERMES_INTERNAL_URL (default `http://10.209.32.8:8080`).
 *
 * Same pattern works for any future internal service moved off Railway /
 * other paid hosts: add another `mountInternalProxy(app, '/api/foo',
 * 'http://10.209.32.X:NNNN')` call.
 *
 * Mounted AFTER the `/api` auth wall in routes.ts, so only logged-in
 * Stockotter users can call HERMES.
 */
import type { Express, Request, Response } from "express";

const DEFAULT_HERMES_URL = "http://10.209.32.8:8080";
const PROXY_TIMEOUT_MS = 10_000;

export function mountHermesProxy(app: Express): void {
  const upstream = process.env.HERMES_INTERNAL_URL || DEFAULT_HERMES_URL;
  console.log(`[hermes-proxy] /api/hermes/* -> ${upstream}`);
  mountInternalProxy(app, "/api/hermes", upstream);
}

/**
 * Generic forward-everything proxy. Mounts at `prefix` and pipes every
 * request through to `upstreamBase` (preserving method, headers worth
 * keeping, body, query string). Exported so any internal bot/service
 * (KAIROS, future ones) can wire its own proxy with one line in
 * `routes.ts`.
 */
export function mountInternalProxy(app: Express, prefix: string, upstreamBase: string): void {
  app.use(prefix, async (req: Request, res: Response) => {
    // Express strips the mount prefix from req.url, so for a request to
    // `/api/hermes/api/status` we see req.url = `/api/status`.
    const target = `${upstreamBase}${req.url}`;

    try {
      const headers: Record<string, string> = {};
      const ct = req.headers["content-type"];
      if (typeof ct === "string") headers["content-type"] = ct;

      const hasBody = !["GET", "HEAD", "OPTIONS"].includes(req.method);
      const body = hasBody ? JSON.stringify(req.body ?? {}) : undefined;

      const upstream = await fetch(target, {
        method: req.method,
        headers,
        body,
        signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
      });

      // Forward status + content-type. Skip transfer-encoding / connection
      // headers (Node sets those itself based on the response body).
      res.status(upstream.status);
      const upstreamCT = upstream.headers.get("content-type");
      if (upstreamCT) res.setHeader("content-type", upstreamCT);

      const buf = Buffer.from(await upstream.arrayBuffer());
      res.send(buf);
    } catch (err: any) {
      const isTimeout = err?.name === "TimeoutError" || err?.name === "AbortError";
      res.status(isTimeout ? 504 : 502).json({
        error: isTimeout ? "Upstream timeout" : "Upstream unreachable",
        message: err?.message || String(err),
        upstream: target,
      });
    }
  });
}

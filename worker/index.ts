import handler from "vinext/server/fetch-handler";
import { runWithConnectorBinding } from "../lib/connector-context";
import type { ConnectorBinding } from "../lib/connector-contract.mjs";
import indexHtml from "../index.html?raw";
import appJs from "../app.js?raw";
import stylesCss from "../styles.css?raw";
import themeCss from "../theme.css?raw";
import roflParserJs from "../rofl-parser.js?raw";

const staticAssets = new Map<string, { body: string; type: string }>([
  ["/app.js", { body: appJs, type: "text/javascript; charset=utf-8" }],
  ["/styles.css", { body: stylesCss, type: "text/css; charset=utf-8" }],
  ["/theme.css", { body: themeCss, type: "text/css; charset=utf-8" }],
  ["/rofl-parser.js", { body: roflParserJs, type: "text/javascript; charset=utf-8" }],
]);

const worker = {
  fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext<{ CONNECTORS?: ConnectorBinding }>) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") {
      return Promise.resolve(new Response(indexHtml, {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" },
      }));
    }
    const asset = staticAssets.get(url.pathname);
    if (request.method === "GET" && asset) {
      return Promise.resolve(new Response(asset.body, {
        headers: { "content-type": asset.type, "cache-control": "public, max-age=300" },
      }));
    }
    let binding = ctx.props?.CONNECTORS;
    // Local preview emulates the same request-scoped capability. This branch and
    // the auxiliary service binding are absent from production builds.
    if (import.meta.env.DEV && !binding && env.CONNECTORS) {
      const preview = env.CONNECTORS;
      const expiresAt = Date.now() + 60_000;
      binding = {
        async getContext() {
          if (Date.now() >= expiresAt) return { status: "request_context_expired" };
          return preview.getContext?.() ?? { status: "binding_unavailable" };
        },
        async invoke(connectorId, actionName, args) {
          if (Date.now() >= expiresAt) {
            return { status: "request_context_expired", message: "This request has expired. Please try again." };
          }
          return preview.invoke(connectorId, actionName, args);
        },
      };
    }
    return runWithConnectorBinding(binding, () => handler.fetch(request, env, ctx));
  },
};

export default worker;

import * as http from "node:http";
import { openDb } from "./db";
import { EloService } from "./service";
import { ApiError } from "./errors";

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const text = typeof body === "string" ? body : JSON.stringify(body, null, 2);
  res.writeHead(status, { "Content-Type": typeof body === "string" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8" });
  res.end(text);
}

async function readBody(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new ApiError("E_VALIDATION", "请求体必须是合法 JSON"); }
}

export function createServer(svc: EloService): http.Server {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", "http://localhost");
      const parts = url.pathname.split("/").filter(Boolean);
      const method = req.method || "GET";
      const body = method === "POST" ? await readBody(req) : {};

      if (method === "POST" && url.pathname === "/rules") {
        return send(res, 201, { rulesId: svc.createRules(body.k, body.initial) });
      }
      if (method === "POST" && url.pathname === "/players") {
        return send(res, 201, { playerId: svc.registerPlayer(body.id) });
      }
      if (method === "GET" && url.pathname === "/players") {
        return send(res, 200, svc.listPlayers());
      }
      if (method === "POST" && url.pathname === "/versions") {
        return send(res, 201, { versionId: svc.createVersion(body.parentId ?? null, body.note || "") });
      }
      if (method === "POST" && parts[0] === "versions" && parts[2] === "matches") {
        const n = svc.importMatches(Number(parts[1]), Number(body.rulesId), body.matches);
        return send(res, 201, { imported: n });
      }
      if (method === "POST" && parts[0] === "versions" && parts[2] === "compute") {
        return send(res, 200, svc.compute(Number(parts[1])));
      }
      if (method === "POST" && parts[0] === "versions" && parts[2] === "correct") {
        return send(res, 201, { versionId: svc.correct(Number(parts[1]), body.ops, body.note) });
      }
      if (method === "GET" && parts[0] === "versions" && parts[2] === "reports") {
        return send(res, 200, svc.getReports(Number(parts[1])));
      }
      if (method === "GET" && parts[0] === "versions" && parts[2] === "matches" && parts[3]) {
        return send(res, 200, svc.getMatchReport(Number(parts[1]), parts[3]));
      }
      if (method === "GET" && parts[0] === "versions" && parts[2] === "standings") {
        return send(res, 200, svc.standings(Number(parts[1]), Number(url.searchParams.get("rulesId"))));
      }
      if (method === "GET" && parts[0] === "versions" && parts[2] === "compare") {
        return send(res, 200, svc.comparePlayers(Number(parts[1]),
          Number(url.searchParams.get("rulesId")),
          url.searchParams.get("p1") || "", url.searchParams.get("p2") || ""));
      }
      if (method === "GET" && parts[0] === "versions" && parts[2] === "export") {
        return send(res, 200, svc.exportReport(Number(parts[1]), Number(url.searchParams.get("digits") || 2)));
      }
      if (method === "GET" && url.pathname === "/diff") {
        return send(res, 200, svc.diffVersions(Number(url.searchParams.get("v1")), Number(url.searchParams.get("v2"))));
      }
      throw new ApiError("E_VALIDATION", `未知路由 ${method} ${url.pathname}`, 404);
    } catch (e) {
      if (e instanceof ApiError) return send(res, e.status, { error: e.code, message: e.message });
      send(res, 500, { error: "E_INTERNAL", message: String(e) });
    }
  });
}

if (require.main === module) {
  const svc = new EloService(openDb());
  const server = createServer(svc);
  const port = process.env.PORT ? Number(process.env.PORT) : 0; // 默认选择空闲端口
  server.listen(port, () => {
    const addr = server.address();
    console.log(`Elo API 已启动: http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : port}`);
  });
}

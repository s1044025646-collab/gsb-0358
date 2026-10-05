import { openDb } from "./db";
import { EloService } from "./service";
import { formatRating } from "./elo";

function out(x: unknown): void {
  console.log(typeof x === "string" ? x : JSON.stringify(x, null, 2));
}

function fail(e: unknown): never {
  if (e && typeof e === "object" && "code" in e) {
    const err = e as { code: string; message: string };
    console.error(`错误 [${err.code}] ${err.message}`);
  } else {
    console.error(String(e));
  }
  process.exit(1);
}

const USAGE = `用法: node dist/src/cli.js <命令> [参数]
  rules <k> <initial>                        创建规则版本
  register <playerId>                        登记选手
  players                                    列出选手
  new-version [parentId] [note]              创建数据版本
  import <versionId> <rulesId> <file.json>   导入有序对局（JSON 数组，含 matchId/seq/a/b/result）
  compute <versionId>                        核算全历史
  match <versionId> <matchId>                查询某场前后分数
  standings <versionId> <rulesId>            等级分榜
  compare <versionId> <rulesId> <p1> <p2>    比较两名选手
  correct <versionId> <ops.json> [note]      历史更正（生成新版本）
  diff <v1> <v2>                             版本差异定位
  export <versionId> [digits]                导出 CSV 报告
`;

export function runCli(argv: string[]): void {
  const svc = new EloService(openDb());
  const [cmd, ...args] = argv;
  switch (cmd) {
    case "rules":
      return out({ rulesId: svc.createRules(Number(args[0]), Number(args[1])) });
    case "register":
      return out({ playerId: svc.registerPlayer(args[0]) });
    case "players":
      return out(svc.listPlayers());
    case "new-version":
      return out({ versionId: svc.createVersion(args[0] ? Number(args[0]) : null, args[1] || "") });
    case "import": {
      const fs = require("node:fs");
      const matches = JSON.parse(fs.readFileSync(args[2], "utf8"));
      return out({ imported: svc.importMatches(Number(args[0]), Number(args[1]), matches) });
    }
    case "compute":
      return out(svc.compute(Number(args[0])));
    case "match":
      return out(svc.getMatchReport(Number(args[0]), args[1]));
    case "standings":
      return out(svc.standings(Number(args[0]), Number(args[1]))
        .map(s => `${s.player}: ${formatRating(s.rating)}`));
    case "compare":
      return out(svc.comparePlayers(Number(args[0]), Number(args[1]), args[2], args[3]));
    case "correct": {
      const fs = require("node:fs");
      const ops = JSON.parse(fs.readFileSync(args[1], "utf8"));
      return out({ versionId: svc.correct(Number(args[0]), ops, args[2]) });
    }
    case "diff":
      return out(svc.diffVersions(Number(args[0]), Number(args[1])));
    case "export":
      return out(svc.exportReport(Number(args[0]), args[1] ? Number(args[1]) : 2));
    default:
      process.stderr.write(USAGE);
      process.exit(cmd ? 1 : 0);
  }
}

if (require.main === module) {
  try {
    runCli(process.argv.slice(2));
  } catch (e) {
    fail(e);
  }
}

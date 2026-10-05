// 演示：两名 1500 分选手 K=32 一场甲胜 -> 1516 / 1484；加入第三人与多场对局；更正首场后对比。
import * as fs from "node:fs";
import * as path from "node:path";
import { openDb } from "./db";
import { EloService } from "./service";
import { formatRating } from "./elo";

const dir = path.join(process.cwd(), "data");
fs.rmSync(path.join(dir, "demo.db"), { force: true });
fs.rmSync(path.join(dir, "demo.db-wal"), { force: true });
fs.rmSync(path.join(dir, "demo.db-shm"), { force: true });

const svc = new EloService(openDb(path.join(dir, "demo.db")));
const f = (x: number) => formatRating(x, 2);

const rulesId = svc.createRules(32, 1500);
for (const p of ["甲", "乙", "丙"]) svc.registerPlayer(p);
const v1 = svc.createVersion(null, "初始版本");

svc.importMatches(v1, rulesId, [
  { matchId: "m1", seq: 1, a: "甲", b: "乙", result: "A" },
]);
svc.compute(v1);
const m1 = svc.getMatchReport(v1, "m1");
console.log(`[演示1] 甲胜一场后: 甲=${f(m1.raPost)} 乙=${f(m1.rbPost)}（期望 1516.00 / 1484.00）`);

svc.importMatches(v1, rulesId, [
  { matchId: "m2", seq: 2, a: "甲", b: "丙", result: "A" },
  { matchId: "m3", seq: 3, a: "丙", b: "乙", result: "B" },
  { matchId: "m4", seq: 4, a: "甲", b: "乙", result: "D" },
]);
svc.compute(v1);
console.log("[演示2] 版本1 等级分榜:");
for (const s of svc.standings(v1, rulesId)) console.log(`  ${s.player}: ${f(s.rating)}`);

const v2 = svc.correct(v1, [{ type: "update", matchId: "m1", result: "B" }], "更正首场为乙胜");
console.log(`[演示3] 更正首场为乙胜，生成版本 ${v2}，等级分榜:`);
for (const s of svc.standings(v2, rulesId)) console.log(`  ${s.player}: ${f(s.rating)}`);

const diff = svc.diffVersions(v1, v2);
console.log(`[演示4] 版本差异: ${diff.explanation}`);
console.log(`[演示5] 版本1 的 m1 报告仍按原数据展示: 结果=${svc.getMatchReport(v1, "m1").result}`);

import { test, beforeEach } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { openDb } from "../src/db";
import { EloService } from "../src/service";
import { ApiError } from "../src/errors";

let svc: EloService;
let dbFile: string;
let rulesId: number;
let v1: number;

function fresh(): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "elo-test-"));
  dbFile = path.join(dir, "test.db");
  svc = new EloService(openDb(dbFile));
  rulesId = svc.createRules(32, 1500);
  for (const p of ["P1", "P2", "P3"]) svc.registerPlayer(p);
  v1 = svc.createVersion(null, "v1");
}

beforeEach(fresh);

const base = [
  { matchId: "m1", seq: 1, a: "P1", b: "P2", result: "A" as const },
  { matchId: "m2", seq: 2, a: "P1", b: "P3", result: "A" as const },
  { matchId: "m3", seq: 3, a: "P3", b: "P2", result: "B" as const },
];

test("导入并核算：顺序影响结果", () => {
  svc.importMatches(v1, rulesId, base);
  svc.compute(v1);
  const m1 = svc.getMatchReport(v1, "m1");
  assert.equal(m1.raPre, 1500);
  assert.equal(m1.raPost, 1516);
  // 交换顺序产生不同中间报告
  const v2 = svc.createVersion(null, "reversed");
  svc.importMatches(v2, rulesId, [
    { matchId: "x1", seq: 1, a: "P3", b: "P2", result: "B" },
    { matchId: "x2", seq: 2, a: "P1", b: "P3", result: "A" },
    { matchId: "x3", seq: 3, a: "P1", b: "P2", result: "A" },
  ]);
  svc.compute(v2);
  assert.notEqual(svc.getMatchReport(v2, "x3").raPre, svc.getMatchReport(v1, "m1").raPost);
});

test("相同输入顺序产生相同结果；空记录返回初始分", () => {
  svc.importMatches(v1, rulesId, base);
  const r1 = svc.compute(v1);
  const r2 = svc.compute(v1);
  assert.deepEqual(r1, r2);
  const emptyV = svc.createVersion(null, "empty");
  const st = svc.standings(emptyV, rulesId);
  assert.ok(st.every(s => s.rating === 1500));
});

test("非法导入：自对局 / 坏结果 / 未登记选手 / 重复编号，且原子回滚", () => {
  assert.throws(() => svc.importMatches(v1, rulesId, [
    { matchId: "bad1", seq: 1, a: "P1", b: "P1", result: "A" }]), (e: ApiError) => e.code === "E_SELF_MATCH");
  assert.throws(() => svc.importMatches(v1, rulesId, [
    { matchId: "bad2", seq: 1, a: "P1", b: "P2", result: "X" as any }]), (e: ApiError) => e.code === "E_BAD_RESULT");
  assert.throws(() => svc.importMatches(v1, rulesId, [
    { matchId: "bad3", seq: 1, a: "P1", b: "NOPE", result: "A" }]), (e: ApiError) => e.code === "E_PLAYER_NOT_FOUND");
  assert.throws(() => svc.importMatches(v1, rulesId, [
    { matchId: "dup", seq: 1, a: "P1", b: "P2", result: "A" },
    { matchId: "dup", seq: 2, a: "P1", b: "P2", result: "A" }]), (e: ApiError) => e.code === "E_DUP_MATCH");
  // 原子回滚：第一批部分成功 + 第二批重复 -> 第一批也不应残留
  svc.importMatches(v1, rulesId, [{ matchId: "m1", seq: 1, a: "P1", b: "P2", result: "A" }]);
  assert.throws(() => svc.importMatches(v1, rulesId, [
    { matchId: "m2", seq: 2, a: "P1", b: "P3", result: "A" },
    { matchId: "m1", seq: 3, a: "P1", b: "P3", result: "A" }]), (e: ApiError) => e.code === "E_DUP_MATCH");
  assert.equal(svc.listMatches(v1).length, 1);
});

test("规则校验：拒绝非有限数与越界值", () => {
  assert.throws(() => svc.createRules(NaN, 1500), (e: ApiError) => e.code === "E_VALIDATION");
  assert.throws(() => svc.createRules(32, Infinity), (e: ApiError) => e.code === "E_VALIDATION");
  assert.throws(() => svc.createRules(0, 1500), (e: ApiError) => e.code === "E_VALIDATION");
});

test("历史更正：改结果生成新版本，旧版本报告不变，版本隔离", () => {
  svc.importMatches(v1, rulesId, base);
  svc.compute(v1);
  const before = svc.getMatchReport(v1, "m1");
  const v2 = svc.correct(v1, [{ type: "update", matchId: "m1", result: "B" }]);
  const after1 = svc.getMatchReport(v1, "m1");
  assert.deepEqual(before, after1); // 过去报告仍按原数据展示
  const m1v2 = svc.getMatchReport(v2, "m1");
  assert.equal(m1v2.result, "B");
  assert.equal(m1v2.raPost, 1484);
  // 传播：m2 的赛前分在新版本中不同
  assert.notEqual(svc.getMatchReport(v2, "m2").raPre, svc.getMatchReport(v1, "m2").raPre);
  // 版本隔离：v1 榜不含 v2 结果
  const s1 = svc.standings(v1, rulesId).find(s => s.player === "P1")!.rating;
  const s2 = svc.standings(v2, rulesId).find(s => s.player === "P1")!.rating;
  assert.notEqual(s1, s2);
});

test("撤销一场：重算后续对局", () => {
  svc.importMatches(v1, rulesId, base);
  svc.compute(v1);
  const v2 = svc.correct(v1, [{ type: "revoke", matchId: "m1" }]);
  assert.equal(svc.listMatches(v2).length, 2);
  const m2 = svc.getMatchReport(v2, "m2");
  assert.equal(m2.raPre, 1500); // m1 撤销后 P1 回到初始分
});

test("新增选手只在其首次参加之前有初始分", () => {
  svc.importMatches(v1, rulesId, [{ matchId: "m1", seq: 1, a: "P1", b: "P2", result: "A" }]);
  svc.registerPlayer("P4"); // 更正后新增的选手
  const v2 = svc.correct(v1, [{ type: "update", matchId: "m1", result: "D" }]);
  const st = svc.standings(v2, rulesId);
  assert.equal(st.find(s => s.player === "P4")!.rating, 1500);
});

test("版本差异定位：最早差异比赛与传播解释", () => {
  svc.importMatches(v1, rulesId, base);
  svc.compute(v1);
  const v2 = svc.correct(v1, [{ type: "update", matchId: "m2", result: "D" }]);
  const diff = svc.diffVersions(v1, v2);
  assert.equal(diff.identical, false);
  assert.equal(diff.earliestDiffMatchId, "m2");
  assert.ok(diff.explanation.includes("m2"));
  const same = svc.diffVersions(v1, v1);
  assert.equal(same.identical, true);
});

test("重启后可查询已有版本并再次核算", () => {
  svc.importMatches(v1, rulesId, base);
  svc.compute(v1);
  const before = svc.getReports(v1);
  // 模拟重启：重新打开同一数据库文件
  const svc2 = new EloService(openDb(dbFile));
  const after = svc2.getReports(v1);
  assert.deepEqual(before, after);
  const recomputed = svc2.compute(v1);
  assert.deepEqual(before.map(r => r.matchId), recomputed.map(r => r.matchId));
});

test("导出报告包含逐场数据且仅展示时格式化", () => {
  svc.importMatches(v1, rulesId, base);
  svc.compute(v1);
  const csv = svc.exportReport(v1, 2);
  const lines = csv.split("\n");
  assert.equal(lines.length, 4);
  assert.ok(lines[1].includes("1516.00"));
});

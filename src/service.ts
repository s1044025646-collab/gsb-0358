import { DatabaseSync } from "node:sqlite";
import { step, Result, isValidResult, DELTA_SUM_TOLERANCE, formatRating } from "./elo";
import { ApiError } from "./errors";
import { MAX_PLAYERS, MAX_MATCHES_PER_VERSION } from "./db";

export interface MatchInput {
  matchId: string;
  seq: number;
  a: string;
  b: string;
  result: Result;
}

export interface ReportRow {
  versionId: number;
  matchId: string;
  seq: number;
  a: string;
  b: string;
  result: Result;
  rulesId: number;
  raPre: number; rbPre: number;
  ea: number; eb: number;
  sa: number; sb: number;
  da: number; db: number;
  raPost: number; rbPost: number;
}

export class EloService {
  constructor(private db: DatabaseSync) {}

  createRules(k: unknown, initial: unknown): number {
    if (typeof k !== "number" || typeof initial !== "number" ||
        !Number.isFinite(k) || !Number.isFinite(initial)) {
      throw new ApiError("E_VALIDATION", "K 与初始分必须为有限数字");
    }
    if (k <= 0 || k > 200) throw new ApiError("E_VALIDATION", "K 必须在 (0, 200] 范围内");
    if (initial < 0 || initial > 4000) throw new ApiError("E_VALIDATION", "初始分必须在 [0, 4000] 范围内");
    const r = this.db.prepare("INSERT INTO rules (k, initial) VALUES (?, ?)").run(k, initial);
    return Number(r.lastInsertRowid);
  }

  getRules(id: number): { id: number; k: number; initial: number } {
    const row = this.db.prepare("SELECT id, k, initial FROM rules WHERE id = ?").get(id) as
      | { id: number; k: number; initial: number } | undefined;
    if (!row) throw new ApiError("E_RULE_NOT_FOUND", `规则版本 ${id} 不存在`, 404);
    return row;
  }

  registerPlayer(id: unknown): string {
    if (typeof id !== "string" || id.trim() === "" || id.length > 64) {
      throw new ApiError("E_VALIDATION", "选手编号必须是非空字符串（<=64 字符）");
    }
    const count = (this.db.prepare("SELECT COUNT(*) AS c FROM players").get() as { c: number }).c;
    const existing = this.db.prepare("SELECT id FROM players WHERE id = ?").get(id);
    if (existing) return id; // 幂等
    if (count >= MAX_PLAYERS) throw new ApiError("E_LIMIT", "选手数量已达上限");
    const next = count + 1;
    this.db.prepare("INSERT INTO players (id, seq) VALUES (?, ?)").run(id, next);
    return id;
  }

  listPlayers(): Array<{ id: string; seq: number }> {
    return this.db.prepare("SELECT id, seq FROM players ORDER BY seq").all() as Array<{ id: string; seq: number }>;
  }

  private requirePlayer(id: string): void {
    if (!this.db.prepare("SELECT id FROM players WHERE id = ?").get(id)) {
      throw new ApiError("E_PLAYER_NOT_FOUND", `选手 ${id} 未登记`, 404);
    }
  }

  createVersion(parentId: number | null, note: string): number {
    if (parentId !== null) this.requireVersion(parentId);
    const r = this.db.prepare("INSERT INTO versions (parent_id, note) VALUES (?, ?)")
      .run(parentId, note);
    return Number(r.lastInsertRowid);
  }

  requireVersion(id: number): void {
    if (!this.db.prepare("SELECT id FROM versions WHERE id = ?").get(id)) {
      throw new ApiError("E_VERSION_NOT_FOUND", `数据版本 ${id} 不存在`, 404);
    }
  }

  // 批量导入：全部校验通过后单事务写入，失败原子回滚。
  importMatches(versionId: number, rulesId: number, matches: MatchInput[]): number {
    this.requireVersion(versionId);
    const rules = this.getRules(rulesId);
    if (!Array.isArray(matches) || matches.length === 0) {
      throw new ApiError("E_VALIDATION", "对局列表必须是非空数组");
    }
    const seenIds = new Set<string>();
    const seenSeqs = new Set<number>();
    for (const m of matches) {
      if (typeof m.matchId !== "string" || m.matchId.trim() === "") {
        throw new ApiError("E_VALIDATION", "matchId 必须是非空字符串");
      }
      if (!Number.isInteger(m.seq) || m.seq <= 0) {
        throw new ApiError("E_VALIDATION", `对局 ${m.matchId} 的 seq 必须是正整数`);
      }
      if (seenIds.has(m.matchId)) throw new ApiError("E_DUP_MATCH", `重复比赛编号 ${m.matchId}`, 409);
      if (seenSeqs.has(m.seq)) throw new ApiError("E_DUP_SEQ", `重复序号 ${m.seq}`, 409);
      seenIds.add(m.matchId); seenSeqs.add(m.seq);
      if (m.a === m.b) throw new ApiError("E_SELF_MATCH", `对局 ${m.matchId} 双方相同`);
      if (!isValidResult(m.result)) {
        throw new ApiError("E_BAD_RESULT", `对局 ${m.matchId} 的结果必须是 "A" | "D" | "B"`);
      }
      this.requirePlayer(m.a);
      this.requirePlayer(m.b);
    }
    const total = (this.db.prepare("SELECT COUNT(*) AS c FROM matches WHERE version_id = ?")
      .get(versionId) as { c: number }).c;
    if (total + matches.length > MAX_MATCHES_PER_VERSION) {
      throw new ApiError("E_LIMIT", "对局数量已达上限");
    }
    const insert = this.db.prepare(
      "INSERT INTO matches (version_id, match_id, seq, a, b, result, rules_id) VALUES (?, ?, ?, ?, ?, ?, ?)");
    this.db.exec("BEGIN");
    try {
      for (const m of matches) {
        try {
          insert.run(versionId, m.matchId, m.seq, m.a, m.b, m.result, rules.id);
        } catch (e) {
          const msg = String(e);
          if (msg.includes("matches.match_id")) throw new ApiError("E_DUP_MATCH", `重复比赛编号 ${m.matchId}`, 409);
          if (msg.includes("matches.seq")) throw new ApiError("E_DUP_SEQ", `重复序号 ${m.seq}`, 409);
          throw e;
        }
      }
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    return matches.length;
  }

  listMatches(versionId: number): Array<{ matchId: string; seq: number; a: string; b: string; result: Result; rulesId: number }> {
    this.requireVersion(versionId);
    const rows = this.db.prepare(
      "SELECT match_id, seq, a, b, result, rules_id FROM matches WHERE version_id = ? ORDER BY seq"
    ).all(versionId) as Array<{ match_id: string; seq: number; a: string; b: string; result: Result; rules_id: number }>;
    return rows.map(r => ({ matchId: r.match_id, seq: r.seq, a: r.a, b: r.b, result: r.result, rulesId: r.rules_id }));
  }

  // 全历史重算：严格按 seq 升序，内部保留完整浮点精度。
  compute(versionId: number): ReportRow[] {
    const matches = this.listMatches(versionId);
    this.db.prepare("DELETE FROM reports WHERE version_id = ?").run(versionId);
    const ratings = new Map<string, number>();
    const insert = this.db.prepare(`INSERT INTO reports
      (version_id, match_id, seq, a, b, result, rules_id, ra_pre, rb_pre, ea, eb, sa, sb, da, db, ra_post, rb_post)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const out: ReportRow[] = [];
    this.db.exec("BEGIN");
    try {
      for (const m of matches) {
        const rules = this.getRules(m.rulesId);
        const raPre = ratings.get(m.a) ?? rules.initial;
        const rbPre = ratings.get(m.b) ?? rules.initial;
        const s = step({ raPre, rbPre, result: m.result }, rules.k);
        if (Math.abs(s.da + s.db) > DELTA_SUM_TOLERANCE) {
          throw new ApiError("E_INTERNAL", "双方变化量之和超出容差", 500);
        }
        ratings.set(m.a, s.raPost);
        ratings.set(m.b, s.rbPost);
        insert.run(versionId, m.matchId, m.seq, m.a, m.b, m.result, m.rulesId,
          s.raPre, s.rbPre, s.ea, s.eb, s.sa, s.sb, s.da, s.db, s.raPost, s.rbPost);
        out.push({ versionId, matchId: m.matchId, seq: m.seq, a: m.a, b: m.b, result: m.result,
          rulesId: m.rulesId, raPre: s.raPre, rbPre: s.rbPre, ea: s.ea, eb: s.eb,
          sa: s.sa, sb: s.sb, da: s.da, db: s.db, raPost: s.raPost, rbPost: s.rbPost });
      }
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    return out;
  }

  private ensureComputed(versionId: number): void {
    const matches = (this.db.prepare("SELECT COUNT(*) AS c FROM matches WHERE version_id = ?")
      .get(versionId) as { c: number }).c;
    const reports = (this.db.prepare("SELECT COUNT(*) AS c FROM reports WHERE version_id = ?")
      .get(versionId) as { c: number }).c;
    if (matches !== reports) this.compute(versionId);
  }

  getReports(versionId: number): ReportRow[] {
    this.requireVersion(versionId);
    this.ensureComputed(versionId);
    const rows = this.db.prepare("SELECT * FROM reports WHERE version_id = ? ORDER BY seq").all(versionId) as any[];
    return rows.map(r => ({
      versionId: r.version_id, matchId: r.match_id, seq: r.seq, a: r.a, b: r.b,
      result: r.result, rulesId: r.rules_id, raPre: r.ra_pre, rbPre: r.rb_pre,
      ea: r.ea, eb: r.eb, sa: r.sa, sb: r.sb, da: r.da, db: r.db,
      raPost: r.ra_post, rbPost: r.rb_post,
    }));
  }

  getMatchReport(versionId: number, matchId: string): ReportRow {
    const rep = this.getReports(versionId).find(r => r.matchId === matchId);
    if (!rep) throw new ApiError("E_MATCH_NOT_FOUND", `版本 ${versionId} 中不存在比赛 ${matchId}`, 404);
    return rep;
  }

  // 当前等级分榜：空记录选手返回初始分。
  standings(versionId: number, rulesId: number): Array<{ player: string; rating: number }> {
    const rules = this.getRules(rulesId);
    const reports = this.getReports(versionId);
    const ratings = new Map<string, number>();
    for (const p of this.listPlayers()) ratings.set(p.id, rules.initial);
    for (const r of reports) {
      ratings.set(r.a, r.raPost);
      ratings.set(r.b, r.rbPost);
    }
    return [...ratings.entries()].map(([player, rating]) => ({ player, rating }))
      .sort((x, y) => y.rating - x.rating || (x.player < y.player ? -1 : 1));
  }

  comparePlayers(versionId: number, rulesId: number, p1: string, p2: string) {
    this.requirePlayer(p1); this.requirePlayer(p2);
    const st = this.standings(versionId, rulesId);
    const r1 = st.find(s => s.player === p1)!.rating;
    const r2 = st.find(s => s.player === p2)!.rating;
    const ea = 1 / (1 + Math.pow(10, (r2 - r1) / 400));
    return { p1, p2, r1, r2, diff: r1 - r2, expectedP1: ea, expectedP2: 1 - ea };
  }

  // 历史更正：生成新版本，可更改一场结果或撤销一场。
  correct(parentId: number, ops: Array<{ type: "update"; matchId: string; result: Result } | { type: "revoke"; matchId: string }>, note = ""): number {
    this.requireVersion(parentId);
    if (!Array.isArray(ops) || ops.length === 0) throw new ApiError("E_VALIDATION", "更正操作列表不能为空");
    const matches = this.listMatches(parentId);
    const byId = new Map(matches.map(m => [m.matchId, m]));
    for (const op of ops) {
      if (!byId.has(op.matchId)) throw new ApiError("E_MATCH_NOT_FOUND", `比赛 ${op.matchId} 不存在`, 404);
      if (op.type === "update" && !isValidResult(op.result)) {
        throw new ApiError("E_BAD_RESULT", "结果必须是 \"A\" | \"D\" | \"B\"");
      }
      if (op.type !== "update" && op.type !== "revoke") throw new ApiError("E_VALIDATION", "未知更正类型");
    }
    const newId = this.createVersion(parentId, note || `更正自版本 ${parentId}`);
    const insert = this.db.prepare(
      "INSERT INTO matches (version_id, match_id, seq, a, b, result, rules_id) VALUES (?, ?, ?, ?, ?, ?, ?)");
    this.db.exec("BEGIN");
    try {
      for (const m of matches) {
        const op = ops.find(o => o.matchId === m.matchId);
        if (op && op.type === "revoke") continue;
        const result = op && op.type === "update" ? op.result : m.result;
        insert.run(newId, m.matchId, m.seq, m.a, m.b, result, m.rulesId);
      }
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      this.db.prepare("DELETE FROM versions WHERE id = ?").run(newId);
      throw e;
    }
    this.compute(newId);
    return newId;
  }

  // 版本对比：定位最早产生差异的比赛并解释传播。
  diffVersions(v1: number, v2: number) {
    const r1 = this.getReports(v1);
    const r2 = this.getReports(v2);
    const m1 = new Map(r1.map(r => [r.matchId, r]));
    const m2 = new Map(r2.map(r => [r.matchId, r]));
    const seqOf = (r: ReportRow | undefined) => (r ? r.seq : Number.MAX_SAFE_INTEGER);
    const allIds = [...new Set([...m1.keys(), ...m2.keys()])]
      .sort((x, y) => Math.min(seqOf(m1.get(x)), seqOf(m2.get(x))) - Math.min(seqOf(m1.get(y)), seqOf(m2.get(y))));
    let earliest: string | null = null;
    for (const id of allIds) {
      const a = m1.get(id), b = m2.get(id);
      if (!a || !b || a.result !== b.result || a.raPre !== b.raPre || a.rbPre !== b.rbPre) {
        earliest = id;
        break;
      }
    }
    const affected = new Set<string>();
    if (earliest !== null) {
      const startSeq = Math.min(seqOf(m1.get(earliest)), seqOf(m2.get(earliest)));
      for (const r of [...r1, ...r2]) {
        if (r.seq >= startSeq) { affected.add(r.a); affected.add(r.b); }
      }
    }
    return {
      identical: earliest === null,
      earliestDiffMatchId: earliest,
      explanation: earliest === null
        ? "两个版本的逐场报告完全一致。"
        : `最早差异出现在比赛 ${earliest}：该场的赛前分或结果被修改，导致双方赛后分变化；` +
          `变化后的分数作为后续对局的赛前分逐场传播，影响之后所有涉及相关选手的对局（共 ${affected.size} 名选手被波及）。` +
          `注意：只影响差异位置之后的对局，之前的报告保持不变。`,
      affectedPlayers: [...affected].sort(),
    };
  }

  exportReport(versionId: number, digits = 2): string {
    const reports = this.getReports(versionId);
    const f = (x: number) => formatRating(x, digits);
    const lines = ["seq,matchId,a,b,result,rulesId,raPre,rbPre,ea,eb,sa,sb,da,db,raPost,rbPost"];
    for (const r of reports) {
      lines.push([r.seq, r.matchId, r.a, r.b, r.result, r.rulesId,
        f(r.raPre), f(r.rbPre), f(r.ea), f(r.eb), f(r.sa), f(r.sb),
        f(r.da), f(r.db), f(r.raPost), f(r.rbPost)].join(","));
    }
    return lines.join("\n");
  }
}

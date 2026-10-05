import { test } from "node:test";
import * as assert from "node:assert/strict";
import { step, formatRating } from "../src/elo";

test("两名 1500 分选手 K=32，甲胜后为 1516 / 1484", () => {
  const s = step({ raPre: 1500, rbPre: 1500, result: "A" }, 32);
  assert.equal(s.ea, 0.5);
  assert.equal(formatRating(s.raPost), "1516.00");
  assert.equal(formatRating(s.rbPost), "1484.00");
});

test("相同等级平局后分数不变", () => {
  const s = step({ raPre: 1600, rbPre: 1600, result: "D" }, 32);
  assert.equal(s.raPost, 1600);
  assert.equal(s.rbPost, 1600);
});

test("强者赢弱者变化较小，弱者赢强者变化较大", () => {
  const strong = step({ raPre: 1800, rbPre: 1400, result: "A" }, 32);
  const upset = step({ raPre: 1400, rbPre: 1800, result: "A" }, 32);
  assert.ok(strong.da < 16);
  assert.ok(upset.da > 16);
  assert.ok(Math.abs(strong.da + upset.da - 32) < 1e-9);
});

test("交换双方结果对称", () => {
  const s1 = step({ raPre: 1700, rbPre: 1500, result: "A" }, 32);
  const s2 = step({ raPre: 1500, rbPre: 1700, result: "B" }, 32);
  assert.ok(Math.abs(s1.da - s2.db) < 1e-12);
  assert.ok(Math.abs(s1.db - s2.da) < 1e-12);
});

test("全体等级平移不改变变化量", () => {
  const s1 = step({ raPre: 1500, rbPre: 1600, result: "A" }, 32);
  const s2 = step({ raPre: 500, rbPre: 600, result: "A" }, 32);
  assert.ok(Math.abs(s1.da - s2.da) < 1e-12);
  assert.ok(Math.abs(s1.db - s2.db) < 1e-12);
});

test("双方变化量之和为零（容差内）", () => {
  for (const r of ["A", "D", "B"] as const) {
    const s = step({ raPre: 1234.5, rbPre: 1876.2, result: r }, 32);
    assert.ok(Math.abs(s.da + s.db) < 1e-9);
  }
});

test("独立手算短对局序列：验证公式与舍入时机（不中途四舍五入）", () => {
  // 手算：1500 vs 1500, K=32
  // 场1 A胜: E=0.5, d=16 -> 1516 / 1484
  // 场2 A胜: E_A = 1/(1+10^((1484-1516)/400)) = 1/(1+10^-0.08)
  const s1 = step({ raPre: 1500, rbPre: 1500, result: "A" }, 32);
  const s2 = step({ raPre: s1.raPost, rbPre: s1.rbPost, result: "A" }, 32);
  const e2 = 1 / (1 + Math.pow(10, -0.08));
  assert.ok(Math.abs(s2.ea - e2) < 1e-12);
  assert.ok(Math.abs(s2.raPost - (1516 + 32 * (1 - e2))) < 1e-9);
  // 若场1先四舍五入到整数再算场2，结果会不同（此处 1516/1484 恰好为整数，
  // 改用 K=25 验证：场1后 1512.5/1487.5，四舍五入会破坏精度）
  const t1 = step({ raPre: 1500, rbPre: 1500, result: "A" }, 25);
  const t2full = step({ raPre: t1.raPost, rbPre: t1.rbPost, result: "A" }, 25);
  const t2rounded = step({ raPre: Math.round(t1.raPost), rbPre: Math.round(t1.rbPost), result: "A" }, 25);
  assert.ok(Math.abs(t2full.raPost - t2rounded.raPost) > 1e-6);
});


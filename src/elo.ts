/**
 * Elo 等级分数学内核。纯函数，不接触数据库、不做四舍五入，
 * 内部全程保留 JS number（双精度浮点）精度。
 */

/** 对局结果（甲视角/乙视角实际得分） */
export type MatchResult = 'A_WIN' | 'DRAW' | 'B_WIN';

export const ALL_RESULTS: readonly MatchResult[] = ['A_WIN', 'DRAW', 'B_WIN'];

/** 双方变化量之和允许的公开容差（浮点误差级别，不是业务容差） */
export const DELTA_SUM_TOLERANCE = 1e-9;

export function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * 甲的期望得分 E_A = 1 / (1 + 10^((R_B - R_A)/400))
 * 乙的期望得分 E_B = 1 - E_A，两者从同一对赛前分计算。
 */
export function expectedScores(ratingA: number, ratingB: number): { ea: number; eb: number } {
  const ea = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
  return { ea, eb: 1 - ea };
}

export function scoreOf(result: MatchResult): { sa: number; sb: number } {
  switch (result) {
    case 'A_WIN':
      return { sa: 1, sb: 0 };
    case 'DRAW':
      return { sa: 0.5, sb: 0.5 };
    case 'B_WIN':
      return { sa: 0, sb: 1 };
  }
}

export function isValidResult(v: unknown): v is MatchResult {
  return typeof v === 'string' && (ALL_RESULTS as readonly string[]).includes(v);
}

export interface BeforeAfter {
  ratingABefore: number;
  ratingBBefore: number;
  ea: number;
  eb: number;
  sa: number;
  sb: number;
  deltaA: number;
  deltaB: number;
  ratingAAfter: number;
  ratingBAfter: number;
}

/**
 * 逐场同步更新：R' = R + K(S - E)。
 * 双方必须使用同一对赛前分，不允许先更新一方再带入新分。
 * 同时核对 deltaA + deltaB ≈ 0（在 DELTA_SUM_TOLERANCE 内）。
 */
export function applyGame(
  ratingA: number,
  ratingB: number,
  result: MatchResult,
  k: number,
): BeforeAfter {
  if (!isFiniteNumber(ratingA) || !isFiniteNumber(ratingB)) {
    throw new Error('赛前分必须是有限数');
  }
  if (!isFiniteNumber(k) || k <= 0) {
    throw new Error('K 必须是正的有限数');
  }
  const { ea, eb } = expectedScores(ratingA, ratingB);
  const { sa, sb } = scoreOf(result);
  const deltaA = k * (sa - ea);
  const deltaB = k * (sb - eb);
  if (Math.abs(deltaA + deltaB) > DELTA_SUM_TOLERANCE) {
    throw new Error(
      `双方变化量之和超出容差：${deltaA + deltaB}（容差 ${DELTA_SUM_TOLERANCE}）`,
    );
  }
  return {
    ratingABefore: ratingA,
    ratingBBefore: ratingB,
    ea,
    eb,
    sa,
    sb,
    deltaA,
    deltaB,
    ratingAAfter: ratingA + deltaA,
    ratingBAfter: ratingB + deltaB,
  };
}

/**
 * 仅用于展示的格式化：保留内部浮点精度，展示时按指定小数位四舍五入。
 * 默认 2 位小数（toFixed 使用半入规则）。
 */
export function formatRating(value: number, digits = 2): string {
  if (!isFiniteNumber(value)) throw new Error('无法格式化非有限数');
  if (!Number.isInteger(digits) || digits < 0 || digits > 10) {
    throw new Error('小数位数必须是 0..10 的整数');
  }
  return value.toFixed(digits);
}

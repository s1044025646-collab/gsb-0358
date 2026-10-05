// 纯 Elo 计算核心：不依赖数据库，便于独立测试。
export type Result = "A" | "D" | "B"; // 甲胜 / 平局 / 乙胜

export interface Rules {
  id: number;
  k: number;
  initial: number;
}

export interface StepInput {
  raPre: number;
  rbPre: number;
  result: Result;
}

export interface StepOutput {
  raPre: number;
  rbPre: number;
  ea: number;
  eb: number;
  sa: number;
  sb: number;
  da: number;
  db: number;
  raPost: number;
  rbPost: number;
}

export function scoreOf(result: Result): { sa: number; sb: number } {
  if (result === "A") return { sa: 1, sb: 0 };
  if (result === "B") return { sa: 0, sb: 1 };
  return { sa: 0.5, sb: 0.5 };
}

// 双方必须从同一对赛前值同步计算。
export function step(input: StepInput, k: number): StepOutput {
  const { raPre, rbPre, result } = input;
  const ea = 1 / (1 + Math.pow(10, (rbPre - raPre) / 400));
  const eb = 1 - ea;
  const { sa, sb } = scoreOf(result);
  const da = k * (sa - ea);
  const db = k * (sb - eb);
  return {
    raPre, rbPre, ea, eb, sa, sb, da, db,
    raPost: raPre + da,
    rbPost: rbPre + db,
  };
}

// 展示用格式化；内部计算永不调用。
export function formatRating(x: number, digits = 2): string {
  return x.toFixed(digits);
}

export const DELTA_SUM_TOLERANCE = 1e-9;

export function isValidResult(x: unknown): x is Result {
  return x === "A" || x === "D" || x === "B";
}

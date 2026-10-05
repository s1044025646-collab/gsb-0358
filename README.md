# Elo 逐场等级分更新与历史更正重算后端

面向小型双人竞技活动的 Elo 等级分核算服务。仅提供 **HTTP API 与 CLI**，使用 TypeScript + Node.js + SQLite（Node 内置 `node:sqlite`，零运行时依赖），Windows 本地直接运行，不需要 Docker / WSL / 外部服务。

## 等级分口径（重要）

- 等级分是**相对水平估计**，不是联赛积分，也不是胜场排行。
- 初始分相同（如 1500）只表示"先验相同"，不表示实力相同。
- 期望得分 `E_A = 1/(1+10^((R_B-R_A)/400))` 是在假设模型下的**单场期望**，**不能直接解释为长期胜率保证**；样本量小、对手构成单一时偏差会很大。
- 不实现 Glicko 波动率、分段 K、排名修正等扩展规则。

## 精度约定

- 内部全程保留 IEEE 754 双精度浮点，**绝不在每场之间四舍五入**。
- 仅在展示 / 导出时按指定小数位格式化（默认 2 位）。
- 每场核对双方变化量之和为零（容差 1e-9）。
- 双方必须从**同一对赛前值**同步计算：`R' = R + K(S - E)`。

## 快速开始

```powershell
npm install
npm run build     # 编译 TypeScript
npm test          # 运行全部测试（17 个）
npm run demo      # 演示：1500 vs 1500 K=32 -> 1516/1484，三人多场，更正首场后对比
npm start         # 启动 API（默认自动选择空闲端口；PORT=8080 可指定）
```

数据保存在项目内 `data/` 目录（可用环境变量 `ELO_DATA_DIR` 覆盖），重启后已有版本可继续查询与重算。

## CLI

```powershell
npm run cli -- rules 32 1500                  # 创建规则版本（K 与初始分固定且不可变）
npm run cli -- register P1                    # 登记选手（匿名编号）
npm run cli -- new-version                    # 创建数据版本
npm run cli -- import 1 1 matches.json        # 导入有序对局（原子，失败整体回滚）
npm run cli -- compute 1                      # 核算全历史
npm run cli -- match 1 m1                     # 查询某场前后分数
npm run cli -- standings 1 1                  # 等级分榜
npm run cli -- compare 1 1 P1 P2              # 比较两名选手
npm run cli -- correct 1 ops.json             # 历史更正 -> 生成新版本
npm run cli -- diff 1 2                       # 版本差异定位与传播解释
npm run cli -- export 1 2                     # 导出 CSV 报告（2 位小数）
```

`matches.json` 格式（`seq` 为显式递增序号，**顺序只由 seq 决定**，与时间标签无关）：

```json
[{ "matchId": "m1", "seq": 1, "a": "P1", "b": "P2", "result": "A" }]
```

`result` 仅允许 `"A"`（甲胜）/ `"D"`（平局）/ `"B"`（乙胜）。
`ops.json` 更正操作：`[{"type":"update","matchId":"m1","result":"B"}]` 或 `[{"type":"revoke","matchId":"m1"}]`。

## HTTP API

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/rules` | 创建规则 `{k, initial}` |
| POST | `/players` | 登记选手 `{id}` |
| GET | `/players` | 选手列表 |
| POST | `/versions` | 创建数据版本 `{parentId?, note?}` |
| POST | `/versions/:id/matches` | 导入对局 `{rulesId, matches[]}` |
| POST | `/versions/:id/compute` | 核算全历史 |
| POST | `/versions/:id/correct` | 历史更正 `{ops[], note?}` -> 新版本 |
| GET | `/versions/:id/reports` | 全部逐场报告 |
| GET | `/versions/:id/matches/:matchId` | 某场前后分数 |
| GET | `/versions/:id/standings?rulesId=` | 等级分榜 |
| GET | `/versions/:id/compare?rulesId=&p1=&p2=` | 比较选手 |
| GET | `/versions/:id/export?digits=` | 导出 CSV |
| GET | `/diff?v1=&v2=` | 版本差异定位 |

## 错误码

| 错误码 | 含义 |
|---|---|
| `E_VALIDATION` | 参数非法（含 K / 初始分非有限数或越界） |
| `E_PLAYER_NOT_FOUND` | 未登记选手 |
| `E_DUP_MATCH` / `E_DUP_SEQ` | 重复比赛编号 / 重复序号 |
| `E_SELF_MATCH` | 选手与自己对局 |
| `E_BAD_RESULT` | 结果字段非法 |
| `E_RULE_NOT_FOUND` / `E_VERSION_NOT_FOUND` / `E_MATCH_NOT_FOUND` | 引用不存在 |
| `E_LIMIT` | 超过选手数（1000）或对局数（100000/版本）上限 |

## 历史更正与版本隔离

- 更正（改结果 / 撤销一场）**生成新数据版本**，从受影响位置起全历史重算。
- 旧版本的逐场报告**保持原样**，新旧版本结果不会混在同一张榜中。
- `diff` 定位最早产生差异的比赛，并解释变化如何沿后续对局传播。
- 新增选手只在其首次参赛前拥有初始分，重算不会把所有人按当前分作为起点。

## 假设与限制

- 直观的全历史重算（非增量缓存），规模上限内性能足够。
- 单进程、单 SQLite 文件；不含多租户、账户体系与并行评分集群。
- 不依赖真实系统时间：顺序完全由显式 `seq` 决定。
- `node:sqlite` 在 Node 25 仍标记为 experimental（会有启动警告），如需消除可换成 `better-sqlite3`。

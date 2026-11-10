<div align="center">
  <img alt="logo" width="120" height="120" src="./src/common/assets/images/layouts/logo.jpg">
  <h1>Milkonomy 牛牛经济学</h1>
  <p>银河放置（Milky Way Idle）利润计算与多步配方工具站</p>
</div>

## 项目介绍

Milkonomy 是一个为放置游戏 **银河放置（Milky Way Idle）** 打造的利润计算工具站。它会自动拉取游戏市场数据，计算生产、采集、炼金、强化等动作的期望收益，并把这些单步动作拼接成可复用的多步配方。

本仓库是 **gcaxe 基于 [polokikiki/Milkonomy](https://github.com/polokikiki/Milkonomy) 的二次开发测试版**，重点新增了多步利润蓝图、税前/税后多步配方推荐、强化节点与配方码等功能。原项目由 [luyh7](https://github.com/luyh7) 创建。

- 在线使用：<https://gcaxe.github.io/milkonomy-test/>
- 上游项目：<https://github.com/polokikiki/Milkonomy>
- 项目状态：测试版；修 Bug 的优先级低于实现新功能。

## 功能

### 单步利润

- 利润排行：锻造、制造、裁缝、烹饪、冲泡、炼金、强化、三采集的每小时/每日期望收益。
- 逐级制作 / 目标材质：按技能显示材质制作链，筛选从什么材质做到什么材质。
- 炼金工具：点金、分解、转化、贤者路径、超级炼金等独立页面。
- 强化工具：强化模拟、强化姿态、强化分解、打野（强化/继承/挑品/超级打野）。

### 多步工具

- **多步利润蓝图**：用节点图描述一条完整产业链。
  - 紫色「处理方式」节点：三造二厨 / 炼金，确定配方后自动生成输入输出节点。
  - 红色「原料」节点：购买 / 三采集 / 来自背包。
  - 绿色「产物」节点：出售 / 保留于背包。
  - 红绿相连合并为蓝色节点；存在跨链共享时使用彩虹节点。
  - 橙色「强化」节点：选择 +0 装备、目标等级、保护物品、从几级开始保护；成本按强化计算页「材料费用」同口径。
  - 自动配平、工时占比、药品/茶消耗、自定义价格、NPC 购买价。
- **税前多步配方推荐**：按首页单步日利润自动拼接多步路线，支持树/图拓扑、炼金与三造混拼、双向 DFS 去重、搜索量/计时器、排除物品、分页。
- **税后多步配方推荐**：复用税前结果，按「红色只能购买、绿色只能计税出售」重新计算并排序。
- **多步路线体检**：把一条已保存的多步配方拆成「满负荷日利润 + 时间占比 + 折算日贡献」，重点看亏损步骤是不是只是成本中心；同时给出最终叶子的日产出、成交量覆盖率和产能判断。
- **配方码**：把整张图压成可复制的字符串，`#` 之后可写注释；支持税前/税后两套配方码。

### 其他

- 自定义价格与首页同步；「来自背包」按税后机会成本计价。
- 中 / 繁 / 英三语界面；数据更新、部署、行情快照全部由 GitHub Actions 自动完成。
- 访问统计：Vercount 提供总访问量 / 访客数；截至 2026-11-04，总访问量 312、访客数 153。

## 我做了什么

本仓库相对上游的主要工作：

- 设计并实现多步利润蓝图的节点模型、连线规则、红绿蓝/彩虹节点、强化节点、自动配平与配方码。
- 设计并实现税前/税后多步配方推荐的搜索、去重、剪枝、搜索量控制、排除物品与结果展示。
- 设计并实现多步路线体检：分步满负荷利润、时间占比、折算贡献、最终叶子产能覆盖率，用来解释“负利润步骤为什么可能是必要的”。
- 统一多步与首页的计算口径：4% 卖出税、金币免税、催化剂仅在成功时消耗、稀有/精华掉落每次行动判定、强化用马尔可夫链求期望。
- 完成 GitHub Actions 数据更新/部署、行情快照、访问统计等工程化工作。
- 开发方式：把需求拆成 `task` 文档，由 AI 编程助手实现，再用构建、类型检查、线上页面和实际配方逐项验收；实现记录写在 `answer` 文档中。这个仓库也是这套「AI 辅助、人做设计与验收」工作流的实践。

## 技术栈

Vue 3 + TypeScript ｜ Vite ｜ Element Plus ｜ Pinia ｜ Vue Router ｜ UnoCSS + SCSS ｜ pnpm

## 计算口径（重要）

- **价格**：买入用市场 best ask，卖出用 best bid；卖出税 4%，金币免税。
- **来自背包**：按 `市场价 × (1 − 4%)` 计机会成本；「保留于背包」不计税。
- **炼金**：点金基础成功率 70%，分解 60%，转化按物品；催化剂只在成功时消耗；稀有掉落、精华掉落每次行动都判定（失败也给）。
- **强化**：按强化等级成功率表与保护/逃逸规则建立马尔可夫链，求期望次数、保护次数与目标等级概率。
- **多步**：中间产物在链内按 0 价转移，只有叶子产物计税。因此多步报表里的「利润率」是**相对外部投入的加成率**，不是包含中间品资金占用的投资回报率；做资金规划时，请把中间品按税后市场价计入机会成本。

## 项目结构

```text
milkonomy/
  .github/workflows/     自动部署、数据更新、行情快照流水线
  public/
    data/                游戏基础数据、市场快照
    sprites/             游戏图标精灵图
    media/               音频等媒体文件
  scripts/
    fetch_game_data.py   抓取游戏基础数据
    trans-convert/       翻译转换工具
    update-version.ts    自动更新版本号
  src/
    calculator/          核心计算逻辑
      index.ts           计算基类：成本、收入、税率、效率、风险
      manufacture.ts     三造二厨
      alchemy.ts         点金 / 分解 / 转化
      enhance.ts         强化马尔可夫链与强化+分解
      gather.ts          三采集
      workflow.ts        多步工作流
    common/
      apis/              游戏数据、市场、玩家配置、排行榜、打野数据
      assets/            图片、图标、样式
      components/        可复用组件
      config/            全局配置、公告
      utils/             格式化、校验、缓存等
    pages/
      dashboard/         首页利润排行
      multistep/         多步蓝图、路线体检、税前/税后推荐、配方码、图计算
      jungle/            打野工具
      manualchemy/       手动炼金
      enhancer/          强化模拟
      sponsor/           致谢页
      changelog/         更新日志
    locales/             中 / 繁 / 英翻译
    pinia/               全局状态
    router/              路由
  tests/                 单元测试
  types/                 TypeScript 类型
  index.html
  vite.config.ts
```

## 本地开发

```bash
pnpm install
pnpm dev          # 本地开发
pnpm build        # 类型检查 + 构建
pnpm lint         # ESLint
pnpm test         # Vitest
```

## 数据更新

- `scripts/fetch_game_data.py`：抓取游戏基础数据。
- `.github/workflows/update-data.yml`：定时更新 `public/data/data.json`。
- `.github/workflows/update-market.yml`：每小时抓取官方 `marketplace.json`，并在 `gh-pages` 生成：
  - `data/market.json`：当前行情快照；
  - `data/vol-history.json`：最近 25 小时成交量；
  - `data/price-history.json`：最近 14 天价格；
  - `data/market-median.json`：近 14 天 ask/bid 滚动中位数。
- `.github/workflows/deploy.yml`：构建并部署到 GitHub Pages。

## 如何继续开发

- **新增单步配方**：优先改数据与 `src/calculator` 中对应的计算器；配方主要来自 `public/data/data.json`，不要把配方硬编码进页面。
- **新增多步节点**：`src/pages/multistep/utils/recipes.ts` 负责配方解析，`composables/useMultistepGraph.ts` 负责图与配平，`utils/recommend.ts` 负责推荐搜索。
- **新增语言**：在 `src/locales/lang/` 下补 key；页面统一使用 `t()`。
- **新增数据源**：在 `.github/workflows/` 里加抓取/快照步骤，前端通过 `public/data/` 同源读取，避免跨域。
- **调试推荐搜索**：先用较小的「最大搜索量」和「最大加工次数」复现，再逐步放大；搜索结果受行情快照影响，换行情后需要重新计算。

## 已知限制

- 价格是市场快照的 best ask/bid，不包含订单簿深度、成交延迟与大额滑点；大资金实盘会低估成本。
- 收益是期望值，未做方差/风险调整；转化、强化这类偏斜分布只看利润率会高估「体感收益」。
- 战斗收益未计算；食物、咖啡、地下城门票/宝箱钥匙只作为战斗玩家的需求侧输入。
- 解精炼未纳入利润计算（通常不划算，打野工具会单独展示捡漏）。
- 多步推荐是启发式搜索，不保证全局最优。

## 致谢

- 原作者：[luyh7](https://github.com/luyh7)
- 中文版维护：hyhfish、[polokiki](https://github.com/polokikiki)
- 所有提供反馈、测试、配方与数据的玩家

本项目与游戏官方无关，不提供任何收款方式。

## 许可

[MIT](./LICENSE) License

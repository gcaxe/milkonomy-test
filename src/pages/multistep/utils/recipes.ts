import type { GraphNode } from "../types"
import type { Action } from "~/game"
import { CoinifyCalculator, DecomposeCalculator, TransmuteCalculator } from "@/calculator/alchemy"
import { EnhanceCalculator } from "@/calculator/enhance"
import { ManufactureCalculator } from "@/calculator/manufacture"
import { getActionDetailOf, getAlchemyEssenceDropTable, getAlchemyRareDropTable, getCoinifyTimeCost, getDecomposeTimeCost, getGameDataApi, getTransmuteTimeCost } from "@/common/apis/game"
import { getTrans } from "@/locales"
import { COIN_HRID } from "@/pinia/stores/game"

/** A 类覆盖的动作（三造二厨：锻造/制造/裁缝 + 烹饪/冲泡） */
const A_ACTION_LIST: Action[] = ["cheesesmithing", "crafting", "tailoring", "cooking", "brewing"]
/** 三采集动作 */
const GATHER_ACTION_LIST: Action[] = ["milking", "foraging", "woodcutting"]
/** 炼金动作 key（B 类） */
export type AlchemyActionKey = "coinify" | "decompose" | "transmute"

/** 产出该物品的 A 类动作（唯一配方）；含冲泡产茶/咖啡等全部配方。返回 null=无唯一配方 */
export function findProducingActionOf(hrid: string): string | null {
  const gameData = getGameDataApi()
  const hits: string[] = []
  for (const actionHrid of Object.keys(gameData.actionDetailMap)) {
    if (!A_ACTION_LIST.some(a => actionHrid.startsWith(`/actions/${a}/`))) continue
    const detail = gameData.actionDetailMap[actionHrid]
    if (!detail.outputItems?.some(o => o.itemHrid === hrid)) continue
    hits.push(actionHrid)
  }
  return hits.length === 1 ? hits[0] : null
}

/**
 * 该物品可用的三采集动作（挤奶/采摘/伐木）；空数组=只能购买。
 * 注意：采集动作的产物在 dropTable（不是 outputItems），与 GatherCalculator 一致
 */
export function getGatherActionsOf(hrid: string): string[] {
  const gameData = getGameDataApi()
  if (!gameData || !hrid) return []
  return Object.keys(gameData.actionDetailMap)
    .filter(k => GATHER_ACTION_LIST.some(a => k.startsWith(`/actions/${a}/`))
      && (gameData.actionDetailMap[k].outputItems?.some(o => o.itemHrid === hrid)
        || gameData.actionDetailMap[k].dropTable?.some(d => d.itemHrid === hrid)))
}

/** 该物品可用的炼金动作（点金/分解/转化）；依据 AlchemyDetail 判定（与 alchemy.ts 的 available 一致） */
export function getAlchemyActionOptionsOf(hrid: string): { key: AlchemyActionKey, actionHrid: string }[] {
  const item = getGameDataApi().itemDetailMap[hrid]
  if (!item) return []
  const result: { key: AlchemyActionKey, actionHrid: string }[] = []
  if (item.alchemyDetail?.isCoinifiable) result.push({ key: "coinify", actionHrid: "/actions/alchemy/coinify" })
  if (item.alchemyDetail?.decomposeItems != null) result.push({ key: "decompose", actionHrid: "/actions/alchemy/decompose" })
  if (item.alchemyDetail?.transmuteDropTable != null) result.push({ key: "transmute", actionHrid: "/actions/alchemy/transmute" })
  return result
}

/** B 类催化剂：0无 1普通 2至高；普通催化剂按动作区分 hrid，至高统一 prime_catalyst */
export function getCatalystHridOf(actionKey: AlchemyActionKey, rank: 0 | 1 | 2): string | null {
  if (rank === 0) return null
  if (rank === 2) return "/items/prime_catalyst"
  return {
    coinify: "/items/catalyst_of_coinification",
    decompose: "/items/catalyst_of_decomposition",
    transmute: "/items/catalyst_of_transmutation"
  }[actionKey]
}

/** 一次配方解析的输入输出描述 */
export interface ResolvedRecipe {
  /** 输入项：只包含需要连线的物品（金币/茶不在此列） */
  inputs: { hrid: string, auto: boolean }[]
  /** 输出项（每个产物一个绿色节点） */
  outputs: string[]
}

/** 解析 A 类配方：主产物 + 唯一动作 */
export function resolveRecipeA(actionHrid: string): ResolvedRecipe {
  const detail = getActionDetailOf(actionHrid)
  // 茶不参与 pin 展示（不生成输入 pin），配方计算时另行补正
  const inputs = [
    ...(detail.upgradeItemHrid ? [{ hrid: detail.upgradeItemHrid, auto: false }] : []),
    ...(detail.inputItems || []).map(i => ({ hrid: i.itemHrid, auto: false }))
  ]
  const outputs = [
    ...(detail.outputItems || []).map(o => o.itemHrid),
    ...(detail.essenceDropTable || []).map(d => d.itemHrid),
    ...(detail.rareDropTable || []).map(d => d.itemHrid)
  ]
  return { inputs, outputs }
}

/**
 * 平凡产物：本处理方式的精华掉落 + 稀有掉落（大中小工匠匣/宝箱/陨石仓、
 * 专精之线/精通之油/洞察之枝等）。可被「不显示平凡产物」隐藏，利润照常计算。
 */
export function getMundaneProductHridsOf(node: { funcClass?: string, actionHrid?: string, mainItemHrid?: string }): string[] {
  if (!node.actionHrid) return []
  if (node.funcClass === "A") {
    const detail = getActionDetailOf(node.actionHrid)
    return [
      ...(detail.essenceDropTable || []).map(d => d.itemHrid),
      ...(detail.rareDropTable || []).map(d => d.itemHrid)
    ]
  }
  // B 类：稀有掉落与炼金精华按物品等级/耗时动态生成（与 resolveRecipeB 同源）
  const item = getGameDataApi().itemDetailMap[node.mainItemHrid ?? ""]
  if (!item) return []
  const actionKey = node.actionHrid.split("/").pop() as AlchemyActionKey
  const timeCost = actionKey === "transmute"
    ? getTransmuteTimeCost()
    : actionKey === "decompose" ? getDecomposeTimeCost() : getCoinifyTimeCost()
  return [
    ...getAlchemyRareDropTable(item, timeCost).map(d => d.itemHrid),
    ...getAlchemyEssenceDropTable(item, timeCost).map(d => d.itemHrid)
  ]
}

/** 解析 B 类配方：主原料 + 炼金动作 + 催化剂等级 */
export function resolveRecipeB(mainItemHrid: string, actionKey: AlchemyActionKey, catalystRank: 0 | 1 | 2): ResolvedRecipe {
  const item = getGameDataApi().itemDetailMap[mainItemHrid]
  const catalyst = getCatalystHridOf(actionKey, catalystRank)
  // 金币与茶不生成输入 pin（自动消耗、不连线），输入 pin 只保留需要连线的物品
  const inputs = [
    { hrid: mainItemHrid, auto: false },
    ...(catalyst ? [{ hrid: catalyst, auto: false }] : [])
  ]
  // 稀有掉落（工匠匣）与炼金精华不在动作数据里：
  // 与首页计算器同源，按物品等级/耗时动态生成（DecomposeCalculator 的 productList 逻辑）
  const timeCost = actionKey === "transmute"
    ? getTransmuteTimeCost()
    : actionKey === "decompose" ? getDecomposeTimeCost() : getCoinifyTimeCost()
  const outputs = [
    ...(actionKey === "transmute"
      ? (item.alchemyDetail.transmuteDropTable || []).map(d => d.itemHrid)
      : actionKey === "decompose"
        ? (item.alchemyDetail.decomposeItems || []).map(d => d.itemHrid)
        : [COIN_HRID]),
    ...getAlchemyRareDropTable(item, timeCost).map(d => d.itemHrid),
    ...getAlchemyEssenceDropTable(item, timeCost).map(d => d.itemHrid)
  ]
  return { inputs, outputs }
}

// ===================== 函数节点输出 pin（按配方顺序） =====================

/** 输出 pin 描述：mundane=平凡产物（稀有/精华掉落，可被隐藏） */
export interface FuncOutputPin {
  hrid: string
  level: number
  mundane: boolean
}

/**
 * 构造某函数节点对应的首页计算器实例（数量/耗时口径与首页一致）。
 * mainLevel = 主输入 pin 上连线物品的强化等级：
 *  - A 类：originLevel（继承 0.7 倍强化等级，精炼装备保留原等级）
 *  - B 类分解：enhanceLevel（成功额外产出强化精华）
 */
export function buildMultistepCalculator(n: GraphNode, mainLevel: number = 0) {
  if (n.funcClass === "C") return null
  const cfg = { hrid: n.mainItemHrid!, project: getTrans("处理方式"), catalystRank: n.catalystRank ?? 0 }
  if (n.funcClass === "A") {
    const action = n.actionHrid!.split("/")[2] as Action
    return new ManufactureCalculator({ ...cfg, action, originLevel: mainLevel })
  }
  const key = n.actionHrid!.split("/").pop()
  if (key === "coinify") return new CoinifyCalculator(cfg)
  if (key === "transmute") return new TransmuteCalculator(cfg)
  return new DecomposeCalculator({ ...cfg, enhanceLevel: mainLevel })
}

/**
 * 函数节点的输出 pin 列表（按配方顺序，与首页计算器 productList 同序，含强化等级）。
 * 直接由计算器 productList 派生：A 类继承拆分（0.8×+3 / 0.2×+2）、分解的强化精华都会
 * 以独立 pin 出现；平凡产物 = 主要产物之后的掉落条目。
 */
export function getFuncOutputPins(node: GraphNode, mainLevel: number = 0): FuncOutputPin[] {
  if (node.funcClass === "C") {
    if (!node.mainItemHrid || node.enhanceLevel == null) return []
    return [{ hrid: node.mainItemHrid, level: node.enhanceLevel, mundane: false }]
  }
  const calc = buildMultistepCalculator(node, mainLevel)
  if (!calc) return []
  // 非平凡（主要产物）条目数：
  // A：目标等级为整数时=outputItems 数量；小数拆分时=2（floor/ceil 两条）
  // B：分解=（强化精华?1:0）+decomposeItems；转化=transmuteDropTable；点金=1
  let mainCount: number
  if (node.funcClass === "A") {
    const detail = getActionDetailOf(node.actionHrid!)
    const target = (calc as ManufactureCalculator).targetLevel
    mainCount = target % 1 === 0 ? (detail.outputItems?.length ?? 1) : 2
  } else if (node.actionHrid!.split("/").pop() === "decompose") {
    const item = getGameDataApi().itemDetailMap[node.mainItemHrid!]
    mainCount = (mainLevel > 0 ? 1 : 0) + (item.alchemyDetail.decomposeItems?.length ?? 0)
  } else if (node.actionHrid!.split("/").pop() === "transmute") {
    const item = getGameDataApi().itemDetailMap[node.mainItemHrid!]
    mainCount = item.alchemyDetail.transmuteDropTable?.length ?? 0
  } else {
    mainCount = 1
  }
  return calc.productList.map((p, i) => ({
    hrid: p.hrid,
    level: p.level ?? 0,
    mundane: i >= mainCount
  }))
}

// ===================== NPC 购买 =====================

/** NPC 固定价格购买：5000 价的奶酪武器/木制武器/十件奶酪工具；250000 价的 17 种实习护符 */
export const NPC_PRICE_MAP: Record<string, number> = {
  // 武器（5000）
  "/items/cheese_sword": 5000,
  "/items/cheese_hammer": 5000,
  "/items/cheese_spear": 5000,
  "/items/wooden_bow": 5000,
  "/items/wooden_crossbow": 5000,
  "/items/wooden_water_staff": 5000,
  "/items/wooden_nature_staff": 5000,
  "/items/wooden_fire_staff": 5000,
  // 奶酪刷子到奶酪强化器共 10 件工具（5000）
  "/items/cheese_brush": 5000,
  "/items/cheese_shears": 5000,
  "/items/cheese_hatchet": 5000,
  "/items/cheese_chisel": 5000,
  "/items/cheese_needle": 5000,
  "/items/cheese_pot": 5000,
  "/items/cheese_spatula": 5000,
  "/items/cheese_alembic": 5000,
  "/items/cheese_enhancer": 5000,
  // 实习护符 17 种（250000）
  "/items/trainee_alchemy_charm": 250000,
  "/items/trainee_attack_charm": 250000,
  "/items/trainee_brewing_charm": 250000,
  "/items/trainee_cheesesmithing_charm": 250000,
  "/items/trainee_cooking_charm": 250000,
  "/items/trainee_crafting_charm": 250000,
  "/items/trainee_defense_charm": 250000,
  "/items/trainee_enhancing_charm": 250000,
  "/items/trainee_foraging_charm": 250000,
  "/items/trainee_intelligence_charm": 250000,
  "/items/trainee_magic_charm": 250000,
  "/items/trainee_melee_charm": 250000,
  "/items/trainee_milking_charm": 250000,
  "/items/trainee_ranged_charm": 250000,
  "/items/trainee_stamina_charm": 250000,
  "/items/trainee_tailoring_charm": 250000,
  "/items/trainee_woodcutting_charm": 250000
}

/** 该物品的 NPC 固定价格；不在列表返回 null（无 NPC 购买选项） */
export function getNpcPriceOf(hrid: string): number | null {
  return NPC_PRICE_MAP[hrid] ?? null
}

// ===================== C 类：强化节点 =====================

/** 强化节点的保护物品选项：由被强化物品决定 + 贤者之镜（任何强化都可使用保护之镜作为保护材料） */
export function getProtectionOptionsOf(hrid: string): { hrid: string, label: string }[] {
  const item = getGameDataApi().itemDetailMap[hrid]
  if (!item) return []
  const hrids = [
    ...(item.protectionItemHrids?.length ? item.protectionItemHrids : [hrid]),
    "/items/mirror_of_protection"
  ]
  return hrids.map(p => ({ hrid: p, label: getTrans(getGameDataApi().itemDetailMap[p]?.name ?? p) }))
}

/** 强化节点解析结果：一次「整件 0→x 强化」为一批 */
export interface EnhanceRecipeInfo {
  /** 期望强化次数（一件 0→x） */
  actions: number
  /** 期望保护次数 */
  protects: number
  /** 每批（一件）的输入：数量已按期望次数折算 */
  inputs: { hrid: string, count: number, auto: boolean, level: number, position: "top" | "left" | "right" }[]
  /** 每批的输出 */
  outputs: { hrid: string, count: number, level: number }[]
  /** 每批耗时 ns（= 期望次数 × 单次有效耗时 / 效率） */
  timeCost: number
}

/** 解析 C 类（强化）配方：材料数量 × 期望次数（与强化计算页「材料费用」同口径：工时费 0） */
export function resolveEnhanceRecipe(node: GraphNode): EnhanceRecipeInfo {
  const gear = node.mainItemHrid!
  const x = node.enhanceLevel!
  const y = node.protectLevel!
  const item = getGameDataApi().itemDetailMap[gear]
  const calc = new EnhanceCalculator({ hrid: gear, enhanceLevel: x, protectLevel: y, originLevel: 0 })
  const { actions, protects } = calc.enhancelate()

  const inputs: EnhanceRecipeInfo["inputs"] = [
    // 正上方：被强化物品（+0 本体）
    { hrid: gear, count: 1, auto: false, level: 0, position: "top" },
    // 正左侧：强化材料（多种，含金币；金币自动供给）
    ...(item.enhancementCosts || []).map(c => ({
      hrid: c.itemHrid,
      count: c.count * actions,
      auto: c.itemHrid === COIN_HRID,
      level: 0,
      position: "left" as const
    })),
    // 正右侧：保护材料（+x 即不保护，无此输入）
    ...(y < x && node.protectionHrid
      ? [{ hrid: node.protectionHrid, count: protects, auto: false, level: 0, position: "right" as const }]
      : [])
  ]
  const outputs = [{ hrid: gear, count: 1, level: x }]
  return { actions, protects, inputs, outputs, timeCost: actions * calc.effectiveTimeCost / calc.efficiency }
}

import type { GraphNode } from "../types"
import type { Action } from "~/game"
import { EnhanceCalculator } from "@/calculator/enhance"
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

import type { GraphNode, GraphWire, MultistepPlan, UpupItemRow } from "../types"
import { CoinifyCalculator, DecomposeCalculator, TransmuteCalculator } from "@/calculator/alchemy"
import { ManufactureCalculator } from "@/calculator/manufacture"
import { getGameDataApi } from "@/common/apis/game"
import { NO_TAX_FACTOR } from "@/common/constants/market"
import { getTrans } from "@/locales"
import { useGameStore } from "@/pinia/stores/game"
import { usePlayerStore } from "@/pinia/stores/player"
import { balanceAndMutate, type BalanceStep } from "./balance"
import { type AlchemyActionKey, findProducingActionOf, getFuncOutputPins, resolveRecipeA, resolveRecipeB } from "./recipes"

/**
 * 税前多步配方推荐引擎。
 * 单步 = 首页「利润排行」的全部不考虑税率的单步配方（三造二厨 + 炼金，不含强化/采集——多步蓝图只用紫节点）。
 * 按税前日利润分 I 类（≥阈值）/ II 类（<阈值，日利润 -1 表示无交易量，忽略）。
 * 多步 = 用任意数量的 I 类单步 + 至多 maxII 个 II 类单步拼接成树（红绿合并连通），
 * 搜索为双向增长（原料向下接供应商 / 根产物向上接消费者）+ 全局去重的最优优先 DFS，
 * 计算其税前利润并归一化到「1 个最终产物」。
 */

export interface SingleStep {
  id: string
  funcClass: "A" | "B"
  mainItemHrid: string
  actionHrid: string
  catalystRank: 0 | 1 | 2
  /** 税前日利润（profitPH × 24） */
  dailyProfit: number
  isClassI: boolean
  /** 非平凡产物（勾选「不显示平凡产物」后可红绿合并的物品） */
  products: string[]
  /** 需要连线的原料 */
  ingredients: string[]
  label: string
}

export interface RecommendOptions {
  /** 日利润阈值（元，用户输入的 M 已换算） */
  threshold: number
  /** 最多检索的负/低利润路径数量（II 类单步上限，0-5） */
  maxII: number
  /** 单条路径（根到叶）最多包含的紫（加工）节点数量（2-15，默认 7） */
  maxPurpleNodes: number
  /** 利润率下限（0-1000，%），筛选最终结果 */
  profitRateMin: number
  /** 任何一步都不能有装备参与 */
  excludeEquipment: boolean
  /** 任何一步都不能有护符参与 */
  excludeCharms: boolean
  /** 排除的物品：不会作为原料进入多步路线（作为产物仍可出现） */
  excludeItems?: string[]
}

export interface ChainSpec {
  step: SingleStep
  /** 原料 → 供应商子链（无供应商 = 购买） */
  suppliers: Map<string, ChainSpec>
}

export interface RecommendResult {
  startItem: string
  finalItem: string
  profitPD: number
  profitPH: number
  profitRate: number
  profitPerUnit: number
  plan: MultistepPlan
  steps: BalanceStep[]
}

/** 物品是否装备/护符（排除筛选用） */
function isEquipmentOf(hrid: string): boolean {
  const item = getGameDataApi().itemDetailMap[hrid]
  return !!item?.equipmentDetail
}
function isCharmOf(hrid: string): boolean {
  const item = getGameDataApi().itemDetailMap[hrid]
  return item?.equipmentDetail?.type === "/equipment_types/charm"
}

let _stepsCache: { key: string, steps: SingleStep[] } | null = null

/** 收集首页全部不考虑税率的单步配方（与利润排行同源：三造二厨 + 炼金×催化剂，不含强化/采集） */
export function collectSingleSteps(): SingleStep[] {
  const gameData = getGameDataApi()
  const cacheKey = `${useGameStore().marketData?.timestamp ?? 0}-${usePlayerStore().configVersion}`
  if (_stepsCache?.key === cacheKey) return _stepsCache.steps

  const steps: SingleStep[] = []
  for (const item of Object.values(gameData.itemDetailMap)) {
    const hrid = item.hrid
    // 炼金：点金/分解/转化 × 催化剂 0/1/2
    for (let rank = 0 as 0 | 1 | 2; rank <= 2; rank++) {
      const alchemy: { key: AlchemyActionKey, calc: TransmuteCalculator | DecomposeCalculator | CoinifyCalculator }[] = []
      if (item.alchemyDetail?.transmuteDropTable != null) {
        alchemy.push({ key: "transmute", calc: new TransmuteCalculator({ hrid, catalystRank: rank, includeRare: true, sellTaxFactor: NO_TAX_FACTOR }) })
      }
      if (item.alchemyDetail?.decomposeItems != null) {
        alchemy.push({ key: "decompose", calc: new DecomposeCalculator({ hrid, catalystRank: rank, includeRare: true, sellTaxFactor: NO_TAX_FACTOR }) })
      }
      if (item.alchemyDetail?.isCoinifiable) {
        alchemy.push({ key: "coinify", calc: new CoinifyCalculator({ hrid, catalystRank: rank, includeRare: true, sellTaxFactor: NO_TAX_FACTOR }) })
      }
      for (const { key, calc } of alchemy) {
        if (!calc.available || !calc.valid) continue
        if (!calc.result) calc.run()
        if (!calc.result) continue
        const actionHrid = `/actions/alchemy/${key}`
        const daily = calc.result.profitPH * 24
        if (daily === -1) continue // 无交易量，忽略
        const nodeLike = { funcClass: "B" as const, mainItemHrid: hrid, actionHrid, catalystRank: rank }
        steps.push({
          id: `B-${hrid}-${key}-${rank}`,
          funcClass: "B",
          mainItemHrid: hrid,
          actionHrid,
          catalystRank: rank,
          dailyProfit: daily,
          isClassI: false,
          // 转化的自产条目（sameItem 返还，count=0）不是净产物，排除以免合并时 0 除产生 NaN
          products: getFuncOutputPins(nodeLike, 0)
            .filter(p => !p.mundane && !(key === "transmute" && p.hrid === hrid))
            .map(p => p.hrid),
          ingredients: resolveRecipeB(hrid, key, rank).inputs.map(i => i.hrid),
          label: `${getTrans(key === "coinify" ? "点金" : key === "decompose" ? "分解" : "转化")}${rank === 1 ? getTrans(" · 普通催化剂") : rank === 2 ? getTrans(" · 至高催化剂") : ""}`
        })
      }
    }
    // 三造二厨：唯一产物配方
    const actionHrid = findProducingActionOf(hrid)
    if (actionHrid) {
      const action = actionHrid.split("/")[2] as any
      const calc = new ManufactureCalculator({ hrid, project: getTrans("处理方式"), action, includeRare: true, sellTaxFactor: NO_TAX_FACTOR })
      if (calc.available && calc.valid) {
        if (!calc.result) calc.run()
        if (calc.result) {
          const daily = calc.result.profitPH * 24
          if (daily !== -1) {
            const nodeLike = { funcClass: "A" as const, mainItemHrid: hrid, actionHrid, catalystRank: 0 as const }
            steps.push({
              id: `A-${hrid}-${action}`,
              funcClass: "A",
              mainItemHrid: hrid,
              actionHrid,
              catalystRank: 0,
              dailyProfit: daily,
              isClassI: false,
              products: getFuncOutputPins(nodeLike, 0).filter(p => !p.mundane).map(p => p.hrid),
              ingredients: resolveRecipeA(actionHrid).inputs.map(i => i.hrid),
              label: getTrans(action)
            })
          }
        }
      }
    }
  }
  _stepsCache = { key: cacheKey, steps }
  return steps
}

/** 构建蓝图并配平评估一条多步链（红节点全部购买、绿节点全部保留于背包 → 税前口径） */
export function evaluateChain(chain: ChainSpec): RecommendResult | null {
  const built = buildPlanForChain(chain)
  const result = balanceAndMutate(built.nodes, built.wires, built.rows)
  if (!result.driver || result.hourlyProfit == null) return null
  const finalGreen = built.nodes.find(n => n.kind === "var" && n.varKind === "green" && n.hrid === built.finalItem)
  const finalQ = finalGreen?.count ?? 0
  if (finalQ <= 0) return null
  return {
    startItem: built.startItem,
    finalItem: built.finalItem,
    profitPD: result.hourlyProfit * 24,
    profitPH: result.hourlyProfit,
    profitRate: result.profitRate,
    profitPerUnit: result.profit / finalQ,
    plan: { name: "", rows: built.rows, nodes: built.nodes, wires: built.wires, savedAt: Date.now() },
    steps: result.steps
  }
}

function buildPlanForChain(root: ChainSpec): { nodes: GraphNode[], wires: GraphWire[], rows: UpupItemRow[], startItem: string, finalItem: string } {
  let nodes: GraphNode[] = []
  let wires: GraphWire[] = []
  let rows: UpupItemRow[] = []
  let seqN = 0
  let seqW = 0
  let seqR = 0
  const leafReds: { hrid: string, redId: string }[] = []

  function buildStep(spec: ChainSpec): Map<string, string> {
    const step = spec.step
    const func: GraphNode = {
      id: `f${++seqN}`,
      kind: "func",
      funcClass: step.funcClass,
      hrid: "",
      mainItemHrid: step.mainItemHrid,
      actionHrid: step.actionHrid,
      catalystRank: step.catalystRank,
      x: 0,
      y: 0
    }
    nodes.push(func)
    // 原料：全部建购买红节点（有供应商的随后与供应商产物绿合并为蓝）
    const inputPins = step.funcClass === "A"
      ? resolveRecipeA(step.actionHrid).inputs
      : resolveRecipeB(step.mainItemHrid, step.actionHrid.split("/").pop() as AlchemyActionKey, step.catalystRank).inputs
    inputPins.forEach((inp, i) => {
      const pinId = `${func.id}:in:${i === 0 ? "main" : i}`
      const uid = ++seqR
      rows.push({ uid, hrid: inp.hrid, count: 1 })
      const red: GraphNode = {
        id: `r${++seqN}`,
        kind: "var",
        varKind: "red",
        hrid: inp.hrid,
        level: 0,
        count: 1,
        rowUid: uid,
        obtain: "buy",
        x: 0,
        y: 0
      }
      nodes.push(red)
      wires.push({ id: `w${++seqW}`, fromPinId: `${red.id}:out:main`, toPinId: pinId })
      const supplier = spec.suppliers.get(inp.hrid)
      if (supplier) {
        const greenIds = buildStep(supplier)
        const greenId = greenIds.get(inp.hrid)
        if (greenId) mergeIntoBlue(red.id, greenId)
      } else {
        leafReds.push({ hrid: inp.hrid, redId: red.id })
      }
    })
    // 产物：全部输出 pin 都生成绿节点（含平凡产物——蓝图加载后每个 pin 都需连线，否则会被不变量维护回退成无连线图）；
    // 绿节点全部保留于背包（税前口径）。搜索拼接只认非平凡产物（勾选「不显示平凡产物」后能红绿合并的部分）。
    const outputs = getFuncOutputPins(
      { funcClass: step.funcClass, mainItemHrid: step.mainItemHrid, actionHrid: step.actionHrid, catalystRank: step.catalystRank },
      0
    )
    const greenIds = new Map<string, string>()
    outputs.forEach((out, i) => {
      const pinId = `${func.id}:out:${i === 0 ? "main" : i}`
      const green: GraphNode = {
        id: `g${++seqN}`,
        kind: "var",
        varKind: "green",
        hrid: out.hrid,
        level: out.level,
        sellMode: "keep",
        x: 0,
        y: 0
      }
      nodes.push(green)
      wires.push({ id: `w${++seqW}`, fromPinId: pinId, toPinId: `${green.id}:in:main` })
      // 同名产物（如分解的两种炼金精华）只记录第一个（主要产物）用于合并
      if (!greenIds.has(out.hrid)) greenIds.set(out.hrid, green.id)
    })
    return greenIds
  }

  /** 供应商产物绿 + 消费者购买红 → 合并为蓝（与蓝图规则一致） */
  function mergeIntoBlue(redId: string, greenId: string) {
    const green = nodes.find(n => n.id === greenId)
    const red = nodes.find(n => n.id === redId)
    if (!green || !red) return
    const greenInWire = wires.find(w => w.toPinId === `${green.id}:in:main`)
    const redOutWires = wires.filter(w => w.fromPinId === `${red.id}:out:main`)
    const redRowUid = red.rowUid
    wires = wires.filter(w =>
      !w.fromPinId.startsWith(`${green.id}:`) && !w.toPinId.startsWith(`${green.id}:`)
      && !w.fromPinId.startsWith(`${red.id}:`) && !w.toPinId.startsWith(`${red.id}:`))
    nodes = nodes.filter(n => n.id !== green.id && n.id !== red.id)
    rows = rows.filter(r => r.uid !== redRowUid)
    const blue: GraphNode = {
      id: `b${++seqN}`,
      kind: "var",
      varKind: "blue",
      hrid: green.hrid,
      level: green.level ?? 0,
      x: 0,
      y: 0
    }
    nodes.push(blue)
    if (greenInWire) wires.push({ id: `w${++seqW}`, fromPinId: greenInWire.fromPinId, toPinId: `${blue.id}:in:main` })
    for (const w of redOutWires) wires.push({ id: `w${++seqW}`, fromPinId: `${blue.id}:out:main`, toPinId: w.toPinId })
    void red
  }

  buildStep(root)

  // 起始物品 = 根步骤第一原料沿供应商链向下的第一个购买叶子
  function startOf(spec: ChainSpec): string {
    const inp = spec.step.ingredients[0]
    const sup = spec.suppliers.get(inp)
    return sup ? startOf(sup) : inp
  }
  const startItem = startOf(root)
  // 驱动行 = 起始物品的购买红节点所在行，移到第一行
  const startRed = nodes.find(n => n.kind === "var" && n.varKind === "red" && n.hrid === startItem)
  if (startRed?.rowUid != null) {
    const idx = rows.findIndex(r => r.uid === startRed.rowUid)
    if (idx > 0) {
      const [row] = rows.splice(idx, 1)
      rows.unshift(row)
    }
  }
  return { nodes, wires, rows, startItem, finalItem: root.step.products[0] }
}

/** 一条已构建的多步链状态（单根树：根=最终产物步骤，其余步骤都是某一步的原料供应商） */
interface ChainState {
  /** 链中步骤 id（无重复） */
  ids: string[]
  /** 树连接：父步骤的非平凡产物 hrid 供给子步骤的原料（该原料不再购买） */
  links: { parent: string, hrid: string, child: string }[]
  /** 最终产物步骤（唯一没有消费者的步骤） */
  rootId: string
  /** 已使用的 II 类单步数 */
  iiUsed: number
  /** 规范化键（步骤集合 + 连接集合排序），用于全局去重 */
  key: string
}

/**
 * 搜索多步链：双向增长 + 全局去重（最优优先 DFS）。
 *  - 初始：每个单步各自成链（按日利润降序压栈，弹栈即最优优先）；
 *  - 向下增长：任意步骤的未供给原料（红 pin）接「以该原料为非平凡产物」的单步；
 *  - 向上增长：根步骤的非平凡产物（绿 pin）接「以该产物为原料」的单步，成为新根；
 *  - 蓝/彩虹节点不参与扩展（已合并）；平凡产物不参与向上增长（保留于背包）；
 *  - 去重：任何构建顺序都收敛到同一个规范化键，全局 visited 只评估一次；
 *  - 选 DFS（栈）而非 BFS：内存 O(深度)，边搜边出结果，配合最优优先截断；
 *  - 上限：「最大搜索量」= 已评估的不同链数量（visited 规模），结果数同受其约束；
 *  - 可选 onProgress：每评估约 200 条链回调一次已搜索量，并让出事件循环（界面计时器/进度实时刷新、不无响应）。
 */
export async function searchChains(
  options: RecommendOptions,
  maxResults: number = 5000,
  onProgress?: (searched: number) => void
): Promise<RecommendResult[]> {
  const steps = collectSingleSteps().filter((s) => {
    if (options.excludeEquipment && (isEquipmentOf(s.mainItemHrid) || s.ingredients.some(i => isEquipmentOf(i)))) return false
    if (options.excludeCharms && (isCharmOf(s.mainItemHrid) || s.ingredients.some(i => isCharmOf(i)))) return false
    // 排除物品：不作为原料进入多步路线（作为产物仍可出现）
    if (options.excludeItems?.length && s.ingredients.some(i => options.excludeItems!.includes(i))) return false
    s.isClassI = s.dailyProfit >= options.threshold
    return true
  })
  const byProduct = new Map<string, SingleStep[]>()
  const byIngredient = new Map<string, SingleStep[]>()
  const stepById = new Map(steps.map(s => [s.id, s]))
  for (const s of steps) {
    for (const p of s.products) {
      if (!byProduct.has(p)) byProduct.set(p, [])
      byProduct.get(p)!.push(s)
    }
    for (const i of s.ingredients) {
      if (!byIngredient.has(i)) byIngredient.set(i, [])
      byIngredient.get(i)!.push(s)
    }
  }

  /** 规范化键：同一链无论以什么顺序构建都得到同一个键 */
  function stateKey(ids: string[], links: ChainState["links"]): string {
    return `${[...ids].sort().join(",")}|${links.map(l => `${l.parent}>${l.child}:${l.hrid}`).sort().join(",")}`
  }

  /** 根到叶的最长路径（紫节点数，≤ maxPurpleNodes）；links.parent 是供应商（上游），child 是消费者（下游） */
  function longestPath(state: ChainState): number {
    const parents = new Map<string, string[]>()
    for (const l of state.links) {
      if (!parents.has(l.child)) parents.set(l.child, [])
      parents.get(l.child)!.push(l.parent)
    }
    const depth = (id: string): number => {
      const ps = parents.get(id) ?? []
      return 1 + (ps.length ? Math.max(...ps.map(depth)) : 0)
    }
    return depth(state.rootId)
  }

  /** 步骤的某原料是否已由链内供应商供给 */
  function isSupplied(state: ChainState, childId: string, hrid: string): boolean {
    return state.links.some(l => l.child === childId && l.hrid === hrid)
  }

  /** 转成评估用的供应商树（evaluateChain/buildPlanForChain 所需）：child 的原料 hrid 由 parent 供给 */
  function toChainSpec(state: ChainState): ChainSpec {
    const byChild = new Map<string, { hrid: string, parent: string }[]>()
    for (const l of state.links) {
      if (!byChild.has(l.child)) byChild.set(l.child, [])
      byChild.get(l.child)!.push(l)
    }
    const build = (id: string): ChainSpec => {
      const suppliers = new Map<string, ChainSpec>()
      for (const { hrid, parent } of byChild.get(id) ?? []) suppliers.set(hrid, build(parent))
      return { step: stepById.get(id)!, suppliers }
    }
    return build(state.rootId)
  }

  /** 链是否无法继续扩展：II 类次数用尽，且没有任何（未使用的）单步能与叶子原料蓝绿合并 */
  function stateIsDeadEnd(state: ChainState): boolean {
    const usedIds = new Set(state.ids)
    const leaves: string[] = []
    for (const id of state.ids) {
      const s = stepById.get(id)!
      for (const ing of s.ingredients) {
        if (!isSupplied(state, id, ing)) leaves.push(ing)
      }
    }
    const iiLeft = options.maxII - state.iiUsed
    for (const leaf of leaves) {
      const suppliers = byProduct.get(leaf) ?? []
      if (suppliers.some(s => !usedIds.has(s.id) && (s.isClassI || iiLeft > 0))) return false
    }
    return true
  }

  /** 双向扩展：全部未供给原料（红）+ 根的非平凡产物（绿）；候选按新步骤日利润降序（最优优先） */
  function extend(state: ChainState): ChainState[] {
    const used = new Set(state.ids)
    const next: ChainState[] = []
    // 向下：每个步骤的未供给原料，接「以该原料为非平凡产物」的步骤
    for (const id of state.ids) {
      const s = stepById.get(id)!
      for (const ing of s.ingredients) {
        if (isSupplied(state, id, ing)) continue
        for (const p of byProduct.get(ing) ?? []) {
          if (used.has(p.id)) continue
          const iiUsed = state.iiUsed + (p.isClassI ? 0 : 1)
          if (iiUsed > options.maxII) continue
          const links = [...state.links, { parent: p.id, hrid: ing, child: id }]
          const ids = [...state.ids, p.id]
          const st: ChainState = { ids, links, rootId: state.rootId, iiUsed, key: stateKey(ids, links) }
          if (longestPath(st) <= options.maxPurpleNodes) next.push(st)
        }
      }
    }
    // 向上：根的非平凡产物，接「以该产物为原料」的步骤（成为新根）
    const root = stepById.get(state.rootId)!
    for (const prod of root.products) {
      for (const p of byIngredient.get(prod) ?? []) {
        if (used.has(p.id)) continue
        const iiUsed = state.iiUsed + (p.isClassI ? 0 : 1)
        if (iiUsed > options.maxII) continue
        const links = [...state.links, { parent: state.rootId, hrid: prod, child: p.id }]
        const ids = [...state.ids, p.id]
        const st: ChainState = { ids, links, rootId: p.id, iiUsed, key: stateKey(ids, links) }
        if (longestPath(st) <= options.maxPurpleNodes) next.push(st)
      }
    }
    // 最优优先：新步骤利润高者先弹栈
    return next.sort((a, b) =>
      stepById.get(b.ids[b.ids.length - 1])!.dailyProfit - stepById.get(a.ids[a.ids.length - 1])!.dailyProfit)
  }

  const results: RecommendResult[] = []
  const visited = new Set<string>()
  const stack: ChainState[] = []
  // 初始：每个单步各自成链（按日利润降序压栈 → 弹栈即最优优先）
  const seeds = [...steps].sort((a, b) => b.dailyProfit - a.dailyProfit)
  for (let i = seeds.length - 1; i >= 0; i--) {
    const s = seeds[i]
    const iiUsed = s.isClassI ? 0 : 1
    if (iiUsed > options.maxII) continue
    stack.push({ ids: [s.id], links: [], rootId: s.id, iiUsed, key: stateKey([s.id], []) })
  }

  // 最优优先 DFS + 全局去重：「最大搜索量」= visited 规模（已评估的不同链数量）
  const yieldNow = () => new Promise<void>(resolve => setTimeout(resolve, 0))
  let sinceYield = 0
  while (stack.length && results.length < maxResults && visited.size < maxResults) {
    const state = stack.pop()!
    if (visited.has(state.key)) continue
    visited.add(state.key)
    try {
      const r = evaluateChain(toChainSpec(state))
      if (r && Number.isFinite(r.profitPD) && Number.isFinite(r.profitRate) && Number.isFinite(r.profitPerUnit)) {
        const rateOk = r.profitRate > options.profitRateMin / 100
        // 整体多步利润低于单步日利润阈值且无法继续扩展 → 丢弃（减少垃圾项目）
        const deadEnd = r.profitPD < options.threshold && stateIsDeadEnd(state)
        if (rateOk && !deadEnd) results.push(r)
      }
    } catch (e) {
      console.error("评估多步链失败", e)
    }
    for (const next of extend(state).reverse()) stack.push(next)
    // 周期性让出事件循环：计时器与「已搜索」进度实时刷新，计算期间界面不无响应
    sinceYield++
    if (onProgress && sinceYield >= 200) {
      sinceYield = 0
      onProgress(visited.size)
      await yieldNow()
    }
  }

  results.sort((a, b) => b.profitPD - a.profitPD)
  return results
}

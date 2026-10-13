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
 * 多步 = 用任意数量的 I 类单步 + 至多 maxII 个 II 类单步拼接成树/图（红绿合并连通），
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

/** 搜索多步链：每个单步作为最终产物步骤，原料可购买或由其他单步供应（任意数量 I 类 + 至多 maxII 个 II 类） */
export function searchChains(options: RecommendOptions, maxResults: number = 5000): RecommendResult[] {
  const steps = collectSingleSteps().filter((s) => {
    if (options.excludeEquipment && (isEquipmentOf(s.mainItemHrid) || s.ingredients.some(i => isEquipmentOf(i)))) return false
    if (options.excludeCharms && (isCharmOf(s.mainItemHrid) || s.ingredients.some(i => isCharmOf(i)))) return false
    s.isClassI = s.dailyProfit >= options.threshold
    return true
  })
  const byProduct = new Map<string, SingleStep[]>()
  for (const s of steps) {
    for (const p of s.products) {
      if (!byProduct.has(p)) byProduct.set(p, [])
      byProduct.get(p)!.push(s)
    }
  }

  const results: RecommendResult[] = []
  const MAX_BRANCH = 300 // 单层供应商组合上限（防组合爆炸）

  /** 链条是否无法继续扩展：II 类次数用尽，且没有任何（未使用的）I 类单步能与叶子原料蓝绿合并 */
  function chainIsDeadEnd(chain: ChainSpec): boolean {
    const usedIds = new Set<string>()
    const iiUsed = { n: 0 }
    const leaves: string[] = []
    ;(function walk(spec: ChainSpec) {
      usedIds.add(spec.step.id)
      if (!spec.step.isClassI) iiUsed.n++
      for (const ing of spec.step.ingredients) {
        const sup = spec.suppliers.get(ing)
        if (sup) walk(sup)
        else leaves.push(ing)
      }
    })(chain)
    const iiLeft = options.maxII - iiUsed.n
    for (const leaf of leaves) {
      const suppliers = byProduct.get(leaf) ?? []
      if (suppliers.some(s => !usedIds.has(s.id) && (s.isClassI || iiLeft > 0))) return false
    }
    return true
  }
  // 最优优先：利润高的单步先枚举，结果截断时保留的是最有希望的组合（避免按物品顺序枚举导致后部高利润根被截掉）
  const sortedSteps = [...steps].sort((a, b) => b.dailyProfit - a.dailyProfit)

  /** 返回某步骤的所有供应商组合（每个组合的 II 消耗 ≤ iiLeft） */
  function expand(step: SingleStep, iiLeft: number, visited: Set<string>, funcDepth: number): ChainSpec[] {
    // 单条路径（根到叶）最多包含 maxPurpleNodes 个紫（加工）节点；funcDepth 已计入本步
    if (funcDepth >= options.maxPurpleNodes) return [newSpec(step)]
    const opts = step.ingredients.map((ing) => {
      const suppliers = (byProduct.get(ing) ?? []).filter(s =>
        !visited.has(s.id) && (s.isClassI || iiLeft > 0)).sort((a, b) => b.dailyProfit - a.dailyProfit)
      return { ing, suppliers }
    })
    let frontier: { suppliers: Map<string, ChainSpec>, iiUsed: number }[] = [{ suppliers: new Map(), iiUsed: 0 }]
    for (const { ing, suppliers } of opts) {
      const next: typeof frontier = []
      for (const f of frontier) {
        next.push(f) // 选项：购买
        for (const sup of suppliers) {
          const supCost = sup.isClassI ? 0 : 1
          if (f.iiUsed + supCost > iiLeft) continue
          const subChains = expand(sup, iiLeft - f.iiUsed - supCost, new Set([...visited, step.id, sup.id]), funcDepth + 1)
          for (const sub of subChains) {
            const m = new Map(f.suppliers)
            m.set(ing, sub)
            next.push({ suppliers: m, iiUsed: f.iiUsed + supCost })
            if (next.length >= MAX_BRANCH) break
          }
          if (next.length >= MAX_BRANCH) break
        }
        if (next.length >= MAX_BRANCH) break
      }
      frontier = next.slice(0, MAX_BRANCH)
    }
    return frontier.map(f => newSpec(step, f.suppliers))
  }

  function newSpec(step: SingleStep, suppliers?: Map<string, ChainSpec>): ChainSpec {
    return { step, suppliers: suppliers ?? new Map() }
  }

  // 每个单步都可能成为最终产物步骤（按日利润降序）
  for (const root of sortedSteps) {
    if (results.length >= maxResults) break
    const rootCost = root.isClassI ? 0 : 1
    if (rootCost > options.maxII) continue
    const chains = expand(root, options.maxII - rootCost, new Set([root.id]), 1)
    for (const chain of chains) {
      if (results.length >= maxResults) break
      try {
        const r = evaluateChain(chain)
        if (!r || !Number.isFinite(r.profitPD) || !Number.isFinite(r.profitRate) || !Number.isFinite(r.profitPerUnit)) continue
        if (r.profitRate <= options.profitRateMin / 100) continue
        // 整体多步利润低于单步日利润阈值且无法继续扩展 → 丢弃（减少垃圾项目）
        if (r.profitPD < options.threshold && chainIsDeadEnd(chain)) continue
        results.push(r)
      } catch (e) {
        console.error("评估多步链失败", e)
      }
    }
  }

  results.sort((a, b) => b.profitPD - a.profitPD)
  return results
}

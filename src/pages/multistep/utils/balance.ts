import type { GraphNode, GraphWire, NodeCalcResult, UpupItemRow } from "../types"
import type { Action } from "~/game"
import { GatherCalculator } from "@/calculator/gather"
import { getActionDetailOf } from "@/common/apis/game"
import { getUsedPriceOf } from "@/common/apis/price"
import { SELL_TAX_FACTOR } from "@/common/constants/market"
import { getTrans } from "@/locales"
import { COIN_HRID, PriceStatus, useGameStore } from "@/pinia/stores/game"
import { type AlchemyActionKey, buildMultistepCalculator, getFuncOutputPins, getGatherActionsOf, getNpcPriceOf, resolveEnhanceRecipe, resolveRecipeA, resolveRecipeB } from "./recipes"

/** 单批配平结果 */
export interface BalanceResult {
  /** 驱动节点（[上部] 第一行对应的红节点） */
  driver: GraphNode | null
  /** 每函数：单批批次数 / 每批耗时(ns，已按效率折算) / 隐藏输入（金币/茶）总成本 */
  funcInfo: Map<string, { actions: number, timeCostPerBatch: number, hiddenCost: number }>
  /** 每节点计算结果（展示在节点上） */
  nodeInfo: Map<string, NodeCalcResult>
  /** 单批处理耗时（ns） */
  totalTime: number
  /** 单批成本 */
  totalCost: number
  /** 起始物品成本（驱动节点） */
  startItemCost: number
  /** 额外材料成本 */
  extraCost: number
  /** 单批税后收入 */
  income: number
  /** 市场税（非金币叶子按税前 4% 逐个累计，金币叶子不计税；保留于背包不计税） */
  tax: number
  profit: number
  profitRate: number
  hourlyProfit: number | null
  dailyProfit: number | null
  processNodeCount: number
  sellLeafCount: number
  /** 用时占比明细 */
  steps: BalanceStep[]
  /** 配方中是否有物品目前无挂单（价格为 -1） */
  noListing: boolean
}

/** 用时占比明细行 */
export interface BalanceStep {
  funcId: string
  /** 主要处理物品 hrid */
  mainHrid: string
  /** 动作名（三造二厨=动作名；炼金=点金/分解/转化·催化剂；强化=强化·保护+N） */
  actionLabel: string
  /** 该批处理的主要物品数量（输入或输出） */
  processCount: number
  /** 单批批次数 */
  actions: number
  /** 单批耗时 ns */
  batchTime: number
  /** 占总处理耗时比例 0-1 */
  share: number
  /** 动作次数/h */
  actionsPerHour: number
}

function emptyNodeCalc(): NodeCalcResult {
  return { actions: null, timeCost: null, extraCost: null, preTaxIncome: null, tax: null, afterTaxIncome: null }
}

function isFuncResolved(n: GraphNode): boolean {
  if (n.kind !== "func") return false
  if (n.funcClass === "C") {
    return !!n.mainItemHrid && n.enhanceLevel != null && n.protectLevel != null && !!n.protectionHrid
  }
  return !!n.actionHrid && (n.funcClass === "A" || n.catalystRank != null)
}

/** 一次配方解析：把紫节点计算器/强化配方统一为「每批输入/输出/耗时/成功率」描述 */
interface NodeRecipe {
  /** 首页计算器（强化节点为 null） */
  calc: ReturnType<typeof buildMultistepCalculator>
  /** 输入条目（与计算器 ingredientList 同源；强化节点为自身输入列表） */
  inputs: { hrid: string, count: number, level: number, auto: boolean }[]
  /** 输入 pin i → inputs 索引（无对应条目为 -1）；同名输入按顺序逐一匹配 */
  inputEntryIdx: number[]
  /** 输出条目（与计算器 productList 同源；强化节点为自身输出列表） */
  outputs: { hrid: string, count: number, rate: number, level: number }[]
  /** 输出 pin i → outputs 索引（无对应条目为 -1）；同名输出按顺序逐一匹配 */
  outputEntryIdx: number[]
  /** 每批耗时 ns（已按效率折算） */
  timeCostPerBatch: number
  successRate: number
}

/** pin id → 索引（`${nodeId}:out:main` → 0，`${nodeId}:in:2` → 2） */
function pinIndexOf(pinId: string): number {
  const seg = pinId.split(":").pop() ?? "main"
  return seg === "main" ? 0 : Number(seg)
}

/** 按顺序把 pin 匹配到条目（同名条目各归其位：如分解的两种炼金精华分属不同 pin） */
function matchPinsInOrder(pins: { hrid: string, level?: number }[], entries: { hrid: string, level: number }[]): number[] {
  const used = new Set<number>()
  return pins.map((p) => {
    const idx = entries.findIndex((e, i) => !used.has(i) && e.hrid === p.hrid && (e.level ?? 0) === (p.level ?? 0))
    if (idx >= 0) used.add(idx)
    return idx
  })
}

function buildNodeRecipe(n: GraphNode, mainLevel: number = 0): NodeRecipe | null {
  if (!isFuncResolved(n)) return null
  if (n.funcClass === "C") {
    const r = resolveEnhanceRecipe(n)
    const inputs = r.inputs.map(i => ({ hrid: i.hrid, count: i.count, level: i.level, auto: i.auto }))
    const outputs = r.outputs.map(o => ({ hrid: o.hrid, count: o.count, rate: 1, level: o.level }))
    return {
      calc: null,
      inputs,
      inputEntryIdx: inputs.map((_, i) => i),
      outputs,
      outputEntryIdx: outputs.map((_, i) => i),
      timeCostPerBatch: r.timeCost,
      successRate: 1
    }
  }
  const calc = buildMultistepCalculator(n, mainLevel)!
  const inputPins: { hrid: string, auto: boolean, level?: number }[] = n.funcClass === "A"
    ? resolveRecipeA(n.actionHrid!).inputs
    : resolveRecipeB(n.mainItemHrid!, n.actionHrid!.split("/").pop() as AlchemyActionKey, n.catalystRank ?? 0).inputs
  // 主输入 pin（升级物 / 分解物）带连线物品的强化等级，才能与计算器条目（level=originLevel/enhanceLevel）匹配
  const key = n.actionHrid!.split("/").pop()
  const mainPinHasLevel = (n.funcClass === "A" && !!getActionDetailOf(n.actionHrid!).upgradeItemHrid) || key === "decompose"
  if (mainPinHasLevel && inputPins.length) {
    inputPins[0] = { ...inputPins[0], level: mainLevel }
  }
  const outputPins = getFuncOutputPins(n, mainLevel)
  const ingEntries = calc.ingredientList.map(e => ({ hrid: e.hrid, level: e.level ?? 0 }))
  const outEntries = calc.productList.map(p => ({ hrid: p.hrid, level: p.level ?? 0 }))
  return {
    calc,
    // 输入取计算器 ingredientList（含金币/茶等自动供给项）；数量为每动作消耗
    inputs: calc.ingredientList.map(e => ({ hrid: e.hrid, count: e.count, level: e.level ?? 0, auto: false })),
    inputEntryIdx: matchPinsInOrder(inputPins, ingEntries),
    // 输出取计算器 productList；全部统一 ×successRate——平凡掉落条目 count 已 ÷successRate，
    // 相乘后正好得到「不考虑成功失败」的最终期望值（与首页配方数量/h 口径一致）
    outputs: calc.productList.map(p => ({
      hrid: p.hrid,
      count: p.count,
      rate: p.rate ?? 1,
      level: p.level ?? 0
    })),
    outputEntryIdx: matchPinsInOrder(outputPins, outEntries),
    timeCostPerBatch: calc.effectiveTimeCost / calc.efficiency,
    successRate: calc.successRate
  }
}

/** 单次传播的结果 */
interface PassResult {
  nodeQ: Map<string, number>
  funcActions: Map<string, { actions: number, recipe: NodeRecipe }>
  gatherTime: number
}

/**
 * 自动配平：以第一行用户填写数量为基准，其余数量按配方期望值传播。
 * 传播是双向的：变量 → 消费函数节点（正向），变量 → 生产函数节点（按产量反推）。
 */
export function balanceAndMutate(nodes: GraphNode[], wires: GraphWire[], rows: UpupItemRow[]): BalanceResult {
  const nodeMap = new Map(nodes.map(n => [n.id, n]))
  const nodeInfo = new Map<string, NodeCalcResult>()
  const funcInfo = new Map<string, { actions: number, timeCostPerBatch: number, hiddenCost: number }>()
  // buffs 由 player API 的 watcher（gameData / playerStore.config 变化）自动重建，与首页同源
  let noListing = false
  /** 价格取值：手动价优先，否则市场价；-1（无挂单）时打标提醒 */
  function usedPrice(hrid: string, level: number, type: "ask" | "bid"): number {
    const price = getUsedPriceOf(hrid, level, type) ?? -1
    if (price === -1) noListing = true
    return price
  }

  const empty = (): BalanceResult => ({
    driver: null,
    funcInfo,
    nodeInfo,
    totalTime: 0,
    totalCost: 0,
    startItemCost: 0,
    extraCost: 0,
    income: 0,
    tax: 0,
    profit: 0,
    profitRate: 0,
    hourlyProfit: null,
    dailyProfit: null,
    processNodeCount: nodes.filter(isFuncResolved).length,
    sellLeafCount: nodes.filter(n => n.kind === "var" && n.varKind === "green").length,
    steps: [],
    noListing
  })

  const driver = nodes.find(n => n.kind === "var" && n.rowUid != null && rows[0] && n.rowUid === rows[0].uid) ?? null
  if (!driver || !driver.hrid) {
    for (const n of nodes) nodeInfo.set(n.id, emptyNodeCalc())
    return empty()
  }
  // 闭包内 TS 收窄失效，这里固定为非空引用
  const driverNode: GraphNode = driver

  // 以第一行用户填写的数量为配平基准
  const baseQ = rows[0]?.count ?? 100

  /** 函数节点主输入 pin 上连线物品的强化等级（A 类继承 / B 类分解强化精华用） */
  function mainInputLevelOf(func: GraphNode): number {
    const mainWire = wires.find(w => w.toPinId === `${func.id}:in:main`)
    const src = mainWire ? nodeMap.get(mainWire.fromPinId.split(":")[0]) : undefined
    return src?.kind === "var" ? (src.level ?? 0) : 0
  }

  /** 纯传播一轮：返回节点数量、函数批次数与采集耗时，不写回也不结算 */
  function runPass(base: number): PassResult {
    const nodeQ = new Map<string, number>()
    nodeQ.set(driverNode.id, base)
    const funcActions = new Map<string, { actions: number, recipe: NodeRecipe }>()
    const processedFuncs = new Set<string>()
    const visited = new Set<string>()
    const queue: GraphNode[] = [driverNode]
    let gatherTime = 0

    /** 处理一个函数节点：按配方向其他输入/输出传播数量（同名条目按 pin 顺序各归其位） */
    function processFunc(func: GraphNode, recipe: NodeRecipe, actions: number) {
      processedFuncs.add(func.id)
      funcActions.set(func.id, { actions, recipe })
      // 输入变量（每个输入 pin 一条线，按 pin 索引对应配方输入条目）
      for (const iw of wires.filter(x => x.toPinId.startsWith(`${func.id}:`))) {
        const src = nodeMap.get(iw.fromPinId.split(":")[0])
        if (!src || src.kind !== "var") continue
        if (nodeQ.has(src.id)) continue
        const idx = recipe.inputEntryIdx[pinIndexOf(iw.toPinId)]
        const entry = idx >= 0 ? recipe.inputs[idx] : undefined
        if (!entry) continue
        const qIn = actions * entry.count
        nodeQ.set(src.id, qIn)
        queue.push(src)
      }
      // 输出变量（期望 = count × rate × 成功率；平凡掉落条目 count 已 ÷成功率，相乘即「不考虑成功失败」的最终值）
      for (const ow of wires.filter(x => x.fromPinId.startsWith(`${func.id}:`))) {
        const tgt = nodeMap.get(ow.toPinId.split(":")[0])
        if (!tgt || tgt.kind !== "var") continue
        const idx = recipe.outputEntryIdx[pinIndexOf(ow.fromPinId)]
        const entry = idx >= 0 ? recipe.outputs[idx] : undefined
        if (!entry) continue
        const qOut = actions * entry.count * entry.rate * recipe.successRate
        nodeQ.set(tgt.id, qOut)
        queue.push(tgt)
      }
    }

    while (queue.length) {
      const v = queue.shift()!
      if (visited.has(v.id)) continue
      visited.add(v.id)
      const q = nodeQ.get(v.id) ?? 0

      // 红节点三采集：累计采集耗时（效率同样折算：单次有效耗时 = effectiveTimeCost / efficiency）
      if (v.kind === "var" && v.varKind === "red" && v.hrid && v.obtain === "gather") {
        const gatherAction = getGatherActionsOf(v.hrid)[0]
        if (gatherAction) {
          const action = gatherAction.split("/")[2] as Action
          const g = new GatherCalculator({ hrid: v.hrid, project: getTrans("处理方式"), action })
          const yieldPerAction = g.productList.find(p => p.hrid === v.hrid)?.count || 1
          gatherTime += (q / yieldPerAction) * (g.effectiveTimeCost / g.efficiency)
        }
      }

      // 1) 上游：该变量的生产函数节点（in-wire 来源）——按产量反推批次数（按 pin 索引取对应输出条目）
      const producerWire = wires.find(w => w.toPinId === `${v.id}:in:main`)
      if (producerWire) {
        const func = nodeMap.get(producerWire.fromPinId.split(":")[0])
        if (func && func.kind === "func" && isFuncResolved(func) && !processedFuncs.has(func.id)) {
          const recipe = buildNodeRecipe(func, mainInputLevelOf(func)) /* 现场构造：speed/buff 取当前玩家配置 */
          if (recipe) {
            const idx = recipe.outputEntryIdx[pinIndexOf(producerWire.fromPinId)]
            const outEntry = idx >= 0 ? recipe.outputs[idx] : undefined
            if (outEntry) {
              // 反推同样折算成功率：每批期望产出 = count × rate × successRate
              processFunc(func, recipe, q / (outEntry.count * outEntry.rate * recipe.successRate))
            }
          }
        }
      }
      // 2) 下游：消费该变量的函数节点（out-wire 目标）——按消耗量正向传播（按 pin 索引取对应输入条目）
      for (const w of wires.filter(x => x.fromPinId === `${v.id}:out:main`)) {
        const func = nodeMap.get(w.toPinId.split(":")[0])
        if (!func || func.kind !== "func" || !isFuncResolved(func)) continue
        if (processedFuncs.has(func.id)) continue
        const recipe = buildNodeRecipe(func, mainInputLevelOf(func)) /* 现场构造：speed/buff 取当前玩家配置 */
        if (!recipe) continue
        const idx = recipe.inputEntryIdx[pinIndexOf(w.toPinId)]
        const inEntry = idx >= 0 ? recipe.inputs[idx] : undefined
        if (inEntry) {
          processFunc(func, recipe, q / inEntry.count)
        }
      }
    }
    return { nodeQ, funcActions, gatherTime }
  }

  // 单轮传播直接结算
  const pass = runPass(baseQ)
  const nodeQ = pass.nodeQ
  const funcActions = pass.funcActions
  const gatherTime = pass.gatherTime

  // —— 结算：按结果汇总成本/耗时/收入并回写节点数量 ——
  let totalTime = gatherTime
  let totalCost = 0
  let startItemCost = 0
  let income = 0
  let taxTotal = 0

  for (const v of nodes) {
    if (v.kind !== "var") continue
    const q = nodeQ.get(v.id)
    if (q == null) continue
    v.count = Math.round(q * 1000) / 1000
  }
  driverNode.count = Math.round((nodeQ.get(driverNode.id) ?? baseQ) * 1000) / 1000
  if (rows[0]) rows[0].count = driverNode.count

  const gameStore = useGameStore()
  for (const v of nodes) {
    if (v.kind !== "var") continue
    const q = nodeQ.get(v.id)
    if (q == null) continue
    const level = v.level ?? 0
    // 购买/来自背包/NPC 购买的红节点计入成本
    if (v.varKind === "red" && v.hrid) {
      if (v.obtain === "gather") continue
      let price = usedPrice(v.hrid, level, "ask")
      if (v.obtain === "npc") {
        // NPC 固定价格购买（奶酪武器/木制武器/工具 5000；实习护符 250000），不受市场价与税率影响
        const npc = getNpcPriceOf(v.hrid)
        if (npc != null) price = npc
      } else if (v.obtain === "backpack" && gameStore.buyStatus !== PriceStatus.MARKET) {
        // 来自背包：按所选买入侧价格 ×（1-税率）计价（左价/左价-/右价/右价+；市场价格不做换算）
        price = price * SELL_TAX_FACTOR
      }
      const cost = q * price
      totalCost += cost
      if (v.id === driverNode.id) startItemCost = cost
    }
    // 绿色叶子计入税后收入：单价取生产计算器条目的价格（按 pin 索引对应，点金金币 = 卖价×5×bulk 等特例靠它）
    if (v.varKind === "green" && v.hrid) {
      const producerWire = wires.find(w => w.toPinId === `${v.id}:in:main`)
      const producer = producerWire ? nodeMap.get(producerWire.fromPinId.split(":")[0]) : undefined
      let price = usedPrice(v.hrid, level, "bid")
      if (producer && producer.kind === "func" && producerWire) {
        const fa = funcActions.get(producer.id)
        const idx = fa?.recipe.outputEntryIdx[pinIndexOf(producerWire.fromPinId)]
        const entry = idx != null && idx >= 0 ? fa?.recipe.calc?.productListWithPrice[idx] : undefined
        if (entry) price = entry.price
      }
      // 无挂单（价格 -1）时不计收入（仅提示），避免负数污染利润
      const pre = price < 0 ? 0 : q * price
      // 金币（点金产物）是货币本身，不计市场税；保留于背包不计税；其余叶子按 4% 计税（与首页计算器口径一致）
      const after = (v.hrid === COIN_HRID || v.sellMode === "keep") ? pre : pre * SELL_TAX_FACTOR
      income += after
      taxTotal += pre - after
      nodeInfo.set(v.id, { actions: null, timeCost: null, extraCost: null, preTaxIncome: pre, tax: pre - after, afterTaxIncome: after })
    }
  }

  for (const [funcId, fa] of funcActions) {
    const func = nodeMap.get(funcId)
    if (!func) continue
    const { actions, recipe } = fa
    // 隐藏输入（金币/茶/自动供给）= 配方输入中没有变量连线的条目（按 pin→条目索引判定）
    let hiddenCost = 0
    if (recipe.calc) {
      const wiredEntryIdx = new Set<number>()
      for (const iw of wires.filter(x => x.toPinId.startsWith(`${func.id}:`))) {
        const src = nodeMap.get(iw.fromPinId.split(":")[0])
        if (src?.kind !== "var") continue
        const idx = recipe.inputEntryIdx[pinIndexOf(iw.toPinId)]
        if (idx >= 0) wiredEntryIdx.add(idx)
      }
      // 紫节点：单价取计算器 WithPrice 条目（转化/分解的金币成本是特例价，不是 1；手动价已生效）
      for (const [i, e] of recipe.calc.ingredientListWithPrice.entries()) {
        if (wiredEntryIdx.has(i)) continue
        if (e.price < 0) continue
        hiddenCost += actions * e.count * e.price
      }
    } else {
      // 强化节点：自动供给（金币）按市场价计，材料/保护/本体均由连线供应
      for (const i of recipe.inputs) {
        if (!i.auto) continue
        const price = usedPrice(i.hrid, i.level, "ask")
        if (price < 0) continue
        hiddenCost += actions * i.count * price
      }
    }
    funcInfo.set(func.id, { actions, timeCostPerBatch: recipe.timeCostPerBatch, hiddenCost })
    totalTime += actions * recipe.timeCostPerBatch
    totalCost += hiddenCost
    nodeInfo.set(func.id, {
      actions,
      timeCost: actions * recipe.timeCostPerBatch,
      extraCost: hiddenCost,
      preTaxIncome: null,
      tax: null,
      afterTaxIncome: null
    })
  }

  // 市场税按叶子逐个累计（金币叶子不计税，不能由总收入反推）
  const tax = taxTotal
  const profit = income - totalCost
  const profitRate = totalCost > 0 ? profit / totalCost : 0
  const hourlyProfit = totalTime > 0 ? profit * ((3600 * 1e9) / totalTime) : null

  // 用时占比明细：处理物品/动作/处理数量/动作次数/批次耗时/工时占比/动作次数/h
  const ALCHEMY_ACTION_LABEL: Record<string, string> = { coinify: "点金", decompose: "分解", transmute: "转化" }
  const CATALYST_LABEL: Record<number, string> = { 0: "", 1: " · 普通催化剂", 2: " · 至高催化剂" }
  const steps: BalanceStep[] = []
  for (const [funcId, fa] of funcActions) {
    const func = nodeMap.get(funcId)
    if (!func || fa.actions <= 0) continue
    let actionLabel: string
    if (func.funcClass === "C") {
      actionLabel = func.protectLevel != null && func.protectLevel < (func.enhanceLevel ?? 0)
        ? `${getTrans("强化")} · ${getTrans("保护")}+${func.protectLevel}`
        : getTrans("强化")
    } else if (func.funcClass === "A") {
      actionLabel = getTrans(func.actionHrid!.split("/")[2] as any)
    } else {
      actionLabel = `${ALCHEMY_ACTION_LABEL[func.actionHrid!.split("/").pop() as string]}${CATALYST_LABEL[func.catalystRank ?? 0]}`
    }
    const batchTime = fa.actions * fa.recipe.timeCostPerBatch
    // 主要物品数量：输入线连着的变量数量取最大（强化节点即本体数量）
    let processCount = 0
    for (const iw of wires.filter(x => x.toPinId.startsWith(`${funcId}:`))) {
      const src = nodeMap.get(iw.fromPinId.split(":")[0])
      if (src?.kind === "var" && src.hrid) {
        const q = nodeQ.get(src.id)
        if (q != null && q > processCount) processCount = q
      }
    }
    if (processCount <= 0 && func.mainItemHrid) {
      // 兜底：主原料批次数 × 每批消耗
      const entry = fa.recipe.inputs.find(i => i.hrid === func.mainItemHrid)
      processCount = entry ? fa.actions * entry.count : fa.actions
    }
    steps.push({
      funcId,
      mainHrid: func.mainItemHrid ?? "",
      actionLabel,
      processCount,
      actions: fa.actions,
      batchTime,
      share: totalTime > 0 ? batchTime / totalTime : 0,
      actionsPerHour: totalTime > 0 ? fa.actions * ((3600 * 1e9) / totalTime) : 0
    })
  }
  steps.sort((a, b) => b.batchTime - a.batchTime)

  return {
    driver,
    funcInfo,
    nodeInfo,
    totalTime,
    totalCost,
    startItemCost,
    extraCost: totalCost - startItemCost,
    income,
    tax,
    profit,
    profitRate,
    hourlyProfit,
    dailyProfit: hourlyProfit != null ? hourlyProfit * 24 : null,
    processNodeCount: nodes.filter(isFuncResolved).length,
    sellLeafCount: nodes.filter(n => n.kind === "var" && n.varKind === "green").length,
    steps,
    noListing
  }
}

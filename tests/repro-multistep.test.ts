import * as fs from "node:fs"
import * as path from "node:path"
/**
 * 多步利润蓝图回归（task01）：
 * 1) 冲泡产茶单步配方修复：究极茶能解析到唯一冲泡配方（item 8）
 * 2) 强化节点配方：材料/保护数量按期望次数折算、产物为 +x（item 3）
 * 3) 端到端配平：驱动数量传播、强化材料成本 ≈ 强化计算页「材料费用」口径、税后叶子收入
 * 4) 来自背包 ×(1-税率)、保留于背包不计税（item 6）
 * 5) 价格为 -1 时 noListing 标记（item 7）
 * 运行：npx vitest run tests/repro-multistep.test.ts
 */
import { expect, it } from "vitest"

async function boot() {
  const fakeReq = (result: unknown) => {
    const r: any = { result, error: null }
    setTimeout(() => r.onsuccess && r.onsuccess({ target: r }), 0)
    return r
  }
  const fakeStore = { get: () => fakeReq(undefined), put: () => fakeReq(undefined), delete: () => fakeReq(undefined) }
  const fakeTx: any = { objectStore: () => fakeStore, onerror: null, oncomplete: null, onabort: null }
  const fakeDb: any = {
    transaction: () => fakeTx,
    close: () => {},
    objectStoreNames: { contains: () => false },
    createObjectStore: () => {}
  }
  ;(globalThis as any).indexedDB = { open: () => fakeReq(fakeDb) }

  const { pinia } = await import("@/pinia")
  const { setActivePinia } = await import("pinia")
  const { useGameStore, updateMarketData } = await import("@/pinia/stores/game")
  const { usePlayerStore, defaultActionConfig } = await import("@/pinia/stores/player")
  const { usePriceStore } = await import("@/pinia/stores/price")

  const root = process.cwd()
  const dataJson = JSON.parse(fs.readFileSync(path.join(root, "public/data/data.json"), "utf8"))
  const marketJson = JSON.parse(fs.readFileSync(path.join(root, "public/data/market.json"), "utf8"))

  setActivePinia(pinia)
  const game = useGameStore(pinia)
  game.gameData = dataJson
  await new Promise(resolve => setTimeout(resolve, 50))
  game.marketData = await updateMarketData(null, marketJson, dataJson)
  game.clearAllCaches()

  // 实例化 player/price store，触发 buffs 与价格库初始化
  const playerStore = usePlayerStore(pinia)
  playerStore.config = defaultActionConfig("回归预设", "#409eff") as any
  const priceStore = usePriceStore(pinia)

  const { findProducingActionOf, resolveEnhanceRecipe } = await import("@/pages/multistep/utils/recipes")
  const { balanceAndMutate } = await import("@/pages/multistep/utils/balance")
  return { game, priceStore, findProducingActionOf, resolveEnhanceRecipe, balanceAndMutate }
}

it("冲泡可以生产各种究极茶（item 8）", async () => {
  const { findProducingActionOf } = await boot()
  const ultraTeas = [
    "ultra_alchemy_tea",
    "ultra_brewing_tea",
    "ultra_cheesesmithing_tea",
    "ultra_cooking_tea",
    "ultra_crafting_tea",
    "ultra_enhancing_tea",
    "ultra_foraging_tea",
    "ultra_milking_tea",
    "ultra_tailoring_tea",
    "ultra_woodcutting_tea"
  ]
  for (const key of ultraTeas) {
    const action = findProducingActionOf(`/items/${key}`)
    console.log(`[究极茶] ${key} -> ${action ?? "无配方"}`)
    expect(action).toBe(`/actions/brewing/${key}`)
  }
}, 600000)

it("强化节点配方按期望次数折算（item 3）", async () => {
  const { resolveEnhanceRecipe } = await boot()
  const node = {
    mainItemHrid: "/items/chaotic_flail_refined",
    enhanceLevel: 10,
    protectLevel: 7,
    protectionHrid: "/items/chaotic_chain"
  } as any
  const r = resolveEnhanceRecipe(node)
  console.log(`[强化] actions=${r.actions.toFixed(2)} protects=${r.protects.toFixed(2)}`)
  // 输入顺序：正上方本体 + 5 种材料（金币自动）+ 正右侧保护
  expect(r.inputs[0]).toMatchObject({ hrid: "/items/chaotic_flail_refined", count: 1, position: "top" })
  const left = r.inputs.filter(i => i.position === "left")
  expect(left.map(i => i.hrid)).toEqual([
    "/items/sinister_essence",
    "/items/holy_cheese",
    "/items/arcane_log",
    "/items/crushed_garnet",
    "/items/coin"
  ])
  // 材料数量 = 基础数量 × 期望次数
  expect(left[0].count).toBeCloseTo(18 * r.actions, 3)
  expect(left.find(i => i.hrid === "/items/coin")!.auto).toBe(true)
  const right = r.inputs.filter(i => i.position === "right")
  expect(right).toHaveLength(1)
  expect(right[0]).toMatchObject({ hrid: "/items/chaotic_chain" })
  expect(right[0].count).toBeCloseTo(r.protects, 3)
  // 产物：+10 本体
  expect(r.outputs).toEqual([{ hrid: "/items/chaotic_flail_refined", count: 1, level: 10 }])
  expect(r.actions).toBeGreaterThan(1)
  expect(r.protects).toBeGreaterThan(0)
}, 600000)

it("端到端配平：三造得到+0 → 强化+10 → 出售（含自定义价格/背包/保留于背包/无挂单）", async () => {
  const { balanceAndMutate, priceStore } = await boot()
  const gear = "/items/chaotic_flail_refined"
  // 市场快照中 +0 无挂单：用自定义价格（item 5，与首页同一价格库）给本体定价 300M
  priceStore.activated = true
  priceStore.setPrice({ hrid: gear, ask: { manual: true, manualPrice: 300_000_000 } })
  priceStore.commit()
  // 价格 API 的快照经 watch 异步同步，等一个微任务
  await new Promise(resolve => setTimeout(resolve, 0))

  // 手工构造 applyResolvedRecipe 等价图：驱动红节点（本体）+ 强化节点 + 材料/保护红节点 + 产物绿节点
  const rows = [{ uid: 1, hrid: gear, count: 1 }]
  const nodes = [
    { id: "red-1", kind: "var", varKind: "red", hrid: gear, level: 0, rowUid: 1, obtain: "buy", x: 0, y: 0 },
    { id: "enh-1", kind: "func", funcClass: "C", hrid: "", mainItemHrid: gear, enhanceLevel: 10, protectLevel: 7, protectionHrid: "/items/chaotic_chain", x: 0, y: 0 }
  ] as any[]
  const wires = [{ id: "w1", fromPinId: "red-1:out:main", toPinId: "enh-1:in:main" }] as any[]
  const materialHrids = ["/items/sinister_essence", "/items/holy_cheese", "/items/arcane_log", "/items/crushed_garnet"]
  materialHrids.forEach((hrid, i) => {
    const uid = 2 + i
    rows.push({ uid, hrid, count: 0 })
    nodes.push({ id: `red-${uid}`, kind: "var", varKind: "red", hrid, level: 0, rowUid: uid, obtain: "buy", x: 0, y: 0 })
    wires.push({ id: `w${uid}`, fromPinId: `red-${uid}:out:main`, toPinId: `enh-1:in:${i + 1}` })
  })
  rows.push({ uid: 6, hrid: "/items/chaotic_chain", count: 0 })
  nodes.push({ id: "red-6", kind: "var", varKind: "red", hrid: "/items/chaotic_chain", level: 0, rowUid: 6, obtain: "buy", x: 0, y: 0 })
  wires.push({ id: "w6", fromPinId: "red-6:out:main", toPinId: "enh-1:in:6" })
  nodes.push({ id: "green-1", kind: "var", varKind: "green", hrid: gear, level: 10, sellMode: "sell", x: 0, y: 0 })
  wires.push({ id: "w7", fromPinId: "enh-1:out:main", toPinId: "green-1:in:main" })

  const r1 = balanceAndMutate(nodes, wires, rows)
  console.log(`[配平] 成本=${r1.totalCost.toFixed(0)} 起始=${r1.startItemCost.toFixed(0)} 收入=${r1.income.toFixed(0)} 利润=${r1.profit.toFixed(0)} noListing=${r1.noListing}`)
  expect(r1.driver?.id).toBe("red-1")
  expect(r1.totalCost).toBeGreaterThan(0)
  expect(r1.income).toBeGreaterThan(0)
  // 自定义买价生效：本体 1 × 300M
  expect(r1.startItemCost).toBeCloseTo(300_000_000, 0)
  expect(r1.noListing).toBe(false)
  // 材料+保护成本 = Σ 数量×单价（强化计算页「材料费用」口径）
  const matCost = r1.totalCost - r1.startItemCost
  console.log(`[配平] 材料+保护=${matCost.toFixed(0)}（快照市场价，应为 4 亿级）`)
  expect(matCost).toBeGreaterThan(300_000_000)
  expect(matCost).toBeLessThan(500_000_000)
  // 用时占比明细包含强化行
  expect(r1.steps.some(s => s.funcId === "enh-1")).toBe(true)
  // 材料红节点数量被回写（阴森精华 = 18 × 期望次数）
  const sinister = nodes.find(n => n.id === "red-2")
  expect(sinister.count).toBeGreaterThan(0)

  // item 6a：驱动改为来自背包 → 本体成本 ×(1-税率)（默认左价 ASK，税率 4% → ×0.96）
  const backpackNodes = structuredClone(nodes)
  backpackNodes.find((n: any) => n.id === "red-1").obtain = "backpack"
  const r2 = balanceAndMutate(backpackNodes, wires, rows)
  expect(r2.startItemCost).toBeCloseTo(r1.startItemCost * 0.96, 0)
  console.log(`[背包] 本体成本 ${r1.startItemCost.toFixed(0)} -> ${r2.startItemCost.toFixed(0)}（×0.96）`)

  // item 6b：叶子保留于背包 → 不计税（税后=税前）
  const keepNodes = structuredClone(nodes)
  keepNodes.find((n: any) => n.id === "green-1").sellMode = "keep"
  const r3 = balanceAndMutate(keepNodes, wires, rows)
  const sellLeaf = r1.nodeInfo.get("green-1")!
  const keepLeaf = r3.nodeInfo.get("green-1")!
  expect(keepLeaf.afterTaxIncome).toBeCloseTo(keepLeaf.preTaxIncome!, 3)
  expect(keepLeaf.preTaxIncome).toBeCloseTo(sellLeaf.preTaxIncome!, 3)
  expect(sellLeaf.afterTaxIncome).toBeCloseTo(sellLeaf.preTaxIncome! * 0.96, 3)
  console.log(`[保留背包] 出售税后=${sellLeaf.afterTaxIncome?.toFixed(0)} 保留=${keepLeaf.afterTaxIncome?.toFixed(0)}（无税）`)

  // item 7：移除本体的自定义价 → +0 无挂单（ask=-1）→ noListing 提示标记
  priceStore.deletePrice({ hrid: gear })
  await new Promise(resolve => setTimeout(resolve, 0))
  const r4 = balanceAndMutate(structuredClone(nodes), wires, rows)
  console.log(`[无挂单] noListing=${r4.noListing}（精炼混沌连枷+0 快照无卖单）`)
  expect(r4.noListing).toBe(true)
}, 600000)

it("精炼披风等不可交易产物的三造配方可用（task05-1）", async () => {
  const { findProducingActionOf } = await boot()
  const { getProcessItemOptions } = await import("@/pages/multistep/utils/items")
  const { ManufactureCalculator } = await import("@/calculator/manufacture")
  // 数据中 isTradable=false 的精炼装备（披风 + 战斗装备）：A 类下拉必须提供
  const nonTradable = [
    "/items/artificer_cape_refined",
    "/items/chance_cape_refined",
    "/items/culinary_cape_refined",
    "/items/gatherer_cape_refined",
    "/items/sinister_cape_refined",
    "/items/enchanted_cloak_refined",
    "/items/chimerical_quiver_refined"
  ]
  const opts = getProcessItemOptions("A").map(o => o.hrid)
  for (const hrid of nonTradable) {
    expect(opts).toContain(hrid)
    const action = findProducingActionOf(hrid)
    expect(action).toBeTruthy()
    const calc = new ManufactureCalculator({ hrid, project: "处理方式", action: action!.split("/")[2] as any })
    expect(calc.available).toBe(true)
    console.log(`[精炼] ${hrid} -> ${action}（available=${calc.available}）`)
  }
}, 600000)

it("默认配方机制：当前数据无重盾链时不误建、不报错（task05-3）", async () => {
  await boot()
  localStorage.clear()
  const { useMultistepGraph } = await import("@/pages/multistep/composables/useMultistepGraph")
  const graph = useMultistepGraph()
  // 数据中暂无 Holy Heavy Shield / Cheese Heavy Shield → 不创建、不写标记
  expect(graph.nodes.value.length).toBe(0)
  expect(localStorage.getItem("multistep-default-plan-created")).toBeNull()
  console.log("[默认配方] 无重盾链数据时画布为空且未写创建标记（数据更新后首次进入会自动创建「配方一」）")
}, 600000)

it("分解产物同名不混淆：两种炼金精华数量各归其位（task06）", async () => {
  const { balanceAndMutate } = await boot()
  const { DecomposeCalculator } = await import("@/calculator/alchemy")
  const catalyst = "/items/catalyst_of_decomposition"
  // 手工构造：驱动红节点 1×分解催化剂 → 炼金-分解（分解催化剂）→ 三个绿色叶子
  const rows = [{ uid: 1, hrid: catalyst, count: 1 }, { uid: 2, hrid: catalyst, count: 0 }]
  const nodes = [
    { id: "red-1", kind: "var", varKind: "red", hrid: catalyst, level: 0, rowUid: 1, obtain: "buy", x: 0, y: 0 },
    { id: "red-2", kind: "var", varKind: "red", hrid: catalyst, level: 0, rowUid: 2, obtain: "buy", x: 0, y: 0 },
    { id: "func-1", kind: "func", funcClass: "B", hrid: "", mainItemHrid: catalyst, actionHrid: "/actions/alchemy/decompose", catalystRank: 1, x: 0, y: 0 },
    { id: "green-1", kind: "var", varKind: "green", hrid: "/items/alchemy_essence", level: 0, sellMode: "sell", x: 0, y: 0 },
    { id: "green-2", kind: "var", varKind: "green", hrid: "/items/medium_artisans_crate", level: 0, sellMode: "sell", x: 0, y: 0 },
    { id: "green-3", kind: "var", varKind: "green", hrid: "/items/alchemy_essence", level: 0, sellMode: "sell", x: 0, y: 0 }
  ] as any[]
  const wires = [
    { id: "w1", fromPinId: "red-1:out:main", toPinId: "func-1:in:main" },
    { id: "w2", fromPinId: "red-2:out:main", toPinId: "func-1:in:1" },
    { id: "w3", fromPinId: "func-1:out:main", toPinId: "green-1:in:main" },
    { id: "w4", fromPinId: "func-1:out:1", toPinId: "green-2:in:main" },
    { id: "w5", fromPinId: "func-1:out:2", toPinId: "green-3:in:main" }
  ] as any[]
  void balanceAndMutate(nodes, wires, rows)
  // 计算器口径：主要产物（成功流）25×成功率；平凡掉落流 count×rate（无论成功失败）
  const calc = new DecomposeCalculator({ hrid: catalyst, project: "处理方式", catalystRank: 1 })
  const successEssence = calc.productList[0]
  const mundaneEssence = calc.productList[2]
  const expectedSuccess = 1 * successEssence.count * (successEssence.rate ?? 1) * calc.successRate
  const expectedMundane = 1 * mundaneEssence.count * (mundaneEssence.rate ?? 1)
  const qSuccess = nodes.find((n: any) => n.id === "green-1").count
  const qMundane = nodes.find((n: any) => n.id === "green-3").count
  console.log(`[分解] 成功率=${(calc.successRate * 100).toFixed(2)}% 成功流=${qSuccess.toFixed(4)}（期望 ${expectedSuccess.toFixed(4)}） 平凡流=${qMundane.toFixed(4)}（期望 ${expectedMundane.toFixed(4)}）`)
  expect(qSuccess).toBeCloseTo(expectedSuccess, 2)
  expect(qMundane).toBeCloseTo(expectedMundane, 3)
  // 修复前两者相等（≈15.8）；修复后必须不同
  expect(Math.abs(qSuccess - qMundane)).toBeGreaterThan(1)
}, 600000)

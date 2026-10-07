import * as fs from "node:fs"
import * as path from "node:path"
/**
 * 装备优化 API 回归：
 * 1) 采集/炼金专业不再触发 inputItems 崩溃（v2.8.0 线上事故）
 * 2) 结果无 NaN/Infinity（除经验口径回本 Infinity，展示层已用 — 守卫）
 * 3) 单件预算上限：超预算候选不进推荐、留候选列表标记
 * 运行：npx vitest run tests/repro-upgrade.test.ts
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
  const fakeDb = { transaction: () => fakeTx, close: () => {} }
  ;(globalThis as any).indexedDB = { open: () => fakeReq(fakeDb) }

  const { pinia } = await import("@/pinia")
  const { setActivePinia } = await import("pinia")
  const { useGameStore, updateMarketData } = await import("@/pinia/stores/game")
  const { getUpgradeCompareApi } = await import("@/common/apis/upgrade")
  const { defaultActionConfig } = await import("@/pinia/stores/player")

  const root = process.cwd()
  const dataJson = JSON.parse(fs.readFileSync(path.join(root, "public/data/data.json"), "utf8"))
  const marketJson = JSON.parse(fs.readFileSync(path.join(root, "public/data/market.json"), "utf8"))

  setActivePinia(pinia)
  const game = useGameStore(pinia)
  game.gameData = dataJson
  await new Promise(resolve => setTimeout(resolve, 50))
  game.marketData = await updateMarketData(null, marketJson, dataJson)
  game.clearAllCaches()

  return { getUpgradeCompareApi, config: defaultActionConfig("回归预设", "#409eff") as any }
}

it("upgrade compare api survives gather actions", async () => {
  const { getUpgradeCompareApi, config } = await boot()
  for (const action of ["foraging", "milking", "woodcutting", "alchemy"] as const) {
    const res = await getUpgradeCompareApi({ presets: [{ index: 0, config }], action, evalMode: "all", topN: 3 })
    const actions = res[0]?.actions ?? []
    console.log(`[${action}] 部位数=${actions.length} 首个候选数=${actions[0]?.baselineOptions?.length ?? "-"}`)
    expect(actions.length).toBeGreaterThan(0)
    expect(actions[0].baselineOptions.length).toBeGreaterThan(0)
    // NaN/Infinity 拦截：除经验口径回本恒为 Infinity 外，不允许任何非有限值出现在展示字段
    for (const a of actions) {
      for (const c of a.candidates) {
        expect(Number.isFinite(c.valueRate)).toBe(true)
        expect(Number.isFinite(c.profitDelta)).toBe(true)
        expect(Number.isFinite(c.cost)).toBe(true)
        expect(c.isExpMetric ? c.paybackHours === Number.POSITIVE_INFINITY : Number.isFinite(c.paybackHours)).toBe(true)
      }
      expect(Number.isFinite(a.baselineProfitPH)).toBe(true)
      for (const b of a.baselines) expect(Number.isFinite(b.profitPH)).toBe(true)
    }
  }
}, 600000)

it("budget cap filters recommendations but keeps candidates visible", async () => {
  const { getUpgradeCompareApi, config } = await boot()
  // 预算 1 金币：所有候选必然超预算 → 无推荐，但候选列表完整且带标记
  const tiny = await getUpgradeCompareApi({ presets: [{ index: 0, config }], action: "cheesesmithing", evalMode: "all", budget: 1 })
  const a1 = tiny[0].actions[0]
  expect(a1.candidates.length).toBeGreaterThan(0)
  expect(a1.candidates.every(c => c.overBudget === true)).toBe(true)
  expect(Object.keys(a1.best).length).toBe(0)

  // 预算 1 万亿：全部放行 → 有推荐，无标记
  const huge = await getUpgradeCompareApi({ presets: [{ index: 0, config }], action: "cheesesmithing", evalMode: "all", budget: 1e12 })
  const a2 = huge[0].actions[0]
  expect(Object.keys(a2.best).length).toBeGreaterThan(0)
  expect(a2.candidates.every(c => !c.overBudget)).toBe(true)
}, 600000)

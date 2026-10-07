import { calculatePhilosopherEnhanceFlow } from "@/calculator/enhance"
import { getItemDetailOf, getPriceOf } from "@/common/apis/game"
import { getCraftCostOf } from "@/common/apis/game/craft"
import { useGameStoreOutside } from "@/pinia/stores/game"

export interface PhilosopherCostOptions {
  /** 起点底材等级，默认 0 */
  originLevel?: number
  /** 福气口径（undefined = 跟随全局 buff，与 philosopher 页默认一致） */
  useBlessedInPhilosopher?: boolean
}

export interface PhilosopherCostResult {
  /** 最优方案的纯料成本（不含时薪/税，与市场买价同口径可比） */
  totalCost: number
  mirrorCount: number
  philosopherProtectLevel: number
  protectLevel: number
}

/** 买价侧无卖单时回退制造成本（买不到就自己造），与 calculator handlePrice 同口径 */
function effectiveAskOf(hrid: string, level: number = 0): number {
  let price = getPriceOf(hrid, level).ask
  if (price < 0) {
    const craft = getCraftCostOf(hrid)
    if (craft >= 0) price = craft
  }
  return price
}

/** 垫子单位成本：本体/指定垫子/守护镜三者取最低（与 EnhanceCalculator.protectionItem 同口径） */
function protectionUnitCostOf(hrid: string): number {
  const item = getItemDetailOf(hrid)
  const hrids = [hrid, ...(item.protectionItemHrids ?? []), "/items/mirror_of_protection"]
  let best = -1
  for (const p of hrids) {
    const price = effectiveAskOf(p)
    if (price >= 0 && (best < 0 || price < best)) best = price
  }
  return best
}

const cache = new Map<string, PhilosopherCostResult | null>()
// 市场价或玩家配置变化后缓存全部作废
watch(() => useGameStoreOutside().marketData, () => cache.clear())
watch(() => useGameStoreOutside().gameData, () => cache.clear())

/**
 * 「买低级 + 贤者镜冲到 targetLevel」的最优纯料成本。
 * 内部遍历 philosopherProtectLevel × protectLevel 候选取最低方案，
 * 引擎复用 calculatePhilosopherEnhanceFlow（线性方程组求期望动作数）。
 * 任何关键单价（底材/镜子/强化材料）拿不到时返回 null。
 */
export function philosopherCostOf(hrid: string, targetLevel: number, opts: PhilosopherCostOptions = {}): PhilosopherCostResult | null {
  if (targetLevel <= 1) return null
  const originLevel = opts.originLevel ?? 0
  const key = `${hrid}|${targetLevel}|${originLevel}|${String(opts.useBlessedInPhilosopher)}`
  if (cache.has(key)) return cache.get(key)!

  let result: PhilosopherCostResult | null = null
  try {
    const baseCost = effectiveAskOf(hrid, originLevel)
    const mirrorUnitCost = effectiveAskOf("/items/philosophers_mirror")
    const protCost = protectionUnitCostOf(hrid)
    let enhUnitCost = 0
    for (const ic of getItemDetailOf(hrid).enhancementCosts ?? []) {
      const unit = effectiveAskOf(ic.itemHrid)
      if (unit < 0) {
        enhUnitCost = -1
        break
      }
      enhUnitCost += unit * ic.count
    }
    if (baseCost < 0 || mirrorUnitCost < 0 || enhUnitCost < 0) {
      cache.set(key, null)
      return null
    }

    for (let philosopherProtectLevel = 1; philosopherProtectLevel < targetLevel; philosopherProtectLevel++) {
      for (let protectLevel = 1; protectLevel <= philosopherProtectLevel; protectLevel++) {
        const flow = calculatePhilosopherEnhanceFlow({
          hrid,
          targetLevel,
          protectLevel,
          philosopherProtectLevel,
          useBlessedInPhilosopher: opts.useBlessedInPhilosopher
        })
        if (!flow) continue
        if (flow.protectionCount > 1e-10 && protCost < 0) continue

        const totalCost = flow.baseItemCount * baseCost
          + flow.totalActions * enhUnitCost
          + flow.protectionCount * (protCost < 0 ? 0 : protCost)
          + flow.mirrorCount * mirrorUnitCost
        if (!result || totalCost < result.totalCost) {
          result = {
            totalCost,
            mirrorCount: flow.mirrorCount,
            philosopherProtectLevel,
            protectLevel
          }
        }
      }
    }
  } catch {
    result = null
  }
  cache.set(key, result)
  return result
}

import type { MarketItemPrice } from "~/market"
import { useGameStoreOutside } from "@/pinia/stores/game"
import { getMarketDataApi, getPriceOf } from "./index"

export type RobustSide = "ask" | "bid"

export interface RobustPrice {
  price: number
  source: RobustSide | "median" | "avg" | "invalid"
  /** 当前挂单价超出参考值 GUARD_K 倍，已回退参考价 */
  degraded: boolean
  /** 薄市场：近期无成交（avg 缺失）也无中位数，挂单价可信度低，未改数 */
  thin: boolean
}

/** 挂单价超过参考值该倍数视为极端（天价挂单） */
const GUARD_K = 3

let medianMap: Record<string, { a?: number, b?: number }> = {}
watch(() => useGameStoreOutside().priceMedian, (v) => {
  medianMap = v?.m ?? {}
}, { immediate: true })

/**
 * 鲁棒挂单价：薄市场孤例天价挂单不直接当市价用。
 * 参照优先级 = 近 14 天滚动中位数（market-median.json）> 官方近期成交均价（avg）；
 * 两者都缺（薄市场冷启动）时保持原价仅打 thin 标记。
 * 官方 marketplace.json 每档只有 ask/bid/avg/vol 四个数、无挂单明细，
 * 跨挂单中位数不可算，故用时间维度中位数代替。
 */
export function robustPriceOf(hrid: string, level: number, side: RobustSide): RobustPrice {
  const item = getMarketDataApi().marketData[hrid]?.[level] as MarketItemPrice | undefined
  const raw = (side === "ask" ? item?.ask : item?.bid) ?? -1
  if (raw <= 0) {
    return { price: -1, source: "invalid", degraded: false, thin: false }
  }
  const med = medianMap[`${hrid}@${level}`]?.[side === "ask" ? "a" : "b"]
  const avg = typeof item?.avg === "number" && item.avg > 0 ? item.avg : -1
  const ref = typeof med === "number" ? med : avg > 0 ? avg : undefined
  if (ref === undefined) {
    return { price: raw, source: side, degraded: false, thin: true }
  }
  if (raw > ref * GUARD_K) {
    return { price: ref, source: typeof med === "number" ? "median" : "avg", degraded: true, thin: false }
  }
  return { price: raw, source: side, degraded: false, thin: false }
}

/**
 * 与 getPriceOf 同口径（含买/卖档位换算），但当前挂单价被判极端时回退参考价。
 * 回退值不再走 ±1 档换算——档位步长在这个量级是噪声。
 */
export function guardedPriceOf(hrid: string, level: number, side: RobustSide): number {
  const rp = robustPriceOf(hrid, level, side)
  if (rp.degraded) {
    return rp.price
  }
  return side === "ask" ? getPriceOf(hrid, level).ask : getPriceOf(hrid, level).bid
}

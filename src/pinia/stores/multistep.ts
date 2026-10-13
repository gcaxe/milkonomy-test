import type { PriceStatus } from "./game"
import type { MultistepPlan } from "@/pages/multistep/types"
import type { BalanceStep } from "@/pages/multistep/utils/balance"
import { defineStore } from "pinia"

/**
 * 多步工具（税前/税后多步配方推荐）跨页共享状态：
 * - snapshot：开始计算时的装配预设（序列化）+ 买价/卖价选项快照（只存选了哪个选项，不存价格）
 * - preTax：税前多步配方推荐的计算结果（切换页面后保留）
 */

export interface RecommendSnapshot {
  /** 装配预设序列化（Maps 转对象后 JSON） */
  configJson: string
  /** 买价选项（左价/左价-/右价/右价+/市场价格） */
  buyStatus: PriceStatus
  /** 卖价选项 */
  sellStatus: PriceStatus
  at: number
}

export interface PreTaxRecommendRow {
  /** 起始物品（驱动的叶子原料） */
  startItem: string
  /** 最终产物 */
  finalItem: string
  /** 税前日利润 */
  profitPD: number
  /** 税前小时利润 */
  profitPH: number
  /** 利润率 */
  profitRate: number
  /** 利润/次（1 个最终产物） */
  profitPerUnit: number
  /** 构建出的蓝图（坐标归零；税后页据此重算） */
  plan: MultistepPlan
  /** 处理步骤与工时占比 */
  steps: BalanceStep[]
  /** 配方码 */
  code: string
}

export const useMultistepRecommendStore = defineStore("multistep-recommend", {
  state: () => ({
    snapshot: null as RecommendSnapshot | null,
    preTax: null as PreTaxRecommendRow[] | null
  }),
  actions: {
    setPreTax(snapshot: RecommendSnapshot, rows: PreTaxRecommendRow[]) {
      this.snapshot = snapshot
      this.preTax = rows
    },
    clear() {
      this.snapshot = null
      this.preTax = null
    }
  }
})

/** 装配预设序列化（Maps 转对象后 JSON 化，用于快照比对） */
export function configToJson(config: unknown): string {
  return JSON.stringify(config, (_key, value) => {
    if (value instanceof Map) {
      return Object.fromEntries(value)
    }
    return value
  })
}

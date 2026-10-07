import { DecomposeCalculator } from "@/calculator/alchemy"
import { EnhanceCalculator } from "@/calculator/enhance"
import { getStorageCalculatorItem } from "@/calculator/utils"
import { WorkflowCalculator } from "@/calculator/workflow"
import locales, { getTrans } from "@/locales"
import { useGameStoreOutside } from "@/pinia/stores/game"
import { usePlayerStoreOutside } from "@/pinia/stores/player"
import { getGameDataApi } from "../game"

import { getUsedPriceOf } from "../price"
import { handlePage, handlePush, handleSearch, handleSort } from "../utils"

const { t } = locales.global
export async function getEnhanposerDataApi(params: any, onProgress?: (pct: number) => void) {
  let profitList: WorkflowCalculator[] = []

  // 缓存指纹：市场快照 + 配装版本 + 买/卖价侧——任一变化都必须重算，否则换配装后结果锁死
  const marketTs = useGameStoreOutside().marketData?.timestamp
  const fp = `${marketTs}-v${usePlayerStoreOutside().configVersion}-buy${useGameStoreOutside().buyStatus}-sell${useGameStoreOutside().sellStatus}`

  const cached = useGameStoreOutside().getEnhanposerCache(fp)
  if (cached && cached.length > 0) {
    profitList = cached
  } else {
    // ★ 不再做 localStorage 持久化恢复：WorkflowCalculator 是类实例，JSON 往返会丢
    // getter 与部分字段，恢复出的"半残行"正是假账与渲染崩溃（reading '0'）的来源；
    // 刷新页面重算几秒即可，数据永远新鲜正确
    await new Promise(resolve => setTimeout(resolve, 300))
    const startTime = Date.now()
    try {
      profitList = profitList.concat(await calcEnhanceProfit(onProgress))
    } catch (e: any) {
      console.error(e)
    }
    useGameStoreOutside().setEnhanposerCache(profitList, fp)
    ElMessage.success(t("计算完成，耗时{0}秒", [(Date.now() - startTime) / 1000]))
  }

  profitList = profitList.filter((item) => {
    const eh = (item.calculator as DecomposeCalculator)?.enhanceLevel
    if (params.maxLevel && eh != null && eh > params.maxLevel) return false
    if (params.minLevel && eh != null && eh < params.minLevel) return false
    return true
  })

  return handlePage(handleSort(handleSearch(profitList, params), params), params)
}

/**
 * 分片异步计算：每 8 个物品让出主线程一次，进度通过 onProgress 回调（0-100），
 * 避免整轮同步计算把页面卡死（同 enhanposest 的模式）
 */
async function calcEnhanceProfit(onProgress?: (p: number) => void): Promise<WorkflowCalculator[]> {
  const gameData = getGameDataApi()
  const list = Object.values(gameData.itemDetailMap).filter((item: any) => item.enhancementCosts)
  const profitList: WorkflowCalculator[] = []

  for (let ix = 0; ix < list.length; ix++) {
    const item: any = list[ix]
    // 找第一个有卖价的等级作为买入等级
    let baseLevel = 0
    for (let lv = 1; lv <= 5; lv++) {
      if (getUsedPriceOf(item.hrid, lv, "ask") !== -1) {
        baseLevel = lv
        break
      }
    }
    if (baseLevel === 0 && getUsedPriceOf(item.hrid, 0, "ask") === -1) {
      continue
    }

    // 从 baseLevel+1 开始：买入Lv5只能强化到Lv6+
    for (let enhanceLevel = baseLevel + 1; enhanceLevel <= 20; enhanceLevel++) {
      if (getUsedPriceOf(item.hrid, baseLevel, "ask") === -1) {
        continue
      }

      let bestProfit = -Infinity
      let bestCal: WorkflowCalculator | undefined
      for (let protectLevel = (enhanceLevel > 2 ? 2 : enhanceLevel); protectLevel <= enhanceLevel; protectLevel++) {
        const enhancer = new EnhanceCalculator({ enhanceLevel, protectLevel, originLevel: baseLevel, hrid: item.hrid })
        for (let catalystRank = 0; catalystRank <= 2; catalystRank++) {
          if (!useGameStoreOutside().checkSecret() && item.itemLevel > 1) {
            continue
          }

          const decomposer = new DecomposeCalculator({ enhanceLevel, hrid: item.hrid, catalystRank })
          if (!decomposer.available) {
            continue
          }

          if (!enhancer.profitable) {
            continue
          }

          const c = new WorkflowCalculator([
            getStorageCalculatorItem(enhancer),
            getStorageCalculatorItem(decomposer)
          ], `${getTrans("强化分解")}+${enhanceLevel}`)

          c.run()

          if (c.result.profitPH > bestProfit) {
            bestProfit = c.result.profitPH
            bestCal = c
          }
        }
      }
      bestCal && handlePush(profitList, bestCal)
    }

    // 每 8 个物品让出主线程，刷新进度条，页面保持可响应
    if (onProgress && (ix % 8 === 0 || ix === list.length - 1)) {
      onProgress(Math.round(((ix + 1) / list.length) * 100))
      await new Promise(resolve => setTimeout(resolve, 0))
    }
  }

  return profitList
}

import { DecomposeCalculator } from "@/calculator/alchemy"
import { EnhanceCalculator } from "@/calculator/enhance"
import { getStorageCalculatorItem } from "@/calculator/utils"
import { WorkflowCalculator } from "@/calculator/workflow"
import { getTrans } from "@/locales"
import { useGameStoreOutside } from "@/pinia/stores/game"
import { usePlayerStoreOutside } from "@/pinia/stores/player"
import { getGameDataApi } from "../game"

import { getUsedPriceOf } from "../price"
import { handlePage, handlePush, handleSearch, handleSort } from "../utils"

/** 查 */
export async function getEnhanposestDataApi(params: any, onProgress?: (pct: number) => void) {
  let profitList: WorkflowCalculator[] = []
  const marketTs = useGameStoreOutside().marketData?.timestamp ?? 0

  // 缓存指纹：市场快照 + 配装版本 + 买卖价侧——任一变化必须重算。
  // ★ localStorage 持久化（mk_enhposest_v2）已移除：WorkflowCalculator 类实例经 JSON
  // 往返会丢 getter 与嵌套字段，恢复的"半残行"是假账与渲染崩溃（reading '0'）的来源
  const cacheId = `enhanposest:${marketTs}:v${usePlayerStoreOutside().configVersion}:b${useGameStoreOutside().buyStatus}:s${useGameStoreOutside().sellStatus}`
  const mem = useGameStoreOutside().getJungleCache(cacheId)
  if (mem && mem.length > 0) {
    profitList = mem
  } else {
    // 同指纹并发请求合并：等待进行中的那轮算完共用结果
    const inflight = inflightMap.get(cacheId)
    if (inflight) {
      profitList = await inflight
    } else {
      console.log("[SUPER] 计算中...")
      const startTime = Date.now()
      const job = calcEnhanceProfit(onProgress).catch((e: any) => {
        console.error(e)
        return [] as WorkflowCalculator[]
      }).then((list) => {
        useGameStoreOutside().setJungleCache(list, cacheId)
        console.log(`[SUPER] 计算完成 ${list.length} 条, ${((Date.now() - startTime) / 1000).toFixed(1)}s`)
        inflightMap.delete(cacheId)
        return list
      })
      inflightMap.set(cacheId, job)
      profitList = await job
    }
  }

  profitList = profitList.filter((item) => {
    const eh = (item.calculator as DecomposeCalculator)?.enhanceLevel
    if (params.maxLevel && eh != null && eh > params.maxLevel) return false
    if (params.minLevel && eh != null && eh < params.minLevel) return false
    return true
  })

  return handlePage(handleSort(handleSearch(profitList, params), params), params)
}

/** 同指纹进行中的计算（并发去重） */
const inflightMap = new Map<string, Promise<WorkflowCalculator[]>>()

/**
 * 分片异步计算：每 8 个物品让出主线程一次，进度通过 onProgress 回调（0-100），
 * 避免整轮同步计算把页面卡死一分钟
 */
async function calcEnhanceProfit(onProgress?: (p: number) => void): Promise<WorkflowCalculator[]> {
  const gameData = getGameDataApi()
  const list = Object.values(gameData.itemDetailMap).filter((item: any) => item.enhancementCosts)
  const profitList: WorkflowCalculator[] = []
  const escapeLevels = [-1, 0, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
  const originLevels = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]
  const targetLevels = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]

  let pushedTotal = 0

  for (let ix = 0; ix < list.length; ix++) {
    const item: any = list[ix]
    for (let _ti = targetLevels.length - 1; _ti >= 0; _ti--) {
      const enhanceLevel = targetLevels[_ti]
      let bestProfit = -Infinity
      let bestCal: WorkflowCalculator | undefined

      for (let oi = 0; oi < originLevels.length; oi++) {
        const originLevel = originLevels[oi]
        if (getUsedPriceOf(item.hrid, originLevel, "ask") === -1) continue

        for (let ei = 0; ei < escapeLevels.length; ei++) {
          const escapeLevel = escapeLevels[ei]
          if (originLevel >= enhanceLevel || escapeLevel >= originLevel) continue

          // 缓存 protectLevel 循环内的 enhancer（仅 depend on enhanceLevel+protectLevel，不依赖 catalyst）
          for (let protectLevel = (enhanceLevel > 2 ? 2 : enhanceLevel); protectLevel <= enhanceLevel; protectLevel++) {
            const enhancer = new EnhanceCalculator({ enhanceLevel, escapeLevel, originLevel, protectLevel, hrid: item.hrid })
            if (!enhancer.available || !enhancer.profitable) continue

            // 同一个 enhancer 复用于 3 种 catalyst
            for (let catalystRank = 0; catalystRank <= 2; catalystRank++) {
              const c = new WorkflowCalculator([
                getStorageCalculatorItem(enhancer),
                getStorageCalculatorItem(new DecomposeCalculator({ enhanceLevel, hrid: item.hrid, catalystRank }))
              ], `+${originLevel} ${getTrans("→")} +${enhanceLevel}`)

              c.run()

              if (c.result.profitPH > bestProfit) {
                bestProfit = c.result.profitPH
                bestCal = c
              }
            }
          }
        }
      }

      if (bestCal) {
        handlePush(profitList, bestCal)
        pushedTotal++
      }
    }

    // 每 8 个物品让出主线程，刷新进度条，页面保持可响应
    if (onProgress && (ix % 8 === 0 || ix === list.length - 1)) {
      onProgress(Math.round(((ix + 1) / list.length) * 100))
      await new Promise(resolve => setTimeout(resolve, 0))
    }
  }

  console.log(`[SUPER] 物品:${list.length} 推送:${pushedTotal} 最终:${profitList.length}`)
  return profitList
}

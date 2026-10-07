import { getGameDataApi } from "@/common/apis/game"
import { getTrans } from "@/locales"
import { useGameStore } from "@/pinia/stores/game"
import { findProducingActionOf, getAlchemyActionOptionsOf } from "./recipes"

export interface ItemOption {
  hrid: string
  label: string
}

/** 全部可交易物品选项（按中文名排序），供 [上部] 与红节点共用 */
export function getTradableItemOptions(): ItemOption[] {
  const gameData = useGameStore().gameData
  if (!gameData) return []
  return Object.values(gameData.itemDetailMap)
    .filter(item => item.isTradable)
    .map(item => ({ hrid: item.hrid, label: getTrans(item.name) }))
    .sort((a, b) => a.label.localeCompare(b.label, "zh"))
}

/** 处理方式节点第二个下拉的可选物品：A=有唯一产配方的产物（含不可交易产物，如精炼披风）；B=可炼金的原料。按 gameData 缓存 */
let _processOptionsCache: { data: unknown, A: ItemOption[], B: ItemOption[] } | null = null
export function getProcessItemOptions(cls: "A" | "B"): ItemOption[] {
  const gameData = getGameDataApi()
  if (!gameData) return []
  if (_processOptionsCache?.data !== gameData) {
    const A: ItemOption[] = []
    const B: ItemOption[] = []
    for (const item of Object.values(gameData.itemDetailMap)) {
      if (!item.isTradable) {
        // 三造产物允许不可交易物品（如精炼披风：游戏中不可挂单但可三造），配方照常解析
        if (findProducingActionOf(item.hrid)) {
          A.push({ hrid: item.hrid, label: getTrans(item.name) })
        }
        continue
      }
      const opt = { hrid: item.hrid, label: getTrans(item.name) }
      if (findProducingActionOf(item.hrid)) A.push(opt)
      if (getAlchemyActionOptionsOf(item.hrid).length) B.push(opt)
    }
    A.sort((a, b) => a.label.localeCompare(b.label, "zh"))
    B.sort((a, b) => a.label.localeCompare(b.label, "zh"))
    _processOptionsCache = { data: gameData, A, B }
  }
  return cls === "A" ? _processOptionsCache.A : _processOptionsCache.B
}

/** 强化节点第一个下拉的可选物品：只接受 +0 的各种装备（有强化材料的装备）。按 gameData 缓存 */
let _enhanceableOptionsCache: { data: unknown, list: ItemOption[] } | null = null
export function getEnhanceableItemOptions(): ItemOption[] {
  const gameData = getGameDataApi()
  if (!gameData) return []
  if (_enhanceableOptionsCache?.data !== gameData) {
    const list = Object.values(gameData.itemDetailMap)
      .filter(item => item.isTradable && item.equipmentDetail != null && (item.enhancementCosts?.length ?? 0) > 0)
      .map(item => ({ hrid: item.hrid, label: getTrans(item.name) }))
      .sort((a, b) => a.label.localeCompare(b.label, "zh"))
    _enhanceableOptionsCache = { data: gameData, list }
  }
  return _enhanceableOptionsCache.list
}

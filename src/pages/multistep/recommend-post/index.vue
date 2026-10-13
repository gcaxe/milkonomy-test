<script lang="ts" setup>
import { ElMessage } from "element-plus"
import { ref } from "vue"
import { usePriceStatus } from "@/common/composables/usePriceStatus"
import ActionConfig from "@/pages/dashboard/components/ActionConfig.vue"
import GameInfo from "@/pages/dashboard/components/GameInfo.vue"
import PriceStatusSelect from "@/pages/dashboard/components/PriceStatusSelect.vue"
import { useGameStore } from "@/pinia/stores/game"
import { configToJson, useMultistepRecommendStore } from "@/pinia/stores/multistep"
import { usePlayerStore } from "@/pinia/stores/player"
import RecommendTable, { type RecommendDisplayRow } from "../components/RecommendTable.vue"
import { balanceAndMutate } from "../utils/balance"

// 触发 player store 初始化
void usePlayerStore()

const { t } = useI18n()
const onPriceStatusChange = usePriceStatus("recommend-post-price-status")
const store = useMultistepRecommendStore()

const computing = ref(false)
const rows = ref<RecommendDisplayRow[]>([])

/** 获取计算结果：税后重算税前多步配方（红节点只能购买、绿节点只能计税出售），重新排序 */
async function onFetch() {
  if (computing.value) return
  const snapshot = store.snapshot
  const preTax = store.preTax
  if (!snapshot || !preTax) {
    warn()
    return
  }
  // 装配或买卖价选项与快照不一致
  const sameConfig = snapshot.configJson === configToJson(usePlayerStore().config)
  const sameStatus = snapshot.buyStatus === useGameStore().buyStatus && snapshot.sellStatus === useGameStore().sellStatus
  if (!sameConfig || !sameStatus) {
    warn()
    return
  }
  computing.value = true
  await new Promise(resolve => setTimeout(resolve, 50))
  try {
    const out: RecommendDisplayRow[] = []
    for (const r of preTax) {
      // store 数据是响应式代理，structuredClone 无法克隆——用 JSON 深拷贝
      const plan = JSON.parse(JSON.stringify(r.plan)) as typeof r.plan
      // 绿节点全部改为计税出售（金币本身免税，口径一致）
      for (const n of plan.nodes) {
        if (n.kind === "var" && (n.varKind === "green" || n.varKind === "rainbow")) n.sellMode = "sell"
      }
      const res = balanceAndMutate(plan.nodes, plan.wires, plan.rows)
      if (!res.driver || res.hourlyProfit == null) continue
      const finalGreen = plan.nodes.find(n => n.kind === "var" && n.varKind === "green" && n.hrid === r.finalItem)
      const finalQ = finalGreen?.count ?? 0
      if (finalQ <= 0) continue
      out.push({
        startItem: r.startItem,
        finalItem: r.finalItem,
        profitPD: res.hourlyProfit * 24,
        profitPH: res.hourlyProfit,
        profitRate: res.profitRate,
        profitPerUnit: res.profit / finalQ,
        steps: res.steps,
        code: r.code,
        postCode: r.postCode
      })
    }
    out.sort((a, b) => b.profitPD - a.profitPD)
    rows.value = out
    ElMessage.success(t("已获取税后计算结果，共 {0} 条", [out.length]))
  } catch (e) {
    console.error(e)
    ElMessage.error(t("计算失败，请重试"))
  } finally {
    computing.value = false
  }
}

/** 提示停留 5 秒再消失 */
function warn() {
  ElMessage({
    message: t("先在税前多步里计算，不修改装配、买卖价等，再回这里获取计算结果"),
    type: "warning",
    duration: 5000
  })
}
</script>

<template>
  <div class="app-container">
    <!-- [顶部]：与税前多步配方推荐一致 -->
    <div class="game-info">
      <GameInfo />
      <div><ActionConfig /></div>
      <PriceStatusSelect @change="onPriceStatusChange" />
    </div>

    <!-- [上部]：只有「获取计算结果」按钮 -->
    <el-card class="mt-5">
      <el-button type="primary" :loading="computing" @click="onFetch">
        {{ t('获取计算结果') }}
      </el-button>
    </el-card>

    <!-- [主体]：与税前主体几乎一样，但利润为税后口径（绿节点计税出售） -->
    <RecommendTable :rows="rows" :loading="computing" />
  </div>
</template>

<style lang="scss" scoped>
.game-info {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}
</style>

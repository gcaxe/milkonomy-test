<script lang="ts" setup>
import { ElMessage } from "element-plus"
import { ref } from "vue"
import { usePriceStatus } from "@/common/composables/usePriceStatus"
import ActionConfig from "@/pages/dashboard/components/ActionConfig.vue"
import GameInfo from "@/pages/dashboard/components/GameInfo.vue"
import PriceStatusSelect from "@/pages/dashboard/components/PriceStatusSelect.vue"
import { useGameStore } from "@/pinia/stores/game"
import { configToJson, type PreTaxRecommendRow, useMultistepRecommendStore } from "@/pinia/stores/multistep"
import { usePlayerStore } from "@/pinia/stores/player"
import RecommendTable, { type RecommendDisplayRow } from "../components/RecommendTable.vue"
import { balanceAndMutate } from "../utils/balance"
import { encodePlanCode } from "../utils/planCode"
import { searchChains } from "../utils/recommend"

// 触发 player store 初始化（buffs/装备/等级），与多步蓝图同源
void usePlayerStore()

const { t } = useI18n()
const onPriceStatusChange = usePriceStatus("recommend-pre-price-status")
const store = useMultistepRecommendStore()

// —— 上部筛选 ——
/** 最多检索的负/低利润路径数量（II 类单步上限，0-5，默认 0） */
const maxII = ref(0)
const maxIIOptions = [0, 1, 2, 3, 4, 5]
/** 利润率 > xx %（0-1000，默认 0） */
const profitRateMin = ref(0)
/** 检索税前日利润大于等于 xx M 的正利润路径（≥30，默认 70；用户输入 M，内部换算为元） */
const thresholdM = ref(70)
/** 排除装备（默认勾选）：任何一步都不能有装备参与 */
const excludeEquipment = ref(true)
/** 排除护符（默认勾选）：任何一步都不能有护符参与 */
const excludeCharms = ref(true)

const computing = ref(false)
const rows = ref<RecommendDisplayRow[]>(store.preTax ?? [])
/** 用户自定搜索路径量（单位 k，最小 1 最大 10000000，默认 100 = 10 万条） */
const pathLimitK = ref(100)
/** 单条路径包含的最大加工（紫节点）次数（最小 2 最大 15，默认 7） */
const maxPurpleNodes = ref(7)
/** 计算计时器（秒） */
const elapsed = ref(0)

/** 开始计算：快照当前装配与买卖价选项（先删旧快照），搜索并评估多步配方 */
async function onStart() {
  if (computing.value) return
  computing.value = true
  elapsed.value = 0
  const startAt = Date.now()
  const timer = window.setInterval(() => {
    elapsed.value = (Date.now() - startAt) / 1000
  }, 100)
  // 让 loading 先渲染出来再跑同步搜索
  await new Promise(resolve => setTimeout(resolve, 50))
  try {
    // 快照：只存买价/卖价选的哪个选项，不存具体价格；先删旧快照（直接替换，不存在两个快照）
    const snapshot = {
      configJson: configToJson(usePlayerStore().config),
      buyStatus: useGameStore().buyStatus,
      sellStatus: useGameStore().sellStatus,
      at: Date.now()
    }
    const results = searchChains({
      threshold: thresholdM.value * 1_000_000,
      maxII: maxII.value,
      maxPurpleNodes: maxPurpleNodes.value,
      profitRateMin: profitRateMin.value,
      excludeEquipment: excludeEquipment.value,
      excludeCharms: excludeCharms.value
    }, pathLimitK.value * 1000)
    const preTaxRows: PreTaxRecommendRow[] = []
    for (const r of results) {
      // 税前配方码：绿节点保留于背包
      const code = await encodePlanCode(r.plan)
      // 税后配方码：绿/彩虹节点改为计税出售后重新配平，与税后页同一口径
      const postPlan = JSON.parse(JSON.stringify(r.plan)) as typeof r.plan
      for (const n of postPlan.nodes) {
        if (n.kind === "var" && (n.varKind === "green" || n.varKind === "rainbow")) n.sellMode = "sell"
      }
      balanceAndMutate(postPlan.nodes, postPlan.wires, postPlan.rows)
      const postCode = await encodePlanCode(postPlan)
      preTaxRows.push({ ...r, code, postCode })
    }
    store.setPreTax(snapshot, preTaxRows)
    rows.value = preTaxRows.map(({ plan, ...rest }) => ({ ...rest }))
    ElMessage.success(t("计算完成，共 {0} 条多步配方", [preTaxRows.length]))
  } catch (e) {
    console.error(e)
    ElMessage.error(t("计算失败，请重试"))
  } finally {
    window.clearInterval(timer)
    computing.value = false
  }
}
</script>

<template>
  <div class="app-container">
    <!-- [顶部]：与多步利润蓝图一致 -->
    <div class="game-info">
      <GameInfo />
      <div><ActionConfig /></div>
      <PriceStatusSelect @change="onPriceStatusChange" />
    </div>

    <!-- [上部]：简化后的首页上部 -->
    <el-card class="mt-5">
      <div class="filter-title">
        {{ t('利润排行') }}
      </div>
      <div class="filters">
        <span class="filter-item">
          {{ t('最多检索的负/低利润路径数量') }}
          <el-select
            v-model="maxII"
            size="small"
            style="width: 70px"
            :class="{ danger: maxII > 1 }"
          >
            <el-option v-for="v in maxIIOptions" :key="v" :label="String(v)" :value="v" />
          </el-select>
          <el-tooltip v-if="maxII > 1" placement="top" :content="t('选>1的值会导致搜索量大幅增加，可能搜索实际过长')">
            <span class="warn">!</span>
          </el-tooltip>
        </span>
        <span class="filter-item">
          {{ t('利润率>') }}
          <el-input-number v-model="profitRateMin" :min="0" :max="1000" :controls="false" size="small" style="width: 80px" />
          %
        </span>
        <span class="filter-item">
          {{ t('检索税前日利润大于等于') }}
          <el-input-number v-model="thresholdM" :min="30" :controls="false" size="small" style="width: 90px" />
          {{ t('M的正利润路径') }}
        </span>
        <el-checkbox v-model="excludeEquipment">
          {{ t('排除装备') }}
        </el-checkbox>
        <el-checkbox v-model="excludeCharms">
          {{ t('排除护符') }}
        </el-checkbox>
        <el-button type="primary" :loading="computing" @click="onStart">
          {{ t('开始计算') }}
        </el-button>
      </div>
      <!-- [下一行]：单条路径最大加工次数 + 搜索路径量 + 计算计时器（计时器始终可见） -->
      <div class="filters mt-2">
        <span class="filter-item">
          {{ t('设置单条路径包含的最大加工次数为') }}
          <el-input-number v-model="maxPurpleNodes" :min="2" :max="15" :controls="false" size="small" style="width: 80px" />
        </span>
        <span class="filter-item">
          {{ t('设置最大搜索量为') }}
          <el-input-number v-model="pathLimitK" :min="1" :max="10000000" :controls="false" size="small" style="width: 110px" />
          k
          <el-tooltip placement="top" :content="t('搜索量越大越能找到高价值配方')">
            <span class="warn">?</span>
          </el-tooltip>
        </span>
        <span class="timer">
          {{ computing ? t('计算中') : t('计算用时') }} {{ elapsed.toFixed(1) }}s
        </span>
      </div>
    </el-card>

    <!-- [主体]：初始为空，点「开始计算」后按利润排列全部多步配方 -->
    <RecommendTable :rows="rows" :loading="computing" />

    <!-- [底部]：使用说明 -->
    <el-card class="mt-5">
      <div class="filter-title">
        {{ t('使用说明') }}
      </div>
      <div class="usage-text">
        {{ t('税前推荐使用说明') }}
      </div>
    </el-card>
  </div>
</template>

<style lang="scss" scoped>
.game-info {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}
.filter-title {
  font-weight: 600;
  font-size: 16px;
  margin-bottom: 10px;
}
.filters {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}
.filter-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.danger :deep(.el-select__wrapper) {
  box-shadow: 0 0 0 1px #f56c6c inset;
}
.warn {
  color: #f56c6c;
  font-weight: 700;
  cursor: help;
}
.timer {
  color: #909399;
  font-size: 13px;
}
.usage-text {
  white-space: pre-line;
  line-height: 1.9;
  font-size: 13px;
  color: var(--el-text-color-regular);
}
</style>

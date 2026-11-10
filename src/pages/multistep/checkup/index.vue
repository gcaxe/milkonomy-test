<script lang="ts" setup>
import type { MultistepPlan } from "../types"
import type { BalanceResult, BalanceStep } from "../utils/balance"
import ItemIcon from "@@/components/ItemIcon/index.vue"
import * as Format from "@@/utils/format"
import { computed, onMounted, ref } from "vue"
import { getItemDetailOf, getPriceOf } from "@/common/apis/game"
import { SELL_TAX_FACTOR } from "@/common/constants/market"
import { getTrans } from "@/locales"
import { COIN_HRID, useGameStore } from "@/pinia/stores/game"
import { usePlayerStore } from "@/pinia/stores/player"
import { balanceAndMutate } from "../utils/balance"
import { decodePlanCode } from "../utils/planCode"
import { loadRecipes } from "../utils/planStore"

// 触发 player store 初始化（buffs/装备/等级），配平计算与多步蓝图同源
void usePlayerStore()
const gameStore = useGameStore()
const ready = computed(() => !!gameStore.gameData && !!gameStore.marketData)

const { t } = useI18n()
const plans = ref<MultistepPlan[]>([])
const selectedName = ref("")
const viewMode = ref<"standalone" | "chain">("standalone")
const codeInput = ref("")
const codeLoading = ref(false)
const result = ref<BalanceResult | null>(null)
const analyzedPlan = ref<MultistepPlan | null>(null)
const error = ref("")

function refreshPlans() {
  plans.value = loadRecipes()
  if (!plans.value.some(p => p.name === selectedName.value)) {
    selectedName.value = plans.value[0]?.name ?? ""
  }
}

function runCheckup() {
  error.value = ""
  if (!ready.value) {
    error.value = t("游戏数据或行情还没加载完，请稍后再试")
    return
  }
  const plan = plans.value.find(p => p.name === selectedName.value)
  if (!plan) {
    error.value = t("没有找到已保存的多步配方，请先到「多步利润蓝图」保存一条")
    return
  }
  analyze(plan)
}

async function loadFromCode() {
  error.value = ""
  if (!ready.value) {
    error.value = t("游戏数据或行情还没加载完，请稍后再试")
    return
  }
  if (!codeInput.value.trim()) {
    error.value = t("请先粘贴配方码")
    return
  }
  codeLoading.value = true
  try {
    const plan = await decodePlanCode(codeInput.value)
    plan.name = plan.name || t("配方码导入")
    analyze(plan)
    selectedName.value = ""
  } catch (e: any) {
    console.error(e)
    error.value = t("配方码无效，请检查后重试")
    result.value = null
  } finally {
    codeLoading.value = false
  }
}

function analyze(plan: MultistepPlan) {
  try {
    // 深拷贝，避免体检把用户保存的配方数量改掉
    const clone = JSON.parse(JSON.stringify(plan)) as MultistepPlan
    analyzedPlan.value = clone
    result.value = balanceAndMutate(clone.nodes, clone.wires, clone.rows)
  } catch (e: any) {
    console.error(e)
    error.value = String(e?.message ?? e)
    result.value = null
  }
}

onMounted(() => {
  refreshPlans()
})

function itemName(hrid?: string) {
  if (!hrid) return "—"
  return getTrans(getItemDetailOf(hrid)?.name ?? hrid)
}

function money(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—"
  return Format.money(n)
}

function percent(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—"
  return Format.percent(n)
}

function number(n: number | null | undefined, digits = 3) {
  if (n == null || !Number.isFinite(n)) return "—"
  return Format.number(n, digits)
}

function costTime(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—"
  return Format.costTime(n)
}

/** 时间占比条宽度 */
function shareWidth(step: BalanceStep) {
  return `${Math.min(100, Math.max(0, step.share * 100))}%`
}

function stepStatus(step: BalanceStep) {
  if (step.standaloneDailyProfit == null) return "unknown"
  if (step.standaloneDailyProfit >= 0) return "positive"
  return step.share <= 0.05 ? "loss-small" : "loss"
}

function statusText(step: BalanceStep) {
  switch (stepStatus(step)) {
    case "positive": return t("正利润")
    case "loss-small": return t("亏损但占比小")
    case "loss": return t("亏损")
    default: return t("未拆分")
  }
}

function statusType(step: BalanceStep) {
  switch (stepStatus(step)) {
    case "positive": return "success"
    case "loss-small": return "warning"
    case "loss": return "danger"
    default: return "info"
  }
}

function chainRoleText(step: BalanceStep) {
  if (step.chainContributionDaily == null) return t("未拆分")
  return step.chainContributionDaily >= 0 ? t("利润中心") : t("成本中心")
}

function chainRoleType(step: BalanceStep) {
  if (step.chainContributionDaily == null) return "info"
  return step.chainContributionDaily >= 0 ? "success" : "warning"
}

const steps = computed(() => result.value?.steps ?? [])
const negativeSteps = computed(() => steps.value.filter(s => s.standaloneDailyProfit != null && s.standaloneDailyProfit < 0))
const negativeContribution = computed(() => negativeSteps.value.reduce((acc, s) => acc + (s.contributionDaily ?? 0), 0))
const attributionSum = computed(() => steps.value.reduce((acc, s) => acc + (s.contributionDaily ?? 0), 0))
const attributionGap = computed(() => (result.value?.dailyProfit ?? 0) - attributionSum.value)
const chainSum = computed(() => steps.value.reduce((acc, s) => acc + (s.chainContributionDaily ?? 0), 0))
const chainGap = computed(() => (result.value?.dailyProfit ?? 0) - chainSum.value)
const maxLossStep = computed(() => negativeSteps.value.reduce<BalanceStep | null>((min, s) => {
  if (!min) return s
  return (s.standaloneDailyProfit ?? 0) < (min.standaloneDailyProfit ?? 0) ? s : min
}, null))

const batchesPerDay = computed(() => {
  const t = result.value?.totalTime ?? 0
  return t > 0 ? (86400 * 1e9) / t : 0
})

interface LeafRow {
  hrid: string
  level: number
  name: string
  keep: boolean
  perBatch: number
  perDay: number
  volume1h: number
  volumeDay: number | null
  coverage: number | null
  revenueDay: number
}

const leafRows = computed<LeafRow[]>(() => {
  const plan = analyzedPlan.value
  const r = result.value
  if (!plan || !r) return []
  const batches = batchesPerDay.value
  const rows: LeafRow[] = []
  for (const n of plan.nodes) {
    if (n.kind !== "var" || n.varKind !== "green" || !n.hrid) continue
    const perBatch = n.count ?? 0
    if (perBatch <= 0) continue
    const level = n.level ?? 0
    const price = getPriceOf(n.hrid, level)
    const perDay = perBatch * batches
    const volume1h = price.vol ?? -1
    const volumeDay = volume1h > 0 ? volume1h * 24 : null
    const keep = n.sellMode === "keep"
    const revenueDay = !keep && price.bid > 0
      ? perDay * price.bid * (n.hrid === COIN_HRID ? 1 : SELL_TAX_FACTOR)
      : 0
    rows.push({
      hrid: n.hrid,
      level,
      name: itemName(n.hrid),
      keep,
      perBatch,
      perDay,
      volume1h,
      volumeDay,
      coverage: keep || !volumeDay ? null : perDay / volumeDay,
      revenueDay
    })
  }
  return rows.sort((a, b) => b.revenueDay - a.revenueDay)
})

function leafTagType(row: LeafRow) {
  if (row.keep) return "info"
  if (row.coverage == null) return "info"
  if (row.coverage >= 1) return "danger"
  if (row.coverage >= 0.3) return "warning"
  return "success"
}

function leafTagText(row: LeafRow) {
  if (row.keep) return t("保留于背包")
  if (row.coverage == null) return t("无成交量数据")
  if (row.coverage >= 1) return t("超过估算成交量")
  if (row.coverage >= 0.3) return t("产能偏紧")
  return t("产能充足")
}
</script>

<template>
  <div class="app-container checkup-page">
    <div class="page-head">
      <h1>{{ t('多步路线体检') }}</h1>
      <p class="sub-title">
        {{ t('把一条多步配方拆成「满负荷日利润 + 时间占比 + 折算日贡献」，重点看亏损步骤是不是只是成本中心。') }}
      </p>
    </div>

    <el-card class="mb-4">
      <div class="toolbar">
        <el-select v-model="selectedName" class="plan-select" :placeholder="t('选择已保存的多步配方')">
          <el-option v-for="p in plans" :key="p.name" :label="p.name" :value="p.name" />
        </el-select>
        <el-button type="primary" :disabled="!ready" @click="runCheckup">
          {{ t('开始体检') }}
        </el-button>
        <el-button @click="refreshPlans">
          {{ t('刷新配方列表') }}
        </el-button>
      </div>
      <div class="code-row">
        <el-input
          v-model="codeInput"
          type="textarea"
          :rows="2"
          :placeholder="t('或者粘贴多步蓝图生成的配方码（# 后是注释）')"
        />
        <el-button :loading="codeLoading" :disabled="!ready" @click="loadFromCode">
          {{ t('从配方码体检') }}
        </el-button>
      </div>
      <el-alert
        v-if="!ready"
        class="mt-3"
        type="warning"
        :closable="false"
        show-icon
        :title="t('正在加载游戏数据与行情')"
        :description="t('加载完成后「开始体检」按钮才会可用。')"
      />
      <el-alert
        v-if="!plans.length"
        class="mt-3"
        type="info"
        :closable="false"
        show-icon
        :title="t('还没有保存的多步配方')"
        :description="t('请先到「多步利润蓝图」搭好一条链并保存，再回来体检。')"
      />
      <el-alert
        v-if="error"
        class="mt-3"
        type="error"
        :closable="false"
        show-icon
        :title="error"
      />
    </el-card>

    <template v-if="result">
      <el-row :gutter="12" class="mb-4">
        <el-col :xs="12" :sm="8" :md="6">
          <el-card class="stat-card">
            <div class="stat-label">
              {{ t('日利润') }}
            </div>
            <div class="stat-value" :class="{ negative: (result.dailyProfit ?? 0) < 0 }">
              {{ money(result.dailyProfit) }}
            </div>
          </el-card>
        </el-col>
        <el-col :xs="12" :sm="8" :md="6">
          <el-card class="stat-card">
            <div class="stat-label">
              {{ t('利润率') }}
            </div>
            <div class="stat-value" :class="{ negative: (result.profitRate ?? 0) < 0 }">
              {{ percent(result.profitRate) }}
            </div>
          </el-card>
        </el-col>
        <el-col :xs="12" :sm="8" :md="6">
          <el-card class="stat-card">
            <div class="stat-label">
              {{ t('单批利润') }}
            </div>
            <div class="stat-value" :class="{ negative: (result.profit ?? 0) < 0 }">
              {{ money(result.profit) }}
            </div>
          </el-card>
        </el-col>
        <el-col :xs="12" :sm="8" :md="6">
          <el-card class="stat-card">
            <div class="stat-label">
              {{ t('单批耗时') }}
            </div>
            <div class="stat-value">
              {{ costTime(result.totalTime) }}
            </div>
          </el-card>
        </el-col>
        <el-col :xs="12" :sm="8" :md="6">
          <el-card class="stat-card">
            <div class="stat-label">
              {{ t('单批总成本') }}
            </div>
            <div class="stat-value">
              {{ money(result.totalCost) }}
            </div>
          </el-card>
        </el-col>
        <el-col :xs="12" :sm="8" :md="6">
          <el-card class="stat-card">
            <div class="stat-label">
              {{ t('单批税后收入') }}
            </div>
            <div class="stat-value">
              {{ money(result.income) }}
            </div>
          </el-card>
        </el-col>
        <el-col :xs="12" :sm="8" :md="6">
          <el-card class="stat-card">
            <div class="stat-label">
              {{ t('市场税') }}
            </div>
            <div class="stat-value">
              {{ money(result.tax) }}
            </div>
          </el-card>
        </el-col>
        <el-col :xs="12" :sm="8" :md="6">
          <el-card class="stat-card">
            <div class="stat-label">
              {{ t('每天批次数') }}
            </div>
            <div class="stat-value">
              {{ number(batchesPerDay, 1) }}
            </div>
          </el-card>
        </el-col>
      </el-row>

      <el-card class="mb-4">
        <template #header>
          <div class="card-head">
            <span>{{ t('分步归因') }}</span>
            <div class="head-actions">
              <el-radio-group v-model="viewMode" size="small">
                <el-radio-button label="standalone">
                  {{ t('独立口径') }}
                </el-radio-button>
                <el-radio-button label="chain">
                  {{ t('链内口径') }}
                </el-radio-button>
              </el-radio-group>
              <span class="hint">{{ t('独立口径看单步满负荷；链内口径看对整条链的实际贡献') }}</span>
            </div>
          </div>
        </template>
        <el-table :data="steps" size="small" style="width: 100%">
          <el-table-column :label="t('处理物品')" min-width="170">
            <template #default="{ row }">
              <div class="item-cell">
                <ItemIcon :hrid="row.mainHrid" :width="22" :height="22" />
                <span>{{ itemName(row.mainHrid) }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column :label="t('动作')" min-width="140">
            <template #default="{ row }">
              {{ row.actionLabel }}
            </template>
          </el-table-column>
          <el-table-column :label="t('动作次数')" align="right" width="95">
            <template #default="{ row }">
              {{ number(row.actions, 3) }}
            </template>
          </el-table-column>
          <el-table-column :label="t('批次耗时')" align="right" width="110">
            <template #default="{ row }">
              {{ costTime(row.batchTime) }}
            </template>
          </el-table-column>
          <el-table-column :label="t('时间占比')" min-width="170">
            <template #default="{ row }">
              <div class="share-cell">
                <div class="share-bar">
                  <div class="share-fill" :style="{ width: shareWidth(row) }" />
                </div>
                <span>{{ percent(row.share) }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column v-if="viewMode === 'standalone'" :label="t('满负荷日利润')" align="right" min-width="130">
            <template #default="{ row }">
              <span :class="{ negative: (row.standaloneDailyProfit ?? 0) < 0 }">
                {{ money(row.standaloneDailyProfit) }}
              </span>
            </template>
          </el-table-column>
          <el-table-column v-if="viewMode === 'standalone'" :label="t('折算日贡献')" align="right" min-width="130">
            <template #default="{ row }">
              <span :class="{ negative: (row.contributionDaily ?? 0) < 0 }">
                {{ money(row.contributionDaily) }}
              </span>
            </template>
          </el-table-column>
          <el-table-column v-if="viewMode === 'chain'" :label="t('链内收入')" align="right" min-width="130">
            <template #default="{ row }">
              {{ money(row.chainRevenue) }}
            </template>
          </el-table-column>
          <el-table-column v-if="viewMode === 'chain'" :label="t('链内投入')" align="right" min-width="130">
            <template #default="{ row }">
              <span :class="{ negative: (row.chainInputCost ?? 0) > 0 }">
                {{ money(row.chainInputCost) }}
              </span>
            </template>
          </el-table-column>
          <el-table-column v-if="viewMode === 'chain'" :label="t('链内贡献/天')" align="right" min-width="130">
            <template #default="{ row }">
              <span :class="{ negative: (row.chainContributionDaily ?? 0) < 0 }">
                {{ money(row.chainContributionDaily) }}
              </span>
            </template>
          </el-table-column>
          <el-table-column v-if="viewMode === 'standalone'" :label="t('判断')" width="120">
            <template #default="{ row }">
              <el-tag :type="statusType(row)" size="small">
                {{ statusText(row) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column v-if="viewMode === 'chain'" :label="t('链内角色')" width="120">
            <template #default="{ row }">
              <el-tag :type="chainRoleType(row)" size="small">
                {{ chainRoleText(row) }}
              </el-tag>
            </template>
          </el-table-column>
        </el-table>
        <div class="footnote">
          <template v-if="viewMode === 'standalone'">
            {{ t('独立口径合计') }}：{{ money(attributionSum) }}；
            {{ t('实际链日利润') }}：{{ money(result.dailyProfit) }}；
            {{ t('差额') }}：{{ money(attributionGap) }}。
            {{ t('差额来自内部转移、税与强化节点：独立口径用于解释单步满负荷，实际日利润以链路合计为准。') }}
          </template>
          <template v-else>
            {{ t('链内口径合计') }}：{{ money(chainSum) }}；
            {{ t('实际链日利润') }}：{{ money(result.dailyProfit) }}；
            {{ t('差额') }}：{{ money(chainGap) }}。
            {{ t('链内口径把中间品按 bid 内部转移、不计税，叶子收入扣 4% 税，外部红节点按 ask；强化节点未拆分。') }}
          </template>
        </div>
      </el-card>

      <el-card class="mb-4">
        <template #header>
          <div class="card-head">
            <span>{{ t('方差分析') }}</span>
          </div>
        </template>
        <div class="todo-placeholder">
          {{ t('还没做完') }}
        </div>
      </el-card>

      <el-card class="mb-4">
        <template #header>
          <div class="card-head">
            <span>{{ t('结论') }}</span>
          </div>
        </template>
        <p>
          {{ t('这条链的日利润为') }}
          <strong :class="{ negative: (result.dailyProfit ?? 0) < 0 }">{{ money(result.dailyProfit) }}</strong>，
          {{ t('利润率为') }} <strong>{{ percent(result.profitRate) }}</strong>，
          {{ t('单批耗时') }} <strong>{{ costTime(result.totalTime) }}</strong>。
        </p>
        <template v-if="negativeSteps.length">
          <p>
            {{ t('有') }} <strong>{{ negativeSteps.length }}</strong> {{ t('个步骤满负荷日利润为负；按时间占比折算后合计') }}
            <strong class="negative">{{ money(negativeContribution) }}</strong>{{ t('/天') }}。
            <template v-if="maxLossStep">
              {{ t('最大亏损步骤是') }}
              <strong>{{ itemName(maxLossStep.mainHrid) }} · {{ maxLossStep.actionLabel }}</strong>，
              {{ t('满负荷') }} {{ money(maxLossStep.standaloneDailyProfit) }}{{ t('/天') }}，
              {{ t('但只占') }} {{ percent(maxLossStep.share) }} {{ t('时间，折算贡献') }}
              {{ money(maxLossStep.contributionDaily) }}{{ t('/天') }}。
            </template>
          </p>
          <p class="explain">
            {{ t('负利润步骤不等于整条链亏损：它可能是把外部原料变成下游必需中间品的成本中心。只要它的时间占比小、产出被下游高价产物吸收，整条链仍然可以成立。') }}
          </p>
        </template>
        <p v-else class="explain">
          {{ t('这条链没有满负荷亏损步骤，所有步骤单卖都不亏。') }}
        </p>
        <p v-if="viewMode === 'chain'" class="explain">
          {{ t('链内口径下，负贡献步骤是成本中心：它创造的价值（叶子+内部转移收入）低于投入（外部+内部转移+隐藏成本）；正贡献步骤是利润中心。') }}
        </p>
      </el-card>

      <el-card class="mb-4">
        <template #header>
          <div class="card-head">
            <span>{{ t('最终叶子与产能') }}</span>
            <span class="hint">{{ t('按项目内 1 小时成交量估算；覆盖率高说明理论日利润会被成交量卡住') }}</span>
          </div>
        </template>
        <el-table :data="leafRows" size="small" style="width: 100%">
          <el-table-column :label="t('产物')" min-width="180">
            <template #default="{ row }">
              <div class="item-cell">
                <ItemIcon :hrid="row.hrid" :width="22" :height="22" />
                <span>{{ row.name }}<template v-if="row.level"> +{{ row.level }}</template></span>
                <el-tag v-if="row.keep" size="small" type="info">
                  {{ t('保留') }}
                </el-tag>
              </div>
            </template>
          </el-table-column>
          <el-table-column :label="t('单批产出')" align="right" min-width="110">
            <template #default="{ row }">
              {{ number(row.perBatch, 3) }}
            </template>
          </el-table-column>
          <el-table-column :label="t('日产出（理论）')" align="right" min-width="130">
            <template #default="{ row }">
              {{ number(row.perDay, 1) }}
            </template>
          </el-table-column>
          <el-table-column :label="t('1h 成交量')" align="right" min-width="110">
            <template #default="{ row }">
              {{ row.volume1h >= 0 ? number(row.volume1h, 0) : '—' }}
            </template>
          </el-table-column>
          <el-table-column :label="t('日成交量（估算）')" align="right" min-width="130">
            <template #default="{ row }">
              {{ row.volumeDay == null ? '—' : number(row.volumeDay, 0) }}
            </template>
          </el-table-column>
          <el-table-column :label="t('占成交量')" align="right" min-width="110">
            <template #default="{ row }">
              {{ row.coverage == null ? '—' : percent(row.coverage) }}
            </template>
          </el-table-column>
          <el-table-column :label="t('产能判断')" width="140">
            <template #default="{ row }">
              <el-tag :type="leafTagType(row)" size="small">
                {{ leafTagText(row) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column :label="t('日收入（估算）')" align="right" min-width="130">
            <template #default="{ row }">
              {{ money(row.revenueDay) }}
            </template>
          </el-table-column>
        </el-table>
      </el-card>

      <el-card>
        <template #header>
          <div class="card-head">
            <span>{{ t('怎么看这张表') }}</span>
          </div>
        </template>
        <ol class="guide">
          <li>{{ t('「满负荷日利润」是假设这一步单独跑 24 小时；为负不代表整条链亏。') }}</li>
          <li>{{ t('「折算日贡献」= 满负荷日利润 × 时间占比；链日利润约等于各步折算贡献之和。') }}</li>
          <li>{{ t('负利润步骤只要时间占比小、产出被下游使用，就可能是成本中心，而不是应该删掉的步骤。') }}</li>
          <li>{{ t('最终叶子看「占成交量」：超过 30% 就要小心，超过 100% 说明理论日利润卖不出去。') }}</li>
          <li>{{ t('日利润是「叶子税后收入 − 外部投入」，没有把中间品库存占用算进分母；要做资金回报率，需要另加中间品占用。') }}</li>
          <li>{{ t('强化节点暂不拆分独立盈亏，强化收益请看强化计算页。') }}</li>
        </ol>
      </el-card>
    </template>
  </div>
</template>

<style lang="scss" scoped>
.checkup-page {
  max-width: 1500px;
}

.page-head {
  margin-bottom: 16px;
}

.page-head h1 {
  margin: 0 0 8px;
  font-size: 26px;
}

.sub-title {
  margin: 0;
  color: var(--el-text-color-secondary);
  line-height: 1.7;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.plan-select {
  width: 320px;
}

.code-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-top: 12px;
}

.code-row :deep(.el-textarea) {
  flex: 1;
}

.mb-4 {
  margin-bottom: 16px;
}

.mt-3 {
  margin-top: 12px;
}

.stat-card {
  height: 100%;
}

.stat-label {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.stat-value {
  margin-top: 6px;
  font-size: 22px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.negative {
  color: var(--el-color-danger);
}

.card-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-weight: 600;
}

.hint {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  font-weight: 400;
}

.head-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.item-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}

.share-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}

.share-bar {
  flex: 1;
  height: 8px;
  overflow: hidden;
  background: var(--el-fill-color-darker);
  border-radius: 4px;
}

.share-fill {
  height: 100%;
  background: var(--el-color-primary);
  border-radius: 4px;
}

.footnote {
  padding-top: 10px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.8;
}

.explain {
  color: var(--el-text-color-regular);
  line-height: 1.9;
}

.todo-placeholder {
  padding: 28px 16px;
  color: var(--el-text-color-secondary);
  text-align: center;
  border: 1px dashed var(--el-border-color);
  border-radius: 8px;
}

.guide {
  padding-left: 20px;
  margin: 0;
  color: var(--el-text-color-regular);
  line-height: 1.9;
}
</style>

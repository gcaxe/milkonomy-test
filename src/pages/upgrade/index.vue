<script lang="ts" setup>
import type { ActionUpgradeResult, EvalMode, PresetUpgradeResult, UpgradeCandidate } from "@/common/apis/upgrade"
import ItemIcon from "@@/components/ItemIcon/index.vue"
import { useMemory } from "@@/composables/useMemory"
import * as Format from "@@/utils/format"
import { QuestionFilled } from "@element-plus/icons-vue"
import { ElMessage } from "element-plus"
import { getMarketDataApi } from "@/common/apis/game"
import { getUpgradeCompareApi, SLOT_LABEL_KEYS, UPGRADE_SLOTS } from "@/common/apis/upgrade"
import { usePriceStatus } from "@/common/composables/usePriceStatus"
import { useGameStore } from "@/pinia/stores/game"
import { usePlayerStore } from "@/pinia/stores/player"
import PriceStatusSelect from "../dashboard/components/PriceStatusSelect.vue"

const { t } = useI18n()
const playerStore = usePlayerStore()
const gameStore = useGameStore()

const selectedPreset = ref(0)
const actionFilter = ref<string>("all")
const evalMode = ref<EvalMode>("all")
const topN = ref(5)
const showAll = ref(false)
const sellOff = useMemory("upgrade-sell-off", true)
const budgetM = useMemory("upgrade-budget-m", null)
const loading = ref(false)
const progressLabel = ref("")
const progressCurrent = ref(0)
const progressTotal = ref(0)
const results = ref<PresetUpgradeResult[]>([])

// 玩家自选基准项目：key = `${预设序号}-${专业}` → 项目键列表（三制造=hrid；炼金=`${hrid}#${玩法}` 区分转化/分解/点金）；空 = 按 topN 自动取
const baselineOverrides = useMemory("upgrade-baseline-overrides", {} as Record<string, string[]>)
const baselineDraft = ref<string[]>([])

const KIND_LABEL_KEYS: Record<string, string> = { transmute: "转化", decompose: "分解", coinify: "点金" }
function baselineKeyOf(b: { hrid: string, kind?: string }) {
  return b.kind ? `${b.hrid}#${b.kind}` : b.hrid
}

function onBaselinePickerOpen(action: ActionUpgradeResult) {
  baselineDraft.value = action.baselines.map(baselineKeyOf)
}

function applyBaselines(key: string, action: ActionUpgradeResult) {
  const defKeys = action.baselines.map(baselineKeyOf).sort().join(",")
  const draftKeys = [...baselineDraft.value].sort().join(",")
  if (!baselineDraft.value.length || draftKeys === defKeys) {
    delete baselineOverrides.value[key]
  } else {
    baselineOverrides.value[key] = [...baselineDraft.value]
  }
  runCompare()
}

function resetBaselines(key: string) {
  delete baselineOverrides.value[key]
  runCompare()
}

const ACTION_OPTIONS = [
  { value: "milking", label: "挤奶" },
  { value: "foraging", label: "采摘" },
  { value: "woodcutting", label: "伐木" },
  { value: "cheesesmithing", label: "锻造" },
  { value: "crafting", label: "制造" },
  { value: "tailoring", label: "裁缝" },
  { value: "cooking", label: "烹饪" },
  { value: "brewing", label: "冲泡" },
  { value: "alchemy", label: "炼金" }
]

const progressPercent = computed(() => {
  if (!progressTotal.value) return 0
  return Math.round((progressCurrent.value / progressTotal.value) * 100)
})

async function runCompare() {
  if (!playerStore.presets[selectedPreset.value]) {
    ElMessage.warning(t("请先选择预设"))
    return
  }
  if (!getMarketDataApi()) {
    ElMessage.warning(t("市场数据未就绪，请稍候"))
    return
  }
  loading.value = true
  results.value = []
  progressCurrent.value = 0
  progressTotal.value = actionFilter.value === "all" ? ACTION_OPTIONS.length : 1
  try {
    results.value = await getUpgradeCompareApi({
      presets: [{ index: selectedPreset.value, config: playerStore.presets[selectedPreset.value] }],
      action: actionFilter.value === "all" ? undefined : (actionFilter.value as Parameters<typeof getUpgradeCompareApi>[0]["action"]),
      evalMode: evalMode.value,
      topN: topN.value,
      baselineOverrides: baselineOverrides.value,
      sellOff: sellOff.value,
      budget: budgetM.value != null && budgetM.value > 0 ? Math.round(budgetM.value * 1e6) : undefined,
      onProgress: (label, current, total) => {
        progressLabel.value = label
        progressCurrent.value = current
        progressTotal.value = total
      }
    })
    if (results.value.length && results.value.every(r => r.actions.length === 0)) {
      ElMessage.warning(t("未找到可提升项"))
    }
  } catch (e) {
    console.error(e)
    ElMessage.error(t("计算失败或结果为空，请打开控制台查看错误"))
  } finally {
    loading.value = false
  }
}

function rowsOf(action: ActionUpgradeResult): UpgradeCandidate[] {
  if (showAll.value) return action.candidates
  return UPGRADE_SLOTS
    .map((slot) => {
      const best = action.best[slot]
      if (best) return best
      // 该部位有候选但全部超预算 → 灰字占位行（无 hrid），不再推天价装备
      return action.candidates.some(c => c.slot === slot)
        ? ({ slot, overBudget: true } as unknown as UpgradeCandidate)
        : null
    })
    .filter(Boolean) as UpgradeCandidate[]
}

function slotLabel(slot: string) {
  return t(SLOT_LABEL_KEYS[slot as keyof typeof SLOT_LABEL_KEYS])
}

function currentOf(action: ActionUpgradeResult, cand: UpgradeCandidate) {
  return action.current[cand.slot]
}

function deltaText(cand: UpgradeCandidate) {
  if (cand.isExpMetric) {
    return `+${Format.number(cand.expDelta, 1)} ${t("经验/时")}`
  }
  return `+${Format.money(cand.profitDelta)}/时`
}

// 切换预设后旧结果作废，清空避免误读
watch(selectedPreset, () => {
  results.value = []
})

// 买卖价侧切换：旧装卖价按卖价侧口径取，已有结果时自动重算
const onPriceStatusChange = usePriceStatus("upgrade-price-status")
function handlePriceStatusChange() {
  onPriceStatusChange()
}
watch(() => [gameStore.buyStatus, gameStore.sellStatus], () => {
  if (results.value.length) runCompare()
})
</script>

<template>
  <div class="app-container">
    <el-card shadow="never">
      <div class="flex flex-wrap items-center gap-4">
        <PriceStatusSelect @change="handlePriceStatusChange" />
        <div class="flex items-center gap-2">
          <span class="font-bold">{{ t("选择预设") }}</span>
          <el-radio-group v-model="selectedPreset">
            <el-radio-button
              v-for="(preset, index) in playerStore.presets"
              :key="index"
              :value="index"
            >
              <span :style="{ color: preset.color }">{{ preset.name || `预设${index + 1}` }}</span>
            </el-radio-button>
          </el-radio-group>
        </div>
        <div class="flex items-center gap-2">
          <span class="font-bold">{{ t("专业") }}</span>
          <el-select v-model="actionFilter" style="width: 120px">
            <el-option :label="t('全部专业')" value="all" />
            <el-option
              v-for="opt in ACTION_OPTIONS"
              :key="opt.value"
              :label="t(opt.label)"
              :value="opt.value"
            />
          </el-select>
        </div>
        <div class="flex items-center gap-2">
          <span class="font-bold">{{ t("比较口径") }}</span>
          <el-radio-group v-model="evalMode">
            <el-radio-button value="all">
              {{ t("全部等级") }}
            </el-radio-button>
            <el-radio-button value="naked">
              {{ t("仅0级") }}
            </el-radio-button>
            <el-radio-button value="sameLevel">
              {{ t("与现装同级") }}
            </el-radio-button>
          </el-radio-group>
        </div>
        <div class="flex items-center gap-2">
          <span>{{ t("基准项目数") }}</span>
          <el-select v-model="topN" style="width: 80px">
            <el-option :value="1" label="1" />
            <el-option :value="2" label="2" />
            <el-option :value="3" label="3" />
            <el-option :value="5" label="5" />
          </el-select>
        </div>
        <div class="flex items-center gap-2">
          <el-tooltip :content="t('单件装备支出上限，超出预算的候选不再推荐（开「卖旧装抵扣」时按净支出计）。留空或 0 = 不限。')" placement="top">
            <span>{{ t("预算上限") }}</span>
          </el-tooltip>
          <el-input-number
            v-model="budgetM"
            :min="0"
            :step="1"
            :precision="1"
            :controls="false"
            :placeholder="t('不限')"
            style="width: 90px"
            @change="results.length && runCompare()"
          />
          <span>M</span>
        </div>
        <div class="flex items-center gap-2">
          <span>{{ t("显示全部候选") }}</span>
          <el-switch v-model="showAll" />
        </div>
        <div class="flex items-center gap-2">
          <el-tooltip :content="t('开启后回本按净支出计：购买成本 − 现装卖价（按卖价侧口径）。卖价侧可在左上角切换。')" placement="top">
            <span>{{ t("卖旧装抵扣") }}</span>
          </el-tooltip>
          <el-switch v-model="sellOff" @change="results.length && runCompare()" />
        </div>
        <el-button type="primary" :loading="loading" @click="runCompare">
          {{ t("开始优化") }}
        </el-button>
      </div>
      <el-progress
        v-if="loading"
        :percentage="progressPercent"
        :format="() => `${progressLabel} (${progressCurrent}/${progressTotal})`"
        class="mt-3"
      />
    </el-card>

    <el-empty v-if="!loading && !results.length" :description="t('选择预设后点击开始优化')" />

    <el-card v-for="preset in results" :key="preset.presetIndex" shadow="never" class="mt-4">
      <template #header>
        <span class="font-bold" :style="{ color: preset.color }">
          {{ t("预设") }}：{{ preset.presetName }}
        </span>
      </template>
      <el-alert type="info" :closable="false" class="mb-4" :title="t('基准=该专业当前等级下利润最高的N个项目（N=基准项目数，可点「选择基准」自选）；提升量=换装后在N个项目上的平均提升；护符只算经验。建议装备后的 +N 为强化等级，成本为该强化等级的市场买价。性价比列=每100万金币的提升量。开「卖旧装抵扣」后回本按净支出（成本−现装卖价）计。')" />
      <template v-for="action in preset.actions" :key="`${preset.presetIndex}-${action.action}`">
        <div class="flex items-baseline gap-3 mt-2 mb-1 flex-wrap">
          <span class="font-bold text-base">{{ action.actionLabel }}</span>
          <span class="text-sm opacity-70">
            {{ t("基准") }}（{{ action.baselines.length }}{{ t("项均值") }} {{ Format.money(action.baselineProfitPH) }}/时）：{{ action.baselines.map(b => b.kind ? `${b.name}(${t(KIND_LABEL_KEYS[b.kind])})` : b.name).join("、") }}
          </span>
          <el-popover placement="bottom" :width="340" trigger="click" @show="onBaselinePickerOpen(action)">
            <template #reference>
              <el-button link type="primary" size="small">
                {{ t("选择基准") }}
              </el-button>
            </template>
            <div style="max-height: 300px; overflow-y: auto">
              <el-checkbox-group v-model="baselineDraft" class="flex flex-col gap-1">
                <el-checkbox v-for="opt in action.baselineOptions" :key="baselineKeyOf(opt)" :value="baselineKeyOf(opt)">
                  {{ opt.name }}（{{ Format.money(opt.profitPH) }}/时）
                  <el-tag v-if="opt.kind" size="small" style="margin-left:4px">
                    {{ t(KIND_LABEL_KEYS[opt.kind]) }}
                  </el-tag>
                </el-checkbox>
              </el-checkbox-group>
            </div>
            <div class="mt-2 flex justify-end gap-2">
              <el-button size="small" @click="resetBaselines(`${preset.presetIndex}-${action.action}`)">
                {{ t("恢复默认") }}
              </el-button>
              <el-button size="small" type="primary" @click="applyBaselines(`${preset.presetIndex}-${action.action}`, action)">
                {{ t("确定") }}
              </el-button>
            </div>
          </el-popover>
        </div>
        <el-table :data="rowsOf(action)" size="small" border>
          <el-table-column type="expand">
            <template #default="{ row }">
              <el-table v-if="row.projects?.length" :data="row.projects" size="small" border>
                <el-table-column :label="t('项目')" min-width="240">
                  <template #default="{ row: p }">
                    <span class="flex items-center gap-1">
                      <ItemIcon :hrid="p.hrid" :width="20" :height="20" />
                      {{ p.name }}
                    </span>
                  </template>
                </el-table-column>
                <el-table-column :label="t('换装前')" align="right" min-width="150">
                  <template #default="{ row: p }">
                    <span class="color-orange font-bold">
                      {{ row.isExpMetric ? `${Format.number(p.expBefore, 1)} ${t("经验/时")}` : `${Format.money(p.profitBefore)}/时` }}
                    </span>
                  </template>
                </el-table-column>
                <el-table-column :label="t('换装后')" align="right" min-width="150">
                  <template #default="{ row: p }">
                    <span class="color-green font-bold">
                      {{ row.isExpMetric ? `${Format.number(p.expAfter, 1)} ${t("经验/时")}` : `${Format.money(p.profitAfter)}/时` }}
                    </span>
                  </template>
                </el-table-column>
              </el-table>
            </template>
          </el-table-column>
          <el-table-column :label="t('部位')" width="70">
            <template #default="{ row }">
              {{ slotLabel(row.slot) }}
            </template>
          </el-table-column>
          <el-table-column :label="t('现装')" min-width="140">
            <template #default="{ row }">
              <template v-if="currentOf(action, row)">
                <ItemIcon :hrid="currentOf(action, row)!.hrid" />
                {{ currentOf(action, row)!.name }}
                <el-tag v-if="currentOf(action, row)!.level" size="small" type="info">
                  +{{ currentOf(action, row)!.level }}
                </el-tag>
              </template>
              <span v-else class="opacity-50">{{ t("无") }}</span>
            </template>
          </el-table-column>
          <el-table-column :label="t('建议装备')" min-width="160">
            <template #default="{ row }">
              <span v-if="!row.hrid" class="opacity-50">{{ t("预算内无候选") }}</span>
              <template v-else>
                <ItemIcon :hrid="row.hrid" />
                {{ row.name }}
                <el-tag v-if="row.evalLevel > 0" size="small" type="warning">
                  +{{ row.evalLevel }}
                </el-tag>
                <el-tag v-else size="small" type="info">
                  {{ t("白板") }}
                </el-tag>
                <el-tag size="small">
                  {{ t("等级") }}{{ row.itemLevel }}
                </el-tag>
              </template>
            </template>
          </el-table-column>
          <el-table-column :label="t('成本')" width="120" align="right">
            <template #default="{ row }">
              <template v-if="row.hrid">
                <div :class="row.overBudget ? 'opacity-50' : ''">
                  <el-tooltip
                    v-if="row.costSource === 'philosopher'"
                    :content="t('市场买价 {0} / 贤者镜路径 {1}，取低', [Format.price(row.marketCost), Format.price(row.mirrorCost)])"
                    placement="top"
                  >
                    <span class="cursor-help">{{ Format.price(row.cost) }} 🪞</span>
                  </el-tooltip>
                  <template v-else>
                    {{ Format.price(row.cost) }}
                  </template>
                  <el-tag v-if="row.overBudget" size="small" type="danger">
                    {{ t("超预算") }}
                  </el-tag>
                </div>
                <div v-if="sellOff && row.oldSellPrice > 0" class="color-gray-400" style="font-size: 12px">
                  {{ t("卖旧装") }} −{{ Format.price(row.oldSellPrice) }}
                </div>
              </template>
              <span v-else class="opacity-50">—</span>
            </template>
          </el-table-column>
          <el-table-column :label="t('提升量')" width="130" align="right">
            <template #default="{ row }">
              <span v-if="!row.hrid" class="opacity-50">—</span>
              <template v-else>
                <span :class="row.isExpMetric ? 'text-purple' : 'text-green'">{{ deltaText(row) }}</span>
                <el-tag v-if="row.isExpMetric" size="small" type="warning" class="ml-1">
                  {{ t("经验") }}
                </el-tag>
              </template>
            </template>
          </el-table-column>
          <el-table-column width="110" align="right">
            <template #header>
              <span class="inline-flex items-center justify-end gap-1">
                {{ t("性价比") }}
                <el-tooltip :content="t('性价比 = 平均每小时提升 ÷ 购买成本 × 1,000,000，即每花 100 万金币能买到的每小时提升量。数值越大越划算。例：换装后每小时多赚 500 金币、装备花 100 万 → 性价比 = 500。')" placement="top">
                  <el-icon class="cursor-help"><QuestionFilled /></el-icon>
                </el-tooltip>
              </span>
            </template>
            <template #default="{ row }">
              <span v-if="!row.hrid" class="opacity-50">—</span>
              <span v-else>{{ Format.number(row.valueRate * 1000000, 1) }}</span>
            </template>
          </el-table-column>
          <el-table-column :label="t('回本(天)')" width="100" align="right">
            <template #default="{ row }">
              <span v-if="!row.hrid || row.isExpMetric" class="opacity-40">—</span>
              <span v-else>{{ Format.number(row.paybackHours / 24, 1) }}</span>
            </template>
          </el-table-column>
        </el-table>
      </template>
      <el-empty
        v-if="!preset.actions.length"
        :image-size="60"
        :description="t('该预设无可提升项或等级不足')"
      />
    </el-card>
  </div>
</template>

<style scoped lang="scss">
@media (max-width: 768px) {
  // 预设/口径单选组按钮多时换行，避免横向溢出被裁剪（页面级滚动锁已禁横向滚动）
  :deep(.el-radio-group) {
    flex-wrap: wrap;
    row-gap: 4px;
  }

  // 顶部配置行间距收紧
  .flex-wrap {
    row-gap: 8px;
  }
}
</style>

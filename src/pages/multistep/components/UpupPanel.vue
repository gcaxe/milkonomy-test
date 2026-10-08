<script lang="ts" setup>
import type { useMultistepGraph } from "../composables/useMultistepGraph"
import type { MultistepPlan, UpupItemRow } from "../types"
import ItemIcon from "@@/components/ItemIcon/index.vue"
import * as Format from "@@/utils/format"
import { Delete, Plus, PriceTag, Sort } from "@element-plus/icons-vue"
import { ElMessage, ElMessageBox } from "element-plus"
import { computed, ref, toRaw } from "vue"
import { COIN_HRID } from "@/pinia/stores/game"
import { getTradableItemOptions } from "../utils/items"
import { decodePlanCode, encodePlanCode } from "../utils/planCode"
import CustomPriceDialog from "./CustomPriceDialog.vue"

const props = defineProps<{ graph: ReturnType<typeof useMultistepGraph> }>()
const { t } = useI18n()

// ===================== 配方码（如炉石卡组码） =====================
const codeText = ref("")
const codeBusy = ref(false)

/** 把当前画布内容打包成配方码（与「保存配方」同一口径：不含坐标） */
function buildCurrentPlan(): MultistepPlan {
  return {
    name: props.graph.planName.value,
    rows: toRaw(props.graph.rows.value),
    nodes: toRaw(props.graph.nodes.value).map(({ x, y, ...rest }) => ({ ...rest, x: 0, y: 0 })),
    wires: toRaw(props.graph.wires.value),
    savedAt: Date.now()
  }
}

/** 生成配方码：填入输入框（# 之后可自行加注释） */
async function onGenCode() {
  if (codeBusy.value) return
  try {
    codeBusy.value = true
    const code = await encodePlanCode(buildCurrentPlan())
    codeText.value = code
    ElMessage.success(t("已生成配方码"))
  } catch (e) {
    console.error(e)
    ElMessage.error(t("生成配方码失败"))
  } finally {
    codeBusy.value = false
  }
}

/** 根据配方码加载配方：# 之后的内容是注释，自动忽略 */
async function onLoadCode() {
  if (codeBusy.value) return
  if (!codeText.value.trim()) {
    ElMessage.warning(t("请先粘贴配方码"))
    return
  }
  try {
    codeBusy.value = true
    const plan = await decodePlanCode(codeText.value)
    props.graph.loadRecipe(plan)
  } catch (e) {
    console.error(e)
    ElMessage.error(t("配方码无效，请检查后重试"))
  } finally {
    codeBusy.value = false
  }
}

// 下拉可选物品：与红节点内选择共用同一来源
const itemOptions = computed(() => getTradableItemOptions())

// 数量输入：只允许十进制正数（>=0），最多保留 3 位小数，非法输入回退为 0
function onCountInput(row: UpupItemRow, val: number | undefined) {
  const n = Number(val)
  if (!Number.isFinite(n) || n < 0) {
    row.count = 0
    return
  }
  row.count = Math.round(n * 1000) / 1000
}

// 行拖动排序（改变谁是"第一行"，即配平基准）
const draggingIndex = ref<number | null>(null)
const dragOverIndex = ref<number | null>(null)
function onRowDragStart(index: number) {
  draggingIndex.value = index
}
function onRowDragOver(index: number) {
  if (draggingIndex.value != null && draggingIndex.value !== index) dragOverIndex.value = index
}
function onRowDrop(index: number) {
  if (draggingIndex.value != null && draggingIndex.value !== index) {
    props.graph.moveRow(draggingIndex.value, index)
  }
  draggingIndex.value = null
  dragOverIndex.value = null
}
function onRowDragEnd() {
  draggingIndex.value = null
  dragOverIndex.value = null
}

const summary = computed(() => props.graph.summary.value)

// 自定义价格（与「首页」同一价格库）：方案中出现的物品去重（金币不参与自定义）
const priceDialogVisible = ref(false)
const planItems = computed(() => {
  const seen = new Set<string>()
  const list: { hrid: string, level: number }[] = []
  for (const n of props.graph.nodes.value) {
    const key = `${n.hrid}|${n.level ?? 0}`
    if (!n.hrid || n.hrid === COIN_HRID || seen.has(key)) continue
    seen.add(key)
    list.push({ hrid: n.hrid, level: n.level ?? 0 })
  }
  return list
})

// 读取配方弹窗
const readDialogVisible = ref(false)
function readPlan(plan: MultistepPlan) {
  props.graph.loadRecipe(plan)
  readDialogVisible.value = false
}
function removePlan(name: string) {
  ElMessageBox.confirm(t("确定删除配方 {0} 吗？", [name]), t("删除配方"), {
    confirmButtonText: t("确定"),
    cancelButtonText: t("取消"),
    type: "warning"
  }).then(() => {
    props.graph.removeRecipe(name)
  }).catch(() => {
    // 取消删除
  })
}
</script>

<template>
  <el-card class="mt-5 upup">
    <!-- 标题区：「多步利润计算」与说明文字；方案名称 -->
    <template #header>
      <div class="upup-header">
        <div class="upup-title">
          <div class="title">
            {{ t('多步利润计算') }}
          </div>
          <div class="desc">
            {{ t('多步利润计算说明') }}
          </div>
        </div>
        <div class="upup-plan">
          <el-button type="primary" plain @click="graph.balance()">
            {{ t('自动配平') }}
          </el-button>
          <el-input
            :model-value="graph.planName.value"
            :placeholder="t('方案名称（可选）')"
            style="width: 200px"
            clearable
            @update:model-value="(val: string | number | boolean | Record<string, unknown> | undefined) => graph.setPlanName(val as string)"
          />
          <el-button :icon="PriceTag" @click="priceDialogVisible = true">
            {{ t('自定义价格') }}
          </el-button>
          <el-button @click="readDialogVisible = true">
            {{ t('读取配方') }}
          </el-button>
          <el-button type="primary" @click="graph.savePlan()">
            {{ t('保存配方') }}
          </el-button>
        </div>
        <!-- 配方码：输入/生成配方码 + 根据配方码加载配方（# 之后是注释） -->
        <div class="upup-code-row">
          <el-input
            v-model="codeText"
            :placeholder="t('配方码（# 之后是注释）')"
            clearable
            style="flex: 1; min-width: 280px"
          />
          <el-button :loading="codeBusy" @click="onLoadCode">
            {{ t('根据配方码加载配方') }}
          </el-button>
          <el-button type="primary" plain :loading="codeBusy" @click="onGenCode">
            {{ t('生成配方码') }}
          </el-button>
        </div>
      </div>
    </template>

    <!-- 起始物品行编辑器（允许同名物品，每行对应一个红节点；最左侧手柄可拖动排序） -->
    <div
      v-for="(row, index) in graph.rows.value"
      :key="row.uid"
      class="upup-row"
      :class="{ 'drag-over': dragOverIndex === index }"
      @dragover.prevent="onRowDragOver(index)"
      @drop.prevent="onRowDrop(index)"
    >
      <el-icon
        class="drag-handle"
        draggable="true"
        :title="t('拖动排序')"
        @dragstart="onRowDragStart(index)"
        @dragend="onRowDragEnd"
      >
        <Sort />
      </el-icon>
      <span class="row-index">{{ index + 1 }}</span>
      <!-- 选择前不渲染图标；选择后显示物品图标 -->
      <ItemIcon v-if="row.hrid" :hrid="row.hrid" :width="28" :height="28" />
      <el-select
        :model-value="row.hrid ?? undefined"
        :placeholder="t('请选择物品')"
        filterable
        style="width: 320px"
        @update:model-value="(val: string | number | boolean | Record<string, unknown> | undefined) => graph.setRowItem(row.uid, val as string)"
      >
        <el-option v-for="opt in itemOptions" :key="opt.hrid" :label="opt.label" :value="opt.hrid">
          <div class="option-item">
            <ItemIcon :hrid="opt.hrid" :width="24" :height="24" />
            <span>{{ opt.label }}</span>
          </div>
        </el-option>
      </el-select>
      <!-- 只有第一行的数量可编辑且保留 +/- 按钮，其余只读（可选中复制） -->
      <el-input-number
        :model-value="row.count"
        :min="0"
        :step="1"
        :precision="3"
        :readonly="index !== 0"
        :controls="index === 0"
        style="width: 160px"
        @update:model-value="(val) => onCountInput(row, val)"
      />
      <el-button :icon="Delete" plain @click="graph.removeRow(row.uid)" />
      <el-button plain @click="graph.focusRowNode(row.uid)">
        {{ t('查看节点') }}
      </el-button>
    </div>

    <div class="row-tools">
      <el-button :icon="Plus" plain class="add-func" @click="graph.addFuncNode()">
        {{ t('添加处理方式') }}
      </el-button>
      <el-button :icon="Plus" plain class="add-enh" @click="graph.addEnhanceNode()">
        {{ t('添加强化节点') }}
      </el-button>
    </div>

    <!-- 六个统计卡片：配平后显示真实数值，未配平显示 -- -->
    <el-row :gutter="16" class="summary-cards">
      <el-col :span="4">
        <div class="card">
          <div class="card-title">
            {{ t('单批税后收入') }}
          </div>
          <div class="card-value">
            {{ summary.leafAfterTaxIncome == null ? '--' : Format.money(summary.leafAfterTaxIncome) }}
          </div>
          <div class="card-sub">
            {{ t('仅出售节点计税', [summary.leafTax == null ? '--' : Format.money(summary.leafTax)]) }}
          </div>
        </div>
      </el-col>
      <el-col :span="4">
        <div class="card">
          <div class="card-title">
            {{ t('单批成本') }}
          </div>
          <div class="card-value">
            {{ summary.totalCost == null ? '--' : Format.money(summary.totalCost) }}
          </div>
          <div class="card-sub">
            {{ t('起始物品额外材料', [summary.startItemCost == null ? '--' : Format.money(summary.startItemCost), summary.extraCost == null ? '--' : Format.money(summary.extraCost)]) }}
          </div>
        </div>
      </el-col>
      <el-col :span="4">
        <div class="card">
          <div class="card-title">
            {{ t('单批利润') }}
          </div>
          <div class="card-value" :class="summary.batchProfit != null && summary.batchProfit < 0 ? 'negative' : 'positive'">
            {{ summary.batchProfit == null ? '--' : Format.money(summary.batchProfit) }}
          </div>
          <div class="card-sub">
            {{ t('利润率', [summary.profitRate == null ? '--' : Format.percent(summary.profitRate)]) }}
          </div>
        </div>
      </el-col>
      <el-col :span="4">
        <div class="card">
          <div class="card-title">
            {{ t('单批处理耗时') }}
          </div>
          <div class="card-value">
            {{ summary.totalTime == null ? '--' : Format.costTime(summary.totalTime) }}
          </div>
          <div class="card-sub">
            {{ t('处理节点出售叶子', [summary.processNodeCount, summary.sellLeafCount]) }}
          </div>
        </div>
      </el-col>
      <el-col :span="4">
        <div class="card">
          <div class="card-title">
            {{ t('小时收益') }}
          </div>
          <div class="card-value positive">
            {{ summary.hourlyProfit == null ? '--' : Format.money(summary.hourlyProfit) }}
          </div>
          <div class="card-sub">
            {{ t('按全部处理工时折算') }}
          </div>
        </div>
      </el-col>
      <el-col :span="4">
        <div class="card">
          <div class="card-title">
            {{ t('天收益') }}
          </div>
          <div class="card-value positive">
            {{ summary.dailyProfit == null ? '--' : Format.money(summary.dailyProfit) }}
          </div>
          <div class="card-sub">
            {{ t('小时收益乘24') }}
          </div>
        </div>
      </el-col>
    </el-row>

    <!-- 读取配方弹窗 -->
    <el-dialog v-model="readDialogVisible" :title="t('读取配方')" width="520px">
      <div v-if="!graph.savedRecipes.value.length" class="empty-tip">
        {{ t('暂无保存的配方') }}
      </div>
      <div v-for="plan in graph.savedRecipes.value" :key="plan.name" class="recipe-row">
        <div class="recipe-info">
          <div class="recipe-name">
            {{ plan.name }}
          </div>
          <div class="recipe-time">
            {{ new Date(plan.savedAt).toLocaleString() }}
          </div>
        </div>
        <div class="recipe-actions">
          <el-button type="primary" plain size="small" @click="readPlan(plan)">
            {{ t('读取此配方') }}
          </el-button>
          <el-button type="danger" plain size="small" :icon="Delete" @click="removePlan(plan.name)">
            {{ t('删除配方') }}
          </el-button>
        </div>
      </div>
    </el-dialog>

    <!-- 自定义价格弹窗（与「首页」自定义价格同步） -->
    <CustomPriceDialog v-model="priceDialogVisible" :items="planItems" />
  </el-card>
</template>

<style lang="scss" scoped>
.upup-header {
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
}
.upup-title .title {
  font-weight: 600;
  font-size: 16px;
}
.upup-title .desc {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  max-width: 640px;
}
.upup-code-row {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-top: 8px;
  flex-wrap: wrap;
}
.upup-plan {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}
.upup-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.drag-handle {
  cursor: grab;
  color: var(--el-text-color-secondary);
}
.upup-row.drag-over {
  outline: 1px dashed #ffd04b;
  border-radius: 6px;
}
.row-index {
  width: 16px;
  text-align: right;
  color: var(--el-text-color-secondary);
}
.option-item {
  display: flex;
  align-items: center;
  gap: 8px;
}
.row-tools {
  display: flex;
  gap: 10px;
  margin-bottom: 16px;
}
.add-func {
  border-color: #a855f7;
  background: rgba(168, 85, 247, 0.08);
  color: #a855f7;
}
.add-func:hover {
  background: rgba(168, 85, 247, 0.25);
  border-color: #a855f7;
  color: #a855f7;
}
.add-enh {
  border-color: #f97316;
  background: rgba(249, 115, 22, 0.08);
  color: #f97316;
}
.add-enh:hover {
  background: rgba(249, 115, 22, 0.25);
  border-color: #f97316;
  color: #f97316;
}
.recipe-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 4px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.recipe-name {
  font-weight: 600;
}
.recipe-time {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.recipe-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
.empty-tip {
  color: var(--el-text-color-secondary);
  text-align: center;
  padding: 16px;
}
.summary-cards .card {
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  padding: 12px 16px;
  .card-title {
    color: var(--el-text-color-secondary);
    font-size: 13px;
  }
  .card-value {
    font-size: 24px;
    font-weight: 600;
    margin: 4px 0;
  }
  .card-sub {
    color: var(--el-text-color-secondary);
    font-size: 12px;
  }
  .positive {
    color: #67c23a;
  }
  .negative {
    color: #f56c6c;
  }
}
</style>

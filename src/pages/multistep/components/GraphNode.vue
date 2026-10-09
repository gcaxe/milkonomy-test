<script lang="ts" setup>
import type { GraphNode, NodeCalcResult, ObtainMethod, SellMode } from "../types"
import ItemIcon from "@@/components/ItemIcon/index.vue"
import * as Format from "@@/utils/format"
import { Delete } from "@element-plus/icons-vue"
import { computed } from "vue"
import { getItemDetailOf } from "@/common/apis/game"
import { getTrans } from "@/locales"
import { COIN_HRID } from "@/pinia/stores/game"
import { getNpcPriceOf } from "../utils/recipes"

const props = defineProps<{
  node: GraphNode
  result?: NodeCalcResult | null
  /** 该物品可用的三采集动作（空=只能购买） */
  gatherActions: string[]
  /** 可选物品列表（红节点内选择物品用） */
  itemOptions: { hrid: string, label: string }[]
}>()
const emit = defineEmits<{
  (e: "dragStart", node: GraphNode, ev: PointerEvent): void
  (e: "pinDragStart", pinId: string, ev: PointerEvent): void
  (e: "delete", node: GraphNode): void
  (e: "setItem", node: GraphNode, hrid: string): void
  (e: "setObtain", node: GraphNode, obtain: ObtainMethod): void
  (e: "setSellMode", node: GraphNode, mode: SellMode): void
}>()
const { t } = useI18n()

const itemName = computed(() => getTrans(getItemDetailOf(props.node.hrid)?.name ?? ""))
const levelText = computed(() => (props.node.level ?? 0) > 0 ? `+${props.node.level}` : "")
const kindLabel = computed(() => ({
  red: t("输入"),
  blue: t("继续处理"),
  green: t("叶子出售"),
  rainbow: t("彩虹节点")
}[props.node.varKind!]))
const isCoin = computed(() => props.node.hrid === COIN_HRID)
function onPinPointerDown(pinId: string, ev: PointerEvent) {
  ev.stopPropagation()
  emit("pinDragStart", pinId, ev)
}
</script>

<template>
  <div
    class="graph-node"
    :class="[`kind-${node.varKind}`]"
    :style="{ left: `${node.x}px`, top: `${node.y}px` }"
    @pointerdown="emit('dragStart', node, $event)"
  >
    <!-- 输入 pin 排（上） -->
    <div class="pin-row in">
      <div
        class="pin"
        :data-pin-id="`${node.id}:in:main`"
        :title="t('输入引脚')"
        @pointerdown="onPinPointerDown(`${node.id}:in:main`, $event)"
      />
    </div>

    <div class="head">
      <ItemIcon v-if="node.hrid" :hrid="node.hrid" :width="26" :height="26" />
      <div class="names">
        <div class="name">
          {{ node.hrid ? `${itemName}${levelText}` : t('未选择物品') }}
        </div>
        <div class="kind">
          {{ kindLabel }}
        </div>
      </div>
      <div class="count">
        × {{ Format.number(node.count ?? 1, 3) }}
      </div>
      <!-- 红节点/彩虹节点：小垃圾桶删除按钮 -->
      <el-button
        v-if="node.varKind === 'red' || node.varKind === 'rainbow'"
        class="del"
        size="small"
        text
        :icon="Delete"
        @click.stop="emit('delete', node)"
      />
    </div>

    <!-- 红节点：直接在这里选择物品（与 [上部] 行联动） -->
    <el-select
      v-if="node.varKind === 'red'"
      :model-value="node.hrid || undefined"
      :placeholder="t('请选择物品')"
      filterable
      size="small"
      style="width: 100%; margin-top: 6px"
      @update:model-value="(val: string | number | boolean | Record<string, unknown> | undefined) => emit('setItem', node, val as string)"
    >
      <el-option v-for="opt in itemOptions" :key="opt.hrid" :label="opt.label" :value="opt.hrid">
        <div class="option-item">
          <ItemIcon :hrid="opt.hrid" :width="20" :height="20" />
          <span>{{ opt.label }}</span>
        </div>
      </el-option>
    </el-select>

    <!-- 红节点：获取方式下拉（购买默认；有三采集动作时可选；来自背包按 价格×(1-税率) 计价） -->
    <el-select
      v-if="node.varKind === 'red' && node.hrid"
      :model-value="node.obtain ?? 'buy'"
      size="small"
      style="width: 100%; margin-top: 6px"
      @update:model-value="(val: string | number | boolean | Record<string, unknown> | undefined) => emit('setObtain', node, (val as string) as ObtainMethod)"
    >
      <el-option :label="t('购买')" value="buy" />
      <el-option v-if="gatherActions.length" :label="t('三采集')" value="gather" />
      <el-option v-if="node.hrid && getNpcPriceOf(node.hrid) != null" :label="t('NPC购买')" value="npc" />
      <el-option :label="t('来自背包')" value="backpack" />
    </el-select>

    <!-- 绿节点/彩虹节点（绿部分）：出售方式下拉（常规物品默认出售；金币只能保留于背包，保留于背包不计税） -->
    <el-select
      v-if="(node.varKind === 'green' || node.varKind === 'rainbow') && node.hrid"
      :model-value="node.sellMode ?? (isCoin ? 'keep' : 'sell')"
      size="small"
      :disabled="isCoin"
      style="width: 100%; margin-top: 6px"
      @update:model-value="(val: string | number | boolean | Record<string, unknown> | undefined) => emit('setSellMode', node, (val as string) as SellMode)"
    >
      <el-option v-if="!isCoin" :label="t('出售')" value="sell" />
      <el-option :label="t('保留于背包')" value="keep" />
    </el-select>

    <div class="metrics">
      <template v-if="node.varKind === 'green'">
        <span>{{ t('税前收入') }} <b>{{ result?.preTaxIncome == null ? '--' : Format.money(result.preTaxIncome) }}</b></span>
        <span>{{ t('税后收入') }} <b>{{ result?.afterTaxIncome == null ? '--' : Format.money(result.afterTaxIncome) }}</b></span>
      </template>
      <template v-else-if="node.varKind === 'blue'">
        <span>{{ t('工时占比') }} <b>--</b></span>
      </template>
      <template v-else-if="node.varKind === 'rainbow'">
        <span class="part blue-part">{{ t('蓝') }} × {{ Format.number(node.count ?? 0, 3) }}</span>
        <span class="part green-part">{{ t('绿') }} × {{ Format.number(node.greenPart ?? 0, 3) }}</span>
        <span class="part red-part">{{ t('红') }} × {{ Format.number(node.redPart ?? 0, 3) }}</span>
      </template>
    </div>

    <!-- 输出 pin 排（下） -->
    <div class="pin-row out">
      <div
        class="pin"
        :data-pin-id="`${node.id}:out:main`"
        :title="t('输出引脚')"
        @pointerdown="onPinPointerDown(`${node.id}:out:main`, $event)"
      />
    </div>
  </div>
</template>

<style lang="scss" scoped>
.graph-node {
  position: absolute;
  width: 220px;
  padding: 10px;
  border-radius: 8px;
  border: 2px solid;
  background: var(--el-bg-color-overlay);
  cursor: grab;
  user-select: none;
  &.kind-red {
    border-color: #f56c6c;
    background: rgba(245, 108, 108, 0.08);
  }
  &.kind-blue {
    border-color: #409eff;
    background: rgba(64, 158, 255, 0.08);
  }
  &.kind-green {
    border-color: #67c23a;
    background: rgba(103, 194, 58, 0.08);
  }
  &.kind-rainbow {
    border-color: #67c23a;
    background: linear-gradient(
      90deg,
      rgba(245, 108, 108, 0.08) 0%,
      rgba(64, 158, 255, 0.08) 50%,
      rgba(103, 194, 58, 0.08) 100%
    );
    box-shadow:
      inset 3px 0 0 #f56c6c,
      inset -3px 0 0 #67c23a;
  }
  .metrics .part.blue-part {
    color: #409eff;
  }
  .metrics .part.green-part {
    color: #67c23a;
  }
  .metrics .part.red-part {
    color: #f56c6c;
  }
  .head {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .names {
    flex: 1;
    min-width: 0;
  }
  .name {
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .kind {
    font-size: 11px;
    color: var(--el-text-color-secondary);
  }
  .count {
    font-size: 12px;
    color: var(--el-text-color-secondary);
  }
  .del {
    color: #f56c6c;
  }
  .option-item {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .metrics {
    margin-top: 6px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 12px;
    color: var(--el-text-color-secondary);
  }
  /* 引脚排：上下居中，悬停放大高亮 */
  .pin-row {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    gap: 8px;
    z-index: 1;
    &.in {
      top: -8px;
    }
    &.out {
      bottom: -8px;
    }
  }
  .pin {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 2px solid var(--el-border-color-darker);
    background: #fff;
    cursor: crosshair;
    &:hover {
      transform: scale(1.4);
      border-color: #ffd04b;
    }
  }
}
</style>

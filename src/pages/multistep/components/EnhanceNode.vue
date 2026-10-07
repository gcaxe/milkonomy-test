<script lang="ts" setup>
import type { GraphNode, GraphPin } from "../types"
import ItemIcon from "@@/components/ItemIcon/index.vue"
import { ArrowDown, ArrowUp, Close, StarFilled } from "@element-plus/icons-vue"
import { computed } from "vue"
import { getItemDetailOf, getPriceOf } from "@/common/apis/game"
import { getTrans } from "@/locales"
import { getEnhanceableItemOptions } from "../utils/items"
import { getProtectionOptionsOf } from "../utils/recipes"

const props = defineProps<{
  node: GraphNode
  pins: GraphPin[]
  result?: any
}>()
const emit = defineEmits<{
  (e: "dragStart", node: GraphNode, ev: PointerEvent): void
  (e: "pinDragStart", pinId: string, ev: PointerEvent): void
  (e: "configChange", node: GraphNode, patch: Partial<GraphNode>): void
  (e: "toggleCollapse", node: GraphNode): void
  (e: "delete", node: GraphNode): void
}>()
const { t } = useI18n()

/** 强化到 +x：闭区间 [2, 20]，默认 +5 */
const LEVEL_OPTIONS = Array.from({ length: 19 }, (_, i) => i + 2)
/** 解析：装备 + 强化到+x + 保护物品 + 从+y 开始保护 四者齐备 */
const isResolved = computed(() =>
  !!props.node.mainItemHrid && props.node.enhanceLevel != null && props.node.protectLevel != null && !!props.node.protectionHrid)

const inPins = computed(() => props.pins.filter(p => p.side === "in"))
const outPins = computed(() => props.pins.filter(p => p.side === "out"))
const topPins = computed(() => inPins.value.filter(p => (p.position ?? "top") === "top"))
const leftPins = computed(() => inPins.value.filter(p => p.position === "left"))
const rightPins = computed(() => inPins.value.filter(p => p.position === "right"))
// 折叠后全部输入 pin 移到上方一排，节点宽度按 pin 数量自适应
const collapsedWidth = computed(() => Math.max(140, inPins.value.length * 22 + 16))

/** 第一个下拉：被强化物品（只接受 +0 的各种装备） */
const gearOptions = computed(() => getEnhanceableItemOptions())
const gearValue = computed({
  get: () => props.node.mainItemHrid ?? "",
  set: (hrid: string) => onGearChange(hrid)
})

/** 第三个下拉：保护物品（由被强化物品决定，不考虑贤者之镜），默认选最便宜的 */
const protectionOptions = computed(() =>
  props.node.mainItemHrid ? getProtectionOptionsOf(props.node.mainItemHrid) : [])
function cheapestProtection(): string | null {
  if (!props.node.mainItemHrid) return null
  const opts = protectionOptions.value
  if (!opts.length) return null
  let best = opts[0]
  let bestPrice = Number.POSITIVE_INFINITY
  for (const o of opts) {
    const p = getPriceOf(o.hrid).ask
    const price = p < 0 ? Number.POSITIVE_INFINITY : p
    if (price < bestPrice) {
      bestPrice = price
      best = o
    }
  }
  return best.hrid
}
const protectionValue = computed({
  get: () => props.node.protectionHrid ?? "",
  set: (hrid: string) => emit("configChange", props.node, { protectionHrid: hrid })
})

/** 第四个下拉：从 +y 开始保护，闭区间 [2, x]，+x 即不保护，默认 +x */
const protectFromOptions = computed(() => {
  const x = props.node.enhanceLevel ?? 5
  return Array.from({ length: x - 1 }, (_, i) => i + 2)
})
const protectFromValue = computed({
  get: () => props.node.protectLevel ?? (props.node.enhanceLevel ?? 5),
  set: (y: number) => emit("configChange", props.node, { protectLevel: y })
})

/** 第二个下拉：强化到 +x；变更时保护起点跟随（默认 +x 时跟随新值，手选值只做钳制） */
function onLevelChange(x: number) {
  const oldX = props.node.enhanceLevel ?? 5
  const y = props.node.protectLevel
  const protectLevel = (y == null || y === oldX || y > x) ? x : y
  emit("configChange", props.node, { enhanceLevel: x, protectLevel })
}

/** 第一个下拉：被强化物品变更 → 重置保护为默认（最便宜物品、从 +x 开始），随后尝试解析 */
function onGearChange(hrid: string) {
  if (!hrid || hrid === props.node.mainItemHrid) return
  emit("configChange", props.node, {
    mainItemHrid: hrid,
    protectionHrid: cheapestProtection() ?? undefined,
    protectLevel: props.node.enhanceLevel ?? 5
  })
}

function onPinPointerDown(pinId: string, ev: PointerEvent) {
  ev.stopPropagation()
  emit("pinDragStart", pinId, ev)
}
function onToggle(e: PointerEvent) {
  e.stopPropagation()
  emit("toggleCollapse", props.node)
}
</script>

<template>
  <div
    class="enh-node"
    :class="{ resolved: isResolved, collapsed: node.collapsed }"
    :style="{ left: `${node.x}px`, top: `${node.y}px`, width: node.collapsed ? `${collapsedWidth}px` : undefined }"
    @pointerdown="emit('dragStart', node, $event)"
  >
    <!-- 折叠态：全部输入 pin 移到上方一排（输出 pin 仍在下方） -->
    <div v-if="node.collapsed" class="pin-row top">
      <div v-for="p in inPins" :key="p.id" class="pin-wrap">
        <div
          class="pin"
          :class="{ main: p.role === 'main', auto: p.auto }"
          :data-pin-id="p.id"
          :title="p.auto ? t('自动供给（金币/茶）') : getTrans(getItemDetailOf(p.itemHrid)?.name ?? '')"
          @pointerdown="onPinPointerDown(p.id, $event)"
        />
      </div>
    </div>
    <!-- 展开态：正上方=被强化物品 / 正左侧=强化材料 / 正右侧=保护材料 -->
    <template v-else>
      <div class="pin-row top">
        <div v-for="p in topPins" :key="p.id" class="pin-wrap">
          <div
            class="pin"
            :class="{ main: p.role === 'main', auto: p.auto }"
            :data-pin-id="p.id"
            :title="p.itemHrid ? getTrans(getItemDetailOf(p.itemHrid)?.name ?? '') : t('输入引脚')"
            @pointerdown="onPinPointerDown(p.id, $event)"
          />
        </div>
      </div>
      <div class="pin-col left">
        <div v-for="p in leftPins" :key="p.id" class="pin-wrap">
          <div
            class="pin"
            :class="{ main: p.role === 'main', auto: p.auto }"
            :data-pin-id="p.id"
            :title="p.auto ? t('自动供给（金币/茶）') : getTrans(getItemDetailOf(p.itemHrid)?.name ?? '')"
            @pointerdown="onPinPointerDown(p.id, $event)"
          />
        </div>
      </div>
      <div class="pin-col right">
        <div v-for="p in rightPins" :key="p.id" class="pin-wrap">
          <div
            class="pin"
            :class="{ main: p.role === 'main', auto: p.auto }"
            :data-pin-id="p.id"
            :title="getTrans(getItemDetailOf(p.itemHrid)?.name ?? '')"
            @pointerdown="onPinPointerDown(p.id, $event)"
          />
        </div>
      </div>
    </template>

    <!-- 折叠态：橙色小长方形（点击展开），不影响 pin 与连线 -->
    <div v-if="node.collapsed" class="collapsed-bar" @pointerdown="onToggle">
      <div class="kind-mark">
        {{ t('强化') }}
      </div>
      <ItemIcon v-if="node.mainItemHrid" :hrid="node.mainItemHrid" :width="16" :height="16" />
      <span v-if="node.mainItemHrid" class="mini-name">
        {{ getTrans(getItemDetailOf(node.mainItemHrid!)?.name ?? "") }}{{ isResolved ? `+${node.enhanceLevel}` : "" }}
      </span>
      <el-icon class="expand-icon">
        <ArrowDown />
      </el-icon>
    </div>

    <!-- 展开态（默认状态） -->
    <template v-else>
      <div class="head">
        <div class="kind-mark">
          {{ t('强化') }}
        </div>
        <div class="title">
          {{ t('强化') }}
        </div>
        <el-button class="icon-btn" size="small" text :icon="ArrowUp" :title="t('折叠')" @pointerdown="onToggle" />
        <el-button class="del" size="small" text :icon="Close" @click.stop="emit('delete', node)" />
      </div>

      <!-- 第一个下拉：被强化物品（只接受 +0 的各种装备；解析后锁定） -->
      <el-select
        v-model="gearValue"
        :disabled="isResolved"
        filterable
        size="small"
        :placeholder="t('请选择被强化物品')"
        style="width: 100%"
      >
        <el-option v-for="opt in gearOptions" :key="opt.hrid" :label="opt.label" :value="opt.hrid">
          <div class="option-item">
            <ItemIcon :hrid="opt.hrid" :width="20" :height="20" />
            <span>{{ opt.label }}</span>
          </div>
        </el-option>
      </el-select>

      <!-- 第二个下拉：强化到+几（+2 ~ +20，默认 +5） -->
      <el-select
        :model-value="node.enhanceLevel ?? 5"
        :disabled="!node.mainItemHrid"
        size="small"
        style="width: 100%; margin-top: 6px"
        @update:model-value="(val: string | number | boolean | Record<string, unknown> | undefined) => onLevelChange(val as number)"
      >
        <el-option v-for="x in LEVEL_OPTIONS" :key="x" :label="`${t('强化到+')}${x}`" :value="x" />
      </el-select>

      <!-- 第三个下拉：保护物品（由被强化物品决定） -->
      <el-select
        v-model="protectionValue"
        :disabled="!node.mainItemHrid"
        size="small"
        :placeholder="t('请选择保护物品')"
        style="width: 100%; margin-top: 6px"
      >
        <el-option v-for="opt in protectionOptions" :key="opt.hrid" :label="opt.label" :value="opt.hrid">
          <div class="option-item">
            <ItemIcon :hrid="opt.hrid" :width="20" :height="20" />
            <span>{{ opt.label }}</span>
          </div>
        </el-option>
      </el-select>

      <!-- 第四个下拉：从+几开始保护（+2 ~ +x，+x 即不保护，默认 +x） -->
      <el-select
        v-model="protectFromValue"
        :disabled="!node.mainItemHrid"
        size="small"
        style="width: 100%; margin-top: 6px"
      >
        <el-option v-for="y in protectFromOptions" :key="y" :label="`${t('从+')}${y}${t('开始保护')}`" :value="y" />
      </el-select>

      <!-- 解析后：主物品标识（星星 + 物品图标 + 目标等级） -->
      <div v-if="isResolved" class="main-item">
        <el-icon color="#ffd04b">
          <StarFilled />
        </el-icon>
        <ItemIcon :hrid="node.mainItemHrid!" :width="20" :height="20" />
        <span>{{ getTrans(getItemDetailOf(node.mainItemHrid!)?.name ?? "") }} → +{{ node.enhanceLevel }}</span>
      </div>
    </template>

    <!-- 正下方输出 pin：强化后的物品 -->
    <div class="pin-row bottom">
      <div v-for="p in outPins" :key="p.id" class="pin-wrap">
        <div
          class="pin"
          :class="{ main: p.role === 'main', auto: p.auto }"
          :data-pin-id="p.id"
          :title="p.itemHrid ? `${getTrans(getItemDetailOf(p.itemHrid)?.name ?? '')}${p.itemLevel ? `+${p.itemLevel}` : ''}` : t('输出引脚')"
          @pointerdown="onPinPointerDown(p.id, $event)"
        />
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.enh-node {
  position: absolute;
  width: 260px;
  padding: 10px;
  border-radius: 8px;
  border: 2px solid #f97316; /* 橙色 */
  background: rgba(249, 115, 22, 0.08);
  cursor: grab;
  user-select: none;
  .head {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .kind-mark {
    padding: 2px 6px;
    border-radius: 4px;
    background: #f97316;
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 700;
    flex-shrink: 0;
  }
  .title {
    font-weight: 600;
    flex: 1;
  }
  .icon-btn {
    color: #f97316;
  }
  .del {
    color: #f97316;
  }
  .main-item {
    display: flex;
    gap: 6px;
    align-items: center;
    margin-top: 6px;
    font-size: 12px;
  }
  .option-item {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  /* 四向 pin：正上/正下/正左/正右 */
  .pin-row {
    position: absolute;
    display: flex;
    gap: 8px;
    z-index: 1;
    &.top {
      top: -8px;
      left: 50%;
      transform: translateX(-50%);
    }
    &.bottom {
      bottom: -8px;
      left: 50%;
      transform: translateX(-50%);
    }
  }
  .pin-col {
    position: absolute;
    display: flex;
    flex-direction: column;
    gap: 8px;
    z-index: 1;
    &.left {
      left: -8px;
      top: 50%;
      transform: translateY(-50%);
    }
    &.right {
      right: -8px;
      top: 50%;
      transform: translateY(-50%);
    }
  }
  .pin-wrap {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .pin {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 2px solid #f97316;
    background: #fff;
    cursor: crosshair;
    z-index: 1;
    &.main {
      background: #ffd04b;
    } /* 主 pin 金黄色 */
    &.auto {
      background: #909399;
      border-color: #909399;
    } /* 金币：灰色自动供给 */
    &:hover {
      transform: scale(1.4);
    }
  }
  /* 折叠态：橙色小长方形（宽度随上方 pin 数量自适应），仍保留 pin 与连线 */
  &.collapsed {
    padding: 2px 6px;
  }
  .collapsed-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 24px;
    width: 100%;
    cursor: pointer;
    .mini-name {
      font-size: 12px;
      color: var(--el-text-color-primary);
      white-space: nowrap;
      max-width: 160px;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .expand-icon {
      color: #f97316;
      font-size: 14px;
    }
  }
}
</style>

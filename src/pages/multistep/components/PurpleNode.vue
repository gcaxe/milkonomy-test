<script lang="ts" setup>
import type { GraphNode, GraphPin } from "../types"
import ItemIcon from "@@/components/ItemIcon/index.vue"
import { ArrowDown, ArrowUp, Close, StarFilled } from "@element-plus/icons-vue"
import { computed } from "vue"
import { getItemDetailOf } from "@/common/apis/game"
import { getTrans } from "@/locales"
import { getProcessItemOptions } from "../utils/items"
import { type AlchemyActionKey, getAlchemyActionOptionsOf } from "../utils/recipes"

const props = defineProps<{
  node: GraphNode
  pins: GraphPin[]
  result?: any
}>()
const emit = defineEmits<{
  (e: "dragStart", node: GraphNode, ev: PointerEvent): void
  (e: "pinDragStart", pinId: string, ev: PointerEvent): void
  (e: "setClass", node: GraphNode, cls: "A" | "B"): void
  (e: "setItem", node: GraphNode, hrid: string): void
  (e: "setAction", node: GraphNode, actionKey: AlchemyActionKey): void
  (e: "setCatalyst", node: GraphNode, rank: 0 | 1 | 2): void
  (e: "toggleCollapse", node: GraphNode): void
  (e: "delete", node: GraphNode): void
}>()
const { t } = useI18n()

const inPins = computed(() => props.pins.filter(p => p.side === "in"))
const outPins = computed(() => props.pins.filter(p => p.side === "out"))
// A 类有动作即解析；B 类需 原料+动作+催化剂 三者齐备
const isResolved = computed(() => !!props.node.actionHrid && (props.node.funcClass === "A" || props.node.catalystRank != null))
const isB = computed(() => props.node.funcClass === "B")
const isA = computed(() => props.node.funcClass === "A")

// 第二个下拉（物品定配方）：A=产物（唯一配方）、B=原料（炼金）
const itemOptions = computed(() => {
  if (isA.value) return getProcessItemOptions("A")
  if (isB.value) return getProcessItemOptions("B")
  return []
})
const itemValue = computed({
  get: () => props.node.mainItemHrid ?? "",
  set: (hrid: string) => hrid && emit("setItem", props.node, hrid)
})
// B 类第三个下拉（动作）：原料已选定才可选；解析后仍可切换
const actionOptions = computed(() =>
  isB.value && props.node.mainItemHrid
    ? getAlchemyActionOptionsOf(props.node.mainItemHrid)
    : [])
const actionValue = computed({
  get: () => isB.value ? (props.node.actionHrid?.split("/").pop() ?? "") : "",
  set: (key: string) => key && emit("setAction", props.node, key as AlchemyActionKey)
})
// B 类第四个下拉（催化剂）：动作选定后可改；催化剂选非默认 → 触发解析
const catalystValue = computed({
  get: () => props.node.catalystRank ?? undefined,
  set: (rank: number) => emit("setCatalyst", props.node, rank as 0 | 1 | 2)
})

function isMainPin(p: GraphPin) {
  if (!isResolved.value) {
    return (isA.value && p.side === "out") || (isB.value && p.side === "in")
  }
  return (isA.value && p.id.endsWith(":out:main")) || (isB.value && p.id.endsWith(":in:main"))
}
function pinLabel(p: GraphPin) {
  // 未解析：仅主 pin 显示「主要产物/主要原料」
  if (!isResolved.value && isMainPin(p)) {
    return p.side === "out" ? t("主要产物") : t("主要原料")
  }
  return ""
}
function onPinPointerDown(pinId: string, ev: PointerEvent) {
  ev.stopPropagation()
  emit("pinDragStart", pinId, ev)
}
function onToggle(e: PointerEvent) {
  e.stopPropagation()
  emit("toggleCollapse", props.node)
}
// 用户可见文案：紫节点 = 处理方式；A = 三造二厨，B = 炼金
const kindLabel = computed(() => isA.value ? t("三造二厨") : isB.value ? t("炼金") : "?")
</script>

<template>
  <div
    class="func-node"
    :class="{ resolved: isResolved, collapsed: node.collapsed }"
    :style="{ left: `${node.x}px`, top: `${node.y}px` }"
    @pointerdown="emit('dragStart', node, $event)"
  >
    <!-- 输入 pin 排（上）：折叠不影响 pin 与连线 -->
    <div class="pin-row in">
      <div
        v-for="p in inPins"
        :key="p.id"
        class="pin-wrap"
      >
        <div
          class="pin"
          :class="{ main: isMainPin(p), auto: p.auto }"
          :data-pin-id="p.id"
          :title="p.auto ? t('自动供给（金币/茶）') : getTrans(getItemDetailOf(p.itemHrid)?.name ?? '')"
          @pointerdown="onPinPointerDown(p.id, $event)"
        />
        <span v-if="!node.collapsed && pinLabel(p)" class="pin-label">{{ pinLabel(p) }}</span>
      </div>
    </div>

    <!-- 折叠态：紫色小长方形（点击展开） -->
    <div v-if="node.collapsed" class="collapsed-bar" @pointerdown="onToggle">
      <div class="kind-mark">
        {{ kindLabel }}
      </div>
      <ItemIcon v-if="node.mainItemHrid" :hrid="node.mainItemHrid" :width="16" :height="16" />
      <span v-if="node.mainItemHrid" class="mini-name">{{ getTrans(getItemDetailOf(node.mainItemHrid!)?.name ?? "") }}</span>
      <el-icon class="expand-icon">
        <ArrowDown />
      </el-icon>
    </div>

    <!-- 展开态（默认状态） -->
    <template v-else>
      <div class="head">
        <div class="kind-mark">
          {{ kindLabel }}
        </div>
        <div class="title">
          {{ t('处理方式') }}
        </div>
        <el-button class="icon-btn" size="small" text :icon="ArrowUp" :title="t('折叠')" @pointerdown="onToggle" />
        <el-button class="del" size="small" text :icon="Close" @click.stop="emit('delete', node)" />
      </div>

      <!-- 第一个下拉：三造二厨/炼金（解析后锁定） -->
      <el-select
        :model-value="node.funcClass"
        :disabled="isResolved"
        size="small"
        style="width: 100%"
        @update:model-value="(val: string | number | boolean | Record<string, unknown> | undefined) => emit('setClass', node, val as 'A' | 'B')"
      >
        <el-option :label="t('三造二厨')" value="A" />
        <el-option :label="t('炼金')" value="B" />
      </el-select>

      <!-- 第二个下拉（新增）：选择物品确定配方。A=产物（唯一配方立即解析）；B=原料（配合动作/催化剂） -->
      <el-select
        v-model="itemValue"
        :disabled="!node.funcClass || isResolved"
        size="small"
        filterable
        :placeholder="isA ? t('请选择产物（三造二厨）') : isB ? t('请选择原料（炼金）') : t('请先选择三造二厨或炼金')"
        style="width: 100%; margin-top: 6px"
      >
        <el-option v-for="opt in itemOptions" :key="opt.hrid" :label="opt.label" :value="opt.hrid">
          <div class="option-item">
            <ItemIcon :hrid="opt.hrid" :width="20" :height="20" />
            <span>{{ opt.label }}</span>
          </div>
        </el-option>
      </el-select>

      <!-- 第三个下拉：炼金动作（点金/分解/转化）；解析后仍可切换 -->
      <el-select
        v-model="actionValue"
        :disabled="!isB || !node.mainItemHrid || (isResolved && !isB)"
        size="small"
        :placeholder="isB ? t('请选择炼金动作') : t('未选择炼金')"
        style="width: 100%; margin-top: 6px"
      >
        <el-option v-for="opt in actionOptions" :key="opt.key" :label="t(opt.key === 'coinify' ? '点金' : opt.key === 'decompose' ? '分解' : '转化')" :value="opt.key" />
      </el-select>

      <!-- 第四个下拉：催化剂；解析后仍可切换 -->
      <el-select
        v-model="catalystValue"
        :disabled="!isB || !node.mainItemHrid || (isResolved && !isB)"
        size="small"
        :placeholder="isB ? t('未选择催化剂') : t('无')"
        style="width: 100%; margin-top: 6px"
      >
        <el-option :label="t('无')" :value="0" />
        <el-option :label="t('普通催化剂')" :value="1" />
        <el-option :label="t('至高催化剂')" :value="2" />
      </el-select>

      <!-- 解析后：主原料/主产物标识（星星 + 物品图标） -->
      <div v-if="isResolved" class="main-item">
        <el-icon color="#ffd04b">
          <StarFilled />
        </el-icon>
        <ItemIcon :hrid="node.mainItemHrid!" :width="20" :height="20" />
        <span>{{ getTrans(getItemDetailOf(node.mainItemHrid!)?.name ?? "") }}</span>
      </div>
    </template>

    <!-- 输出 pin 排（下） -->
    <div class="pin-row out">
      <div v-for="p in outPins" :key="p.id" class="pin-wrap">
        <div
          class="pin"
          :class="{ main: isMainPin(p), auto: p.auto }"
          :data-pin-id="p.id"
          :title="getTrans(getItemDetailOf(p.itemHrid)?.name ?? '') + (p.itemLevel ? `+${p.itemLevel}` : '')"
          @pointerdown="onPinPointerDown(p.id, $event)"
        />
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.func-node {
  position: absolute;
  width: 260px;
  padding: 10px;
  border-radius: 8px;
  border: 2px solid #a855f7; /* 紫色 */
  background: rgba(168, 85, 247, 0.08);
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
    background: #a855f7;
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
    color: #a855f7;
  }
  .del {
    color: #a855f7;
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
  .pin-row {
    position: absolute;
    left: 0;
    right: 0;
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
  .pin-wrap {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .pin-label {
    font-size: 10px;
    color: #a855f7;
    white-space: nowrap;
  }
  .pin {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 2px solid #a855f7;
    background: #fff;
    cursor: crosshair;
    z-index: 1;
    &.main {
      background: #ffd04b;
    } /* 主 pin 金黄色 */
    &.auto {
      background: #909399;
      border-color: #909399;
    } /* 金币/茶：灰色自动供给 */
    &:hover {
      transform: scale(1.4);
    }
  }
  /* 折叠态：紫色小长方形，仍保留 pin 与连线 */
  &.collapsed {
    width: auto;
    padding: 2px 6px;
  }
  .collapsed-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 24px;
    min-width: 120px;
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
      color: #a855f7;
      font-size: 14px;
    }
  }
}
</style>

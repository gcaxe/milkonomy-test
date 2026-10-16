<script lang="ts" setup>
import ItemIcon from "@@/components/ItemIcon/index.vue"
import { Delete, Plus, Sort } from "@element-plus/icons-vue"
import { computed, ref } from "vue"
import { pinyinOf } from "@/common/utils/pinyin"
import { getTradableItemOptions } from "../utils/items"

/**
 * 排除物品面板（税前多步配方推荐）：
 * 被排除的物品不会作为原料进入多步路线。行 UI 与多步蓝图起始物品行一致，
 * 但只有：拖动排序 + 物品选择（支持拼音搜索）+ 删除，没有数量与「查看节点」。
 */
const props = defineProps<{ modelValue: string[] }>()
const emit = defineEmits<{ (e: "update:modelValue", v: string[]): void }>()

const { t } = useI18n()
const itemOptions = computed(() => getTradableItemOptions())

/** 拼音/中文过滤（el-select 提供 filter-method 后不再自行过滤，选项按此处结果给） */
const query = ref("")
const filteredOptions = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return itemOptions.value
  return itemOptions.value.filter(o => o.label.toLowerCase().includes(q) || pinyinOf(o.label).includes(q))
})
function onFilter(q: string) {
  query.value = q
}

function addRow() {
  emit("update:modelValue", [...props.modelValue, ""])
}
function removeRow(index: number) {
  const next = [...props.modelValue]
  next.splice(index, 1)
  emit("update:modelValue", next)
}
function setRow(index: number, hrid: string) {
  const next = [...props.modelValue]
  next[index] = hrid
  emit("update:modelValue", next)
}

// 拖动排序（与多步蓝图起始物品行一致）
const draggingIndex = ref<number | null>(null)
const dragOverIndex = ref<number | null>(null)
function onDragStart(index: number) {
  draggingIndex.value = index
}
function onDragOver(index: number) {
  if (draggingIndex.value != null && draggingIndex.value !== index) dragOverIndex.value = index
}
function onDrop(index: number) {
  if (draggingIndex.value != null && draggingIndex.value !== index) {
    const next = [...props.modelValue]
    const [row] = next.splice(draggingIndex.value, 1)
    next.splice(index, 0, row)
    emit("update:modelValue", next)
  }
  draggingIndex.value = null
  dragOverIndex.value = null
}
function onDragEnd() {
  draggingIndex.value = null
  dragOverIndex.value = null
}
</script>

<template>
  <el-card class="mt-5 exclude">
    <div class="exclude-header">
      <div class="title">
        {{ t('排除物品') }}
      </div>
      <div class="desc">
        {{ t('被排除的物品不会作为原料进入多步路线') }}
      </div>
    </div>
    <div
      v-for="(hrid, index) in modelValue"
      :key="index"
      class="exclude-row"
      :class="{ 'drag-over': dragOverIndex === index }"
      @dragover.prevent="onDragOver(index)"
      @drop.prevent="onDrop(index)"
    >
      <el-icon
        class="drag-handle"
        draggable="true"
        :title="t('拖动排序')"
        @dragstart="onDragStart(index)"
        @dragend="onDragEnd"
      >
        <Sort />
      </el-icon>
      <ItemIcon v-if="hrid" :hrid="hrid" :width="24" :height="24" />
      <el-select
        :model-value="hrid || undefined"
        :placeholder="t('请选择物品')"
        filterable
        :filter-method="onFilter"
        style="width: 280px"
        @update:model-value="(val: string | number | boolean | Record<string, unknown> | undefined) => setRow(index, val as string)"
      >
        <el-option v-for="opt in filteredOptions" :key="opt.hrid" :label="opt.label" :value="opt.hrid">
          <div class="option-item">
            <ItemIcon :hrid="opt.hrid" :width="24" :height="24" />
            <span>{{ opt.label }}</span>
          </div>
        </el-option>
      </el-select>
      <el-button :icon="Delete" plain @click="removeRow(index)" />
    </div>
    <el-button :icon="Plus" plain class="add" @click="addRow">
      {{ t('添加排除物品') }}
    </el-button>
  </el-card>
</template>

<style lang="scss" scoped>
.exclude-header {
  margin-bottom: 10px;
  .title {
    font-weight: 600;
    font-size: 15px;
  }
  .desc {
    margin-top: 4px;
    color: var(--el-text-color-secondary);
    font-size: 12px;
  }
}
.exclude-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
}
.drag-handle {
  cursor: grab;
  color: var(--el-text-color-secondary);
}
.exclude-row.drag-over {
  outline: 1px dashed var(--el-color-primary);
  border-radius: 4px;
}
.option-item {
  display: flex;
  align-items: center;
  gap: 8px;
}
.add {
  margin-top: 8px;
}
</style>

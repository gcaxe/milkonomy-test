<script lang="ts" setup>
import type { BalanceStep } from "../utils/balance"
import ItemIcon from "@@/components/ItemIcon/index.vue"
import * as Format from "@@/utils/format"
import { ElMessage } from "element-plus"
import { computed, ref, watch } from "vue"
import { getItemDetailOf } from "@/common/apis/game"
import { getTrans } from "@/locales"
import TimeSharePanel from "./TimeSharePanel.vue"

export interface RecommendDisplayRow {
  startItem: string
  finalItem: string
  profitPD: number
  profitPH: number
  profitRate: number
  profitPerUnit: number
  steps: BalanceStep[]
  /** 税前配方码（绿节点保留于背包） */
  code: string
  /** 税后配方码（绿/彩虹节点计税出售后重新配平） */
  postCode: string
}

const props = defineProps<{
  rows: RecommendDisplayRow[]
  loading?: boolean
}>()
const { t } = useI18n()

function itemName(hrid: string) {
  return getTrans(getItemDetailOf(hrid)?.name ?? "")
}

/** 复制配方码（只可复制，不可编辑） */
async function copyCode(code: string) {
  try {
    await navigator.clipboard.writeText(code)
    ElMessage.success(t("已复制配方码"))
  } catch {
    ElMessage.error(t("复制失败"))
  }
}

// 像首页一样每页只列出 20 个，分页
const PAGE_SIZE = 20
const page = ref(1)
watch(() => props.rows, () => {
  page.value = 1
})
const pagedRows = computed(() => props.rows.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE))
</script>

<template>
  <el-card class="mt-5">
    <el-table :data="pagedRows" v-loading="loading || false" size="small" style="width: 100%">
      <!-- 展开：只展现「处理步骤与工时占比」的全部动作 -->
      <el-table-column :label="t('展开')" width="80" align="center" type="expand">
        <template #default="{ row }">
          <div class="expand-body">
            <TimeSharePanel :steps="row.steps" />
            <!-- 最底下是两条可复制的配方码（只可复制，不可编辑）：税前换行税后；未生成的（低利润）不显示 -->
            <div v-if="row.code" class="code-row">
              <span class="code-label">{{ t('税前配方码') }}</span>
              <el-input :model-value="row.code" readonly size="small" style="flex: 1" />
              <el-button size="small" @click="copyCode(row.code)">
                {{ t('复制') }}
              </el-button>
            </div>
            <div v-if="row.postCode" class="code-row">
              <span class="code-label">{{ t('税后配方码') }}</span>
              <el-input :model-value="row.postCode" readonly size="small" style="flex: 1" />
              <el-button size="small" @click="copyCode(row.postCode)">
                {{ t('复制') }}
              </el-button>
            </div>
          </div>
        </template>
      </el-table-column>
      <el-table-column :label="t('起始物品')" min-width="160">
        <template #default="{ row }">
          <div class="item-cell">
            <ItemIcon :hrid="row.startItem" :width="24" :height="24" />
            <span>{{ itemName(row.startItem) }}</span>
          </div>
        </template>
      </el-table-column>
      <el-table-column :label="t('利润 / 天')" align="right" min-width="120" sortable prop="profitPD">
        <template #default="{ row }">
          {{ Format.money(row.profitPD) }}
        </template>
      </el-table-column>
      <el-table-column :label="t('利润 / h')" align="right" min-width="120" sortable prop="profitPH">
        <template #default="{ row }">
          {{ Format.money(row.profitPH) }}
        </template>
      </el-table-column>
      <el-table-column :label="t('利润率')" align="right" min-width="100" sortable prop="profitRate">
        <template #default="{ row }">
          {{ Format.percent(row.profitRate) }}
        </template>
      </el-table-column>
      <el-table-column :label="t('利润 / 次')" align="right" min-width="120" sortable prop="profitPerUnit">
        <template #default="{ row }">
          {{ Format.money(row.profitPerUnit) }}
        </template>
      </el-table-column>
    </el-table>
    <div class="pager-wrapper">
      <el-pagination
        v-model:current-page="page"
        background
        layout="total, prev, pager, next"
        :page-size="PAGE_SIZE"
        :total="rows.length"
      />
    </div>
  </el-card>
</template>

<style lang="scss" scoped>
.expand-body {
  padding: 8px 24px 16px;
}
.item-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}
.pager-wrapper {
  display: flex;
  justify-content: center;
  margin-top: 12px;
}
.code-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
}
.code-label {
  flex-shrink: 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
</style>

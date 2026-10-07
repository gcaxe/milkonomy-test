<script lang="ts" setup>
import ItemIcon from "@@/components/ItemIcon/index.vue"
import * as Format from "@@/utils/format"
import { computed, watch } from "vue"
import { getItemDetailOf, getPriceOf } from "@/common/apis/game"
import { getManualPriceOf } from "@/common/apis/price"
import { PriceStatus } from "@/pinia/stores/game"
import { usePriceStoreOutside } from "@/pinia/stores/price"

const props = defineProps<{
  modelValue: boolean
  /** 方案中出现的物品（去重，含等级） */
  items: { hrid: string, level: number }[]
}>()
const emit = defineEmits<{ (e: "update:modelValue", v: boolean): void }>()
const { t } = useI18n()

const visible = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit("update:modelValue", v)
})

interface PriceRow {
  hrid: string
  level: number
  askManual: boolean
  askPrice: number
  bidManual: boolean
  bidPrice: number
}

const rows = ref<PriceRow[]>([])

/** 打开时从价格库（与首页同一 localStorage）读取已有自定义价，市场价取原始挂单价 */
watch(visible, (v) => {
  if (!v) return
  rows.value = props.items.map(({ hrid, level }) => {
    const manual = getManualPriceOf(hrid, level)
    const raw = getPriceOf(hrid, level, PriceStatus.MARKET, PriceStatus.MARKET)
    return {
      hrid,
      level,
      askManual: manual?.ask?.manual ?? false,
      askPrice: manual?.ask?.manual ? manual.ask.manualPrice! : raw.ask,
      bidManual: manual?.bid?.manual ?? false,
      bidPrice: manual?.bid?.manual ? manual.bid.manualPrice! : raw.bid
    }
  })
})

function itemName(hrid: string) {
  return t(getItemDetailOf(hrid).name)
}

/** 保存：写入价格库（首页同步生效）；无手动价的条目自动清除 */
function onConfirm() {
  const store = usePriceStoreOutside()
  for (const r of rows.value) {
    store.setPrice({
      hrid: r.hrid,
      level: r.level || undefined,
      ask: { manual: r.askManual, manualPrice: r.askManual ? r.askPrice : undefined },
      bid: { manual: r.bidManual, manualPrice: r.bidManual ? r.bidPrice : undefined }
    })
  }
  store.commit()
  visible.value = false
}
</script>

<template>
  <el-dialog v-model="visible" :title="t('自定义价格')" width="720px">
    <div class="desc">
      {{ t('自定义价格说明') }}
    </div>
    <el-table :data="rows" size="small">
      <el-table-column width="54">
        <template #default="{ row }">
          <ItemIcon :hrid="row.hrid" :width="28" :height="28" />
        </template>
      </el-table-column>
      <el-table-column :label="t('物品')" min-width="160">
        <template #default="{ row }">
          {{ itemName(row.hrid) }}{{ row.level ? ` +${row.level}` : "" }}
        </template>
      </el-table-column>
      <el-table-column :label="t('市场价格')" min-width="150">
        <template #default="{ row }">
          {{ Format.price(getPriceOf(row.hrid, row.level, PriceStatus.MARKET, PriceStatus.MARKET).ask) }}
          /
          {{ Format.price(getPriceOf(row.hrid, row.level, PriceStatus.MARKET, PriceStatus.MARKET).bid) }}
        </template>
      </el-table-column>
      <el-table-column :label="t('自定义买价')" min-width="170">
        <template #default="{ row }">
          <el-checkbox v-model="row.askManual" />
          <el-input-number v-show="row.askManual" v-model="row.askPrice" :controls="false" style="width: 110px" />
        </template>
      </el-table-column>
      <el-table-column :label="t('自定义卖价')" min-width="170">
        <template #default="{ row }">
          <el-checkbox v-model="row.bidManual" />
          <el-input-number v-show="row.bidManual" v-model="row.bidPrice" :controls="false" style="width: 110px" />
        </template>
      </el-table-column>
    </el-table>
    <template #footer>
      <el-button @click="visible = false">
        {{ t('取消') }}
      </el-button>
      <el-button type="primary" @click="onConfirm">
        {{ t('保存') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style lang="scss" scoped>
.desc {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  margin-bottom: 8px;
}
</style>

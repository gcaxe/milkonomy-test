<script lang="ts" setup>
import { getMarketDataApi } from "@/common/apis/game"
import { getIconOf } from "@/common/utils/game"
import { useGameStore } from "@/pinia/stores/game"

const version = __APP_VERSION__
const { t } = useI18n()
</script>

<template>
  <div class="app-version">
    <svg width="20" height="20" style="vertical-align: -4px"><use :xlink:href="getIconOf('/chat_icons/duckling')" /></svg>
    {{ t('Milkonomy') }} v{{ version }}
  </div>
  <div
    :class="{
      error: getMarketDataApi()?.timestamp * 1000 < Date.now() - 1000 * 60 * 120,
      success: getMarketDataApi()?.timestamp * 1000 > Date.now() - 1000 * 60 * 120,
    }"
  >
    <a href="https://www.milkywayidle.com/game_data/marketplace.json" target="_blank" rel="noopener noreferrer">{{ t('市场数据来源(MilkyWayIdle)') }} : {{ new Date(useGameStore().marketData?.timestamp! * 1000).toLocaleString() }}</a>
  </div>
</template>

<style lang="scss" scoped>
/* 游戏内 CharacterName 渐变绿（--color-jade-100/200/300 实测值取自游戏 CSS） */
.app-version {
  background: linear-gradient(90deg, #82dcca, #82dcca 3%, #d5f3ed 15%, #d5f3ed 30%, #ace7dc 50%, #82dcca 95%, #82dcca);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.error {
  color: #f56c6c;

  a {
    color: inherit;
    // text-decoration: underline;

    &:hover {
      opacity: 0.8;
    }
  }
}
.success {
  color: #67c23a;

  a {
    color: inherit;
    // text-decoration: underline;

    &:hover {
      opacity: 0.8;
    }
  }
}
</style>

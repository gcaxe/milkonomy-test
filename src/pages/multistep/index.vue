<script lang="ts" setup>
import { Close, Delete, FullScreen, Plus, ZoomIn, ZoomOut } from "@element-plus/icons-vue"
import { ElMessageBox } from "element-plus"
import { ref } from "vue"
import { usePriceStatus } from "@/common/composables/usePriceStatus"
import ActionConfig from "@/pages/dashboard/components/ActionConfig.vue"
import GameInfo from "@/pages/dashboard/components/GameInfo.vue"
import PriceStatusSelect from "@/pages/dashboard/components/PriceStatusSelect.vue"
import { usePlayerStore } from "@/pinia/stores/player"
import NodeCanvas from "./components/NodeCanvas.vue"
import TimeSharePanel from "./components/TimeSharePanel.vue"
import UpupPanel from "./components/UpupPanel.vue"
import { useMultistepGraph } from "./composables/useMultistepGraph"

// 触发 player store 初始化（buffs/装备/等级），配平与首页计算器同源需要
void usePlayerStore()

const { t } = useI18n()
const onPriceStatusChange = usePriceStatus("multistep-price-status")
const graph = useMultistepGraph()
// 蓝图全屏（CSS 铺满视口，非浏览器原生全屏，便于保留工具栏）
const fullscreen = ref(false)

/** 清空全部节点与连线（二次确认） */
function onClearAll() {
  ElMessageBox.confirm(t("确定清空全部节点与连线吗？"), t("清空"), {
    confirmButtonText: t("确定"),
    cancelButtonText: t("取消"),
    type: "warning"
  }).then(() => {
    graph.clearAll()
  }).catch(() => {
    // 取消清空
  })
}
</script>

<template>
  <div class="app-container">
    <!-- [顶端] toptop：与首页相同，但不含 计算税率 / 多步产量修正 两个 checkbox -->
    <div class="game-info">
      <GameInfo />
      <div><ActionConfig /></div>
      <PriceStatusSelect @change="onPriceStatusChange" />
    </div>

    <!-- [上部] upup -->
    <UpupPanel :graph="graph" />

    <!-- [中部] zhongzhong -->
    <el-card
      class="mt-5 zhongzhong-card"
      :class="{ 'zhongzhong-fullscreen': fullscreen }"
    >
      <template #header>
        <div class="zhongzhong-header">
          <span class="title">{{ t('可拖动结点图') }}</span>
          <div class="toolbar">
            <!-- 「不显示平凡产物」勾选项 + 五个图例：红=输入 蓝=继续处理 绿=叶子出售 紫=处理方式 橙=强化 -->
            <el-checkbox v-model="graph.hideMundane.value" class="legend">
              {{ t('不显示平凡产物') }}
            </el-checkbox>
            <el-tag type="danger" class="legend">
              {{ t('输入') }}
            </el-tag>
            <el-tag type="primary" class="legend">
              {{ t('继续处理') }}
            </el-tag>
            <el-tag type="success" class="legend">
              {{ t('叶子出售') }}
            </el-tag>
            <el-tag class="legend purple">
              {{ t('处理方式') }}
            </el-tag>
            <el-tag class="legend orange">
              {{ t('强化') }}
            </el-tag>
            <el-button-group>
              <el-button :icon="ZoomOut" @click="graph.zoomBy(-0.1)" />
              <el-button style="pointer-events:none">
                {{ Math.round(graph.zoom.value * 100) }}%
              </el-button>
              <el-button :icon="ZoomIn" @click="graph.zoomBy(0.1)" />
              <el-button :icon="Delete" @click="onClearAll">
                {{ t('清空') }}
              </el-button>
            </el-button-group>
            <el-button v-if="!fullscreen" :icon="FullScreen" @click="fullscreen = true">
              {{ t('全屏') }}
            </el-button>
          </div>
        </div>
      </template>

      <!-- 全屏时右上角工具栏 -->
      <div v-if="fullscreen" class="fullscreen-toolbar">
        <el-button :icon="Close" @click="fullscreen = false">
          {{ t('退出全屏') }}
        </el-button>
        <el-button :icon="Plus" plain class="purple-btn" @click="graph.addFuncNode()">
          {{ t('添加处理方式') }}
        </el-button>
        <el-button :icon="Plus" plain class="orange-btn" @click="graph.addEnhanceNode()">
          {{ t('添加强化节点') }}
        </el-button>
      </div>

      <NodeCanvas :graph="graph" />
    </el-card>

    <!-- 用时占比（配平后显示） -->
    <TimeSharePanel :steps="graph.steps.value" />

    <!-- 使用指南（与结点图平行层级） -->
    <el-card class="mt-5">
      <template #header>
        <span class="title">{{ t('使用指南') }}</span>
      </template>
      <div class="guide-line">
        {{ t('本界面不提供任何推荐功能，只提供模拟功能') }}
      </div>
      <div class="guide-line">
        {{ t('处理方式（紫）节点先选三造二厨或炼金，再用第二个下拉选择物品确定配方（炼金还需选择动作与催化剂），配方确定后自动生成对应的输入输出节点') }}
      </div>
      <div class="guide-line">
        {{ t('强化（橙）节点依次选择+0装备、强化到+几、保护物品、从+几开始保护，配方即确定；材料/保护费用按强化计算页「材料费用」同口径（工时费0）') }}
      </div>
      <div class="guide-line">
        {{ t('绿色节点与同名同等级的红色节点相连会合并为蓝色节点，用来连通整张图') }}
      </div>
      <div class="guide-line">
        {{ t('红节点可改获取方式：购买 / 三采集 / 来自背包（按所选价格 ×(1-税率) 计价）；绿节点可选择出售或保留于背包（保留不计税，金币只能保留）') }}
      </div>
      <div class="guide-line">
        {{ t('连完线后，点击自动配平') }}
      </div>
      <div class="guide-line">
        {{ t('平凡产物是该行动的精华、箱子类物品、精通之油类物品，可勾选「不显示平凡产物」隐藏，但利润还是正常算。') }}
      </div>
      <div class="guide-line">
        {{ t('炼金的例子：想要点金太阳石，处理方式选炼金，物品选太阳石，动作选点金') }}
      </div>
      <div class="guide-line">
        {{ t('三造二厨的例子：想要红杉弩+神秘木板获得神秘弩，处理方式选三造二厨，物品选神秘弩') }}
      </div>
      <div class="guide-line">
        {{ t('强化的例子：三造二厨得到精炼混沌连枷+0，强化节点强化到+10、从+7开始用混沌锁链保护，绿色叶子出售+10产物') }}
      </div>
    </el-card>
  </div>
</template>

<style lang="scss" scoped>
.game-info {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}
.zhongzhong-header {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  .title {
    font-weight: 600;
  }
  .desc {
    color: var(--el-text-color-secondary);
    font-size: 13px;
  }
  .toolbar {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .legend {
    cursor: default;
  }
  .legend.purple {
    border-color: #a855f7;
    color: #a855f7;
    background: rgba(168, 85, 247, 0.08);
  }
  .legend.orange {
    border-color: #f97316;
    color: #f97316;
    background: rgba(249, 115, 22, 0.08);
  }
}
.zhongzhong-card {
  position: relative;
}
/* CSS 全屏：铺满视口 */
.zhongzhong-fullscreen {
  position: fixed !important;
  inset: 0;
  /* 低于 Element Plus 浮层默认层级（2000+），保证节点下拉菜单/确认框/消息提示可用 */
  z-index: 1900;
  margin: 0 !important;
  display: flex;
  flex-direction: column;
  overflow: auto;
  border-radius: 0;
  :deep(.el-card__body) {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  :deep(.node-canvas-wrap) {
    flex: 1;
    height: auto;
    min-height: 400px;
  }
}
.fullscreen-toolbar {
  position: absolute;
  /* 位于卡片头部下方，避免遮挡标题与图例；右移留出滚动条宽度 */
  top: 76px;
  right: 48px;
  z-index: 3200;
  display: flex;
  gap: 8px;
  background: var(--el-bg-color);
  padding: 6px;
  border-radius: 8px;
  box-shadow: var(--el-box-shadow-light);
}
.purple-btn {
  border-color: #a855f7;
  background: rgba(168, 85, 247, 0.08);
  color: #a855f7;
}
.purple-btn:hover {
  background: rgba(168, 85, 247, 0.25);
  border-color: #a855f7;
  color: #a855f7;
}
.orange-btn {
  border-color: #f97316;
  background: rgba(249, 115, 22, 0.08);
  color: #f97316;
}
.orange-btn:hover {
  background: rgba(249, 115, 22, 0.25);
  border-color: #f97316;
  color: #f97316;
}
.guide-line + .guide-line {
  margin-top: 1em;
}
</style>

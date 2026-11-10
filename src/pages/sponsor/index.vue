<script lang="ts" setup>
import { useI18n } from "vue-i18n"

const { t } = useI18n()
</script>

<template>
  <div class="ack-page">
    <div class="page-head">
      <h1>{{ t('致谢') }}</h1>
      <p class="sub-title">
        感谢所有帮助过 Milkonomy 的人。
      </p>
    </div>

    <el-card class="ack-card" shadow="never">
      <section class="ack-section">
        <h2>项目来源</h2>
        <p>
          Milkonomy 由 <a href="https://github.com/luyh7" target="_blank" rel="noopener">luyh7</a> 创建，
          hyhfish、<a href="https://github.com/polokikiki" target="_blank" rel="noopener">polokiki</a>
          等维护者持续维护中文版本。
        </p>
        <p>
          本测试版由 gcaxe 基于 polokiki/Milkonomy 二次开发，重点实现多步利润蓝图、
          税前/税后多步配方推荐、强化节点与配方码。
        </p>
      </section>

      <section class="ack-section">
        <h2>主要贡献者</h2>
        <ul>
          <li><a href="https://github.com/luyh7" target="_blank" rel="noopener">luyh7</a>：原作者，Milkonomy 的基础架构与计算逻辑。</li>
          <li>hyhfish：中文版维护、数据与工具链。</li>
          <li><a href="https://github.com/polokikiki" target="_blank" rel="noopener">polokiki</a>：中文版维护、打野工具与炼金工具。</li>
          <li>gcaxe：本测试版的多步蓝图、多步推荐与工程化。</li>
        </ul>
      </section>

      <section class="ack-section">
        <h2>致谢</h2>
        <p>
          感谢所有提供反馈、测试、配方、数据与建议的玩家。没有你们的反馈，这个工具不会迭代到今天。
        </p>
      </section>

      <section class="ack-notice">
        <p>本页面仅用于致谢，不提供任何收款方式。如需支持维护者，请通过其 GitHub 主页联系。</p>
      </section>
    </el-card>
  </div>
</template>

<style lang="scss" scoped>
.ack-page {
  max-width: 880px;
  padding: 20px;
  margin: 0 auto;
}

.page-head {
  margin-bottom: 24px;
  text-align: center;
}

.page-head h1 {
  margin: 0 0 12px;
  font-size: 34px;
}

.sub-title {
  color: #999;
  line-height: 1.8;
}

.ack-card {
  text-align: left;
}

.ack-section {
  padding: 8px 4px 16px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.ack-section:last-of-type {
  border-bottom: none;
}

.ack-section h2 {
  margin: 8px 0 12px;
  font-size: 20px;
}

.ack-section p,
.ack-section li {
  color: #606266;
  line-height: 1.9;
}

.ack-section ul {
  padding-left: 20px;
  margin: 0;
}

.ack-section a {
  color: var(--el-color-primary);
  text-decoration: none;
}

.ack-section a:hover {
  text-decoration: underline;
}

.ack-notice {
  padding: 14px 18px;
  margin-top: 12px;
  color: #8a6d3b;
  background: #fdf6ec;
  border-radius: 8px;
}

.ack-notice p {
  margin: 0;
  line-height: 1.8;
}

@media (max-width: 768px) {
  .ack-page {
    padding: 16px;
  }

  .page-head h1 {
    font-size: 28px;
  }
}
</style>

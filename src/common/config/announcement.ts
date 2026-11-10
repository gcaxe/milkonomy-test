/**
 * 公告配置
 * 用于在页面顶部展示全局公告信息
 */

export interface AnnouncementConfig {
  /** 是否启用公告 */
  enabled: boolean
  /** 公告唯一标识，用于localStorage记录关闭状态，修改id可让已关闭的用户重新看到公告 */
  id: string
  /** 公告消息的i18n key */
  message: {
    title: string
    content: string
  }
  /** 相关链接 */
  link?: {
    url: string
    text: string
  }
}

export const announcementConfig: AnnouncementConfig = {
  enabled: true,
  id: "v2.8.7",
  message: {
    title: "v2.8.7 更新公告",
    content: [
      "一、新功能",
      "1. 多步工具新增「多步路线体检」，与「多步利润蓝图」并列。",
      "2. 支持选择已保存配方或粘贴配方码，拆解每一步的满负荷日利润、时间占比与折算日贡献，并可在「独立口径 / 链内口径」之间切换。",
      "3. 展示最终叶子的日产出、近 24 小时成交量覆盖率与产能判断，帮助判断理论日利润能否被市场吸收。",
      "4. 新增方差分析区域（施工中），具体指标后续补齐。",
      "",
      "二、说明",
      "1. 体检页只做诊断，不重新推荐配方；实际日利润以链路合计为准。",
      "2. 强化节点暂不拆分独立盈亏。",
      "",
      "三、未来更新计划（顺序不代表更新顺序）",
      "1. 用 GPU 加速计算 2. 常规 UI 改进 3. 手机端 UI 适配 4. 炼金-转化重新设计 5. 修 bug。",
      "",
      "四、测试版",
      "本项目基于 https://github.com/gcaxe/milkonomy 与 https://github.com/polokikiki/Milkonomy 二次开发。作为测试版，将专注新功能的实现。"
    ].join("\n")
  },
  link: {
    url: "https://gcaxe.github.io/milkonomy-test/#/changelog",
    text: "查看详情"
  }
}

const STORAGE_KEY = "announcement-dismissed-2026"

/**
 * 检查公告是否应该显示
 */
export function shouldShowAnnouncement(): boolean {
  if (!announcementConfig.enabled) return false
  const dismissed = localStorage.getItem(STORAGE_KEY)
  return dismissed !== announcementConfig.id
}

/**
 * 关闭/忽略公告
 */
export function dismissAnnouncement(): void {
  localStorage.setItem(STORAGE_KEY, announcementConfig.id)
}

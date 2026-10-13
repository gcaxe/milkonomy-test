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
  id: "v2.8.5",
  message: {
    title: "v2.8.5 更新公告",
    content: [
      "一、新功能",
      "1. 多步配方推荐：税前多步配方推荐 + 税后多步配方推荐。自动按首页单步配方日利润拼接多步配方（树/图拓扑），按利润排序；可查看处理步骤与工时占比、复制配方码；搜索量可自定（默认 10 万条）。",
      "2. 多步工具：多步利润蓝图、税前/税后多步配方推荐已整合进「多步工具」导航菜单。",
      "",
      "二、调整",
      "1. 配方码规则修改，旧配方码可能失效（重新生成即可）。",
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

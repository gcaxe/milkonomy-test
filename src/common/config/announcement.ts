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
  id: "v2.8.6",
  message: {
    title: "v2.8.6 更新公告",
    content: [
      "一、新功能",
      "1. 多步配方推荐支持「排除物品」：被排除的物品不会作为原料进入多步路线（默认排除太阳石），支持拼音搜索、拖动排序。",
      "",
      "二、调整",
      "1. 多步配方推荐搜索方式修正：改为双向增长的 DFS 搜索（带去重），搜索结果更确定、更完整，重复计算大幅减少。",
      "2. 多步配方推荐新增搜索进度显示：计算时实时显示已完成的搜索量，计算过程中界面不再无响应。",
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

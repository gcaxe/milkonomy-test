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
  id: "v2.8.4",
  message: {
    title: "v2.8.4 更新公告",
    content: [
      "一、配方分享",
      "1. 点「生成配方码」，把当前配方编码成一串只含数字和大小写字母的配方码（以 # 结尾），复制即可分享给他人。",
      "2. 收到配方码后，粘贴到输入框点「根据配方码加载配方」，即可完整还原整张配方图。",
      "3. 配方码 # 之后的内容是注释，加载时会自动忽略，可以随手备注。",
      "4. 配方码不依赖本地保存，换设备、换浏览器都能使用，清缓存也不丢失。",
      "",
      "二、多步利润蓝图新功能",
      "1. 三造继承强化等级：给三造二厨喂强化过的装备，产物按 0.7 倍继承等级，小数按概率拆分（如 +4 奶酪剑显示为 0.8 个 +3 与 0.2 个 +2）。",
      "2. 强化分解：分解强化等级非 0 的物品时，成功会额外产出强化精华，数量与「强化工具-强化分解」页一致。",
      "3. 红节点支持 NPC 固定价购买（部分新手装备与实习护符）。",
      "4. 多步页底部新增网站访问统计（总访问量 / 访客数）。",
      "",
      "三、修复",
      "修复了若干配方数量口径与翻译问题。",
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

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
  id: "v2.8.3",
  message: {
    title: "v2.8.3 更新公告",
    content: [
      "一、新功能",
      "1. 多步利润蓝图页：红/绿/蓝节点 + 紫/橙节点的可拖动结点图，点「自动配平」按配方传播整张图，得到单批成本/利润与小时收益，附处理步骤与工时占比明细。",
      "2. 处理方式（紫）节点改版：4 个下拉选配方（三造二厨选产物、炼金选原料+动作+催化剂），不再靠连线定配方；可折叠成小长方形，不影响连线。",
      "3. 新增强化（橙）节点：选 +0 装备、强化到+几、保护物品、从+几开始保护，成本按强化计算页「材料费用」同口径（工时费0）。",
      "4. 红节点新增「来自背包」（价格×(1-税率)）；绿节点可选「保留于背包」（不计税，金币只能保留）。",
      "5. 方案内物品支持自定义价格，与首页共用并同步。",
      "6. 补全缺失单步配方：冲泡可以生产各种究极茶。",
      "",
      "二、体验优化",
      "1. 配平时有物品无挂单会提示「配方中有物品目前无挂单」。",
      "2. 移除循环计算的红绿相连规则（成环的合并直接禁止）。",
      "",
      "三、测试版",
      "本项目基于 https://github.com/gcaxe/milkonomy 与 https://github.com/polokikiki/Milkonomy 二次开发。作为测试版，将专注新功能的实现。"
    ].join("\n")
  },
  link: {
    url: "https://www.milkonomy.top/#/changelog",
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

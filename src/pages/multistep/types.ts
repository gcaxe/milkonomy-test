/** 变量节点种类：red=输入(市场买入/三采集/来自背包) blue=继续处理 green=叶子出售 */
export type VarKind = "red" | "blue" | "green"
/** 函数节点类别：A=三造二厨(产物定配方) B=炼金(原料定配方) C=强化 */
export type FuncClass = "A" | "B" | "C"
/** 红节点获取方式 */
export type ObtainMethod = "buy" | "gather" | "backpack"
/** 绿节点处理方式：出售 / 保留于背包 */
export type SellMode = "sell" | "keep"

/** [上部] 的一行起始物品；与红节点一对一（uid 关联），允许同名 */
export interface UpupItemRow {
  uid: number
  hrid: string | null
  /** 数量：十进制、最多 3 位小数、最小 0 */
  count: number
}

/** 画布上的节点：kind=var 变量 / kind=func 函数 */
export interface GraphNode {
  id: string
  kind: "var" | "func"
  // —— 变量节点字段 ——
  varKind?: VarKind
  hrid: string
  /** 物品强化等级（默认 0；强化节点产物为 +x） */
  level?: number
  /** 该节点代表的物品数量（红节点与行同步） */
  count?: number
  /** 红节点关联的 [上部] 行 uid（红→绿后清除） */
  rowUid?: number
  /** 获取方式（仅红节点） */
  obtain?: ObtainMethod
  /** 出售方式（仅绿节点）：常规物品默认出售，金币只能保留于背包 */
  sellMode?: SellMode
  // —— 函数节点字段 ——
  funcClass?: FuncClass
  /** A: 主要产物 hrid；B: 主要原料 hrid；C: 被强化装备 hrid（只接受 +0 装备） */
  mainItemHrid?: string
  /** A: 具体配方动作 hrid（如 /actions/crafting/mystery_plank）；B: 炼金动作 hrid */
  actionHrid?: string
  /** B: 催化剂等级 0无 1普通 2至高 */
  catalystRank?: 0 | 1 | 2
  // —— C 类（强化）字段 ——
  /** 强化到 +x（闭区间 [2, 20]，默认 +5） */
  enhanceLevel?: number
  /** 从 +y 开始保护（闭区间 [2, x]，+x 即不保护，默认 +x） */
  protectLevel?: number
  /** 保护物品 hrid（由被强化物品决定，不考虑贤者之镜） */
  protectionHrid?: string
  /** 折叠状态（仅函数节点）：折叠为小长方形，不影响 pin 与连线 */
  collapsed?: boolean
  /** 由哪个函数节点自动生成（级联删除用） */
  createdBy?: string
  // —— 坐标 ——
  x: number
  y: number
}

/** 引脚：id 可确定性重建，因此只需要持久化 wire 即可恢复全图 */
export interface GraphPin {
  /** `${nodeId}:in:main` / `${nodeId}:in:1` / `${nodeId}:out:main` ... */
  id: string
  nodeId: string
  side: "in" | "out"
  /** main = 主 pin；normal = 配方普通引脚 */
  role: "main" | "normal"
  /** 该 pin 上流动的物品 hrid */
  itemHrid: string
  /** 该 pin 上流动的物品强化等级（默认 0） */
  itemLevel?: number
  /** 自动供给（金币、茶）：不画线、不生成红节点，用灰色圆点表示 */
  auto?: boolean
  /** 强化节点四向 pin 位置；处理方式节点默认上/下 */
  position?: "top" | "left" | "right" | "bottom"
}

/** 一条连线：永远从 output pin 指向 input pin */
export interface GraphWire {
  id: string
  fromPinId: string
  toPinId: string
}

/** 方案保存 */
export interface MultistepPlan {
  name: string
  rows: UpupItemRow[]
  nodes: GraphNode[]
  wires: GraphWire[]
  savedAt: number
}

/** 单个结点的计算结果 */
export interface NodeCalcResult {
  actions: number | null
  timeCost: number | null
  extraCost: number | null
  preTaxIncome: number | null
  tax: number | null
  afterTaxIncome: number | null
}

/** [上部] 六个统计卡片的结果 */
export interface UpupSummary {
  leafAfterTaxIncome: number | null
  leafTax: number | null
  totalCost: number | null
  startItemCost: number | null
  extraCost: number | null
  batchProfit: number | null
  profitRate: number | null
  totalTime: number | null
  processNodeCount: number
  sellLeafCount: number
  hourlyProfit: number | null
  dailyProfit: number | null
}

/** 计算方式接口——未来新增计算方式时实现此接口即可，页面无需改动 */
export interface MultistepCalculatorStrategy {
  /** 计算单个结点 */
  calcNode: (node: GraphNode, ctx: { actionMap: Map<string, NodeCalcResult> }) => NodeCalcResult
  /** 汇总为统计卡片 */
  summarize: (nodes: GraphNode[], nodeResults: Map<string, NodeCalcResult>) => UpupSummary
}

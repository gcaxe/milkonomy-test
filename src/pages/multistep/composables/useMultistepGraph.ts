import type { GraphNode, GraphPin, GraphWire, MultistepPlan, UpupItemRow } from "../types"
import { ElMessage } from "element-plus"
import { computed, ref, toRaw, watch } from "vue"
import { getActionDetailOf, getGameDataApi } from "@/common/apis/game"
import locales, { getTrans } from "@/locales"
import { COIN_HRID } from "@/pinia/stores/game"
import { deleteRecipe, loadRecipes, saveRecipe } from "../utils/planStore"
import { type AlchemyActionKey, findProducingActionOf, getAlchemyActionOptionsOf, getFuncOutputPins, getGatherActionsOf, resolveEnhanceRecipe, resolveRecipeA, resolveRecipeB } from "../utils/recipes"
import { useMultistepCalc } from "./useMultistepCalc"

let seq = 0
const nextId = (prefix: string) => `${prefix}-${++seq}`

/** pin id → 索引（`${nodeId}:out:main` → 0，`${nodeId}:in:2` → 2） */
function pinIndexOf(pinId: string): number {
  const seg = pinId.split(":").pop() ?? "main"
  return seg === "main" ? 0 : Number(seg)
}

export function useMultistepGraph() {
  // —— 状态（暂不持久化：刷新页面即清空，配方用「保存/读取配方」存取） ——
  const rows = ref<UpupItemRow[]>([])
  const planName = ref("")
  const plans = ref<MultistepPlan[]>([])
  const positions = ref<Record<string, { x: number, y: number }>>({})

  const nodes = ref<GraphNode[]>([])
  const wires = ref<GraphWire[]>([])
  const zoom = ref(1)

  /** 函数节点是否已解析：A 类有动作即可；B 类需 原料+动作+催化剂 三者齐备；C 类需 装备+等级+保护物品+起保等级 */
  function isFuncResolved(n: GraphNode): boolean {
    if (n.kind !== "func") return false
    if (n.funcClass === "C") {
      return !!n.mainItemHrid && n.enhanceLevel != null && n.protectLevel != null && !!n.protectionHrid
    }
    return !!n.actionHrid && (n.funcClass === "A" || n.catalystRank != null)
  }

  /** 统一配方描述：输入 {hrid, auto}，输出 {hrid, level, mundane}（mundane=平凡产物，可隐藏） */
  interface PinRecipe {
    inputs: { hrid: string, auto: boolean }[]
    outputs: { hrid: string, level: number, mundane: boolean }[]
  }

  /** 函数节点主输入 pin 上连线物品的强化等级（A 类继承 / B 类分解强化精华用） */
  function mainInputLevelOf(n: GraphNode): number {
    const mainWire = wires.value.find(w => w.toPinId === `${n.id}:in:main`)
    const src = mainWire ? nodeById(mainWire.fromPinId.split(":")[0]) : undefined
    return src?.kind === "var" ? (src.level ?? 0) : 0
  }

  /** 缓存解析结果避免重复计算（key = nodeId + 配方参数 + 主输入等级） */
  const recipeCache = new Map<string, PinRecipe>()
  function resolveFuncRecipe(n: GraphNode, mainLevel: number = mainInputLevelOf(n)): PinRecipe {
    if (!isFuncResolved(n)) return { inputs: [], outputs: [] }
    const key = `${n.id}-${n.actionHrid ?? "C"}-${n.catalystRank ?? 0}-${n.mainItemHrid ?? ""}-${n.enhanceLevel ?? 0}-${n.protectLevel ?? 0}-${n.protectionHrid ?? ""}-${mainLevel}`
    if (!recipeCache.has(key)) {
      if (n.funcClass === "C") {
        const r = resolveEnhanceRecipe(n)
        recipeCache.set(key, {
          inputs: r.inputs.map(i => ({ hrid: i.hrid, auto: i.auto })),
          outputs: r.outputs.map(o => ({ hrid: o.hrid, level: o.level, mundane: false }))
        })
      } else if (n.funcClass === "A") {
        const r = resolveRecipeA(n.actionHrid!)
        recipeCache.set(key, { inputs: r.inputs, outputs: getFuncOutputPins(n, mainLevel) })
      } else {
        const r = resolveRecipeB(n.mainItemHrid!, n.actionHrid!.split("/").pop() as AlchemyActionKey, n.catalystRank ?? 0)
        recipeCache.set(key, { inputs: r.inputs, outputs: getFuncOutputPins(n, mainLevel) })
      }
    }
    return recipeCache.get(key)!
  }

  /** C 类输入 pin 的四向位置（top=本体 / left=强化材料 / right=保护材料） */
  function enhancePinPosition(n: GraphNode, index: number): "top" | "left" | "right" {
    const r = resolveEnhanceRecipe(n)
    return r.inputs[index]?.position ?? "left"
  }

  // —— 引脚：由 nodes+wires 确定性派生（不持久化；主输入等级会影响配方输出 pin） ——
  const pins = computed<GraphPin[]>(() => {
    const list: GraphPin[] = []
    const wireList = wires.value // 建立对连线的响应式依赖
    /** pin 上连线物品的强化等级（无连线 = 0） */
    const wiredLevelOf = (pinId: string): number => {
      const w = wireList.find(x => x.toPinId === pinId)
      const src = w ? nodeById(w.fromPinId.split(":")[0]) : undefined
      return src?.kind === "var" ? (src.level ?? 0) : 0
    }
    for (const n of nodes.value) {
      if (n.kind === "var") {
        list.push({ id: `${n.id}:in:main`, nodeId: n.id, side: "in", role: "normal", itemHrid: n.hrid, itemLevel: n.level ?? 0 })
        list.push({ id: `${n.id}:out:main`, nodeId: n.id, side: "out", role: "normal", itemHrid: n.hrid, itemLevel: n.level ?? 0 })
      } else {
        // 未解析函数：仅主 in / 主 out
        if (!isFuncResolved(n)) {
          list.push({ id: `${n.id}:in:main`, nodeId: n.id, side: "in", role: "main", itemHrid: n.mainItemHrid ?? "", itemLevel: 0, position: "top" })
          list.push({ id: `${n.id}:out:main`, nodeId: n.id, side: "out", role: "main", itemHrid: n.mainItemHrid ?? "", itemLevel: n.funcClass === "C" ? (n.enhanceLevel ?? 0) : 0, position: "bottom" })
        } else {
          const recipe = resolveFuncRecipe(n)
          recipe.inputs.forEach((input, i) => {
            const pinId = `${n.id}:in:${i === 0 ? "main" : i}`
            list.push({
              id: pinId,
              nodeId: n.id,
              side: "in",
              role: i === 0 ? "main" : "normal",
              itemHrid: input.hrid,
              itemLevel: wiredLevelOf(pinId),
              auto: input.auto,
              position: n.funcClass === "C" ? enhancePinPosition(n, i) : undefined
            })
          })
          recipe.outputs.forEach((out, i) => list.push({
            id: `${n.id}:out:${i === 0 ? "main" : i}`,
            nodeId: n.id,
            side: "out",
            role: i === 0 ? "main" : "normal",
            itemHrid: out.hrid,
            itemLevel: out.level,
            position: "bottom"
          }))
        }
      }
    }
    return list
  })
  const pinById = (id: string) => pins.value.find(p => p.id === id)
  const nodeById = (id: string) => nodes.value.find(n => n.id === id)

  // ===================== 基础 CRUD =====================

  /** 把节点放到画布当前视口中央（含滚动/缩放换算），offsetIndex 用于错开多个新节点 */
  function placeInViewport(node: GraphNode, offsetIndex: number) {
    const wrap = document.querySelector<HTMLElement>(".node-canvas-wrap")
    if (!wrap) {
      node.x = 400
      node.y = 600
      return
    }
    const rect = wrap.getBoundingClientRect()
    const z = zoom.value || 1
    node.x = (rect.width / 2 + wrap.scrollLeft) / z - 110 + (offsetIndex % 5) * 30
    node.y = (rect.height / 2 + wrap.scrollTop) / z - 60 + (offsetIndex % 5) * 30
  }

  /** [上部] 添加物品行：同时创建红节点（购买）；viewport=true 时出现在用户视野中央 */
  function addRow(viewport: boolean = false) {
    const uid = ++seq
    const nodeId = nextId("red")
    const row: UpupItemRow = { uid, hrid: null, count: 1 }
    rows.value.push(row)
    const node: GraphNode = {
      id: nodeId,
      kind: "var",
      varKind: "red",
      hrid: "",
      level: 0,
      count: 1,
      rowUid: uid,
      obtain: "buy",
      x: 40,
      y: 40
    }
    nodes.value.push(node)
    if (viewport) {
      placeInViewport(node, nodes.value.filter(n => n.kind === "var").length)
      // 记录为“手动”位置，避免 layout() 把它拽回网格
      positions.value[node.id] = { x: node.x, y: node.y }
    }
    layout()
    return { row, nodeId }
  }
  /** 行选中物品：红节点拿到物品名，获取方式重置为购买 */
  function setRowItem(uid: number, hrid: string) {
    const row = rows.value.find(r => r.uid === uid)
    const node = nodes.value.find(n => n.rowUid === uid)
    if (!row || !node) return
    row.hrid = hrid
    node.hrid = hrid
    node.obtain = "buy"
  }
  /** 删除行：级联删除对应红节点及其连线 */
  function removeRow(uid: number) {
    const node = nodes.value.find(n => n.rowUid === uid)
    rows.value = rows.value.filter(r => r.uid !== uid)
    if (node) deleteNode(node.id)
  }
  /** 添加处理方式节点（紫色，未解析，尽量出现在用户当前视野中央；创建后默认展开） */
  function addFuncNode() {
    const node: GraphNode = {
      id: nextId("func"),
      kind: "func",
      hrid: "",
      collapsed: false,
      x: 400,
      y: 600
    }
    placeInViewport(node, nodes.value.filter(n => n.kind === "func").length)
    nodes.value.push(node)
    // 记录为“手动”位置，避免 layout() 把它拽回网格
    positions.value[node.id] = { x: node.x, y: node.y }
    layout()
    return node
  }
  /** 添加强化节点（橙色，行为类似处理方式节点；创建后默认展开） */
  function addEnhanceNode() {
    const node: GraphNode = {
      id: nextId("enh"),
      kind: "func",
      hrid: "",
      funcClass: "C",
      enhanceLevel: 5,
      collapsed: false,
      x: 400,
      y: 600
    }
    placeInViewport(node, nodes.value.filter(n => n.kind === "func").length)
    nodes.value.push(node)
    positions.value[node.id] = { x: node.x, y: node.y }
    layout()
    return node
  }
  /** 删除节点：删除其全部连线；函数节点级联删除其自动生成的绿/红节点 */
  function deleteNode(nodeId: string) {
    const node = nodeById(nodeId)
    if (!node) return
    wires.value = wires.value.filter(w => !w.fromPinId.startsWith(`${nodeId}:`) && !w.toPinId.startsWith(`${nodeId}:`))
    // 函数节点：级联删除其自动生成的绿/红节点，并同步删除红节点对应的 [上部] 行
    if (node.kind === "func") {
      const children = nodes.value.filter(n => n.createdBy === nodeId)
      for (const c of children) {
        if (c.kind === "var" && c.rowUid != null) rows.value = rows.value.filter(r => r.uid !== c.rowUid)
        wires.value = wires.value.filter(w => !w.fromPinId.startsWith(`${c.id}:`) && !w.toPinId.startsWith(`${c.id}:`))
      }
      nodes.value = nodes.value.filter(n => !(n.createdBy === nodeId))
    }
    nodes.value = nodes.value.filter(n => n.id !== nodeId)
    if (node.rowUid != null) rows.value = rows.value.filter(r => r.uid !== node.rowUid)
    maintainInvariants()
    layout()
  }
  /** 删除连线：随后做全局一致性维护 */
  function deleteWire(wireId: string) {
    if (!wires.value.some(x => x.id === wireId)) return
    wires.value = wires.value.filter(x => x.id !== wireId)
    maintainInvariants()
    layout()
  }
  /**
   * 函数节点复原为未解析状态：删除其全部产物节点（绿/蓝，含主产物）、清自身连线、复位下拉。
   *  产物删除会切断下游函数节点的输入，由 maintainInvariants 循环传播连锁复位
   */
  function revertFunc(func: GraphNode) {
    // 先收集该函数节点的产物变量节点（in-wire 来自函数节点任意输出 pin）
    const products = nodes.value.filter(n =>
      n.kind === "var" && wires.value.some(w => w.fromPinId.startsWith(`${func.id}:`) && w.toPinId === `${n.id}:in:main`))
    // 清除函数节点自身全部连线
    wires.value = wires.value.filter(w => !w.fromPinId.startsWith(`${func.id}:`) && !w.toPinId.startsWith(`${func.id}:`))
    // 主产物节点已悬空（线被先删）时同样删除（强化节点按产物等级匹配）
    const mainOutLevel = func.funcClass === "C" ? (func.enhanceLevel ?? 0) : 0
    if (func.mainItemHrid) {
      const dangling = nodes.value.find(n =>
        n.kind === "var" && (n.varKind === "green" || n.varKind === "blue") && n.hrid === func.mainItemHrid
        && (n.level ?? 0) === mainOutLevel
        && !wires.value.some(w => w.toPinId === `${n.id}:in:main`) && !products.includes(n))
      if (dangling) products.push(dangling)
    }
    // 复位为未解析状态
    func.actionHrid = undefined
    func.mainItemHrid = undefined
    func.catalystRank = undefined
    func.protectionHrid = undefined
    // 删除产物节点及其行与连线
    for (const p of products) {
      if (p.rowUid != null) rows.value = rows.value.filter(r => r.uid !== p.rowUid)
      wires.value = wires.value.filter(w => !w.fromPinId.startsWith(`${p.id}:`) && !w.toPinId.startsWith(`${p.id}:`))
    }
    nodes.value = nodes.value.filter(n => !products.includes(n))
  }

  /** 删除连线/节点后的全局一致性维护 */
  function maintainInvariants() {
    // 1. 已解析函数节点：任一非自动供给输入/输出 pin 断线 → 复原为无配方状态。
    //    复原会删除产物节点，可能使下游函数节点失去输入，故循环至稳定（传播式级联复位）
    let changed = true
    while (changed) {
      changed = false
      for (const func of nodes.value.filter(n => n.kind === "func" && isFuncResolved(n))) {
        const recipe = resolveFuncRecipe(func)
        const outOk = recipe.outputs.every((_, i) =>
          wires.value.some(w => w.fromPinId === `${func.id}:out:${i === 0 ? "main" : i}`))
        const inOk = recipe.inputs.every((input, i) =>
          input.auto || wires.value.some(w => w.toPinId === `${func.id}:in:${i === 0 ? "main" : i}`))
        if (!outOk || !inOk) {
          revertFunc(func)
          changed = true
          break
        }
      }
    }
    // 2. 清理指向不存在 pin 的残留线（配方切换/复位后 pin 可能消失）
    const validPinIds = new Set(pins.value.map(p => p.id))
    wires.value = wires.value.filter(w => validPinIds.has(w.fromPinId) && validPinIds.has(w.toPinId))
    // 3. 自动生成的绿节点若失去输入线 → 删除
    for (const g of nodes.value.filter(n => n.kind === "var" && n.varKind === "green" && n.createdBy)) {
      if (!wires.value.some(w => w.toPinId === `${g.id}:in:main`)) {
        wires.value = wires.value.filter(w => !w.fromPinId.startsWith(`${g.id}:`) && !w.toPinId.startsWith(`${g.id}:`))
        nodes.value = nodes.value.filter(n => n.id !== g.id)
      }
    }
    // 4. 变量节点颜色由 pin 占用状态决定：双连=蓝，仅输入=绿，其余=红（来源购买，含双空）；彩虹节点保持类型
    for (const v of nodes.value.filter(n => n.kind === "var")) {
      if (v.varKind === "rainbow") continue
      const hasIn = wires.value.some(w => w.toPinId === `${v.id}:in:main`)
      const hasOut = wires.value.some(w => w.fromPinId === `${v.id}:out:main`)
      if (hasIn && hasOut) {
        v.varKind = "blue"
      } else if (hasIn) {
        v.varKind = "green"
        // 兜底：带行的节点获得输入线时清除其 [上部] 行
        if (v.rowUid != null) {
          rows.value = rows.value.filter(r => r.uid !== v.rowUid)
          v.rowUid = undefined
        }
      } else if (v.varKind !== "red" || v.rowUid == null) {
        // 无输入线（仅输出或双空）：只能是红，来源变回购买并恢复 [上部] 行
        v.varKind = "red"
        v.obtain = "buy"
        if (v.rowUid == null) {
          const uid = ++seq
          rows.value.push({ uid, hrid: v.hrid, count: v.count ?? 1 })
          v.rowUid = uid
        }
      }
    }
  }

  // ===================== 连线交互 =====================

  /**
   * 拖线落点判定：返回错误消息或执行动作。
   *  用户只通过「绿 → 红同名同等级合并为蓝」连通整张图；函数节点 pin 由配方自动生成连线
   */
  function tryConnect(fromPinId: string, toPinId: string): string | null {
    const from = pinById(fromPinId)
    const to = pinById(toPinId)
    if (!from || !to) return getTrans("引脚不存在")
    if (from.side === to.side) return getTrans("只能从输出连到输入")
    const outPin = from.side === "out" ? from : to
    const inPin = from.side === "in" ? from : to
    const outNode = nodeById(outPin.nodeId)!
    const inNode = nodeById(inPin.nodeId)!
    // 输入 pin 只能接一条线
    if (wires.value.some(w => w.toPinId === inPin.id)) return getTrans("该输入引脚已连接")
    // 一个 pin 只能连出一条线
    if (wires.value.some(w => w.fromPinId === outPin.id)) return getTrans("该输出引脚已连接")

    // —— 变量 → 变量（仅允许：绿 → 红 同名合并；等级不同时红节点采用绿节点等级） ——
    if (outNode.kind === "var" && inNode.kind === "var") {
      if (outNode.varKind !== "green" || inNode.varKind !== "red") {
        return getTrans("仅同名绿色节点可连到红色输入引脚")
      }
      if (!outNode.hrid || outNode.hrid !== inNode.hrid) {
        return getTrans("仅同名绿色节点可连到红色输入引脚")
      }
      // 等级采用：绿节点是生产者，其强化等级为准（如 +4 奶酪剑喂给锻造节点）
      if ((outNode.level ?? 0) !== (inNode.level ?? 0)) {
        inNode.level = outNode.level ?? 0
      }
      // 禁止合并：炼金（如转化）中产物与主要原料相同，合并会形成输入=输出的循环
      const producerWire = wires.value.find(w => w.toPinId === `${outNode.id}:in:main`)
      const producer = producerWire ? nodeById(pinById(producerWire.fromPinId)?.nodeId ?? "") : undefined
      if (producer && producer.kind === "func" && producer.funcClass === "B" && producer.mainItemHrid === outNode.hrid) {
        return getTrans("主要原料与产物相同，禁止合并")
      }
      // 环检测：合并会成环时禁止（不保留三角回流/循环计算规则）
      if (mergeCreatesCycle(outNode, inNode)) {
        return getTrans("会形成循环，请调整连线")
      }
      // 彩虹判定：同一生产者的另一个同名输出已流入红节点的下游链 → 双路径供料，创建彩虹节点（红蓝绿三部分）
      if (shouldBeRainbow(outNode, inNode)) {
        createRainbowNode(outNode, inNode)
        return null
      }
      mergeVarNodes(outNode, inNode)
      return null
    }

    // 函数节点的 pin 不接受手工连线（配方由下拉菜单确定，连线由配方自动生成）
    if (outNode.kind === "func" || inNode.kind === "func") {
      return getTrans("该输入引脚不可连接")
    }

    return getTrans("无法连接")
  }

  // ===================== 解析（下拉菜单确定配方） =====================

  /** 处理方式节点第一个下拉：三造二厨(A)/炼金(B)。切换时清空已选的物品/动作/催化剂 */
  function onFuncClassChange(func: GraphNode, cls: "A" | "B") {
    if (func.funcClass === cls) return
    func.funcClass = cls
    func.mainItemHrid = undefined
    func.actionHrid = undefined
    func.catalystRank = undefined
  }

  /**
   * 处理方式节点第二个下拉：选择物品确定配方。
   *  A（三造二厨）选产物 → 唯一配方立即解析；B（炼金）选原料 → 等待动作+催化剂
   */
  function onProcessItemChange(func: GraphNode, hrid: string) {
    if (func.funcClass === "A") {
      const actionHrid = findProducingActionOf(hrid)
      if (!actionHrid) {
        ElMessage.error(getTrans("未找到该产物的唯一配方"))
        func.mainItemHrid = undefined
        return
      }
      func.mainItemHrid = hrid
      func.actionHrid = actionHrid
      applyResolvedRecipe(func)
      maintainInvariants()
      layout()
      return
    }
    if (func.funcClass === "B") {
      func.mainItemHrid = hrid
      func.actionHrid = undefined
      func.catalystRank = undefined
    }
  }

  /** B 类（炼金）动作切换 */
  function onFuncActionChange(func: GraphNode, actionKey: AlchemyActionKey) {
    if (func.funcClass !== "B") return
    func.actionHrid = `/actions/alchemy/${actionKey}`
    if (func.catalystRank == null) func.catalystRank = 0
    onFuncConfigChange(func)
  }

  /** B 类（炼金）催化剂切换 */
  function onFuncCatalystChange(func: GraphNode, rank: 0 | 1 | 2) {
    if (func.funcClass !== "B") return
    func.catalystRank = rank
    onFuncConfigChange(func)
  }

  /** B 类解析：主原料 + 动作 + 催化剂（三者齐备后触发） */
  function resolveFuncB(func: GraphNode) {
    if (!func.mainItemHrid || !func.actionHrid || func.catalystRank == null) return
    applyResolvedRecipe(func)
    maintainInvariants()
    layout()
  }

  /** C 类（强化）解析：装备 + 强化到+x + 保护物品 + 从+y 开始保护（四者齐备后触发） */
  function resolveEnhanceFunc(func: GraphNode) {
    if (!func.mainItemHrid || func.enhanceLevel == null || func.protectLevel == null || !func.protectionHrid) return
    applyResolvedRecipe(func)
    maintainInvariants()
    layout()
  }

  /** 强化节点配置变化：未解析→尝试解析；已解析→切换配方重建 */
  function onEnhanceConfigChange(func: GraphNode) {
    if (isFuncResolved(func)) reapplyResolvedRecipe(func)
    else resolveEnhanceFunc(func)
  }

  /** 配方切换（炼金动作/催化剂/强化参数）：清除旧配方的展开（自动生成的绿/红节点与行），按新参数重建 */
  function reapplyResolvedRecipe(func: GraphNode) {
    const childIds = new Set(nodes.value.filter(n => n.createdBy === func.id).map(n => n.id))
    // 删除自动生成的绿/红节点（含 [上部] 行）及其连线
    for (const c of nodes.value.filter(n => childIds.has(n.id))) {
      if (c.kind === "var" && c.rowUid != null) rows.value = rows.value.filter(r => r.uid !== c.rowUid)
      wires.value = wires.value.filter(w => !w.fromPinId.startsWith(`${c.id}:`) && !w.toPinId.startsWith(`${c.id}:`))
    }
    nodes.value = nodes.value.filter(n => !childIds.has(n.id))
    const newRecipe = resolveFuncRecipe(func)
    // 保留用户合并出的蓝节点连线：另一端节点存活、不是自动生成节点，且与切换后的配方物品匹配
    wires.value = wires.value.filter((w) => {
      const touches = w.fromPinId.startsWith(`${func.id}:`) || w.toPinId.startsWith(`${func.id}:`)
      if (!touches) return true
      const srcId = w.fromPinId.split(":")[0]
      const tgtId = w.toPinId.split(":")[0]
      const pinIdx = w.fromPinId.startsWith(`${func.id}:`)
        ? Number((w.fromPinId.split(":").pop() || "main").replace("main", "0"))
        : Number((w.toPinId.split(":").pop() || "main").replace("main", "0"))
      if (w.fromPinId.startsWith(`${func.id}:`)) {
        // 函数输出 → 变量：变量物品须与新配方该输出一致
        const out = newRecipe.outputs[pinIdx]
        const tgt = nodeById(tgtId)
        if (!tgt || childIds.has(tgtId) || !out) return false
        return tgt.kind === "var" && tgt.hrid === out.hrid && (tgt.level ?? 0) === out.level
      }
      // 变量 → 函数输入：变量物品须与新配方该输入一致（自动供给 pin 不保留线）
      const input = newRecipe.inputs[pinIdx]
      const src = nodeById(srcId)
      if (!src || childIds.has(srcId) || !input || input.auto) return false
      return src.kind === "var" && src.hrid === input.hrid && (src.level ?? 0) === 0
    })
    applyResolvedRecipe(func)
    maintainInvariants()
    layout()
  }

  /** B 类配置变化：未解析→尝试解析；已解析（炼金）→切换配方重建 */
  function onFuncConfigChange(func: GraphNode) {
    if (isFuncResolved(func)) reapplyResolvedRecipe(func)
    else resolveFuncB(func)
  }

  /** 展开配方：重建输入输出 pin、自动生成红/绿节点并连线（金币/茶等自动供给除外） */
  function applyResolvedRecipe(func: GraphNode) {
    const recipe = resolveFuncRecipe(func)
    // —— 输入侧 ——
    recipe.inputs.forEach((input, i) => {
      if (input.auto) return // 金币/茶：不生成节点，pin 为灰色自动供给
      const pinId = `${func.id}:in:${i === 0 ? "main" : i}`
      // pin 已被用户合并出的蓝节点连线占用，跳过
      if (wires.value.some(w => w.toPinId === pinId)) return
      const { row, nodeId } = addRow()
      const varNode = nodeById(nodeId)!
      setRowItem(row.uid, input.hrid)
      varNode.createdBy = func.id
      wires.value.push({ id: nextId("wire"), fromPinId: `${varNode.id}:out:main`, toPinId: pinId })
    })
    // —— 输出侧 ——
    recipe.outputs.forEach((out, i) => {
      const pinId = `${func.id}:out:${i === 0 ? "main" : i}`
      // pin 已被用户合并出的蓝节点连线占用，跳过
      if (wires.value.some(w => w.fromPinId === pinId)) return
      // 只有金币默认保留于背包（货币本身），其余产物（含匣子/精华/精炼装备）默认出售
      const keepDefault = out.hrid === COIN_HRID
      const green: GraphNode = {
        id: nextId("green"),
        kind: "var",
        varKind: "green",
        hrid: out.hrid,
        level: out.level,
        sellMode: keepDefault ? "keep" : "sell",
        x: func.x,
        y: func.y + 200,
        createdBy: func.id
      }
      nodes.value.push(green)
      wires.value.push({ id: nextId("wire"), fromPinId: pinId, toPinId: `${green.id}:in:main` })
    })
  }

  /** 折叠/展开切换：纯视觉变化，不影响 pin 与连线 */
  function toggleCollapse(func: GraphNode) {
    func.collapsed = !func.collapsed
  }

  // ===================== 合并（红+绿 → 蓝） =====================

  /** 沿 var 出线收集下游函数节点集合（彩虹检测用：两条同源流是否汇入同一条下游链） */
  function downstreamFuncsOf(varId: string, maxDepth: number = 20): Set<string> {
    const result = new Set<string>()
    const visitedVars = new Set<string>([varId])
    const queue = [varId]
    let depth = 0
    while (queue.length && depth < maxDepth) {
      depth++
      const cur = queue.shift()!
      for (const w of wires.value.filter(x => x.fromPinId.startsWith(`${cur}:`))) {
        const tgt = nodeById(w.toPinId.split(":")[0])
        if (!tgt) continue
        if (tgt.kind === "func") {
          result.add(tgt.id)
          for (const ow of wires.value.filter(x => x.fromPinId.startsWith(`${tgt.id}:`))) {
            const v = nodeById(ow.toPinId.split(":")[0])
            if (v?.kind === "var" && !visitedVars.has(v.id)) {
              visitedVars.add(v.id)
              queue.push(v.id)
            }
          }
        } else if (tgt.kind === "var" && !visitedVars.has(tgt.id)) {
          visitedVars.add(tgt.id)
          queue.push(tgt.id)
        }
      }
    }
    return result
  }

  /** 判断绿+红合并是否应创建彩虹节点：绿的生产者有另一个同名输出已流入红的下游链（双路径供料，硬合并会导致配平冲突） */
  function shouldBeRainbow(greenNode: GraphNode, redNode: GraphNode): boolean {
    const producerWire = wires.value.find(w => w.toPinId === `${greenNode.id}:in:main`)
    const producer = producerWire ? nodeById(producerWire.fromPinId.split(":")[0]) : undefined
    if (!producer || producer.kind !== "func") return false
    // 同生产者（直接或间接）的其他同名同等级输出
    const siblings = nodes.value.filter(n =>
      n.kind === "var" && n.id !== greenNode.id && n.hrid === greenNode.hrid
      && (n.level ?? 0) === (greenNode.level ?? 0)
      && wires.value.some(w => w.toPinId === `${n.id}:in:main` && w.fromPinId.startsWith(`${producer.id}:`)))
    if (!siblings.length) return false
    const redDown = downstreamFuncsOf(redNode.id)
    if (!redDown.size) return false
    return siblings.some((sib) => {
      const sibDown = downstreamFuncsOf(sib.id)
      return [...sibDown].some(f => redDown.has(f))
    })
  }

  /** 红绿合并为彩虹节点：结构同蓝节点（in 接生产、out 接消耗），配平时为被动节点，结算拆成蓝/绿/红三部分 */
  function createRainbowNode(greenNode: GraphNode, redNode: GraphNode) {
    const hrid = greenNode.hrid
    const level = greenNode.level ?? 0
    const greenInputWire = wires.value.find(w => w.toPinId === `${greenNode.id}:in:main`)
    const redOutputWires = wires.value.filter(w => w.fromPinId === `${redNode.id}:out:main`)
    const redRowUid = redNode.rowUid
    wires.value = wires.value.filter(w =>
      !w.fromPinId.startsWith(`${greenNode.id}:`) && !w.toPinId.startsWith(`${greenNode.id}:`)
      && !w.fromPinId.startsWith(`${redNode.id}:`) && !w.toPinId.startsWith(`${redNode.id}:`))
    nodes.value = nodes.value.filter(n => n.id !== greenNode.id && n.id !== redNode.id)
    rows.value = rows.value.filter(r => r.uid !== redRowUid)
    const rainbow: GraphNode = {
      id: nextId("rainbow"),
      kind: "var",
      varKind: "rainbow",
      hrid,
      level,
      count: 0,
      sellMode: greenNode.sellMode,
      x: (greenNode.x + redNode.x) / 2,
      y: (greenNode.y + redNode.y) / 2
    }
    nodes.value.push(rainbow)
    if (greenInputWire) wires.value.push({ id: nextId("wire"), fromPinId: greenInputWire.fromPinId, toPinId: `${rainbow.id}:in:main` })
    for (const w of redOutputWires) wires.value.push({ id: nextId("wire"), fromPinId: `${rainbow.id}:out:main`, toPinId: w.toPinId })
    maintainInvariants()
    layout()
  }

  /** 判断 绿+红 合并是否形成环：从绿的生产函数节点出发沿下游（含红的后继）能否回到自身 */
  function mergeCreatesCycle(greenNode: GraphNode, redNode: GraphNode): boolean {
    const producerWire = wires.value.find(w => w.toPinId === `${greenNode.id}:in:main`)
    const producer = producerWire ? nodeById(pinById(producerWire.fromPinId)?.nodeId ?? "") : undefined
    if (!producer || producer.kind !== "func") return false
    const visited = new Set<string>()
    const queue: GraphNode[] = [producer]
    while (queue.length) {
      const f = queue.shift()!
      if (visited.has(f.id)) continue
      visited.add(f.id)
      for (const w of wires.value.filter(x => x.fromPinId.startsWith(`${f.id}:`))) {
        const v = nodeById(pinById(w.toPinId)?.nodeId ?? "")
        if (!v || v.kind !== "var") continue
        // 合并后绿被蓝取代：蓝.out → 红的全部消费函数节点
        const outWires = v.id === greenNode.id
          ? wires.value.filter(x => x.fromPinId === `${redNode.id}:out:main`)
          : wires.value.filter(x => x.fromPinId === `${v.id}:out:main`)
        for (const vw of outWires) {
          const nf = nodeById(pinById(vw.toPinId)?.nodeId ?? "")
          if (nf?.kind === "func") {
            if (nf.id === producer.id) return true
            queue.push(nf)
          }
        }
      }
    }
    return false
  }

  /** 红绿同名合并：记录信息 → 删两节点+红节点行 → 建蓝节点 → 重连；等级不同时红采用绿的等级 */
  function mergeVarNodes(greenNode: GraphNode, redNode: GraphNode) {
    // 1. 记录
    const hrid = greenNode.hrid
    const level = greenNode.level ?? 0
    const levelAdopted = (redNode.level ?? 0) !== level
    const greenInputWire = wires.value.find(w => w.toPinId === `${greenNode.id}:in:main`)
    const redOutputWires = wires.value.filter(w => w.fromPinId === `${redNode.id}:out:main`)
    const redRowUid = redNode.rowUid
    // 2. 删除二者及所有相关连线与红节点 [上部] 行
    wires.value = wires.value.filter(w =>
      !w.fromPinId.startsWith(`${greenNode.id}:`) && !w.toPinId.startsWith(`${greenNode.id}:`)
      && !w.fromPinId.startsWith(`${redNode.id}:`) && !w.toPinId.startsWith(`${redNode.id}:`))
    nodes.value = nodes.value.filter(n => n.id !== greenNode.id && n.id !== redNode.id)
    rows.value = rows.value.filter(r => r.uid !== redRowUid)
    // 3. 创建蓝色节点（数量沿用绿色节点的产量折算）
    const blue: GraphNode = {
      id: nextId("blue"),
      kind: "var",
      varKind: "blue",
      hrid,
      level,
      count: greenNode.count,
      x: (greenNode.x + redNode.x) / 2,
      y: (greenNode.y + redNode.y) / 2
    }
    nodes.value.push(blue)
    // 4. 重连：蓝.in ← 绿的原生产连线；蓝.out → 红的原消耗连线
    if (greenInputWire) wires.value.push({ id: nextId("wire"), fromPinId: greenInputWire.fromPinId, toPinId: `${blue.id}:in:main` })
    for (const w of redOutputWires) wires.value.push({ id: nextId("wire"), fromPinId: `${blue.id}:out:main`, toPinId: w.toPinId })
    // 5. 等级被采用时：消费该物品的函数节点配方随主输入等级变化（A 继承 0.7 / 分解强化精华），重建其展开
    if (levelAdopted) {
      const consumers = new Set<string>()
      for (const w of redOutputWires) consumers.add(w.toPinId.split(":")[0])
      for (const func of nodes.value.filter(n => n.kind === "func" && consumers.has(n.id) && isFuncResolved(n))) {
        reapplyResolvedRecipe(func)
      }
    }
    // 按 pin 占用规则定色（绿.in + 红.out 都在 → 蓝）
    maintainInvariants()
    layout()
  }

  // ===================== 布局（垂直组织：输入在函数节点上方、输出在下方） =====================
  const LEVEL_H = 140
  function layout() {
    const funcs = nodes.value.filter(n => n.kind === "func")
    const vars = nodes.value.filter(n => n.kind === "var")
    // 隐藏的平凡产物不参与布局（位置由后续可见节点补上）
    const visibleVars = vars.filter(v => !hiddenMundaneIds.value.has(v.id))
    // 函数节点：每行 4 个换行，避免超出可滚动区域
    funcs.forEach((f, i) => {
      if (!positions.value[f.id]) {
        f.x = 400 + (i % 4) * 520
        f.y = 700 + Math.floor(i / 4) * 700
      } else {
        f.x = positions.value[f.id].x
        f.y = positions.value[f.id].y
      }
    })
    for (const v of visibleVars) {
      // 手动拖过/手动放置的节点尊重其位置
      if (positions.value[v.id]) {
        v.x = positions.value[v.id].x
        v.y = positions.value[v.id].y
        continue
      }
      const producerWire = wires.value.find(w => w.toPinId === `${v.id}:in:main`)
      const producer = producerWire ? nodeById(pinById(producerWire.fromPinId)?.nodeId ?? "") : undefined
      const consumerWire = wires.value.find(w => w.fromPinId === `${v.id}:out:main`)
      const consumer = consumerWire ? nodeById(pinById(consumerWire.toPinId)?.nodeId ?? "") : undefined
      if (producer && producer.kind === "func") {
        // 输出节点：位于其生产函数节点下方
        const siblings = visibleVars.filter((n) => {
          const w = wires.value.find(x => x.toPinId === `${n.id}:in:main`)
          return w ? w.fromPinId.startsWith(`${producer.id}:`) : false
        })
        const idx = siblings.indexOf(v)
        v.x = producer.x
        v.y = producer.y + 200 + idx * LEVEL_H
      } else if (consumer && consumer.kind === "func") {
        // 输入节点：位于其消费函数节点上方
        const siblings = visibleVars.filter((n) => {
          const w = wires.value.find(x => x.fromPinId === `${n.id}:out:main`)
          return w ? w.toPinId.startsWith(`${consumer.id}:`) : false
        })
        const idx = siblings.indexOf(v)
        v.x = consumer.x
        v.y = consumer.y - 200 - idx * LEVEL_H
      } else {
        // 未连线红节点：最左列
        const idx = visibleVars
          .filter(n => !wires.value.some(w => w.fromPinId.startsWith(`${n.id}:`) || w.toPinId.startsWith(`${n.id}:`)))
          .indexOf(v)
        v.x = 40
        v.y = 40 + idx * 150
      }
      // 不生成在可滚动区域外：坐标下限 40
      if (v.x < 40) v.x = 40
      if (v.y < 40) v.y = 40
    }
  }

  /** 画布尺寸：随节点分布动态扩展，保证所有节点都在可滚动区域内 */
  const canvasSize = computed(() => {
    let w = 4000
    let h = 2000
    for (const n of nodes.value) {
      w = Math.max(w, n.x + 320)
      h = Math.max(h, n.y + 220)
    }
    return { width: w, height: h }
  })

  /** 不显示平凡产物（精华/箱子/专精之线等稀有掉落），默认关闭；隐藏不影响利润计算 */
  const hideMundane = ref(false)
  /** 勾选后需要隐藏的绿色节点 id：按输出 pin 判定（同名同 hrid 的平凡/非平凡产物互不影响，如分解的两种炼金精华） */
  const hiddenMundaneIds = computed(() => {
    const hidden = new Set<string>()
    if (!hideMundane.value) return hidden
    for (const g of nodes.value) {
      if (g.kind !== "var" || g.varKind !== "green") continue
      const producerWire = wires.value.find(w => w.toPinId === `${g.id}:in:main`)
      const producer = producerWire ? nodeById(pinById(producerWire.fromPinId)?.nodeId ?? "") : undefined
      if (!producer || producer.kind !== "func" || !isFuncResolved(producer) || !producerWire) continue
      const pinIdx = pinIndexOf(producerWire.fromPinId)
      const out = resolveFuncRecipe(producer).outputs[pinIdx]
      if (out?.mundane) hidden.add(g.id)
    }
    return hidden
  })
  function persistPositions() {
    const map: Record<string, { x: number, y: number }> = {}
    for (const n of nodes.value) map[n.id] = { x: n.x, y: n.y }
    positions.value = map
  }
  function resetLayout() {
    positions.value = {}
    layout()
  }
  function zoomBy(delta: number) {
    zoom.value = Math.min(2, Math.max(0.2, zoom.value + delta))
  }

  /** 清空全部节点与连线（含 [上部] 行与手动位置） */
  function clearAll() {
    nodes.value = []
    wires.value = []
    rows.value = []
    positions.value = {}
  }

  /** 已保存的配方列表（localStorage，与职业装备预设同一机制） */
  const savedRecipes = ref<MultistepPlan[]>(loadRecipes())

  /** 保存配方：全部节点与连线写入 localStorage（同名覆盖）。不保存位置，加载时自动布局 */
  function savePlan() {
    const plan: MultistepPlan = {
      name: planName.value || `方案 ${savedRecipes.value.length + 1}`,
      rows: toRaw(rows.value),
      nodes: toRaw(nodes.value).map(({ x, y, ...rest }) => ({ ...rest, x: 0, y: 0 })),
      wires: toRaw(wires.value),
      savedAt: Date.now()
    }
    try {
      savedRecipes.value = saveRecipe(plan)
      ElMessage.success(locales.global.t("已保存配方 {0}", [plan.name]))
    } catch (e) {
      console.error(e)
      ElMessage.error(getTrans("保存配方失败"))
    }
  }

  /** 读取配方：清空当前全部节点与连线后加载 */
  function loadRecipe(plan: MultistepPlan) {
    try {
      // JSON 深拷贝：彻底剥离 Vue 响应式代理，避免克隆失败
      const clone = JSON.parse(JSON.stringify(plan)) as MultistepPlan
      rows.value = clone.rows ?? []
      nodes.value = clone.nodes ?? []
      wires.value = clone.wires ?? []
      positions.value = {}
      planName.value = clone.name || planName.value
      // 更新 id 计数器（节点与连线都要扫），避免之后新建节点/连线与已加载 id 冲突
      for (const n of nodes.value) {
        const m = /(\d+)$/.exec(n.id)
        if (m) seq = Math.max(seq, Number(m[1]))
      }
      for (const w of wires.value) {
        const m = /(\d+)$/.exec(w.id)
        if (m) seq = Math.max(seq, Number(m[1]))
      }
      // 归一化：旧版本保存的配方可能存在重复 id（key 冲突导致渲染错乱/残留线），重新分配
      const nodeIdRemap = new Map<string, string>()
      const seenNodeIds = new Set<string>()
      for (const n of nodes.value) {
        if (!n.id || seenNodeIds.has(n.id)) {
          const oldId = n.id
          n.id = nextId("node")
          nodeIdRemap.set(oldId, n.id)
        }
        seenNodeIds.add(n.id)
      }
      const seenWireIds = new Set<string>()
      for (const w of wires.value) {
        if (!w.id || seenWireIds.has(w.id)) {
          w.id = nextId("wire")
        }
        seenWireIds.add(w.id)
        // 节点 id 变更时同步重映射连线端点
        if (nodeIdRemap.size) {
          const fromParts = w.fromPinId.split(":")
          const toParts = w.toPinId.split(":")
          if (nodeIdRemap.has(fromParts[0])) w.fromPinId = `${nodeIdRemap.get(fromParts[0])}:${fromParts.slice(1).join(":")}`
          if (nodeIdRemap.has(toParts[0])) w.toPinId = `${nodeIdRemap.get(toParts[0])}:${toParts.slice(1).join(":")}`
        }
      }
      maintainInvariants()
      layout()
      ElMessage.success(locales.global.t("已读取配方 {0}", [clone.name]))
    } catch (e) {
      console.error(e)
      ElMessage.error(`${getTrans("读取配方失败")}：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  /** 视野聚焦请求（[上部]「查看节点」→ 画布滚动居中） */
  const focusTarget = ref<{ nodeId: string, nonce: number } | null>(null)
  function focusNode(nodeId: string) {
    focusTarget.value = { nodeId, nonce: (focusTarget.value?.nonce ?? 0) + 1 }
  }
  /** [上部] 行 → 对应红节点视野居中 */
  function focusRowNode(rowUid: number) {
    const node = nodes.value.find(n => n.kind === "var" && n.rowUid === rowUid)
    if (node) focusNode(node.id)
  }

  /** 删除配方（按名称） */
  function removeRecipe(name: string) {
    try {
      savedRecipes.value = deleteRecipe(name)
      ElMessage.success(locales.global.t("已删除配方 {0}", [name]))
    } catch (e) {
      console.error(e)
      ElMessage.error(getTrans("保存配方失败"))
    }
  }

  /** 拖动 [上部] 行改变顺序（影响配平的"第一行"） */
  function moveRow(fromIndex: number, toIndex: number) {
    if (fromIndex < 0 || toIndex < 0 || fromIndex >= rows.value.length || toIndex >= rows.value.length) return
    const [row] = rows.value.splice(fromIndex, 1)
    rows.value.splice(toIndex, 0, row)
  }

  // 红节点数量与 [上部] 行保持同步
  watch(rows, () => {
    for (const n of nodes.value) {
      if (n.kind === "var" && n.rowUid != null) {
        const row = rows.value.find(r => r.uid === n.rowUid)
        if (row) n.count = row.count
      }
    }
  }, { deep: true })

  // 配平计算（快照驱动六卡片与节点指标）
  const { summary, nodeResults, steps, balance } = useMultistepCalc(nodes, wires, rows)

  // ===================== 默认配方「配方一」 =====================
  const DEFAULT_PLAN_CREATED_KEY = "multistep-default-plan-created"

  /** 从「神圣重盾」沿三造升级链向下找到「奶酪重盾」，返回自基础层向上的各层产物（数据中暂无则返回空） */
  function buildDefaultShieldChain(): { product: string, action: string }[] {
    const gameData = getGameDataApi()
    if (!gameData) return []
    const byName = (name: string) => Object.values(gameData.itemDetailMap).find(i => i.name === name)?.hrid
    const top = byName("Holy Heavy Shield")
    const base = byName("Cheese Heavy Shield")
    if (!top || !base) return []
    const down: { product: string, action: string }[] = []
    let current: string | undefined = top
    while (current && down.length < 12) {
      const action = findProducingActionOf(current)
      if (!action) return []
      down.push({ product: current, action })
      current = getActionDetailOf(action).upgradeItemHrid
    }
    // 最底层必须是奶酪重盾，否则视为数据不完整
    if (down[down.length - 1]?.product !== base) return []
    return down.reverse()
  }

  /** 每个玩家首次进入时创建一个默认的已保存配方「配方一」（每一层重盾都用三造生产） */
  function ensureDefaultPlan() {
    if (typeof localStorage === "undefined") return
    if (localStorage.getItem(DEFAULT_PLAN_CREATED_KEY)) return
    if (loadRecipes().some(p => p.name === "配方一")) {
      localStorage.setItem(DEFAULT_PLAN_CREATED_KEY, "1")
      return
    }
    const chain = buildDefaultShieldChain()
    if (chain.length < 2) return // 数据中暂无重盾链（游戏数据未更新），不建；下次进入重试
    try {
      // 自基础层（奶酪重盾）向上逐层创建三造节点
      const funcs: GraphNode[] = []
      for (const tier of chain) {
        const func = addFuncNode()
        func.funcClass = "A"
        func.mainItemHrid = tier.product
        func.actionHrid = tier.action
        applyResolvedRecipe(func)
        funcs.push(func)
      }
      // 相邻层：下层产物绿节点与上层升级原料红节点合并为蓝，连通整链
      for (let i = 0; i + 1 < funcs.length; i++) {
        const product = funcs[i].mainItemHrid!
        const green = nodes.value.find(n => n.kind === "var" && n.createdBy === funcs[i].id && n.hrid === product && (n.level ?? 0) === 0)
        const red = nodes.value.find(n => n.kind === "var" && n.createdBy === funcs[i + 1].id && n.hrid === product && (n.level ?? 0) === 0)
        if (green && red) mergeVarNodes(green, red)
      }
      // 驱动行（第一行）= 基础层第一个原料，数量按配方所需补足（1 批 = 1 个奶酪重盾）
      const baseAction = getActionDetailOf(chain[0].action)
      if (rows.value[0]?.hrid && baseAction.inputItems?.length) {
        const first = baseAction.inputItems.find(i => i.itemHrid === rows.value[0].hrid)
        if (first) rows.value[0].count = first.count
      }
      planName.value = "配方一"
      savePlan()
      resetLayout() // 画布按网格排开（保存的配方不含坐标）
      localStorage.setItem(DEFAULT_PLAN_CREATED_KEY, "1")
    } catch (e) {
      console.error("创建默认配方失败", e)
      clearAll() // 失败时清空画布，不写标记，下次进入重试
    }
  }

  ensureDefaultPlan()

  if (nodes.value.length) layout()

  /** 设置方案名称（供 [上部] 输入框使用） */
  function setPlanName(name: string) {
    planName.value = name
  }

  return {
    rows,
    planName,
    setPlanName,
    plans,
    nodes,
    wires,
    pins,
    zoom,
    canvasSize,
    summary,
    nodeResults,
    steps,
    hideMundane,
    hiddenMundaneIds,
    savedRecipes,
    loadRecipe,
    removeRecipe,
    moveRow,
    focusTarget,
    focusNode,
    focusRowNode,
    pinById,
    nodeById,
    resolveFuncRecipe,
    isFuncResolved,
    addRow,
    setRowItem,
    removeRow,
    addFuncNode,
    addEnhanceNode,
    deleteNode,
    deleteWire,
    tryConnect,
    onFuncClassChange,
    onProcessItemChange,
    onFuncActionChange,
    onFuncCatalystChange,
    onFuncConfigChange,
    onEnhanceConfigChange,
    toggleCollapse,
    mergeVarNodes,
    balance,
    getGatherActionsOf,
    getAlchemyActionOptionsOf,
    findProducingActionOf,
    layout,
    persistPositions,
    resetLayout,
    zoomBy,
    savePlan,
    clearAll
  }
}

import type { GraphNode, GraphWire, MultistepPlan, UpupItemRow } from "../types"

/**
 * 配方码（如炉石卡组码）：配方与「数字+字母」字符串双向映射。
 *  - 有效字符只含 0-9a-zA-Z；
 *  - 以 # 结束，# 之后的内容为玩家自加注释（加载时忽略）；
 *  - 编码 = 紧凑结构 JSON → deflate-raw 压缩 → base62，尽量短小。
 *
 * 紧凑结构：
 *  - h/a：hrid / actionHrid 字符串表（最占体积的重复部分只存一次）；
 *  - r：rows，[hrid 表索引(-1=未选), 数量]；
 *  - n：节点，定长 15 元组（kind/类别/hrid/等级/数量/行索引/获取方式/出售方式/主物品/动作/催化剂/强化等级/起保等级/保护物品/生成者节点索引）；
 *  - w：wires，[源节点索引, 源 pin 后缀, 目标节点索引, 目标 pin 后缀]。
 * 解码时重新分配节点 id（createdBy/行 uid 按索引还原），与「读取配方」共用加载逻辑。
 */

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

export function _toBase62(bytes: Uint8Array): string {
  // 把字节流当作大整数逐位除 62（实现简单、长度稳定）
  const digits: number[] = []
  const arr = Array.from(bytes)
  while (arr.length) {
    let rem = 0
    for (let i = 0; i < arr.length; i++) {
      const cur = rem * 256 + arr[i]
      arr[i] = Math.floor(cur / 62)
      rem = cur % 62
    }
    digits.push(rem)
    while (arr.length && arr[0] === 0) arr.shift()
  }
  if (!digits.length) digits.push(0)
  return digits.reverse().map(d => BASE62[d]).join("")
}

export function _fromBase62(code: string): Uint8Array {
  // 逆运算：逐位乘 62 加回字节流
  const digits = Array.from(code).map(c => BASE62.indexOf(c))
  if (digits.some(d => d < 0)) throw new Error("配方码包含无效字符")
  const bytes: number[] = []
  for (const d of digits) {
    let carry = d
    for (let i = bytes.length - 1; i >= 0; i--) {
      const cur = bytes[i] * 62 + carry
      bytes[i] = cur % 256
      carry = Math.floor(cur / 256)
    }
    while (carry) {
      bytes.unshift(carry % 256)
      carry = Math.floor(carry / 256)
    }
  }
  // 去掉前导零
  while (bytes.length && bytes[0] === 0) bytes.shift()
  if (!bytes.length) bytes.push(0)
  return new Uint8Array(bytes)
}

/** 紧凑结构 */
interface CompactPlan {
  h: string[]
  a: string[]
  r: [number, number][]
  n: CompactNode[]
  w: [number, string, number, string][]
}
/** [kind(0变量/1函数), 类别, hridIdx, level, count, rowIdx, obtain, sellMode, mainHridIdx, actionHridIdx, catalyst, enhanceLevel, protectLevel, protectionHridIdx, createdByIdx] */
type CompactNode = [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number]

const VAR_KIND = { red: 0, blue: 1, green: 2, rainbow: 3 } as const
const FUNC_CLASS = { A: 0, B: 1, C: 2 } as const
const OBTAIN = { buy: 0, gather: 1, backpack: 2, npc: 3 } as const
const SELL_MODE = { sell: 0, keep: 1 } as const

export function _compactifyPlan(plan: MultistepPlan): CompactPlan {
  // 收集 hrid / actionHrid 字符串表
  const hridSet = new Set<string>()
  const actionSet = new Set<string>()
  for (const r of plan.rows) {
    if (r.hrid) hridSet.add(r.hrid)
  }
  for (const n of plan.nodes) {
    if (n.hrid) hridSet.add(n.hrid)
    if (n.mainItemHrid) hridSet.add(n.mainItemHrid)
    if (n.protectionHrid) hridSet.add(n.protectionHrid)
    if (n.actionHrid) actionSet.add(n.actionHrid)
  }
  const h = [...hridSet].sort()
  const a = [...actionSet].sort()
  const hIdx = new Map(h.map((v, i) => [v, i]))
  const aIdx = new Map(a.map((v, i) => [v, i]))
  const rowIdx = new Map(plan.rows.map((r, i) => [r.uid, i]))
  const nodeIdx = new Map(plan.nodes.map((n, i) => [n.id, i]))

  return {
    h,
    a,
    r: plan.rows.map(r => [r.hrid ? hIdx.get(r.hrid)! : -1, r.count]),
    n: plan.nodes.map((n) => {
      const cls = n.kind === "var"
        ? (VAR_KIND[n.varKind ?? "red"] ?? -1)
        : (n.funcClass ? FUNC_CLASS[n.funcClass] : -1)
      return [
        n.kind === "var" ? 0 : 1,
        cls,
        n.hrid ? hIdx.get(n.hrid)! : -1,
        n.level ?? 0,
        n.count ?? -1,
        n.rowUid != null ? (rowIdx.get(n.rowUid) ?? -1) : -1,
        n.obtain ? (OBTAIN[n.obtain] ?? 0) : -1,
        n.sellMode ? (SELL_MODE[n.sellMode] ?? 0) : -1,
        n.mainItemHrid ? hIdx.get(n.mainItemHrid)! : -1,
        n.actionHrid ? aIdx.get(n.actionHrid)! : -1,
        n.catalystRank ?? -1,
        n.enhanceLevel ?? -1,
        n.protectLevel ?? -1,
        n.protectionHrid ? hIdx.get(n.protectionHrid)! : -1,
        n.createdBy ? (nodeIdx.get(n.createdBy) ?? -1) : -1
      ] as CompactNode
    }),
    w: plan.wires.map((w) => {
      const [fId, fPin] = splitPin(w.fromPinId)
      const [tId, tPin] = splitPin(w.toPinId)
      return [nodeIdx.get(fId) ?? -1, fPin, nodeIdx.get(tId) ?? -1, tPin]
    })
  }
}

function splitPin(pinId: string): [string, string] {
  const i = pinId.indexOf(":")
  return i >= 0 ? [pinId.slice(0, i), pinId.slice(i + 1)] : [pinId, "main"]
}

export function _hydratePlan(compact: CompactPlan): MultistepPlan {
  const h = compact.h
  const a = compact.a
  const hridOf = (i: number) => (i >= 0 && i < h.length ? h[i] : "")
  const rows: UpupItemRow[] = compact.r.map(([hIdx, count], i) => ({
    uid: i + 1,
    hrid: hIdx >= 0 ? h[hIdx] : null,
    count
  }))
  const nodes: GraphNode[] = compact.n.map((t, i) => {
    const [kind, cls, hridIdx, level, count, rowIdx, obtain, sellMode, mainHridIdx, actionHridIdx, catalyst, enhanceLevel, protectLevel, protectionHridIdx, createdByIdx] = t
    const node: GraphNode = {
      id: `node-${i + 1}`,
      kind: kind === 1 ? "func" : "var",
      hrid: hridOf(hridIdx),
      x: 0,
      y: 0
    }
    if (node.kind === "var") {
      node.varKind = (["red", "blue", "green", "rainbow"] as const)[cls] ?? "red"
      node.level = level
      if (count >= 0) node.count = count
      if (rowIdx >= 0) node.rowUid = rows[rowIdx]?.uid
      node.obtain = (["buy", "gather", "backpack", "npc"] as const)[obtain]
      node.sellMode = (["sell", "keep"] as const)[sellMode]
    } else {
      node.funcClass = (["A", "B", "C"] as const)[cls]
      node.mainItemHrid = hridOf(mainHridIdx) || undefined
      node.actionHrid = actionHridIdx >= 0 ? a[actionHridIdx] : undefined
      if (catalyst >= 0) node.catalystRank = catalyst as 0 | 1 | 2
      if (enhanceLevel >= 0) node.enhanceLevel = enhanceLevel
      if (protectLevel >= 0) node.protectLevel = protectLevel
      node.protectionHrid = hridOf(protectionHridIdx) || undefined
    }
    if (createdByIdx >= 0) node.createdBy = `node-${createdByIdx + 1}`
    return node
  })
  const wires: GraphWire[] = compact.w.map(([fIdx, fPin, tIdx, tPin], i) => ({
    id: `wire-${i + 1}`,
    fromPinId: `${nodes[fIdx]?.id ?? "node-0"}:${fPin}`,
    toPinId: `${nodes[tIdx]?.id ?? "node-0"}:${tPin}`
  })).filter(w => !w.fromPinId.startsWith("node-0") && !w.toPinId.startsWith("node-0"))
  return { name: "", rows, nodes, wires, savedAt: Date.now() }
}

async function deflateRaw(text: string): Promise<Uint8Array> {
  const stream = new Blob([new TextEncoder().encode(text)]).stream().pipeThrough(new CompressionStream("deflate-raw"))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function inflateRaw(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"))
  return new TextDecoder().decode(await new Response(stream).arrayBuffer())
}

/** 生成配方码：紧凑结构 → deflate-raw → base62 → 以 # 结尾（# 后为用户注释位） */
export async function encodePlanCode(plan: MultistepPlan): Promise<string> {
  const compact = _compactifyPlan(plan)
  const compressed = await deflateRaw(JSON.stringify(compact))
  return `${_toBase62(compressed)}#`
}

/** 解析配方码：忽略 # 后的注释；返回可交给「读取配方」加载的配方 */
export async function decodePlanCode(code: string): Promise<MultistepPlan> {
  const body = code.trim().split("#")[0] ?? ""
  if (!body) throw new Error("配方码为空")
  const bytes = _fromBase62(body)
  const text = await inflateRaw(bytes)
  const compact = JSON.parse(text) as CompactPlan
  return _hydratePlan(compact)
}

import { pinyin } from "@/vendor/pinyin-pro/index.mjs"

/** 汉字 → 无声调小写拼音串（如 太阳石 → taiyangshi），供搜索过滤用 */
export function pinyinOf(text: string): string {
  const r = pinyin(text, { toneType: "none", type: "string", separator: "" })
  return typeof r === "string" ? r.toLowerCase() : ""
}

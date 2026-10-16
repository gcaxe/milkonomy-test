/**
 * pinyin-pro (vendored, MIT) 最小类型声明。
 * 源码见同目录 *.mjs（从 npm pinyin-pro 3.29.5 dist/esm 复制，含 LICENSE）。
 */
export interface PinyinOptions {
  toneType?: "symbol" | "num" | "none"
  type?: "string" | "array" | "all"
  separator?: string
  v?: boolean
  nonZh?: string
  mode?: string
  pattern?: string
}

export function pinyin(word: string, options?: PinyinOptions): string | string[] | unknown[]

export const PRODUCT_CATEGORIES = ['ai', 'learning', 'mail', 'tool'] as const
export const PRODUCT_TEMPLATES = ['card', 'orbit', 'mail', 'ticket', 'account'] as const
export const FULFILLMENT_MODES = ['card', 'account', 'recharge', 'manual'] as const
export const INPUT_TYPES = ['text', 'email', 'textarea'] as const

export type ProductCategory = typeof PRODUCT_CATEGORIES[number]
export type ProductTemplate = typeof PRODUCT_TEMPLATES[number]
export type FulfillmentMode = typeof FULFILLMENT_MODES[number]
export type InputType = typeof INPUT_TYPES[number]

export type InputField = {
  key: string
  label: string
  type: InputType
  required: boolean
  maxLength: number
  placeholder?: string
  help?: string
}

export type ProductFaq = { question: string; answer: string }

export type DynamicProduct = {
  id: string
  slug: string
  name: string
  category: ProductCategory
  tagline: string
  description: string
  pitch: string
  badge: string
  unit: string
  quantity: string
  template: ProductTemplate
  accent: string
  image_url: string | null
  faq: ProductFaq[]
  sort_order: number
  enabled: number
  version: number
  created_at: number
  updated_at: number
}

export type DynamicPlan = {
  id: string
  product_id: string
  name: string
  price_cents: number
  enabled: number
  renewal_only: number
  version: number
  purchase_note: string
  delivery_instructions: string
  fulfillment: FulfillmentMode
  input_fields: InputField[]
  features: string[]
  subtitle: string
  description: string
  unit: string
  product_slug: string
}

export const FULFILLMENT_LABELS: Record<FulfillmentMode, string> = {
  card: '卡密 / 兑换码',
  account: '账号资料',
  recharge: '代充（买家提交资料）',
  manual: '纯人工处理',
}

export const TEMPLATE_LABELS: Record<ProductTemplate, string> = {
  card: '叠卡',
  orbit: '星轨',
  mail: '信封',
  ticket: '票券',
  account: '账号卡',
}

export const CATEGORY_LABELS: Record<ProductCategory, string> = {
  ai: 'AI 订阅',
  learning: '语言学习',
  mail: '邮箱账号',
  tool: '工具服务',
}

const KEY_PATTERN = /^[a-z][a-z0-9_]{1,31}$/
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,47}$/
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,47}$/

export function cleanSlug(value: unknown) {
  if (typeof value !== 'string' || !SLUG_PATTERN.test(value)) return null
  return value
}

export function cleanPlanId(value: unknown) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) return null
  return value
}

function cleanText(value: unknown, max: number, required = false) {
  if (value === undefined || value === null) return required ? null : ''
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (required && !text) return null
  return text.length <= max ? text : null
}

export function cleanFaq(value: unknown): ProductFaq[] | null {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 20) return null
  const out: ProductFaq[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') return null
    const question = cleanText((item as ProductFaq).question, 200, true)
    const answer = cleanText((item as ProductFaq).answer, 1000, true)
    if (!question || !answer) return null
    out.push({ question, answer })
  }
  return out
}

export function cleanFeatures(value: unknown): string[] | null {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 12) return null
  const out: string[] = []
  for (const item of value) {
    const text = cleanText(item, 120, true)
    if (!text) return null
    out.push(text)
  }
  return out
}

export function cleanInputFields(value: unknown): InputField[] | null {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 8) return null
  const out: InputField[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (!item || typeof item !== 'object') return null
    const raw = item as Record<string, unknown>
    const key = typeof raw.key === 'string' ? raw.key : ''
    if (!KEY_PATTERN.test(key) || seen.has(key)) return null
    seen.add(key)
    const label = cleanText(raw.label, 40, true)
    if (!label) return null
    const type = INPUT_TYPES.includes(raw.type as InputType) ? raw.type as InputType : null
    if (!type) return null
    const maxLength = Number(raw.maxLength)
    if (!Number.isSafeInteger(maxLength) || maxLength < 1 || maxLength > 2000) return null
    const placeholder = cleanText(raw.placeholder, 80)
    const help = cleanText(raw.help, 200)
    if (placeholder === null || help === null) return null
    out.push({ key, label, type, required: raw.required === true, maxLength, ...(placeholder ? { placeholder } : {}), ...(help ? { help } : {}) })
  }
  return out
}

export type ValidatedInputs = { values: Record<string, string> } | { error: string }

/** Validates buyer input against the plan's field schema; unknown keys are dropped. */
export function validateInputs(fields: InputField[], raw: unknown): ValidatedInputs {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
  const values: Record<string, string> = {}
  for (const field of fields) {
    const rawValue = source[field.key]
    const value = typeof rawValue === 'string' ? rawValue.trim() : ''
    if (!value) {
      if (field.required) return { error: `请填写${field.label}。` }
      continue
    }
    if (value.length > field.maxLength) return { error: `${field.label}最多 ${field.maxLength} 个字符。` }
    if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return { error: `${field.label}格式不正确。` }
    if (Array.from(value).some(char => char.charCodeAt(0) < 32 && char !== '\n' && char !== '\t')) return { error: `${field.label}包含无效字符。` }
    values[field.key] = value
  }
  return { values }
}

export function cleanAccent(value: unknown) {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : null
}

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try { return JSON.parse(value) as T } catch { return fallback }
}

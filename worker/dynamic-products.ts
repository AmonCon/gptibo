import { ApiError, body, json, type Env } from './platform.ts'
import {
  PRODUCT_CATEGORIES, PRODUCT_TEMPLATES, FULFILLMENT_MODES,
  cleanAccent, cleanFaq, cleanFeatures, cleanInputFields, cleanPlanId, cleanSlug, parseJson, validateInputs,
  type DynamicPlan, type DynamicProduct, type FulfillmentMode, type InputField, type ProductFaq,
} from '../shared/dynamic-products.ts'
import { seal, unseal } from './sealed.ts'
import { change, getOrder, type Order } from './order-state.ts'

type ProductRow = Omit<DynamicProduct, 'faq'> & { faq: string }
type PlanRow = Omit<DynamicPlan, 'input_fields' | 'features'> & { input_fields: string; features: string }

const product = (row: ProductRow): DynamicProduct => ({ ...row, faq: parseJson<ProductFaq[]>(row.faq, []) })
const plan = (row: PlanRow): DynamicPlan => ({ ...row, input_fields: parseJson<InputField[]>(row.input_fields, []), features: parseJson<string[]>(row.features, []) })

export async function listProducts(env: Env, onlyEnabled = false) {
  const rows = (await env.INTEREST_DB.prepare('SELECT * FROM products' + (onlyEnabled ? ' WHERE enabled=1' : '') + ' ORDER BY sort_order, created_at').all<ProductRow>()).results
  return rows.map(product)
}

export async function listDynamicPlans(env: Env, onlyEnabled = false) {
  const rows = (await env.INTEREST_DB.prepare(
    'SELECT p.* FROM catalog_plans p JOIN products d ON d.id=p.product_id' + (onlyEnabled ? ' WHERE p.enabled=1 AND d.enabled=1' : '') + ' ORDER BY d.sort_order, p.rowid',
  ).all<PlanRow>()).results
  return rows.map(plan)
}

export async function findDynamicPlan(env: Env, id: string) {
  const row = await env.INTEREST_DB.prepare(
    'SELECT p.*,d.enabled product_enabled FROM catalog_plans p JOIN products d ON d.id=p.product_id WHERE p.id=?',
  ).bind(id).first<PlanRow & { product_enabled: number }>()
  return row ? { ...plan(row), productEnabled: row.product_enabled === 1 } : null
}

function productPayload(data: Record<string, unknown>) {
  const slug = cleanSlug(data.slug)
  const name = typeof data.name === 'string' ? data.name.trim() : ''
  const category = PRODUCT_CATEGORIES.includes(data.category as never) ? data.category : null
  const template = PRODUCT_TEMPLATES.includes(data.template as never) ? data.template : null
  const accent = cleanAccent(data.accent)
  const faq = cleanFaq(data.faq)
  const text = (key: string, max: number, required = false) => {
    const value = data[key]
    if (value === undefined || value === null) return required ? null : ''
    if (typeof value !== 'string') return null
    const trimmed = value.trim()
    if (required && !trimmed) return null
    return trimmed.length <= max ? trimmed : null
  }
  const tagline = text('tagline', 120)
  const description = text('description', 500)
  const pitch = text('pitch', 500)
  const badge = text('badge', 20)
  const unit = text('unit', 10)
  const quantity = text('quantity', 40)
  const image = data.imageUrl === undefined || data.imageUrl === null || data.imageUrl === '' ? '' : text('imageUrl', 500)
  const sortOrder = data.sortOrder === undefined ? 0 : Number(data.sortOrder)
  if (!slug || !name || name.length > 60 || !category || !template || !accent || faq === null) return null
  if (tagline === null || description === null || pitch === null || badge === null || unit === null || quantity === null || image === null) return null
  if (!Number.isSafeInteger(sortOrder) || sortOrder < 0 || sortOrder > 9999) return null
  if (image && !/^https:\/\/[^\s"'<>]+$/.test(image)) return null
  return {
    slug, name, category: category as DynamicProduct['category'], tagline, description, pitch,
    badge, unit: unit || '份', quantity: quantity || '1 份', template: template as DynamicProduct['template'],
    accent, image_url: image || null, faq: JSON.stringify(faq), sort_order: sortOrder,
    enabled: data.enabled === false ? 0 : 1,
  }
}

function planPayload(data: Record<string, unknown>) {
  const id = cleanPlanId(data.id)
  const name = typeof data.name === 'string' ? data.name.trim() : ''
  const price = Number(data.priceCents)
  const fulfillment = FULFILLMENT_MODES.includes(data.fulfillment as never) ? data.fulfillment as FulfillmentMode : null
  const inputs = cleanInputFields(data.inputFields)
  const features = cleanFeatures(data.features)
  const text = (key: string, max: number) => {
    const value = data[key]
    if (value === undefined || value === null) return ''
    return typeof value === 'string' && value.trim().length <= max ? value.trim() : null
  }
  const subtitle = text('subtitle', 120)
  const description = text('description', 300)
  const unit = text('unit', 10)
  const purchaseNote = text('purchaseNote', 2000)
  const deliveryInstructions = text('deliveryInstructions', 2000)
  if (!id || !name || name.length > 60 || !Number.isSafeInteger(price) || price < 1 || price > 10000000) return null
  if (!fulfillment || inputs === null || features === null) return null
  if (subtitle === null || description === null || unit === null || purchaseNote === null || deliveryInstructions === null) return null
  if (fulfillment === 'recharge' && !inputs.some(field => field.required)) return null
  return {
    id, name, price_cents: price, fulfillment, input_fields: JSON.stringify(inputs), features: JSON.stringify(features),
    subtitle, description, unit, purchase_note: purchaseNote, delivery_instructions: deliveryInstructions,
    enabled: data.enabled === false ? 0 : 1, renewal_only: data.renewalOnly === true ? 1 : 0,
  }
}

async function audit(env: Env, action: string, target: string, note: string) {
  await env.INTEREST_DB.prepare('INSERT INTO admin_audit(id,action,target_id,note,created_at) VALUES (?,?,?,?,?)')
    .bind(crypto.randomUUID(), action, target, `${env.ADMIN_USERNAME}: ${note}`, Date.now()).run()
}

export async function productAdmin(request: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname, method = request.method, db = env.INTEREST_DB
  if (path === '/api/admin/products' && method === 'GET') {
    const products = await listProducts(env)
    const plans = await listDynamicPlans(env)
    return json({ products, plans })
  }
  if (path === '/api/admin/products' && method === 'POST') {
    const data = await body(request, 16384)
    const value = productPayload(data)
    if (!value) throw new ApiError('商品信息不完整或格式不正确。')
    const now = Date.now()
    if (await db.prepare('SELECT id FROM products WHERE slug=?').bind(value.slug).first()) throw new ApiError('商品标识已被使用。', 409)
    const id = crypto.randomUUID()
    await db.prepare('INSERT INTO products(id,slug,name,category,tagline,description,pitch,badge,unit,quantity,template,accent,image_url,faq,sort_order,enabled,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?)')
      .bind(id, value.slug, value.name, value.category, value.tagline, value.description, value.pitch, value.badge, value.unit, value.quantity, value.template, value.accent, value.image_url, value.faq, value.sort_order, value.enabled, now, now).run()
    await audit(env, 'product-create', id, `新建商品 ${value.name}`)
    return json({ product: product((await db.prepare('SELECT * FROM products WHERE id=?').bind(id).first<ProductRow>())!) }, 201)
  }
  const productMatch = path.match(/^\/api\/admin\/products\/([a-f0-9-]{36})$/)
  if (productMatch && method === 'POST') {
    const data = await body(request, 16384)
    const current = await db.prepare('SELECT * FROM products WHERE id=?').bind(productMatch[1]).first<ProductRow>()
    if (!current) throw new ApiError('商品不存在。', 404)
    if (!Number.isInteger(data.version) || data.version !== current.version) throw new ApiError('商品已更新，请刷新后重试。', 409)
    const value = productPayload({ ...current, ...data, faq: data.faq ?? parseJson(current.faq, []), imageUrl: data.imageUrl === undefined ? current.image_url : data.imageUrl })
    if (!value) throw new ApiError('商品信息不完整或格式不正确。')
    if (await db.prepare('SELECT id FROM products WHERE slug=? AND id<>?').bind(value.slug, current.id).first()) throw new ApiError('商品标识已被使用。', 409)
    await db.batch([
      db.prepare('INSERT INTO admin_audit(id,action,target_id,note,created_at) SELECT ?,?,?,?,? FROM products WHERE id=? AND version=?').bind(crypto.randomUUID(), 'product-update', current.id, `${env.ADMIN_USERNAME}: 更新商品 ${value.name}`, Date.now(), current.id, current.version),
      db.prepare('UPDATE products SET slug=?,name=?,category=?,tagline=?,description=?,pitch=?,badge=?,unit=?,quantity=?,template=?,accent=?,image_url=?,faq=?,sort_order=?,enabled=?,version=version+1,updated_at=? WHERE id=? AND version=?')
        .bind(value.slug, value.name, value.category, value.tagline, value.description, value.pitch, value.badge, value.unit, value.quantity, value.template, value.accent, value.image_url, value.faq, value.sort_order, value.enabled, Date.now(), current.id, current.version),
      db.prepare('UPDATE catalog_plans SET product_slug=?,version=version+1,updated_at=? WHERE product_id=?').bind(value.slug, Date.now(), current.id),
    ])
    return json({ product: product((await db.prepare('SELECT * FROM products WHERE id=?').bind(current.id).first<ProductRow>())!) })
  }
  if (path === '/api/admin/product-plans' && method === 'POST') {
    const data = await body(request, 16384)
    const value = planPayload(data)
    const productId = typeof data.productId === 'string' ? data.productId : ''
    if (!value) throw new ApiError('套餐信息不完整或格式不正确。')
    if (value.fulfillment === 'recharge' && !parseJson<InputField[]>(value.input_fields, []).some(field => field.required)) throw new ApiError('代充商品至少需要一个必填的买家资料字段。')
    const owner = await db.prepare('SELECT id,slug FROM products WHERE id=?').bind(productId).first<{ id: string; slug: string }>()
    if (!owner) throw new ApiError('商品不存在。', 404)
    if (await db.prepare('SELECT id FROM catalog_plans WHERE id=?').bind(value.id).first()) throw new ApiError('套餐标识已被使用。', 409)
    const now = Date.now()
    await db.batch([
      db.prepare('INSERT INTO catalog_plans(id,product_id,name,price_cents,enabled,renewal_only,version,updated_at,purchase_note,delivery_instructions,partner_enabled,fulfillment,input_fields,features,subtitle,description,unit,product_slug) VALUES (?,?,?,?,?,?,0,?,?,?,0,?,?,?,?,?,?,?)')
        .bind(value.id, owner.id, value.name, value.price_cents, value.enabled, value.renewal_only, now, value.purchase_note, value.delivery_instructions, value.fulfillment, value.input_fields, value.features, value.subtitle, value.description, value.unit, owner.slug),
      db.prepare('INSERT INTO admin_audit(id,action,target_id,note,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(), 'plan-create', value.id, `${env.ADMIN_USERNAME}: 新建套餐 ${value.name}`, now),
    ])
    return json({ plan: plan((await db.prepare('SELECT * FROM catalog_plans WHERE id=?').bind(value.id).first<PlanRow>())!) }, 201)
  }
  const planMatch = path.match(/^\/api\/admin\/product-plans\/([a-z0-9-]{2,48})$/)
  if (planMatch && method === 'POST') {
    const data = await body(request, 16384)
    const current = await db.prepare('SELECT * FROM catalog_plans WHERE id=?').bind(planMatch[1]).first<PlanRow>()
    if (!current) throw new ApiError('套餐不存在。', 404)
    if (!Number.isInteger(data.version) || data.version !== current.version) throw new ApiError('套餐已更新，请刷新后重试。', 409)
    const value = planPayload({ ...current, ...data, id: current.id, inputFields: data.inputFields ?? parseJson(current.input_fields, []), features: data.features ?? parseJson(current.features, []) })
    if (!value) throw new ApiError('套餐信息不完整或格式不正确。')
    await db.batch([
      db.prepare('INSERT INTO admin_audit(id,action,target_id,note,created_at) SELECT ?,?,?,?,? FROM catalog_plans WHERE id=? AND version=?').bind(crypto.randomUUID(), 'plan-update', current.id, `${env.ADMIN_USERNAME}: 更新套餐 ${value.name}`, Date.now(), current.id, current.version),
      db.prepare('UPDATE catalog_plans SET name=?,price_cents=?,enabled=?,renewal_only=?,fulfillment=?,input_fields=?,features=?,subtitle=?,description=?,unit=?,purchase_note=?,delivery_instructions=?,version=version+1,updated_at=? WHERE id=? AND version=?')
        .bind(value.name, value.price_cents, value.enabled, value.renewal_only, value.fulfillment, value.input_fields, value.features, value.subtitle, value.description, value.unit, value.purchase_note, value.delivery_instructions, Date.now(), current.id, current.version),
    ])
    return json({ plan: plan((await db.prepare('SELECT * FROM catalog_plans WHERE id=?').bind(current.id).first<PlanRow>())!) })
  }
  throw new ApiError('未找到接口。', 404)
}

// ---------------------------------------------------------------------------
// Buyer-facing generic checkout
// ---------------------------------------------------------------------------

export async function createDynamicOrder(request: Request, env: Env, ownerHash: string, email: string, data: Record<string, unknown>) {
  const planId = cleanPlanId(data.plan)
  if (!planId || typeof data.key !== 'string' || !/^[a-f0-9-]{36}$/.test(data.key)) throw new ApiError('商品或请求编号无效。')
  const existing = await env.INTEREST_DB.prepare('SELECT * FROM orders WHERE owner_hash=? AND idempotency_key=?').bind(ownerHash, data.key).first<Order>()
  if (existing) {
    if (existing.customer_email !== email || existing.plan !== planId) throw new ApiError('请求编号已被另一套餐使用。', 409)
    return existing
  }
  const found = await findDynamicPlan(env, planId)
  if (!found || !found.productEnabled || !found.enabled) throw new ApiError('该套餐已暂停销售，请选择其他套餐。', 409)
  const testing = env.ORDER_TESTING_ENABLED === 'true'
  const live = env.PAYMENT_CHECKOUT_ENABLED === 'true' && Boolean(env.ALIPAY_APP_ID)
  if (!testing && !live) throw new ApiError('该服务暂未开放购买，请稍后再来。', 409)
  if (data.expectedPrice !== found.price_cents) throw new ApiError('套餐价格已更新，请刷新后重新确认。', 409)
  const inputs = validateBuyerInputs(found.input_fields, data.inputs)
  if ('error' in inputs) throw new ApiError(inputs.error ?? '买家资料格式不正确。')
  const id = 'YMX-' + crypto.randomUUID().replaceAll('-', '').toUpperCase()
  const eventId = crypto.randomUUID(), now = Date.now()
  const statements = [
    env.INTEREST_DB.prepare("INSERT INTO orders(id,owner_hash,idempotency_key,plan,plan_name,price_cents,status,created_at,updated_at,last_event_id,customer_email,fulfillment,product_slug,input_json) VALUES (?,?,?,?,?,?,'pending',?,?,?,?,?,?,?)")
      .bind(id, ownerHash, data.key, found.id, found.name, found.price_cents, now, now, eventId, email, found.fulfillment, found.product_slug, JSON.stringify({ submitted: Object.keys(inputs.values) })),
    env.INTEREST_DB.prepare('UPDATE orders SET purchase_note=(SELECT purchase_note FROM catalog_plans WHERE id=orders.plan) WHERE id=?').bind(id),
    ...(live ? [env.INTEREST_DB.prepare("UPDATE orders SET mode='live' WHERE id=? AND payment_status='unpaid'").bind(id)] : []),
    env.INTEREST_DB.prepare("INSERT INTO order_events(id,order_id,actor,action,to_status,note,order_version,created_at) SELECT ?,id,'customer','create','pending',?,0,? FROM orders WHERE id=? ON CONFLICT DO NOTHING").bind(eventId, live ? '创建订单，等待支付' : '创建测试订单', now, id),
  ]
  if (Object.keys(inputs.values).length) {
    const sealed = await seal(env, JSON.stringify(inputs.values))
    statements.push(env.INTEREST_DB.prepare('INSERT INTO order_inputs(order_id,ciphertext,iv,fingerprint,fields,created_at,expires_at) VALUES (?,?,?,?,?,?,?)')
      .bind(id, sealed.ciphertext, sealed.iv, sealed.fingerprint, JSON.stringify(found.input_fields.map(field => field.key)), now, null))
  }
  await env.INTEREST_DB.batch(statements)
  const created = await env.INTEREST_DB.prepare('SELECT * FROM orders WHERE owner_hash=? AND idempotency_key=?').bind(ownerHash, data.key).first<Order>()
  if (!created) throw new ApiError('商品已更新，请刷新后重试。', 409)
  return created
}

function validateBuyerInputs(fields: InputField[], raw: unknown) {
  const result = validateInputs(fields, raw)
  return 'error' in result ? { error: result.error } as const : { values: result.values } as const
}

export async function buyerInputSummary(env: Env, order: Order) {
  const row = await env.INTEREST_DB.prepare('SELECT * FROM order_inputs WHERE order_id=?').bind(order.id).first<{ ciphertext: string; iv: string; fields: string; created_at: number }>()
  if (!row) return null
  return { keys: parseJson<string[]>(row.fields, []), submittedAt: row.created_at }
}

export async function readBuyerInputs(env: Env, order: Order, actor: string) {
  const row = await env.INTEREST_DB.prepare('SELECT * FROM order_inputs WHERE order_id=?').bind(order.id).first<{ ciphertext: string; iv: string }>()
  if (!row) throw new ApiError('本订单没有买家提交的资料。', 404)
  await logAccess(env, order.id, actor, 'input-read')
  return JSON.parse(await unseal(env, row.ciphertext, row.iv)) as Record<string, string>
}

export async function deliverySummary(env: Env, order: Order) {
  const row = await env.INTEREST_DB.prepare('SELECT kind,note,delivered_at,version FROM order_deliveries WHERE order_id=?').bind(order.id).first<{ kind: string; note: string; delivered_at: number; version: number }>()
  return row ?? null
}

export async function readDelivery(env: Env, order: Order, actor: string) {
  const row = await env.INTEREST_DB.prepare('SELECT * FROM order_deliveries WHERE order_id=?').bind(order.id).first<{ ciphertext: string; iv: string; kind: string; note: string; delivered_at: number }>()
  if (!row) throw new ApiError('本订单尚未发货。', 404)
  await logAccess(env, order.id, actor, 'delivery-read')
  return { kind: row.kind, note: row.note, deliveredAt: row.delivered_at, payload: JSON.parse(await unseal(env, row.ciphertext, row.iv)) as Record<string, string> }
}

export async function writeDelivery(env: Env, order: Order, actor: string, input: { kind: string; payload: Record<string, string>; note: string }) {
  const serialized = JSON.stringify(input.payload)
  const sealed = await seal(env, serialized)
  const duplicate = await env.INTEREST_DB.prepare('SELECT order_id FROM order_deliveries WHERE fingerprint=? AND order_id<>?').bind(sealed.fingerprint, order.id).first()
  if (duplicate) throw new ApiError('这份资料已用于另一笔订单，不能重复发放。', 409)
  const now = Date.now(), eventId = crypto.randomUUID()
  await env.INTEREST_DB.batch([
    env.INTEREST_DB.prepare('INSERT INTO order_deliveries(order_id,kind,ciphertext,iv,fingerprint,note,delivered_at,delivered_by,version) VALUES (?,?,?,?,?,?,?,?,0) ON CONFLICT(order_id) DO UPDATE SET kind=excluded.kind,ciphertext=excluded.ciphertext,iv=excluded.iv,fingerprint=excluded.fingerprint,note=excluded.note,delivered_at=excluded.delivered_at,delivered_by=excluded.delivered_by,version=order_deliveries.version+1')
      .bind(order.id, input.kind, sealed.ciphertext, sealed.iv, sealed.fingerprint, input.note, now, actor),
    env.INTEREST_DB.prepare("UPDATE orders SET status='success',updated_at=?,version=version+1,last_event_id=? WHERE id=? AND status IN ('session','processing')")
      .bind(now, eventId, order.id),
    env.INTEREST_DB.prepare("INSERT INTO order_events(id,order_id,actor,action,from_status,to_status,note,order_version,created_at) SELECT ?,id,?,'delivery','session',status,?,version,? FROM orders WHERE id=? AND last_event_id=?").bind(eventId, actor, input.note || '已发货', now, order.id, eventId),
    env.INTEREST_DB.prepare('INSERT INTO delivery_access_log(id,order_id,actor,action,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(), order.id, actor, 'delivery-write', now),
  ])
  const current = await env.INTEREST_DB.prepare('SELECT status FROM orders WHERE id=?').bind(order.id).first<{ status: string }>()
  if (current?.status !== 'success') throw new ApiError('订单状态已变化，请刷新后重试。', 409)
  return getOrder(env, order.id)
}

async function logAccess(env: Env, orderId: string, actor: string, action: string) {
  await env.INTEREST_DB.prepare('INSERT INTO delivery_access_log(id,order_id,actor,action,created_at) VALUES (?,?,?,?,?)')
    .bind(crypto.randomUUID(), orderId, actor, action, Date.now()).run()
}

export async function purgeExpiredInputs(env: Env) {
  const rows = (await env.INTEREST_DB.prepare('SELECT order_id FROM order_inputs WHERE expires_at IS NOT NULL AND expires_at<=? LIMIT 100').bind(Date.now()).all<{ order_id: string }>()).results
  for (const row of rows) {
    await env.INTEREST_DB.batch([
      env.INTEREST_DB.prepare('DELETE FROM order_inputs WHERE order_id=? AND expires_at IS NOT NULL AND expires_at<=?').bind(row.order_id, Date.now()),
      env.INTEREST_DB.prepare('INSERT INTO delivery_access_log(id,order_id,actor,action,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(), row.order_id, 'system', 'input-purge', Date.now()),
    ])
  }
}

export async function planForOrder(env: Env, order: Order) {
  if (!order.fulfillment) return null
  return findDynamicPlan(env, order.plan)
}

export function deliveryKindFor(mode: string | null): 'card' | 'account' | 'recharge' | 'manual' {
  return mode === 'card' || mode === 'account' || mode === 'recharge' ? mode : 'manual'
}

export type { DynamicPlan, DynamicProduct }

import test from 'node:test'
import assert from 'node:assert/strict'
import { customerFixture } from './customer-fixture.ts'

const SECRET = 'local-fixture-delivery-secret-32-chars'

async function setup(t: Parameters<Parameters<typeof test>[1]>[0]) {
  const s = await customerFixture(); t.after(() => s.db.close())
  Object.assign(s.env, { DELIVERY_SECRET: SECRET, ORDER_TESTING_ENABLED: 'true' })
  return s
}

async function createProduct(s: Awaited<ReturnType<typeof setup>>, overrides: Record<string, unknown> = {}) {
  const response = await s.request('/api/admin/products', {
    slug: 'test-membership', name: '测试会员', category: 'ai', tagline: '一句话',
    description: '描述', pitch: '卖点', badge: '自动发货', unit: '月', quantity: '1 个月',
    template: 'card', accent: '#2563eb', sortOrder: 1, enabled: true, faq: [], ...overrides,
  }, s.admin)
  assert.equal(response.status, 201, await response.clone().text())
  return (await response.json()).product
}

async function createPlan(s: Awaited<ReturnType<typeof setup>>, productId: string, overrides: Record<string, unknown> = {}) {
  const response = await s.request('/api/admin/product-plans', {
    productId, id: 'test-card-plan', name: '标准版', priceCents: 1990, fulfillment: 'card',
    inputFields: [], features: ['权益一'], subtitle: '副标题', description: '套餐描述',
    unit: '月', purchaseNote: '购买说明', deliveryInstructions: '领取说明', enabled: true, ...overrides,
  }, s.admin)
  assert.equal(response.status, 201, await response.clone().text())
  return (await response.json()).plan
}

async function buyerCookie(s: Awaited<ReturnType<typeof setup>>) {
  const response = await s.request('/api/orders/client', {})
  return response.headers.get('set-cookie')!.split(';')[0]
}

test('admin can create a product and plan; storefront catalog exposes both', async t => {
  const s = await setup(t)
  const product = await createProduct(s)
  const plan = await createPlan(s, product.id)
  assert.equal(plan.fulfillment, 'card')
  assert.equal(plan.price_cents, 1990)
  assert.deepEqual(plan.features, ['权益一'])

  const catalog = await (await s.request('/api/catalog')).json()
  assert.equal(catalog.products.length, 1)
  assert.equal(catalog.products[0].name, '测试会员')
  assert.deepEqual(catalog.products[0].faq, [])
  const offer = catalog.plans.find((item: { id: string }) => item.id === 'test-card-plan')
  assert.equal(offer.enabled, 1)
  assert.equal(offer.product_slug, 'test-membership')
  assert.equal(catalog.checkoutEnabled, true)
})

test('legacy products are untouched and do not gain a fulfillment mode', async t => {
  const s = await setup(t)
  await createProduct(s)
  const catalog = await (await s.request('/api/catalog')).json()
  const plus = catalog.plans.find((item: { id: string }) => item.id === 'plus')
  assert.equal(plus.fulfillment, null)
  assert.equal(plus.input_fields, '[]')
  assert.equal((await s.request('/api/admin/plans', undefined, s.admin)).status, 200)
})

test('product and plan edits reject stale versions and duplicate slugs', async t => {
  const s = await setup(t)
  const product = await createProduct(s)
  await createPlan(s, product.id)
  const duplicate = await s.request('/api/admin/products', { slug: 'test-membership', name: '重复', category: 'ai', template: 'card', accent: '#000000' }, s.admin)
  assert.equal(duplicate.status, 409)
  const stale = await s.request(`/api/admin/products/${product.id}`, { version: 99, slug: 'test-membership', name: '改名', category: 'ai', template: 'card', accent: '#000000' }, s.admin)
  assert.equal(stale.status, 409)
  const renamed = await s.request(`/api/admin/products/${product.id}`, { version: product.version, slug: 'test-membership', name: '改名', category: 'ai', template: 'card', accent: '#000000' }, s.admin)
  assert.equal(renamed.status, 200, await renamed.clone().text())
  assert.equal((await renamed.json()).product.name, '改名')
})

test('recharge plans require at least one required buyer field', async t => {
  const s = await setup(t)
  const product = await createProduct(s)
  const invalid = await s.request('/api/admin/product-plans', {
    productId: product.id, id: 'recharge-plan', name: '代充', priceCents: 100, fulfillment: 'recharge',
    inputFields: [{ key: 'username', label: '用户名', type: 'text', required: false, maxLength: 32 }],
  }, s.admin)
  assert.equal(invalid.status, 400)
  const valid = await s.request('/api/admin/product-plans', {
    productId: product.id, id: 'recharge-plan', name: '代充', priceCents: 100, fulfillment: 'recharge',
    inputFields: [{ key: 'username', label: '用户名', type: 'text', required: true, maxLength: 32 }],
  }, s.admin)
  assert.equal(valid.status, 201, await valid.clone().text())
})

test('buyer inputs are validated, sealed, and never returned in the order payload', async t => {
  const s = await setup(t)
  const product = await createProduct(s)
  await createPlan(s, product.id, {
    fulfillment: 'recharge',
    inputFields: [{ key: 'account', label: '账号', type: 'text', required: true, maxLength: 64 }],
  })
  const cookie = await buyerCookie(s)
  const missing = await s.request('/api/orders', { plan: 'test-card-plan', expectedPrice: 1990, key: crypto.randomUUID(), email: 'buyer@example.test', inputs: {} }, cookie)
  assert.equal(missing.status, 400)
  assert.match((await missing.json()).error, /账号/)

  const created = await s.request('/api/orders', { plan: 'test-card-plan', expectedPrice: 1990, key: crypto.randomUUID(), email: 'buyer@example.test', inputs: { account: 'secret-account' } }, cookie)
  assert.equal(created.status, 201, await created.clone().text())
  const order = (await created.json()).order
  assert.equal(order.fulfillmentMode, 'recharge')
  assert.equal(order.status, 'pending')
  assert.doesNotMatch(JSON.stringify(order), /secret-account/)

  const row = s.db.prepare('SELECT ciphertext,iv FROM order_inputs WHERE order_id=?').get(order.id) as { ciphertext: string; iv: string }
  assert.ok(row)
  assert.doesNotMatch(row.ciphertext, /secret-account/)
  const event = s.db.prepare('SELECT note FROM order_events WHERE order_id=?').get(order.id) as { note: string }
  assert.doesNotMatch(event.note, /secret-account/)
})

test('admin can read inputs, deliver sealed payloads, and duplicate card keys are rejected', async t => {
  const s = await setup(t)
  const product = await createProduct(s)
  await createPlan(s, product.id)
  const cookie = await buyerCookie(s)
  const created = await s.request('/api/orders', { plan: 'test-card-plan', expectedPrice: 1990, key: crypto.randomUUID(), email: 'buyer@example.test' }, cookie)
  const order = (await created.json()).order
  s.db.prepare("UPDATE orders SET mode='live', payment_status='paid', status='session' WHERE id=?").run(order.id)

  const before = await s.request(`/api/admin/orders/${order.id}/fulfillment`, undefined, s.admin)
  assert.equal(before.status, 200, await before.clone().text())
  assert.equal((await before.json()).delivery, null)

  const deliver = await s.request(`/api/admin/orders/${order.id}/fulfillment`, { version: 0, note: '录入卡密', payload: { code: 'CARD-KEY-AAAA-BBBB' } }, s.admin)
  assert.equal(deliver.status, 200, await deliver.clone().text())
  assert.equal((await deliver.json()).order.status, 'success')

  const stored = s.db.prepare('SELECT ciphertext FROM order_deliveries WHERE order_id=?').get(order.id) as { ciphertext: string }
  assert.doesNotMatch(stored.ciphertext, /CARD-KEY-AAAA-BBBB/)
  const access = s.db.prepare('SELECT action FROM delivery_access_log WHERE order_id=? ORDER BY created_at').all(order.id) as { action: string }[]
  assert.ok(access.some(row => row.action === 'delivery-write'))

  // A second order must not receive the same card key.
  const second = await s.request('/api/orders', { plan: 'test-card-plan', expectedPrice: 1990, key: crypto.randomUUID(), email: 'buyer2@example.test' }, cookie)
  const secondOrder = (await second.json()).order
  s.db.prepare("UPDATE orders SET mode='live', payment_status='paid', status='session' WHERE id=?").run(secondOrder.id)
  const duplicate = await s.request(`/api/admin/orders/${secondOrder.id}/fulfillment`, { version: 0, note: '重复卡密', payload: { code: 'CARD-KEY-AAAA-BBBB' } }, s.admin)
  assert.equal(duplicate.status, 409)

  const buyer = await s.request(`/api/orders/${order.id}/delivery`, undefined, cookie)
  assert.equal(buyer.status, 200, await buyer.clone().text())
  assert.equal((await buyer.json()).delivery.payload.code, 'CARD-KEY-AAAA-BBBB')
})

test('buyer cannot read delivery for unpaid or refunded orders', async t => {
  const s = await setup(t)
  const product = await createProduct(s)
  await createPlan(s, product.id)
  const cookie = await buyerCookie(s)
  const created = await s.request('/api/orders', { plan: 'test-card-plan', expectedPrice: 1990, key: crypto.randomUUID(), email: 'buyer@example.test' }, cookie)
  const order = (await created.json()).order
  assert.equal((await s.request(`/api/orders/${order.id}/delivery`, undefined, cookie)).status, 404)
})

test('disabled products disappear from checkout but keep admin visibility', async t => {
  const s = await setup(t)
  const product = await createProduct(s)
  await createPlan(s, product.id)
  const off = await s.request(`/api/admin/products/${product.id}`, { version: product.version, slug: 'test-membership', name: '测试会员', category: 'ai', template: 'card', accent: '#2563eb', enabled: false }, s.admin)
  assert.equal(off.status, 200, await off.clone().text())
  const catalog = await (await s.request('/api/catalog')).json()
  assert.equal(catalog.products.length, 0)
  assert.equal(catalog.plans.find((item: { id: string }) => item.id === 'test-card-plan').enabled, 0)
  const cookie = await buyerCookie(s)
  const blocked = await s.request('/api/orders', { plan: 'test-card-plan', expectedPrice: 1990, key: crypto.randomUUID(), email: 'buyer@example.test' }, cookie)
  assert.equal(blocked.status, 409)
  const adminList = await (await s.request('/api/admin/products', undefined, s.admin)).json()
  assert.equal(adminList.products.length, 1)
})

test('sealed delivery cannot be decrypted with a different key', async t => {
  const { seal, unseal } = await import('../worker/sealed.ts')
  const env = { DELIVERY_SECRET: SECRET } as never
  const sealed = await seal(env, '{"code":"ABC"}')
  assert.equal(await unseal(env, sealed.ciphertext, sealed.iv), '{"code":"ABC"}')
  await assert.rejects(unseal({ DELIVERY_SECRET: 'another-fixture-secret-32-characters' } as never, sealed.ciphertext, sealed.iv))
  await assert.rejects(seal({ DELIVERY_SECRET: 'short' } as never, 'x'))
})

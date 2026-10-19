import test from 'node:test'
import assert from 'node:assert/strict'
import { customerFixture } from './customer-fixture.ts'

const SECRET = 'local-fixture-delivery-secret-32-chars'
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

async function setup(t: Parameters<Parameters<typeof test>[1]>[0]) {
  const s = await customerFixture(); t.after(() => s.db.close())
  Object.assign(s.env, { DELIVERY_SECRET: SECRET, ORDER_TESTING_ENABLED: 'true', PURCHASE_CONTACT_ONLY: 'true' })
  return s
}

async function createProduct(s: Awaited<ReturnType<typeof setup>>) {
  const response = await s.request('/api/admin/products', {
    slug: 'contact-membership', name: '联系购买会员', category: 'ai', tagline: '一句话',
    description: '描述', pitch: '卖点', badge: '联系购买', unit: '月', quantity: '1 个月',
    template: 'card', accent: '#2563eb', sortOrder: 1, enabled: true, faq: [],
  }, s.admin)
  assert.equal(response.status, 201, await response.clone().text())
  return (await response.json()).product
}

async function createPlan(s: Awaited<ReturnType<typeof setup>>, productId: string) {
  const response = await s.request('/api/admin/product-plans', {
    productId, id: 'contact-plan', name: '标准版', priceCents: 1990, fulfillment: 'manual',
    inputFields: [], features: ['权益一'], subtitle: '副标题', description: '套餐描述',
    unit: '月', purchaseNote: '', deliveryInstructions: '', enabled: true,
  }, s.admin)
  assert.equal(response.status, 201, await response.clone().text())
  return (await response.json()).plan
}

async function buyerCookie(s: Awaited<ReturnType<typeof setup>>) {
  const response = await s.request('/api/orders/client', {})
  return response.headers.get('set-cookie')!.split(';')[0]
}

test('contact-only storefront exposes sellable plans, hides online checkout, and rejects orders', async t => {
  const s = await setup(t)
  const product = await createProduct(s)
  await createPlan(s, product.id)
  const buyer = await buyerCookie(s)
  const catalog = await (await s.request('/api/catalog')).json()
  const offer = catalog.plans.find((item: { id: string }) => item.id === 'contact-plan')

  assert.equal(catalog.checkoutEnabled, false)
  assert.equal(catalog.contactPurchase, false)
  assert.equal(offer.enabled, 0)
  assert.equal(offer.contactEnabled, 1)
  const rejected = await s.request('/api/orders', { plan: 'contact-plan', expectedPrice: 1990, key: crypto.randomUUID(), email: 'buyer@example.test' }, buyer)
  assert.equal(rejected.status, 409)
  assert.match((await rejected.json()).error, /联系客服/)

  const contacts = { wechat: 'help_wechat', qq: '', email: '', version: 0 }
  assert.equal((await s.request('/api/admin/support-contacts', contacts, s.admin)).status, 200)
  const ready = await (await s.request('/api/catalog')).json()
  assert.equal(ready.contactPurchase, true)
  assert.equal(ready.checkoutEnabled, false)
  assert.deepEqual(ready.supportContacts, { wechat: 'help_wechat', qq: '', email: '' })
  assert.equal(ready.plans.find((item: { id: string }) => item.id === 'contact-plan').contactEnabled, 1)
})

test('admin uploads a WeChat QR that the storefront and public image route can read', async t => {
  const s = await setup(t)
  const product = await createProduct(s)
  await createPlan(s, product.id)

  assert.equal((await s.request('/api/admin/support-qr', undefined, s.admin)).status, 200)
  const uploaded = await s.request('/api/admin/support-qr', { image: PNG }, s.admin)
  assert.equal(uploaded.status, 200, await uploaded.clone().text())
  const meta = await uploaded.json()
  assert.match(meta.url, /^\/api\/support-qr\?v=\d+$/)

  const catalog = await (await s.request('/api/catalog')).json()
  assert.equal(catalog.contactPurchase, true)
  assert.equal(catalog.supportQr, meta.url)

  const image = await s.request(meta.url)
  assert.equal(image.status, 200)
  assert.equal(image.headers.get('content-type'), 'image/png')
  assert.equal(image.headers.get('cache-control'), 'no-store')
  const bytes = new Uint8Array(await image.arrayBuffer())
  assert.deepEqual(Array.from(bytes.slice(0, 8)), [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

  const invalid = await s.request('/api/admin/support-qr', { image: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' }, s.admin)
  assert.equal(invalid.status, 400)
  assert.equal((await s.request('/api/admin/support-qr', { image: '' }, s.admin)).status, 200)
  const cleared = await (await s.request('/api/catalog')).json()
  assert.equal(cleared.supportQr, '')
  assert.equal((await s.request(meta.url)).status, 404)
})

test('disabling contact-only mode restores the online checkout path', async t => {
  const s = await setup(t)
  const product = await createProduct(s)
  await createPlan(s, product.id)
  s.env.PURCHASE_CONTACT_ONLY = 'false'
  await s.request('/api/admin/support-contacts', { wechat: 'help_wechat', qq: '', email: '', version: 0 }, s.admin)
  const buyer = await buyerCookie(s)
  const catalog = await (await s.request('/api/catalog')).json()
  assert.equal(catalog.contactPurchase, false)
  assert.equal(catalog.checkoutEnabled, true)
  assert.equal(catalog.plans.find((item: { id: string }) => item.id === 'contact-plan').enabled, 1)
  const created = await s.request('/api/orders', { plan: 'contact-plan', expectedPrice: 1990, key: crypto.randomUUID(), email: 'buyer@example.test' }, buyer)
  assert.equal(created.status, 201, await created.clone().text())
})

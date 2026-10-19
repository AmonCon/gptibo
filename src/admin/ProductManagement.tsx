import { useEffect, useState } from 'react'
import { Check, Package, Pencil, Plus, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Feedback } from '@/components/workspace-loading'
import { api, errorMessage } from '@/lib/api'
import { useResource } from '@/lib/use-resource'
import {
  CATEGORY_LABELS, FULFILLMENT_LABELS, FULFILLMENT_MODES, PRODUCT_CATEGORIES, PRODUCT_TEMPLATES, TEMPLATE_LABELS,
  type DynamicPlan, type DynamicProduct, type FulfillmentMode, type InputField, type ProductCategory, type ProductFaq, type ProductTemplate,
} from '../../shared/dynamic-products'
import './product-management.css'

type Catalog = { products: DynamicProduct[]; plans: DynamicPlan[] }
const money = (cents: number) => `¥${(cents / 100).toFixed(2)}`

type ProductDraft = {
  slug: string; name: string; category: ProductCategory; tagline: string; description: string; pitch: string;
  badge: string; unit: string; quantity: string; template: ProductTemplate; accent: string; imageUrl: string;
  sortOrder: string; enabled: boolean; faq: ProductFaq[];
}

function emptyProduct(): ProductDraft {
  return {
    slug: '', name: '', category: 'tool', tagline: '', description: '', pitch: '', badge: '',
    unit: '份', quantity: '1 份', template: 'card', accent: '#2563eb', imageUrl: '', sortOrder: '0', enabled: true, faq: [],
  }
}

function productDraft(product: DynamicProduct): ProductDraft {
  return {
    slug: product.slug, name: product.name, category: product.category, tagline: product.tagline,
    description: product.description, pitch: product.pitch, badge: product.badge, unit: product.unit,
    quantity: product.quantity, template: product.template, accent: product.accent, imageUrl: product.image_url ?? '',
    sortOrder: String(product.sort_order), enabled: product.enabled === 1, faq: product.faq,
  }
}

type PlanDraft = {
  id: string; name: string; price: string; fulfillment: FulfillmentMode; subtitle: string; description: string;
  unit: string; features: string; purchaseNote: string; deliveryInstructions: string;
  inputFields: InputField[]; enabled: boolean; renewalOnly: boolean;
}

function emptyPlan(): PlanDraft {
  return {
    id: '', name: '', price: '', fulfillment: 'manual', subtitle: '', description: '', unit: '',
    features: '', purchaseNote: '', deliveryInstructions: '', inputFields: [], enabled: true, renewalOnly: false,
  }
}

function planDraft(plan: DynamicPlan): PlanDraft {
  return {
    id: plan.id, name: plan.name, price: (plan.price_cents / 100).toFixed(2), fulfillment: plan.fulfillment,
    subtitle: plan.subtitle, description: plan.description, unit: plan.unit, features: plan.features.join('\n'),
    purchaseNote: plan.purchase_note, deliveryInstructions: plan.delivery_instructions,
    inputFields: plan.input_fields, enabled: plan.enabled === 1, renewalOnly: plan.renewal_only === 1,
  }
}

export function ProductManagement({ revision, onChanged }: { revision: number; onChanged: () => void }) {
  const [localRevision, setLocalRevision] = useState(0)
  const { data, error, loading } = useResource<Catalog>('/api/admin/products', revision + localRevision)
  const [editProduct, setEditProduct] = useState<DynamicProduct | 'new'>()
  const [editPlan, setEditPlan] = useState<{ productId: string; plan?: DynamicPlan }>()
  const refresh = () => { setLocalRevision(v => v + 1); onChanged() }
  const products = data?.products ?? []
  return <>
    <section className="admin-panel">
      <div className="admin-panel-title"><h2>商品管理</h2><span>新增商品无需改代码或重新部署</span><Button onClick={() => setEditProduct('new')}><Plus size={14} />新建商品</Button></div>
      <Feedback error={error} loading={loading} data={data} />
      {data && (products.length ? <div className="admin-table-scroll"><table className="admin-table"><thead><tr><th>商品</th><th>分类</th><th>视觉模板</th><th>套餐</th><th>状态</th><th>排序</th><th /></tr></thead><tbody>
        {products.map(product => {
          const plans = (data.plans ?? []).filter(plan => plan.product_id === product.id)
          return <tr key={product.id}>
            <td><strong>{product.name}</strong><small>{product.slug} · {product.tagline || '未填写标语'}</small></td>
            <td>{CATEGORY_LABELS[product.category]}</td>
            <td>{TEMPLATE_LABELS[product.template]}</td>
            <td>{plans.length}<small>{plans.filter(plan => plan.enabled === 1).length} 个在售</small></td>
            <td><span className={`admin-pill ${product.enabled ? 'available' : ''}`}>{product.enabled ? '已上架' : '已下架'}</span></td>
            <td>{product.sort_order}</td>
            <td className="product-admin-actions"><Button variant="outline" onClick={() => setEditPlan({ productId: product.id })}><Plus size={13} />套餐</Button><Button variant="ghost" onClick={() => setEditProduct(product)}><Pencil size={13} />编辑</Button></td>
          </tr>
        })}
      </tbody></table></div> : <div className="admin-empty"><Package size={26} /><h3>还没有自定义商品</h3><p>新建商品并添加套餐后，前台会自动出现。</p><Button onClick={() => setEditProduct('new')}><Plus size={14} />新建商品</Button></div>)}
      <p className="admin-panel-footnote">现有 ChatGPT、Gemini、多邻国等商品保持原样，不受这里影响。这里管理的是后台新增的通用商品。</p>
    </section>
    {data && <PlanTable plans={data.plans ?? []} products={products} onEdit={plan => setEditPlan({ productId: plan.product_id, plan })} />}
    {editProduct && <ProductEditor key={editProduct === 'new' ? 'new' : editProduct.id} product={editProduct} onClose={() => setEditProduct(undefined)} onSaved={() => { setEditProduct(undefined); refresh() }} />}
    {editPlan && <PlanEditor key={(editPlan.plan?.id ?? 'new') + editPlan.productId} productId={editPlan.productId} plan={editPlan.plan} onClose={() => setEditPlan(undefined)} onSaved={() => { setEditPlan(undefined); refresh() }} />}
  </>
}

function PlanTable({ plans, products, onEdit }: { plans: DynamicPlan[]; products: DynamicProduct[]; onEdit: (plan: DynamicPlan) => void }) {
  return <section className="admin-panel">
    <div className="admin-panel-title"><h2>通用商品套餐</h2><span>交付方式与买家资料按套餐配置</span></div>
    {plans.length ? <div className="admin-table-scroll"><table className="admin-table"><thead><tr><th>商品</th><th>套餐</th><th>售价</th><th>交付方式</th><th>买家必填</th><th>状态</th><th /></tr></thead><tbody>
      {plans.map(plan => {
        const product = products.find(item => item.id === plan.product_id)
        return <tr key={plan.id}>
          <td>{product?.name ?? plan.product_id}</td>
          <td><strong>{plan.name}</strong><small>{plan.id}</small></td>
          <td className="admin-numeric">{money(plan.price_cents)}</td>
          <td>{FULFILLMENT_LABELS[plan.fulfillment]}</td>
          <td>{plan.input_fields.filter(field => field.required).map(field => field.label).join('、') || '—'}</td>
          <td><span className={`admin-pill ${plan.enabled ? 'available' : ''}`}>{plan.enabled ? '可购买' : '已暂停'}</span></td>
          <td><Button variant="ghost" onClick={() => onEdit(plan)}><Pencil size={13} />编辑</Button></td>
        </tr>
      })}
    </tbody></table></div> : <p className="admin-panel-footnote">还没有套餐。先新建商品，再为它添加套餐。</p>}
  </section>
}

function ProductEditor({ product, onClose, onSaved }: { product: DynamicProduct | 'new'; onClose: () => void; onSaved: () => void }) {
  const isNew = product === 'new'
  const [draft, setDraft] = useState<ProductDraft>(isNew ? emptyProduct() : productDraft(product))
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  const update = <K extends keyof ProductDraft>(key: K, value: ProductDraft[K]) => setDraft(current => ({ ...current, [key]: value }))
  async function save() {
    if (busy) return
    setBusy(true); setError('')
    try {
      const payload = {
        ...draft, sortOrder: Number(draft.sortOrder || 0),
        imageUrl: draft.imageUrl.trim() || null,
        version: isNew ? undefined : (product as DynamicProduct).version,
      }
      if (isNew) await api('/api/admin/products', payload)
      else await api(`/api/admin/products/${(product as DynamicProduct).id}`, payload)
      onSaved()
    } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose() }}><DialogContent className="motion-dialog product-editor"><DialogHeader><DialogTitle>{isNew ? '新建商品' : `编辑 ${draft.name}`}</DialogTitle><DialogDescription>商品信息保存后立即出现在前台；至少添加一个套餐才能下单。</DialogDescription></DialogHeader>
    <form className="admin-edit-form" onSubmit={event => { event.preventDefault(); void save() }}>
      <div className="product-editor-grid">
        <label htmlFor="product-name">商品名称</label><Input id="product-name" value={draft.name} onChange={e => update('name', e.target.value)} maxLength={60} required disabled={busy} placeholder="例如：Spotify Premium" />
        <label htmlFor="product-slug">商品标识</label><Input id="product-slug" value={draft.slug} onChange={e => update('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} maxLength={48} required disabled={busy} placeholder="spotify-premium" />
        <label htmlFor="product-category">分类</label>
        <select id="product-category" value={draft.category} onChange={e => update('category', e.target.value as ProductCategory)} disabled={busy}>{PRODUCT_CATEGORIES.map(id => <option key={id} value={id}>{CATEGORY_LABELS[id]}</option>)}</select>
        <label htmlFor="product-tagline">一句话标语</label><Input id="product-tagline" value={draft.tagline} onChange={e => update('tagline', e.target.value)} maxLength={120} disabled={busy} placeholder="卡片标题下方的一行说明" />
        <label htmlFor="product-description">商品描述</label><textarea id="product-description" rows={2} value={draft.description} onChange={e => update('description', e.target.value)} maxLength={500} disabled={busy} />
        <label htmlFor="product-pitch">卖点文案</label><textarea id="product-pitch" rows={2} value={draft.pitch} onChange={e => update('pitch', e.target.value)} maxLength={500} disabled={busy} />
        <label htmlFor="product-badge">角标</label><Input id="product-badge" value={draft.badge} onChange={e => update('badge', e.target.value)} maxLength={20} disabled={busy} placeholder="例如：自动发货" />
        <label htmlFor="product-unit">计价单位</label><Input id="product-unit" value={draft.unit} onChange={e => update('unit', e.target.value)} maxLength={10} disabled={busy} placeholder="月 / 次 / 份" />
        <label htmlFor="product-quantity">规格说明</label><Input id="product-quantity" value={draft.quantity} onChange={e => update('quantity', e.target.value)} maxLength={40} disabled={busy} placeholder="1 个月" />
        <label htmlFor="product-template">视觉模板</label>
        <select id="product-template" value={draft.template} onChange={e => update('template', e.target.value as ProductTemplate)} disabled={busy}>{PRODUCT_TEMPLATES.map(id => <option key={id} value={id}>{TEMPLATE_LABELS[id]}</option>)}</select>
        <label htmlFor="product-accent">主色</label>
        <div className="product-accent-row"><input id="product-accent" type="color" value={draft.accent} onChange={e => update('accent', e.target.value)} disabled={busy} /><Input value={draft.accent} onChange={e => update('accent', e.target.value)} maxLength={7} disabled={busy} aria-label="主色十六进制值" /></div>
        <label htmlFor="product-image">主图地址（可选）</label><Input id="product-image" value={draft.imageUrl} onChange={e => update('imageUrl', e.target.value)} maxLength={500} disabled={busy} placeholder="https://…" />
        <label htmlFor="product-sort">排序（越小越靠前）</label><Input id="product-sort" value={draft.sortOrder} onChange={e => update('sortOrder', e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" disabled={busy} />
      </div>
      <FaqEditor value={draft.faq} onChange={value => update('faq', value)} disabled={busy} />
      <label className="admin-checkbox"><input type="checkbox" checked={draft.enabled} onChange={e => update('enabled', e.target.checked)} disabled={busy} />上架到前台</label>
      <Feedback error={error} />
      <div className="product-editor-actions"><Button type="button" variant="outline" onClick={onClose} disabled={busy}>取消</Button><Button type="submit" disabled={busy || !draft.name.trim() || !draft.slug.trim()}>{busy ? '保存中…' : isNew ? '创建商品' : '保存修改'}</Button></div>
    </form>
  </DialogContent></Dialog>
}

function FaqEditor({ value, onChange, disabled }: { value: ProductFaq[]; onChange: (value: ProductFaq[]) => void; disabled: boolean }) {
  const update = (index: number, patch: Partial<ProductFaq>) => onChange(value.map((item, i) => i === index ? { ...item, ...patch } : item))
  return <fieldset className="product-faq-editor" disabled={disabled}>
    <legend>常见问题</legend>
    {value.map((item, index) => <div key={index} className="product-faq-row">
      <Input value={item.question} onChange={e => update(index, { question: e.target.value })} maxLength={200} placeholder="问题" aria-label={`问题 ${index + 1}`} />
      <textarea value={item.answer} onChange={e => update(index, { answer: e.target.value })} maxLength={1000} rows={2} placeholder="回答" aria-label={`回答 ${index + 1}`} />
      <Button type="button" variant="ghost" size="icon" aria-label={`删除问题 ${index + 1}`} onClick={() => onChange(value.filter((_, i) => i !== index))}><X size={14} /></Button>
    </div>)}
    <Button type="button" variant="outline" disabled={value.length >= 20} onClick={() => onChange([...value, { question: '', answer: '' }])}><Plus size={13} />添加问题</Button>
  </fieldset>
}

function PlanEditor({ productId, plan, onClose, onSaved }: { productId: string; plan?: DynamicPlan; onClose: () => void; onSaved: () => void }) {
  const [draft, setDraft] = useState<PlanDraft>(plan ? planDraft(plan) : emptyPlan())
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  const update = <K extends keyof PlanDraft>(key: K, value: PlanDraft[K]) => setDraft(current => ({ ...current, [key]: value }))
  async function save() {
    if (busy) return
    if (!/^\d+(\.\d{1,2})?$/.test(draft.price) || Number(draft.price) <= 0) { setError('请输入正确的售价。'); return }
    setBusy(true); setError('')
    try {
      const payload = {
        productId, id: draft.id, name: draft.name, priceCents: Math.round(Number(draft.price) * 100),
        fulfillment: draft.fulfillment, subtitle: draft.subtitle, description: draft.description, unit: draft.unit,
        features: draft.features.split('\n').map(line => line.trim()).filter(Boolean),
        purchaseNote: draft.purchaseNote, deliveryInstructions: draft.deliveryInstructions,
        inputFields: draft.inputFields, enabled: draft.enabled, renewalOnly: draft.renewalOnly,
        version: plan?.version,
      }
      if (plan) await api(`/api/admin/product-plans/${plan.id}`, payload)
      else await api('/api/admin/product-plans', payload)
      onSaved()
    } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }
  const needsInput = draft.fulfillment === 'recharge'
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose() }}><DialogContent className="motion-dialog product-editor"><DialogHeader><DialogTitle>{plan ? `编辑套餐 ${plan.name}` : '新增套餐'}</DialogTitle><DialogDescription>交付方式决定买家付款后看到什么、管理员如何发货。</DialogDescription></DialogHeader>
    <form className="admin-edit-form" onSubmit={event => { event.preventDefault(); void save() }}>
      <div className="product-editor-grid">
        <label htmlFor="plan-name">套餐名称</label><Input id="plan-name" value={draft.name} onChange={e => update('name', e.target.value)} maxLength={60} required disabled={busy} placeholder="标准版 / 3 个月" />
        <label htmlFor="plan-id">套餐标识</label><Input id="plan-id" value={draft.id} onChange={e => update('id', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} maxLength={48} required disabled={busy || Boolean(plan)} placeholder="spotify-3m" />
        <label htmlFor="plan-price">售价（元）</label><Input id="plan-price" value={draft.price} onChange={e => update('price', e.target.value)} inputMode="decimal" required disabled={busy} placeholder="19.90" />
        <label htmlFor="plan-fulfillment">交付方式</label>
        <select id="plan-fulfillment" value={draft.fulfillment} onChange={e => update('fulfillment', e.target.value as FulfillmentMode)} disabled={busy}>{FULFILLMENT_MODES.map(id => <option key={id} value={id}>{FULFILLMENT_LABELS[id]}</option>)}</select>
        <label htmlFor="plan-subtitle">套餐副标题</label><Input id="plan-subtitle" value={draft.subtitle} onChange={e => update('subtitle', e.target.value)} maxLength={120} disabled={busy} />
        <label htmlFor="plan-description">套餐说明</label><textarea id="plan-description" rows={2} value={draft.description} onChange={e => update('description', e.target.value)} maxLength={300} disabled={busy} />
        <label htmlFor="plan-unit">计价单位</label><Input id="plan-unit" value={draft.unit} onChange={e => update('unit', e.target.value)} maxLength={10} disabled={busy} placeholder="月 / 次" />
        <label htmlFor="plan-features">套餐权益（每行一条）</label><textarea id="plan-features" rows={3} value={draft.features} onChange={e => update('features', e.target.value)} disabled={busy} />
        <label htmlFor="plan-purchase-note">购买说明（客户下单前可见）</label><textarea id="plan-purchase-note" rows={3} value={draft.purchaseNote} onChange={e => update('purchaseNote', e.target.value)} maxLength={2000} disabled={busy} />
        <label htmlFor="plan-delivery-instructions">领取说明（发货后可见）</label><textarea id="plan-delivery-instructions" rows={3} value={draft.deliveryInstructions} onChange={e => update('deliveryInstructions', e.target.value)} maxLength={2000} disabled={busy} />
      </div>
      <InputFieldsEditor value={draft.inputFields} onChange={value => update('inputFields', value)} disabled={busy} required={needsInput} />
      {needsInput && <p className="admin-subtle">代充商品至少需要一个必填字段，例如账号或用户名。</p>}
      <label className="admin-checkbox"><input type="checkbox" checked={draft.enabled} onChange={e => update('enabled', e.target.checked)} disabled={busy} />允许创建新订单</label>
      <label className="admin-checkbox"><input type="checkbox" checked={draft.renewalOnly} onChange={e => update('renewalOnly', e.target.checked)} disabled={busy} />仅限续费</label>
      <Feedback error={error} />
      <div className="product-editor-actions"><Button type="button" variant="outline" onClick={onClose} disabled={busy}>取消</Button><Button type="submit" disabled={busy || !draft.name.trim() || !draft.id.trim()}>{busy ? '保存中…' : plan ? '保存修改' : '创建套餐'}</Button></div>
    </form>
  </DialogContent></Dialog>
}

function InputFieldsEditor({ value, onChange, disabled, required }: { value: InputField[]; onChange: (value: InputField[]) => void; disabled: boolean; required: boolean }) {
  const update = (index: number, patch: Partial<InputField>) => onChange(value.map((item, i) => i === index ? { ...item, ...patch } : item))
  return <fieldset className="product-faq-editor" disabled={disabled}>
    <legend>买家需提交的资料{required ? '（代充至少一项必填）' : ''}</legend>
    {value.map((field, index) => <div key={index} className="product-input-row">
      <Input value={field.key} onChange={e => update(index, { key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })} maxLength={32} placeholder="字段标识 username" aria-label={`字段标识 ${index + 1}`} />
      <Input value={field.label} onChange={e => update(index, { label: e.target.value })} maxLength={40} placeholder="显示名称 用户名" aria-label={`显示名称 ${index + 1}`} />
      <select value={field.type} onChange={e => update(index, { type: e.target.value as InputField['type'] })} aria-label={`字段类型 ${index + 1}`}><option value="text">文本</option><option value="email">邮箱</option><option value="textarea">多行文本</option></select>
      <Input value={String(field.maxLength)} onChange={e => update(index, { maxLength: Number(e.target.value.replace(/[^0-9]/g, '')) || 1 })} inputMode="numeric" aria-label={`最大长度 ${index + 1}`} />
      <label className="product-input-required"><input type="checkbox" checked={field.required} onChange={e => update(index, { required: e.target.checked })} />必填</label>
      <Button type="button" variant="ghost" size="icon" aria-label={`删除字段 ${index + 1}`} onClick={() => onChange(value.filter((_, i) => i !== index))}><Trash2 size={14} /></Button>
    </div>)}
    <Button type="button" variant="outline" disabled={value.length >= 8} onClick={() => onChange([...value, { key: '', label: '', type: 'text', required: false, maxLength: 200 }])}><Plus size={13} />添加字段</Button>
  </fieldset>
}

export function FulfillmentPanel({ orderId, version, onSaved }: { orderId: string; version: number; onSaved: () => void }) {
  const { data, error, loading } = useResource<{ inputs: Record<string, string> | null; delivery: { kind: string; note: string; payload: Record<string, string> } | null }>(`/api/admin/orders/${orderId}/fulfillment`, version)
  const [payload, setPayload] = useState(''); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false); const [failure, setFailure] = useState(''); const [done, setDone] = useState(false)
  useEffect(() => { if (data?.delivery) setPayload(Object.entries(data.delivery.payload).map(([key, value]) => `${key}: ${value}`).join('\n')) }, [data])
  async function submit() {
    if (busy || !note.trim()) return
    const entries = payload.split('\n').map(line => line.trim()).filter(Boolean).map(line => {
      const index = line.indexOf(':')
      return index > 0 ? [line.slice(0, index).trim(), line.slice(index + 1).trim()] as const : ['content', line] as const
    })
    if (!entries.length) { setFailure('请填写发货内容。'); return }
    setBusy(true); setFailure('')
    try { await api(`/api/admin/orders/${orderId}/fulfillment`, { version, note, payload: Object.fromEntries(entries) }); setDone(true); onSaved() }
    catch (e) { setFailure(errorMessage(e)) } finally { setBusy(false) }
  }
  if (!data) return <Feedback error={error} loading={loading} data={data} shape="compact" />
  return <section className="product-fulfillment" aria-label="通用商品发货">
    <h3><Package size={16} /> 通用商品发货</h3>
    {data.inputs ? <div className="product-fulfillment-inputs"><p>买家提交的资料</p><dl>{Object.entries(data.inputs).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl></div> : <p className="admin-subtle">本订单没有买家提交的资料。</p>}
    {data.delivery && <p className="product-fulfillment-done"><Check size={14} /> 已发货：{Object.keys(data.delivery.payload).join('、')}</p>}
    {done ? <p className="admin-success" role="status">发货内容已加密保存，订单已完成。</p> : <>
      <label htmlFor="fulfillment-payload">发货内容（每行 <code>字段: 值</code>，例如 <code>code: ABCD-1234</code>）</label>
      <textarea id="fulfillment-payload" rows={5} value={payload} onChange={e => setPayload(e.target.value)} disabled={busy} placeholder={'code: ABCD-1234\npassword: 示例密码'} />
      <label htmlFor="fulfillment-note">处理说明（客户可见，不含敏感内容）</label>
      <Input id="fulfillment-note" value={note} onChange={e => setNote(e.target.value)} maxLength={500} disabled={busy} placeholder="例如：已发送卡密，请及时兑换" />
      <Feedback error={failure} />
      <div className="product-editor-actions"><Button disabled={busy || !note.trim() || !payload.trim()} onClick={() => void submit()}>{busy ? '保存中…' : '加密保存并发货'}</Button></div>
    </>}
  </section>
}

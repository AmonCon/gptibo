import { useMemo, useState } from 'react'
import { ArrowRight, Check, ChevronRight, CircleHelp, ShieldCheck, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatCatalogPrice } from '@/lib/catalog-display'
import { CATEGORY_LABELS, FULFILLMENT_LABELS, type DynamicProduct } from '../../shared/dynamic-products'
import type { CatalogPlan } from '@/lib/api'
import './dynamic-product.css'

export type DynamicCatalogPlan = CatalogPlan & { subtitle?: string; features?: string; input_fields?: string; product_slug?: string | null; fulfillment?: string | null }

/** Plans belonging to a merchant-created product, in the store's price order. */
export function plansForProduct(offers: CatalogPlan[], productSlug: string) {
  return offers.filter(offer => offer.product_slug === productSlug && Boolean(offer.fulfillment))
}

export function ProductArt({ product, price }: { product: DynamicProduct; price?: string }) {
  const style = { '--product-accent': product.accent } as React.CSSProperties
  if (product.image_url) {
    return <div className="dynamic-art dynamic-art-image" style={style}><img src={product.image_url} alt="" loading="lazy" /></div>
  }
  if (product.template === 'orbit') {
    return <div className="dynamic-art dynamic-art-orbit" style={style} aria-hidden="true"><span className="dynamic-orbit-ring" /><span className="dynamic-orbit-star"><Sparkles size={44} strokeWidth={1.1} /></span><span className="dynamic-orbit-dot" /></div>
  }
  if (product.template === 'mail') {
    return <div className="dynamic-art dynamic-art-mail" style={style} aria-hidden="true"><span className="dynamic-envelope" /><span className="dynamic-envelope-flap" /><span className="dynamic-mail-label">{product.name.slice(0, 10)}</span></div>
  }
  if (product.template === 'ticket') {
    return <div className="dynamic-art dynamic-art-ticket" style={style} aria-hidden="true"><span className="dynamic-ticket"><span className="dynamic-ticket-name">{product.name}</span><span className="dynamic-ticket-perf" /><span className="dynamic-ticket-meta">{product.quantity}</span></span></div>
  }
  if (product.template === 'account') {
    return <div className="dynamic-art dynamic-art-account" style={style} aria-hidden="true"><span className="dynamic-account-card"><span className="dynamic-account-avatar" /><span className="dynamic-account-lines"><i /><i /></span></span><span className="dynamic-account-check"><Check size={16} /></span></div>
  }
  return <div className="dynamic-art dynamic-art-card" style={style} aria-hidden="true">{[0, 1, 2].map(index => <span key={index} className="dynamic-stack-card" data-index={index}><span className="dynamic-stack-name">{product.name}</span><span className="dynamic-stack-price">{price ?? product.unit}</span></span>)}</div>
}

export function DynamicProductCard({ product, offers, onOpen }: { product: DynamicProduct; offers: CatalogPlan[]; onOpen: (href: string) => (event: React.MouseEvent<HTMLAnchorElement>) => void }) {
  const plans = plansForProduct(offers, product.slug)
  const available = plans.filter(plan => plan.enabled)
  const cheapest = (available.length ? available : plans).reduce<CatalogPlan | undefined>((lowest, plan) => !lowest || plan.price_cents < lowest.price_cents ? plan : lowest, undefined)
  const href = `product/${product.slug}`
  return <article className="store-product dynamic-product-card" style={{ '--product-accent': product.accent } as React.CSSProperties}>
    <div className="store-product-heading"><h3>{product.name}</h3><span>{plans.length && !available.length ? '暂停售卖' : product.badge || CATEGORY_LABELS[product.category]}</span></div>
    <p className="store-spec">{product.tagline || product.description.slice(0, 40)}</p>
    <ProductArt product={product} price={cheapest ? `¥${formatCatalogPrice(cheapest.price_cents / 100)}` : '待定价'} />
    <div className="store-product-bottom">
      <span className="store-starting-price">{cheapest ? <>¥{formatCatalogPrice(cheapest.price_cents / 100)}<small> 起</small></> : <small className="store-pending-price">暂未设置套餐</small>}</span>
      <a className="store-action" href={`/${href}`} onClick={onOpen(href)}>{available.length ? '选择套餐' : '查看详情'}</a>
    </div>
  </article>
}

export function DynamicProductDetail({ product, offers, onCreate, onHelp }: { product: DynamicProduct; offers: CatalogPlan[]; onCreate: (plan: CatalogPlan) => void; onHelp: () => void }) {
  const plans = plansForProduct(offers, product.slug)
  const [selected, setSelected] = useState(() => plans.find(plan => plan.enabled)?.id ?? plans[0]?.id ?? '')
  const plan = plans.find(item => item.id === selected) ?? plans[0]
  const features = useMemo(() => {
    if (!plan) return []
    try { const parsed: unknown = JSON.parse(plan.features ?? '[]'); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [] } catch { return [] }
  }, [plan])
  return <section className="purchase-workspace page-width reveal-in delay-1 dynamic-detail" aria-label={product.name + ' 套餐选择'} id="subscriptions">
    <div className="product-area">
      <div className="product-topline"><span className="section-kicker">01 / 选择套餐</span><span className="availability"><span />{plan?.enabled ? '可购买' : '待开放'}</span></div>
      <div className="product-heading"><span className="dynamic-brand-mark" style={{ background: product.accent }}>{product.name.slice(0, 1)}</span><div><h2>{product.name}</h2><p>{product.tagline}</p></div>{product.badge && <span className="dynamic-badge">{product.badge}</span>}</div>
      <div className="product-pitch"><h3>{plan?.subtitle || plan?.name || '套餐准备中'}</h3><p>{product.pitch || product.description}</p></div>
      <ProductArt product={product} price={plan ? `¥${formatCatalogPrice(plan.price_cents / 100)}` : undefined} />
      {plans.length > 1 && <div className="plan-label"><span>选择适合你的计划</span><span>{product.quantity}</span></div>}
      {plans.length > 0 && <div className={`plan-options dynamic-plan-options ${plans.length === 1 ? 'single-plan' : 'subscription-plans'}`} role="radiogroup" aria-label="商品套餐">
        {plans.map(item => <label key={item.id} className={`plan-option dynamic-plan-option ${plan?.id === item.id ? 'is-selected' : ''}`}>
          <span className="dynamic-plan-head"><input type="radio" name="dynamic-plan" value={item.id} checked={plan?.id === item.id} onChange={() => setSelected(item.id)} disabled={!item.enabled} /><span className="dynamic-plan-name">{item.name}</span>{!item.enabled && <span className="dynamic-plan-off">暂停售卖</span>}</span>
          {item.description && <span className="dynamic-plan-desc">{item.description}</span>}
          <span className="dynamic-plan-price"><small>¥</small>{formatCatalogPrice(item.price_cents / 100)}<small>/ {item.unit || product.unit}</small></span>
        </label>)}
      </div>}
      {features.length > 0 && <div className="plan-features">{features.map(text => <span key={text}><Check size={14} />{text}</span>)}</div>}
      {plan?.purchase_note && <p className="membership-purchase-note">{plan.purchase_note}</p>}
      <div className="product-bottom"><ShieldCheck size={15} /><span>{plan ? FULFILLMENT_LABELS[plan.fulfillment as keyof typeof FULFILLMENT_LABELS] : '交付方式待配置'}</span><span className="dot-separator">·</span><span>订单进度可查</span><button className="text-button" onClick={onHelp}>购买须知 <ChevronRight size={13} /></button></div>
    </div>
    <aside className="order-summary" aria-label="订单摘要">
      <div className="summary-title"><h2>你的订单</h2></div>
      <div className="summary-product"><span className="dynamic-brand-mark" style={{ background: product.accent }}>{product.name.slice(0, 1)}</span><div><strong>{product.name} <span>{plan?.name}</span></strong><p>{product.quantity}</p></div></div>
      <dl className="summary-details">
        <div><dt>规格</dt><dd>{product.quantity}</dd></div>
        <div><dt>交付方式</dt><dd>{plan ? FULFILLMENT_LABELS[plan.fulfillment as keyof typeof FULFILLMENT_LABELS] : '待配置'}</dd></div>
        <div><dt>支付方式</dt><dd>支付宝</dd></div>
      </dl>
      <div className="summary-total"><div><span>合计</span><span className="price-caption">{plan ? `1 × ${plan.name}` : '请选择套餐'}</span></div><div className="total-price"><small>¥</small>{plan ? formatCatalogPrice(plan.price_cents / 100) : '—'}</div></div>
      <Button className="primary-action summary-cta" disabled={!plan?.enabled} onClick={() => plan && onCreate(plan)}>{plan?.enabled ? '立即购买' : '暂停售卖'} <ArrowRight size={17} /></Button>
      <p className="summary-note">在线付款 · 订单进度可查</p>
      {product.faq.length > 0 && <div className="dynamic-faq-hint"><CircleHelp size={14} />付款后可在「我的订单」查看进度与交付内容</div>}
    </aside>
  </section>
}

export function DynamicProductFaq({ product }: { product: DynamicProduct }) {
  if (!product.faq.length) return null
  return <section className="faq-section page-width dynamic-faq" id="help" aria-label="常见问题">
    <div className="faq-heading"><span className="section-kicker">你可能想知道</span><h2>一些问题，<br />提前说清楚。</h2></div>
    <div className="faq-list">{product.faq.map(item => <details key={item.question}><summary>{item.question}</summary><p>{item.answer}</p></details>)}</div>
  </section>
}

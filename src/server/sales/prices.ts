/**
 * 价格体系服务端逻辑（so_price_strategies + so_price_tiers，0023）
 *
 * 取价优先级（resolvePrice）：
 *   客户+SKU 专属 > 客户等级 > 全局默认
 * 同级取「生效期内且 effective_from 最新」的策略；命中策略后在满足数量
 * （min_qty ≤ qty）的档中取最低档价；若所有档 min_qty 均大于数量则取最低档
 * （min_qty 最小者）兜底。
 * 单位匹配：仅取与商品单位一致的阶梯行；该单位无阶梯则视为无命中。
 * 策略本身不存基础价，价格全部由阶梯明细承载（至少一行）。
 */
import { z } from 'zod';
import { ApiError } from '@/server/http';
import { escapeOrKeyword, throwDbError, type ListQuery, type PagedResult } from '@/server/master-data/helpers';
import { getSupabaseClient } from '@/storage/database/supabase-client';

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export interface PriceTierInput {
  unit: string;
  min_qty: number;
  unit_price: number;
}

export interface PriceStrategyInput {
  scope_type: 'customer_sku' | 'customer_level' | 'global';
  customer_id?: string | null;
  product_id?: string | null;
  customer_level?: string | null;
  effective_from: string;
  effective_to?: string | null;
  status?: string;
  remark?: string | null;
  tiers: PriceTierInput[];
}

export interface PriceStrategyView {
  id: string;
  scope_type: string;
  customer_id: string | null;
  customer_name: string | null;
  product_id: string | null;
  product_name: string | null;
  product_sku: string | null;
  customer_level: string | null;
  effective_from: string;
  effective_to: string | null;
  status: string;
  remark: string | null;
  created_by_name: string | null;
  created_at: string;
  tiers: PriceTierInput[];
}

export interface PriceResolveResult {
  hit: boolean;
  unit_price: number;
  strategy_id: string | null;
  scope_type: 'customer_sku' | 'customer_level' | 'global' | null;
  tier: { unit: string; min_qty: number; unit_price: number } | null;
  reason: string;
}

// ---------------------------------------------------------------------------
// 校验
// ---------------------------------------------------------------------------

const uuid = z.string().regex(/^[0-9a-fA-F-]{36}$/, 'ID 格式不正确');
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD');

const tierSchema = z.object({
  unit: z.string().min(1, '单位不能为空').max(16, '单位不能超过 16 字'),
  min_qty: z.number().positive('阶梯数量必须大于 0').max(9_999_999, '阶梯数量超出范围'),
  unit_price: z.number().min(0, '阶梯单价不能为负').max(99_999_999, '阶梯单价超出范围'),
});

export const priceStrategySchema = z
  .object({
    scope_type: z.enum(['customer_sku', 'customer_level', 'global'], { message: '作用对象不合法' }),
    customer_id: uuid.nullish(),
    product_id: uuid.nullish(),
    customer_level: z.enum(['normal', 'vip', 'strategic'], { message: '客户等级不合法' }).nullish(),
    effective_from: dateStr,
    effective_to: dateStr.nullish(),
    status: z.enum(['active', 'disabled']).optional(),
    remark: z.string().max(500, '备注不能超过 500 字').nullish(),
    tiers: z.array(tierSchema).min(1, '至少需要一行阶梯价').max(50, '阶梯行过多'),
  })
  .superRefine((v, ctx) => {
    if (v.scope_type === 'customer_sku') {
      if (!v.customer_id) ctx.addIssue({ code: 'custom', message: '客户+SKU 策略必须选择客户' });
      if (!v.product_id) ctx.addIssue({ code: 'custom', message: '客户+SKU 策略必须选择商品' });
      if (v.customer_level) ctx.addIssue({ code: 'custom', message: '客户+SKU 策略不能设置客户等级' });
    }
    if (v.scope_type === 'customer_level') {
      if (!v.customer_level) ctx.addIssue({ code: 'custom', message: '等级策略必须选择客户等级' });
      if (v.customer_id || v.product_id) ctx.addIssue({ code: 'custom', message: '等级策略不能指定客户或商品' });
    }
    if (v.scope_type === 'global' && (v.customer_id || v.product_id || v.customer_level)) {
      ctx.addIssue({ code: 'custom', message: '全局默认策略不能指定客户/商品/等级' });
    }
    if (v.effective_from && v.effective_to && v.effective_to < v.effective_from) {
      ctx.addIssue({ code: 'custom', message: '生效截止日不能早于开始日' });
    }
  });

// ---------------------------------------------------------------------------
// 序列化
// ---------------------------------------------------------------------------

interface StrategyRow {
  id: string;
  scope_type: string;
  customer_id: string | null;
  product_id: string | null;
  customer_level: string | null;
  effective_from: string;
  effective_to: string | null;
  status: string;
  remark: string | null;
  created_by: string | null;
  created_at: string;
}

function serialize(
  row: StrategyRow,
  extra: {
    customerName?: string | null;
    productName?: string | null;
    productSku?: string | null;
    creatorName?: string | null;
    tiers?: PriceTierInput[];
  } = {},
): PriceStrategyView {
  return {
    id: row.id,
    scope_type: row.scope_type,
    customer_id: row.customer_id,
    customer_name: extra.customerName ?? null,
    product_id: row.product_id,
    product_name: extra.productName ?? null,
    product_sku: extra.productSku ?? null,
    customer_level: row.customer_level,
    effective_from: row.effective_from,
    effective_to: row.effective_to,
    status: row.status,
    remark: row.remark,
    created_by_name: extra.creatorName ?? null,
    created_at: new Date(row.created_at).toISOString(),
    tiers: extra.tiers ?? [],
  };
}

async function fetchTiers(strategyIds: string[]): Promise<Map<string, PriceTierInput[]>> {
  const map = new Map<string, PriceTierInput[]>();
  if (strategyIds.length === 0) return map;
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('so_price_tiers')
    .select('strategy_id, unit, min_qty, unit_price')
    .in('strategy_id', strategyIds)
    .order('min_qty', { ascending: true });
  if (error) throwDbError(error, '查询阶梯价');
  for (const r of data ?? []) {
    const list = map.get(r.strategy_id as string) ?? [];
    list.push({ unit: r.unit as string, min_qty: Number(r.min_qty), unit_price: Number(r.unit_price) });
    map.set(r.strategy_id as string, list);
  }
  return map;
}

async function fetchNameMaps(rows: StrategyRow[]) {
  const supabase = getSupabaseClient();
  const customerIds = [...new Set(rows.map((r) => r.customer_id).filter((v): v is string => Boolean(v)))];
  const productIds = [...new Set(rows.map((r) => r.product_id).filter((v): v is string => Boolean(v)))];
  const userIds = [...new Set(rows.map((r) => r.created_by).filter((v): v is string => Boolean(v)))];
  const [customers, products, users] = await Promise.all([
    customerIds.length ? supabase.from('md_customers').select('id, name').in('id', customerIds) : Promise.resolve({ data: [], error: null }),
    productIds.length ? supabase.from('md_products').select('id, name, sku_code').in('id', productIds) : Promise.resolve({ data: [], error: null }),
    userIds.length ? supabase.from('sys_users').select('id, username, display_name').in('id', userIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (customers.error) throwDbError(customers.error, '查询客户');
  if (products.error) throwDbError(products.error, '查询商品');
  if (users.error) throwDbError(users.error, '查询用户');
  return {
    customerNames: new Map((customers.data ?? []).map((r) => [r.id as string, r.name as string])),
    products: new Map((products.data ?? []).map((r) => [r.id as string, { name: r.name as string, sku: r.sku_code as string }])),
    userNames: new Map(
      (users.data ?? []).map((r) => [r.id as string, ((r.display_name as string | null) ?? (r.username as string)) as string]),
    ),
  };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function listPriceStrategies(
  q: ListQuery & { scope_type?: string; status?: string },
): Promise<PagedResult<PriceStrategyView>> {
  const supabase = getSupabaseClient();
  let builder = supabase.from('so_price_strategies').select('*', { count: 'exact' });
  if (q.scope_type) builder = builder.eq('scope_type', q.scope_type);
  if (q.status) builder = builder.eq('status', q.status);
  if (q.keyword) {
    const kw = escapeOrKeyword(q.keyword);
    if (kw) builder = builder.or(`remark.ilike.%${kw}%`);
  }
  const from = (q.page - 1) * q.pageSize;
  const { data, error, count } = await builder
    .order('created_at', { ascending: false })
    .range(from, from + q.pageSize - 1);
  if (error) throwDbError(error, '查询价格策略');
  const rows = (data ?? []) as unknown as StrategyRow[];
  const [tiers, names] = await Promise.all([fetchTiers(rows.map((r) => r.id)), fetchNameMaps(rows)]);
  return {
    items: rows.map((r) =>
      serialize(r, {
        customerName: r.customer_id ? (names.customerNames.get(r.customer_id) ?? null) : null,
        productName: r.product_id ? (names.products.get(r.product_id)?.name ?? null) : null,
        productSku: r.product_id ? (names.products.get(r.product_id)?.sku ?? null) : null,
        creatorName: r.created_by ? (names.userNames.get(r.created_by) ?? null) : null,
        tiers: tiers.get(r.id) ?? [],
      }),
    ),
    total: count ?? 0,
    page: q.page,
    page_size: q.pageSize,
  };
}

export async function getPriceStrategy(id: string): Promise<PriceStrategyView> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('so_price_strategies').select('*').eq('id', id).maybeSingle();
  if (error) throwDbError(error, '查询价格策略');
  if (!data) throw new ApiError(404, 'SO.PRICE_NOT_FOUND', '价格策略不存在');
  const row = data as unknown as StrategyRow;
  const [tiers, names] = await Promise.all([fetchTiers([row.id]), fetchNameMaps([row])]);
  return serialize(row, {
    customerName: row.customer_id ? (names.customerNames.get(row.customer_id) ?? null) : null,
    productName: row.product_id ? (names.products.get(row.product_id)?.name ?? null) : null,
    productSku: row.product_id ? (names.products.get(row.product_id)?.sku ?? null) : null,
    creatorName: row.created_by ? (names.userNames.get(row.created_by) ?? null) : null,
    tiers: tiers.get(row.id) ?? [],
  });
}

function insertPayload(input: PriceStrategyInput, userId: string) {
  return {
    scope_type: input.scope_type,
    customer_id: input.scope_type === 'customer_sku' ? (input.customer_id ?? null) : null,
    product_id: input.scope_type === 'customer_sku' ? (input.product_id ?? null) : null,
    customer_level: input.scope_type === 'customer_level' ? (input.customer_level ?? null) : null,
    effective_from: input.effective_from,
    effective_to: input.effective_to ?? null,
    status: input.status ?? 'active',
    remark: input.remark?.trim() || null,
    created_by: userId,
  };
}

export async function createPriceStrategy(input: PriceStrategyInput, userId: string): Promise<PriceStrategyView> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('so_price_strategies').insert(insertPayload(input, userId)).select('id').single();
  if (error) throwDbError(error, '创建价格策略');
  const id = (data as { id: string }).id;
  const { error: tErr } = await supabase.from('so_price_tiers').insert(
    input.tiers.map((t) => ({ strategy_id: id, unit: t.unit.trim(), min_qty: t.min_qty, unit_price: t.unit_price })),
  );
  if (tErr) {
    await supabase.from('so_price_strategies').delete().eq('id', id);
    throwDbError(tErr, '保存阶梯价');
  }
  return getPriceStrategy(id);
}

export async function updatePriceStrategy(id: string, input: PriceStrategyInput): Promise<PriceStrategyView> {
  await getPriceStrategy(id);
  const supabase = getSupabaseClient();
  const payload = insertPayload(input, '');
  delete (payload as { created_by?: string }).created_by;
  const { error } = await supabase
    .from('so_price_strategies')
    .update({ ...payload, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throwDbError(error, '更新价格策略');
  const { error: delErr } = await supabase.from('so_price_tiers').delete().eq('strategy_id', id);
  if (delErr) throwDbError(delErr, '更新阶梯价');
  const { error: tErr } = await supabase.from('so_price_tiers').insert(
    input.tiers.map((t) => ({ strategy_id: id, unit: t.unit.trim(), min_qty: t.min_qty, unit_price: t.unit_price })),
  );
  if (tErr) throwDbError(tErr, '更新阶梯价');
  return getPriceStrategy(id);
}

export async function deletePriceStrategy(id: string): Promise<void> {
  await getPriceStrategy(id);
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('so_price_strategies').delete().eq('id', id);
  if (error) throwDbError(error, '删除价格策略');
}

// ---------------------------------------------------------------------------
// 取价（三档取优 + 阶梯匹配）
// ---------------------------------------------------------------------------

/**
 * 价格试算：
 * 1. 取客户等级；
 * 2. 按优先级 customer_sku > customer_level > global 筛选 active 且生效期内的策略；
 * 3. 同级取 effective_from 最新的一条；
 * 4. 在该策略阶梯中，单位与商品单位一致的行里：取 min_qty <= qty 的最高档；
 *    无满足档则取该单位最低档兜底；该单位无阶梯行则视为未命中，继续下一优先级。
 */
export async function resolvePrice(customerId: string, productId: string, qty: number): Promise<PriceResolveResult> {
  if (!Number.isFinite(qty) || qty <= 0) throw new ApiError(400, 'SO.PRICE_BAD_QTY', '数量必须大于 0');
  const supabase = getSupabaseClient();

  const [{ data: customer, error: cErr }, { data: product, error: pErr }] = await Promise.all([
    supabase.from('md_customers').select('id, level').eq('id', customerId).maybeSingle(),
    supabase.from('md_products').select('id, unit, reference_sale_price').eq('id', productId).maybeSingle(),
  ]);
  if (cErr) throwDbError(cErr, '查询客户');
  if (pErr) throwDbError(pErr, '查询商品');
  if (!customer) throw new ApiError(404, 'SO.CUSTOMER_NOT_FOUND', '客户不存在');
  if (!product) throw new ApiError(404, 'SO.PRODUCT_NOT_FOUND', '商品不存在');

  const level = (customer.level as string | null) ?? 'normal';
  const productUnit = ((product.unit as string | null) ?? '片').trim();
  const today = new Date().toISOString().slice(0, 10);

  const scopes: Array<{ scope: 'customer_sku' | 'customer_level' | 'global'; apply: (b: unknown) => unknown }> = [
    {
      scope: 'customer_sku',
      apply: (b) =>
        (b as ReturnType<typeof baseQuery>)
          .eq('scope_type', 'customer_sku')
          .eq('customer_id', customerId)
          .eq('product_id', productId),
    },
    {
      scope: 'customer_level',
      apply: (b) => (b as ReturnType<typeof baseQuery>).eq('scope_type', 'customer_level').eq('customer_level', level),
    },
    { scope: 'global', apply: (b) => (b as ReturnType<typeof baseQuery>).eq('scope_type', 'global') },
  ];
  function baseQuery() {
    return supabase
      .from('so_price_strategies')
      .select('id, scope_type, effective_from')
      .eq('status', 'active')
      .lte('effective_from', today)
      .or(`effective_to.is.null,effective_to.gte.${today}`)
      .order('effective_from', { ascending: false })
      .limit(1);
  }

  for (const { scope, apply } of scopes) {
    const { data, error } = (await apply(baseQuery())) as { data: Array<{ id: string }> | null; error: unknown };
    if (error) throwDbError(error as { message: string }, '查询价格策略');
    const strategy = data?.[0];
    if (!strategy) continue;

    const { data: tiers, error: tErr } = await supabase
      .from('so_price_tiers')
      .select('unit, min_qty, unit_price')
      .eq('strategy_id', strategy.id)
      .eq('unit', productUnit)
      .order('min_qty', { ascending: true });
    if (tErr) throwDbError(tErr, '查询阶梯价');
    const rows = (tiers ?? []) as Array<{ unit: string; min_qty: string; unit_price: string }>;
    if (rows.length === 0) continue; // 该策略无此商品单位的阶梯 → 落到下一优先级

    const satisfied = rows.filter((r) => Number(r.min_qty) <= qty);
    // 满足数量的档中取最低档价（价格最低者）；无满足档则取最低档（min_qty 最小）兜底
    const hit = satisfied.length > 0
      ? satisfied.reduce((a, b) => (Number(b.unit_price) < Number(a.unit_price) ? b : a))
      : rows[0];
    return {
      hit: true,
      unit_price: Number(hit.unit_price),
      strategy_id: strategy.id,
      scope_type: scope,
      tier: { unit: hit.unit, min_qty: Number(hit.min_qty), unit_price: Number(hit.unit_price) },
      reason:
        satisfied.length > 0
          ? `命中${scope === 'customer_sku' ? '客户+SKU 专属' : scope === 'customer_level' ? '客户等级' : '全局默认'}策略阶梯（≥${Number(hit.min_qty)}${hit.unit}）`
          : `命中策略但数量低于最低档，按最低档价`,
    };
  }

  // 兜底：商品参考售价（原 quote 逻辑基价）
  const base = Number(product.reference_sale_price ?? 0);
  return {
    hit: false,
    unit_price: base,
    strategy_id: null,
    scope_type: null,
    tier: null,
    reason: '无命中策略，回退商品参考售价',
  };
}

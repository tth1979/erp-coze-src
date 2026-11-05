#!/usr/bin/env python3
"""0023 销售闭环补全 冒烟测试
覆盖：价格策略三档取优（customer_sku > customer_level > global）/ 同级生效期最新 /
      阶梯按数量取档 / resolve 试算 API / 报价单 CRUD / 提交-接受-作废状态机 /
      报价转订单（quote_id 回写）/ 作废后不可转单 / 信用超限拦截 CREDIT.EXCEEDED /
      强制通过落审计 / 信用看板 / 权限（staff403/匿名401）
"""
import json
import os
import urllib.request
import urllib.error
import http.cookiejar
import uuid

BASE = os.environ.get('BASE_URL', 'http://localhost:5000')

passed = 0
failed = 0


def check(name, cond, extra=''):
    global passed, failed
    if cond:
        passed += 1
        print(f'PASS  {name}')
    else:
        failed += 1
        print(f'FAIL  {name} {extra}')


class Session:
    def __init__(self):
        self.cj = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cj))

    def req(self, method, path, body=None):
        url = BASE + path
        data = None
        headers = {'Content-Type': 'application/json'}
        if body is not None:
            data = json.dumps(body).encode()
        r = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            resp = self.opener.open(r, timeout=60)
            raw = resp.read().decode()
            ct = resp.headers.get('Content-Type', '')
            if 'json' in ct:
                return resp.status, json.loads(raw or '{}')
            return resp.status, {'raw': raw[:300]}
        except urllib.error.HTTPError as e:
            raw = e.read().decode()
            try:
                return e.code, json.loads(raw or '{}')
            except Exception:
                return e.code, {'raw': raw}
        except Exception as e:
            return 0, {'error': str(e)}

    def login(self, username, password):
        status, data = self.req('POST', '/api/auth/login', {
            'type': 'password', 'payload': {'username': username, 'password': password}})
        return status == 200 and 'user' in data


admin = Session()
check('admin 登录', admin.login('admin123', 'admin123'))
manager = Session()
check('manager 登录', manager.login('dev_manager@coze.dev', 'manager123456'))
staff = Session()
check('staff 登录', staff.login('dev_user@coze.dev', 'staff-smoke-123'))
anon = Session()

suffix = uuid.uuid4().hex[:6].upper()

# ---------- 基础资料准备 ----------
s, cus = admin.req('POST', '/api/md/customers', {
    'code': f'CUS-Q{suffix}', 'name': f'报价客户{suffix}', 'level': 'vip',
    'credit_limit': 10000, 'credit_days': 30})
check('创建 VIP 客户（信用额度 10000）', s == 201, f'got {s} {cus}')
customer_id = cus.get('id')

s, cus2 = admin.req('POST', '/api/md/customers', {
    'code': f'CUS-N{suffix}', 'name': f'普通客户{suffix}', 'level': 'normal'})
check('创建普通客户', s == 201, f'got {s} {cus2}')
customer2_id = cus2.get('id')

s, prod = admin.req('POST', '/api/md/products', {
    'sku_code': f'SKU-Q{suffix}', 'name': f'报价瓷砖{suffix}', 'unit': '片',
    'reference_cost_price': 50, 'reference_sale_price': 100})
check('创建商品（参考售价 100）', s == 201, f'got {s} {prod}')
product_id = prod.get('id')

s, prod2 = admin.req('POST', '/api/md/products', {
    'sku_code': f'SKU-Q2{suffix}', 'name': f'阶梯瓷砖{suffix}', 'unit': '箱',
    'reference_cost_price': 200, 'reference_sale_price': 300})
check('创建箱装商品（参考售价 300）', s == 201, f'got {s} {prod2}')
product2_id = prod2.get('id')

# ---------- 一、价格体系与阶梯取优 ----------
# 1) 全局策略 G1（生效 2020）：片≥1→90、箱≥10→85
s, g = admin.req('POST', '/api/sales/prices', {
    'scope_type': 'global', 'effective_from': '2020-01-01',
    'tiers': [{'unit': '片', 'min_qty': 1, 'unit_price': 90},
              {'unit': '箱', 'min_qty': 10, 'unit_price': 85}]})
check('创建全局价格策略 201', s == 201, f'got {s} {g}')
global_id = g.get('id')

# 2) 旧的全局策略 G0（生效期更早，片≥1→95）——同级应取最新的 G1
s, g0 = admin.req('POST', '/api/sales/prices', {
    'scope_type': 'global', 'effective_from': '2019-01-01',
    'tiers': [{'unit': '片', 'min_qty': 1, 'unit_price': 95}]})
check('创建更早生效的全局策略 201', s == 201, f'got {s} {g0}')

# 3) 客户等级策略：vip → 片≥1:80、箱≥1:80
s, lv = admin.req('POST', '/api/sales/prices', {
    'scope_type': 'customer_level', 'customer_level': 'vip',
    'effective_from': '2020-06-01',
    'tiers': [{'unit': '片', 'min_qty': 1, 'unit_price': 80},
              {'unit': '箱', 'min_qty': 1, 'unit_price': 80}]})
check('创建 VIP 等级价格策略 201', s == 201, f'got {s} {lv}')
level_id = lv.get('id')

# 4) 客户+SKU 专属策略：片≥1→70、片≥100→65
s, sp = admin.req('POST', '/api/sales/prices', {
    'scope_type': 'customer_sku', 'customer_id': customer_id, 'product_id': product_id,
    'effective_from': '2021-01-01',
    'tiers': [{'unit': '片', 'min_qty': 1, 'unit_price': 70},
              {'unit': '片', 'min_qty': 100, 'unit_price': 65}]})
check('创建客户+SKU 专属策略 201', s == 201, f'got {s} {sp}')
sku_id = sp.get('id')

# 5) 校验互斥约束：customer_sku 缺 product_id 应 400
s, bad = admin.req('POST', '/api/sales/prices', {
    'scope_type': 'customer_sku', 'customer_id': customer_id,
    'effective_from': '2021-01-01',
    'tiers': [{'unit': '片', 'min_qty': 1, 'unit_price': 60}]})
check('customer_sku 缺 product_id 拦截 400', s == 400, f'got {s} {bad}')

# resolve 试算
# (a) 普通客户 + 商品1 qty5：无等级/专属 → 全局 G1 片档 90
s, r = admin.req('GET', f'/api/sales/price/resolve?customer_id={customer2_id}&product_id={product_id}&quantity=5')
check('resolve 普通客户→全局 90', s == 200 and float(r.get('unit_price', 0)) == 90 and r.get('scope_type') == 'global',
      f'got {s} {r}')
# (b) VIP 客户 + 商品1 qty5：客户+SKU 专属 → 70
s, r = admin.req('GET', f'/api/sales/price/resolve?customer_id={customer_id}&product_id={product_id}&quantity=5')
check('resolve VIP+SKU→专属 70', s == 200 and float(r.get('unit_price', 0)) == 70 and r.get('scope_type') == 'customer_sku',
      f'got {s} {r}')
# (c) VIP 客户 + 商品1 qty150：满足 100 片档 → 取满足数量的最低档价 65
s, r = admin.req('GET', f'/api/sales/price/resolve?customer_id={customer_id}&product_id={product_id}&quantity=150')
check('resolve 满足阶梯→最低档价 65', s == 200 and float(r.get('unit_price', 0)) == 65, f'got {s} {r}')
# (d) VIP 客户 + 商品2（箱）qty5：无专属 → 等级策略箱档 80
s, r = admin.req('GET', f'/api/sales/price/resolve?customer_id={customer_id}&product_id={product2_id}&quantity=5')
check('resolve VIP 无专属→等级 80', s == 200 and float(r.get('unit_price', 0)) == 80 and r.get('scope_type') == 'customer_level',
      f'got {s} {r}')
# (e) 普通客户 + 商品2（箱）qty20：全局箱档≥10 → 85
s, r = admin.req('GET', f'/api/sales/price/resolve?customer_id={customer2_id}&product_id={product2_id}&quantity=20')
check('resolve 普通+箱20→全局箱档 85', s == 200 and float(r.get('unit_price', 0)) == 85, f'got {s} {r}')
# (f) 普通客户 + 商品2（箱）qty5：全局箱档≥10 不满足 → 最低档兜底 85
s, r = admin.req('GET', f'/api/sales/price/resolve?customer_id={customer2_id}&product_id={product2_id}&quantity=5')
check('resolve 低于最低档→兜底 85', s == 200 and float(r.get('unit_price', 0)) == 85, f'got {s} {r}')
# (g) 无策略商品回退参考售价
s, prod3 = admin.req('POST', '/api/md/products', {
    'sku_code': f'SKU-Q3{suffix}', 'name': f'无策略商品{suffix}', 'unit': '㎡',
    'reference_sale_price': 55})
product3_id = prod3.get('id')
s, r = admin.req('GET', f'/api/sales/price/resolve?customer_id={customer2_id}&product_id={product3_id}&quantity=1')
check('resolve 无策略→参考售价 55', s == 200 and float(r.get('unit_price', 0)) == 55 and r.get('hit') == False,
      f'got {s} {r}')

# 策略列表与删除
s, lst = admin.req('GET', f'/api/sales/prices?keyword=SKU-Q')
check('策略列表 keyword 过滤', s == 200, f'got {s}')
s, d = admin.req('DELETE', f'/api/sales/prices/{g0.get("id")}')
check('删除旧全局策略 200', s == 200, f'got {s} {d}')

# ---------- 二、报价单 ----------
quote_body = {
    'customer_id': customer_id,
    'quote_date': '2026-01-10',
    'valid_until': '2026-12-31',
    'remark': '冒烟报价',
    'items': [
        {'product_id': product_id, 'quantity': 10, 'unit_price': 70, 'discount_rate': 100, 'tax_rate': 13, 'color_code': ''},
        {'product_id': product2_id, 'quantity': 5, 'unit_price': 80, 'discount_rate': 50, 'tax_rate': 13, 'color_code': ''},
    ],
}
s, q = admin.req('POST', '/api/sales/quotes', quote_body)
# 金额 = 10*70*1 + 5*80*0.5 = 700 + 200 = 900
check('创建报价单 201', s == 201, f'got {s} {q}')
quote_id = q.get('id')
check('报价金额服务端重算=900', abs(float(q.get('total_amount', 0)) - 900) < 0.01, f'got {q.get("total_amount")}')
check('报价单号 QO 前缀', str(q.get('quote_no', '')).startswith('QO'), f'got {q.get("quote_no")}')

# 明细行增删改（draft 可编辑）
s, q2 = admin.req('PUT', f'/api/sales/quotes/{quote_id}', {
    'customer_id': customer_id, 'quote_date': '2026-01-10', 'valid_until': '2026-12-31',
    'remark': '冒烟报价v2',
    'items': [
        {'product_id': product_id, 'quantity': 20, 'unit_price': 70, 'discount_rate': 100, 'tax_rate': 13, 'color_code': ''},
    ]})
check('编辑报价单（减行）200', s == 200 and len(q2.get('items', [])) == 1, f'got {s} {q2}')
check('编辑后金额=1400', abs(float(q2.get('total_amount', 0)) - 1400) < 0.01, f'got {q2.get("total_amount")}')

# 提交 → sent
s, r = admin.req('POST', f'/api/sales/quotes/{quote_id}/submit')
check('报价单提交→sent', s == 200 and r.get('status') == 'sent', f'got {s} {r}')

# sent 状态不可编辑
s, r = admin.req('PUT', f'/api/sales/quotes/{quote_id}', quote_body)
check('sent 状态禁编辑 400', s == 400, f'got {s} {r}')

# 接受 → accepted
s, r = admin.req('POST', f'/api/sales/quotes/{quote_id}/accept')
check('报价单接受→accepted', s == 200 and r.get('status') == 'accepted', f'got {s} {r}')

# ---------- 三、报价转订单 + 信用校验 ----------
# 当前客户额度 10000，报价 1400，无占用 → 正常转单
s, r = admin.req('POST', f'/api/sales/quotes/{quote_id}/convert', {})
check('报价转订单 200', s == 200, f'got {s} {r}')
check('报价状态→converted', r.get('status') == 'converted', f'got {r.get("status")}')
converted_order_id = r.get('converted_order_id')
check('回写 converted_order_id', bool(converted_order_id), f'got {r}')

# 订单回写 quote_id
s, od = admin.req('GET', f'/api/so/orders/{converted_order_id}')
check('订单回写 quote_id', s == 200 and od.get('quote_id') == quote_id, f'got {s} quote_id={od.get("quote_id")}')
check('订单为 draft', od.get('status') == 'draft', f'got {od.get("status")}')
check('订单明细带色号字段', 'color_code' in (od.get('items') or [{}])[0], f'got {od.get("items")}')

# 重复转单拦截
s, r = admin.req('POST', f'/api/sales/quotes/{quote_id}/convert', {})
check('重复转单拦截 400', s == 400, f'got {s} {r}')

# 作废后不可转单
s, qv = admin.req('POST', '/api/sales/quotes', {
    'customer_id': customer_id, 'quote_date': '2026-01-10', 'valid_until': '2026-06-30',
    'items': [{'product_id': product_id, 'quantity': 1, 'unit_price': 70, 'discount_rate': 100, 'tax_rate': 13}]})
void_quote_id = qv.get('id')
admin.req('POST', f'/api/sales/quotes/{void_quote_id}/submit')
s, r = admin.req('POST', f'/api/sales/quotes/{void_quote_id}/void', {'reason': '客户取消'})
check('作废报价单 200', s == 200 and r.get('status') == 'void', f'got {s} {r}')
s, r = admin.req('POST', f'/api/sales/quotes/{void_quote_id}/convert', {})
check('作废后不可转单 400 SO.QUOTE_VOID', s == 400 and r.get('code') == 'SO.QUOTE_VOID', f'got {s} {r}')

# draft 状态不可转单（须先提交）
s, qd = admin.req('POST', '/api/sales/quotes', {
    'customer_id': customer_id, 'quote_date': '2026-01-10', 'valid_until': '2026-06-30',
    'items': [{'product_id': product_id, 'quantity': 1, 'unit_price': 70, 'discount_rate': 100, 'tax_rate': 13}]})
draft_quote_id = qd.get('id')
s, r = admin.req('POST', f'/api/sales/quotes/{draft_quote_id}/convert', {})
check('draft 不可转单 400', s == 400, f'got {s} {r}')

# ---------- 四、信用超限拦截与强制通过 ----------
# 把客户额度调低到 1000：报价转订单 1400 应超限
s, _ = admin.req('PUT', f'/api/md/customers/{customer_id}', {'name': f'报价客户{suffix}', 'level': 'vip',
                                                              'credit_limit': 1000, 'credit_days': 30})
check('调整信用额度 1000', s == 200, f'got {s}')

# 新报价 1400 → 转单超限
s, qb = admin.req('POST', '/api/sales/quotes', {
    'customer_id': customer_id, 'quote_date': '2026-01-10', 'valid_until': '2026-12-31',
    'items': [{'product_id': product_id, 'quantity': 20, 'unit_price': 70, 'discount_rate': 100, 'tax_rate': 13}]})
big_quote_id = qb.get('id')
admin.req('POST', f'/api/sales/quotes/{big_quote_id}/submit')
s, r = admin.req('POST', f'/api/sales/quotes/{big_quote_id}/convert', {})
check('转单超限拦截 CREDIT.EXCEEDED', s == 400 and r.get('code') == 'CREDIT.EXCEEDED', f'got {s} {r}')

# staff 无 so.approve 权限，强制通过也应被拒（403）
s, r = staff.req('POST', f'/api/sales/quotes/{big_quote_id}/convert', {'force_reason': '特批'})
check('staff 强制通过被拒 403', s == 403, f'got {s} {r}')

# manager 有 so.approve，可强制通过（落审计）
s, r = manager.req('POST', f'/api/sales/quotes/{big_quote_id}/convert', {'force': True, 'reason': '老客户特批放单'})
check('manager 强制通过转单 200', s == 200 and r.get('status') == 'converted', f'got {s} {r}')

# 审计日志有 credit.override
s, logs = admin.req('GET', '/api/system/audit-logs?action=credit.override&pageSize=5')
found_override = any(l.get('action') == 'credit.override' for l in logs.get('items', []))
check('审计日志 credit.override 落库', s == 200 and found_override, f'got {s} {logs.get("items", [])[:1]}')

# 销售订单提交确认同样校验信用：订单 1400（已占用 1400）+ 新订单提交
# 把转换出的大订单删掉避免干扰，直接用 converted_order_id（1400 draft，不占额度——draft 不计占用）
# 提交 converted 的大订单（1400）：已用=0（draft不占），提交时校验 1400 ≤ 1000? 是超限 → 拦截
big_order_id = None
s, lst = admin.req('GET', f'/api/so/orders?keyword=&pageSize=50')
# 从报价 converted_order_id 拿
s, qv2 = admin.req('GET', f'/api/sales/quotes/{big_quote_id}')
big_order_id = qv2.get('converted_order_id')
check('获取强制转出的订单 id', bool(big_order_id), f'got {qv2}')
s, r = manager.req('POST', f'/api/so/orders/{big_order_id}/submit', {})
check('订单提交超限拦截 CREDIT.EXCEEDED', s == 400 and r.get('code') == 'CREDIT.EXCEEDED', f'got {s} {r}')

# 强制通过提交
s, r = manager.req('POST', f'/api/so/orders/{big_order_id}/submit', {'force': True, 'reason': '信用特批提交'})
check('订单强制通过提交 200', s == 200 and r.get('status') == 'pending', f'got {s} {r}')

# 审批通过 → approved（计入在途占用 1400 > 额度 1000）
s, r = manager.req('POST', f'/api/so/orders/{big_order_id}/approve', {})
check('订单审批通过→approved（计入占用）', s == 200 and r.get('status') in ('approved', 'pending'), f'got {s} {r}')
# 多级审批场景循环审批至 approved
for _ in range(4):
    if r.get('status') == 'approved':
        break
    s, r = manager.req('POST', f'/api/so/orders/{big_order_id}/approve', {})
check('订单终审通过→approved', r.get('status') == 'approved', f'got {r.get("status")}')

# ---------- 五、信用看板 ----------
from urllib.parse import quote as urlquote
s, board = admin.req('GET', f'/api/sales/credit?keyword={urlquote(f"报价客户{suffix}")}')
rows = board.get('items', [])
row = rows[0] if rows else None
check('信用看板返回客户行', s == 200 and row is not None, f'got {s} {board}')
if row:
    check('看板额度=1000', abs(float(row.get('credit_limit', 0)) - 1000) < 0.01, f'got {row.get("credit_limit")}')
    check('看板可用额度为负（超用）', float(row.get('available', 0)) < 0, f'got {row.get("available")}')
    check('看板状态红/黄（超用或高使用率）', row.get('status') in ('red', 'yellow'), f'got {row.get("status")}')

# 下钻应收明细
s, detail = admin.req('GET', f'/api/sales/credit/{customer_id}')
check('信用下钻明细 200', s == 200 and 'bills' in detail, f'got {s}')

# ---------- 六、列表筛选 + 导出 ----------
s, lst = admin.req('GET', f'/api/sales/quotes?status=void&keyword=QO')
check('报价列表 status=void 筛选', s == 200 and all(q.get('status') == 'void' for q in lst.get('items', [])),
      f'got {s}')
s, lst = admin.req('GET', f'/api/sales/quotes?customer_id={customer_id}')
check('报价列表 customer_id 筛选', s == 200 and all(q.get('customer_id') == customer_id for q in lst.get('items', [])),
      f'got {s}')
s, csv = admin.req('GET', '/api/sales/quotes/export?status=converted')
check('报价导出 CSV', s == 200 and 'quote_no' in csv.get('raw', ''), f'got {s} {csv.get("raw", "")[:80]}')

# ---------- 七、权限 ----------
s, r = anon.req('GET', '/api/sales/quotes')
check('匿名访问报价 401', s == 401, f'got {s}')
s, r = anon.req('GET', '/api/sales/credit')
check('匿名信用看板 401', s == 401, f'got {s}')
s, r = anon.req('GET', f'/api/sales/price/resolve?customer_id={customer_id}&product_id={product_id}')
check('匿名取价 401', s == 401, f'got {s}')
s, r = staff.req('POST', '/api/sales/quotes', quote_body)
check('staff 创建报价 403', s == 403, f'got {s} {r}')
s, r = staff.req('POST', '/api/sales/prices', {'scope_type': 'global', 'effective_from': '2020-01-01',
                                               'tiers': [{'unit': '片', 'min_qty': 1, 'unit_price': 1}]})
check('staff 创建价格策略 403', s == 403, f'got {s} {r}')
s, r = staff.req('GET', '/api/sales/quotes')
check('staff 读报价列表 200', s == 200, f'got {s}')
s, r = staff.req('GET', '/api/sales/credit')
check('staff 读信用看板 200', s == 200, f'got {s}')

# ---------- 页面探活 ----------
for path, label in [('/sales/quotes', '报价单列表页'), ('/sales/prices', '价格策略页'), ('/sales/credit', '信用看板页')]:
    s, r = admin.req('GET', path)
    check(f'页面探活 {label}', s == 200, f'got {s}')

print(f'\n=== 结果: {passed} passed, {failed} failed ===')
exit(1 if failed > 0 else 0)

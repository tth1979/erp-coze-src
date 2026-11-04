#!/usr/bin/env python3
"""0022 色号全链路贯通 冒烟测试
覆盖：商品色号档案 CRUD / 采购带色号入库 / 销售带色号出库 / 按色号查库存与成本 /
      色号不串 / 存量兼容（默认色）/ 权限（staff403/匿名401）/ 页面探活
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
            return resp.status, {'raw': raw[:200]}
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
staff = Session()
check('staff 登录', staff.login('dev_user@coze.dev', 'staff-smoke-123'))
anon = Session()

suffix = uuid.uuid4().hex[:6].upper()
RED = f'R{suffix}'
GRAY = f'G{suffix}'

# ---------- 基础资料准备 ----------
s, sup = admin.req('POST', '/api/md/suppliers', {'code': f'SUP-C{suffix}', 'name': f'色号供应商{suffix}'})
check('创建供应商 201', s == 201, f'got {s} {sup}')
supplier_id = sup.get('id')

s, cus = admin.req('POST', '/api/md/customers', {'code': f'CUS-C{suffix}', 'name': f'色号客户{suffix}'})
check('创建客户 201', s == 201, f'got {s} {cus}')
customer_id = cus.get('id')

s, prod = admin.req('POST', '/api/md/products', {
    'sku_code': f'TILE-C{suffix}', 'name': f'色号测试砖{suffix}', 'unit': '片',
    'spec': '800x800', 'tax_rate': 13})
check('创建商品 201', s == 201, f'got {s} {prod}')
pid = prod.get('id')

# ---------- 一、商品色号档案 ----------
s, red = admin.req('POST', '/api/md/colors', {
    'product_id': pid, 'color_code': RED, 'color_name': '中国红'})
check('新增色号红 201', s == 201 and red.get('color_code') == RED, f'got {s} {red}')
red_id = red.get('id')

s, gray = admin.req('POST', '/api/md/colors', {
    'product_id': pid, 'color_code': GRAY, 'color_name': '高级灰'})
check('新增色号灰 201', s == 201, f'got {s} {gray}')
gray_id = gray.get('id')

s, dup = admin.req('POST', '/api/md/colors', {
    'product_id': pid, 'color_code': RED, 'color_name': '重复红'})
check('重复色号 409', s == 409, f'got {s} {dup}')

s, lst = admin.req('GET', f'/api/md/colors?product_id={pid}')
check('色号列表含两条', s == 200 and len(lst.get('items', [])) == 2, f'got {s} {lst}')
check('列表含库存关联量字段', all('stock_quantity' in it for it in lst.get('items', [])))

s, upd = admin.req('PUT', f'/api/md/colors/{red_id}', {'color_name': '正红'})
check('更新色号名称 200', s == 200 and upd.get('color_name') == '正红', f'got {s} {upd}')

# 临时色号用完即删（验证删除路径）
s, tmp = admin.req('POST', '/api/md/colors', {
    'product_id': pid, 'color_code': f'T{suffix}', 'color_name': '临时色'})
tmp_id = tmp.get('id')
s, dele = admin.req('DELETE', f'/api/md/colors/{tmp_id}')
check('删除未引用色号 200', s == 200, f'got {s} {dele}')

# ---------- 二、采购带色号入库（不同色号不同价 → 成本不串） ----------
PRICE_RED, PRICE_GRAY = 10.0, 20.0
s, po = admin.req('POST', '/api/po/orders', {
    'supplier_id': supplier_id,
    'items': [
        {'product_id': pid, 'quantity': 100, 'unit_price': PRICE_RED, 'color_code': RED},
        {'product_id': pid, 'quantity': 50, 'unit_price': PRICE_GRAY, 'color_code': GRAY},
    ]})
check('采购订单带色号 201', s == 201, f'got {s} {po}')
po_id = po.get('id')

s, pod = admin.req('GET', f'/api/po/orders/{po_id}')
items = pod.get('items', [])
check('订单明细回显色号', s == 200 and {i.get('color_code') for i in items} == {RED, GRAY},
      f'got {s} {items}')
check('订单明细回显色号名称快照', all(i.get('color_name') for i in items))

# 同型号同色号重复行拦截
s, dup_line = admin.req('POST', '/api/po/orders', {
    'supplier_id': supplier_id,
    'items': [
        {'product_id': pid, 'quantity': 1, 'unit_price': 1, 'color_code': RED},
        {'product_id': pid, 'quantity': 2, 'unit_price': 1, 'color_code': RED},
    ]})
check('同色号重复行 400', s == 400, f'got {s} {dup_line}')

# 档案外色号拦截
s, bad_color = admin.req('POST', '/api/po/orders', {
    'supplier_id': supplier_id,
    'items': [{'product_id': pid, 'quantity': 1, 'unit_price': 1, 'color_code': 'NOTEXIST'}]})
check('档案外色号 400', s == 400, f'got {s} {bad_color}')

s, sub = admin.req('POST', f'/api/po/orders/{po_id}/submit')
check('采购订单提交 200', s == 200, f'got {s} {sub}')
s, ap = admin.req('POST', f'/api/po/orders/{po_id}/approve')
check('采购订单审批 200', s == 200, f'got {s} {ap}')
s, comp = admin.req('POST', f'/api/po/orders/{po_id}/complete')
check('一键入库 200', s == 200, f'got {s} {comp}')

# ---------- 三、按色号查库存与成本 ----------
def num(v):
    return float(v) if v is not None else 0.0


def stock_of(color):
    s, r = admin.req('GET', f'/api/inv/stock?keyword=TILE-C{suffix}&color_code={color}&pageSize=10')
    rows = [i for i in r.get('items', []) if i.get('product_id') == pid]
    return (s, r) if not rows else (s, rows[0])


s, row = stock_of(RED)
check('色号红库存=100', s == 200 and num(row.get('quantity')) == 100, f'got {s} {row}')
check('色号红均价=10 不串灰', abs(num(row.get('avg_cost')) - PRICE_RED) < 0.001, f"got {row.get('avg_cost')}")
s, row = stock_of(GRAY)
check('色号灰库存=50', s == 200 and num(row.get('quantity')) == 50, f'got {s} {row}')
check('色号灰均价=20 不串红', abs(num(row.get('avg_cost')) - PRICE_GRAY) < 0.001, f"got {row.get('avg_cost')}")

# 色号筛选只回该色号行
s, r = admin.req('GET', f'/api/inv/stock?keyword=TILE-C{suffix}&color_code={RED}&pageSize=10')
check('色号筛选结果全部命中', s == 200 and all(i.get('color_code') == RED for i in r.get('items', [])),
      f'got {s}')

# 批次按色号分列
s, bat = admin.req('GET', f'/api/inv/batches?keyword=TILE-C{suffix}&pageSize=20')
bcolors = {b.get('color_code') for b in bat.get('items', []) if b.get('product_id') == pid}
check('批次分红/灰两色', RED in bcolors and GRAY in bcolors, f'got {bcolors}')

# 色号有库存禁删
s, del_red = admin.req('DELETE', f'/api/md/colors/{red_id}')
check('有库存色号禁删 400', s == 400, f'got {s} {del_red}')

# ---------- 四、销售带色号出库（只扣红色，灰色不动） ----------
s, so = admin.req('POST', '/api/so/orders', {
    'customer_id': customer_id,
    'items': [{'product_id': pid, 'quantity': 30, 'unit_price': 15.0, 'color_code': RED}]})
check('销售订单带色号 201', s == 201, f'got {s} {so}')
so_id = so.get('id')
s, sub = admin.req('POST', f'/api/so/orders/{so_id}/submit')
check('销售订单提交 200', s == 200, f'got {s} {sub}')
s, ap = admin.req('POST', f'/api/so/orders/{so_id}/approve')
check('销售订单审批 200', s == 200, f'got {s} {ap}')
s, comp = admin.req('POST', f'/api/so/orders/{so_id}/complete')
check('一键出库 200', s == 200, f'got {s} {comp}')

s, row = stock_of(RED)
check('出库后红库存=70', s == 200 and num(row.get('quantity')) == 70, f'got {s} {row}')
check('出库后红均价仍=10', abs(num(row.get('avg_cost')) - PRICE_RED) < 0.001, f"got {row.get('avg_cost')}")
s, row = stock_of(GRAY)
check('灰色库存不受红色出库影响=50', s == 200 and num(row.get('quantity')) == 50, f'got {s} {row}')
check('灰色均价仍=20', abs(num(row.get('avg_cost')) - PRICE_GRAY) < 0.001, f"got {row.get('avg_cost')}")

# 台账带色号
s, mv = admin.req('GET', f'/api/inv/movements?keyword=TILE-C{suffix}&pageSize=50')
mcolors = {m.get('color_code') for m in mv.get('items', []) if m.get('product_id') == pid}
check('台账含红/灰色号流水', RED in mcolors and GRAY in mcolors, f'got {mcolors}')

# ---------- 五、存量兼容（默认色空串） ----------
s, po2 = admin.req('POST', '/api/po/orders', {
    'supplier_id': supplier_id,
    'items': [{'product_id': pid, 'quantity': 5, 'unit_price': 8.0}]})
check('不填色号下单 201（存量兼容）', s == 201, f'got {s} {po2}')
po2_id = po2.get('id')
s, sub = admin.req('POST', f'/api/po/orders/{po2_id}/submit')
s, ap = admin.req('POST', f'/api/po/orders/{po2_id}/approve')
s, comp = admin.req('POST', f'/api/po/orders/{po2_id}/complete')
check('默认色一键入库 200', s == 200, f'got {s} {comp}')

s, r = admin.req('GET', f'/api/inv/stock?keyword=TILE-C{suffix}&pageSize=20')
def_row = [i for i in r.get('items', []) if i.get('product_id') == pid and not i.get('color_code')]
check('默认色库存行存在且数量=5', len(def_row) == 1 and num(def_row[0].get('quantity')) == 5,
      f'got {def_row}')

# ---------- 六、权限 ----------
s, _ = staff.req('POST', '/api/md/colors', {'product_id': pid, 'color_code': 'XX', 'color_name': 'x'})
check('staff 新增色号 403', s == 403, f'got {s}')
s, _ = staff.req('PUT', f'/api/md/colors/{gray_id}', {'color_name': 'x'})
check('staff 更新色号 403', s == 403, f'got {s}')
s, _ = staff.req('DELETE', f'/api/md/colors/{gray_id}')
check('staff 删除色号 403', s == 403, f'got {s}')
s, _ = anon.req('GET', f'/api/md/colors?product_id={pid}')
check('匿名读色号 401', s == 401, f'got {s}')

# ---------- 七、页面探活 ----------
for page in ['/master-data/products', '/inventory/stock', '/inventory/batches',
             '/inventory/movements', '/inventory/alerts',
             '/purchase/orders', '/sales/orders']:
    s, _ = admin.req('GET', page)
    check(f'页面 {page} 200', s == 200, f'got {s}')

# ---------- 收尾：一致性断言全绿（色号维度纳入断言） ----------
s, run = admin.req('POST', '/api/system/integrity/run', {'group': 'manual'})
check('触发一致性校验 200', s == 200, f'got {s}')
results = {r['key']: r for r in run.get('results', [])}
for key in ['quantity_state', 'batch_closure', 'ledger_conservation']:
    check(f'断言 {key} pass（含色号维度）', results.get(key, {}).get('result') == 'pass',
          f"got {results.get(key, {}).get('result')} {results.get(key, {}).get('failure_type')}")

print(f'\n{passed} passed, {failed} failed')
print('COLOR_CHAIN_SMOKE_OK' if failed == 0 else 'COLOR_CHAIN_SMOKE_FAIL')

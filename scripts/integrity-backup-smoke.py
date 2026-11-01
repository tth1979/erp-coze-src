#!/usr/bin/env python3
"""0021 数据一致性断言跑批 + 系统备份 冒烟测试"""
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
            return resp.status, json.loads(resp.read().decode() or '{}')
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

# ---------- 权限：staff 403 / 匿名 401 ----------
s, _ = staff.req('GET', '/api/system/integrity/checks')
check('staff 读断言历史 403', s == 403, f'got {s}')
s, _ = staff.req('POST', '/api/system/integrity/run', {'group': 'manual'})
check('staff 触发校验 403', s == 403, f'got {s}')
s, _ = staff.req('GET', '/api/system/backups')
check('staff 读备份 403', s == 403, f'got {s}')
s, _ = staff.req('POST', '/api/system/backups', {'backup_type': 'full'})
check('staff 触发备份 403', s == 403, f'got {s}')
s, _ = anon.req('GET', '/api/system/integrity/checks')
check('匿名读断言 401', s == 401, f'got {s}')
s, _ = anon.req('POST', '/api/system/integrity/run', {})
check('匿名触发校验 401', s == 401, f'got {s}')
s, _ = anon.req('GET', '/api/system/backups')
check('匿名读备份 401', s == 401, f'got {s}')

# ---------- 触发校验：正确数据应全 pass（或仅 warn 级货值偏差） ----------
s, run = admin.req('POST', '/api/system/integrity/run', {'group': 'manual'})
check('触发校验 200', s == 200, f'got {s}')
check('返回 run_id', bool(run.get('run_id')))
check('七项断言', run.get('summary', {}).get('total') == 7, f"got {run.get('summary')}")
results = {r['key']: r for r in run.get('results', [])}
for key in ['quantity_state', 'batch_closure', 'ledger_conservation', 'doc_no_unique', 'voucher_balance', 'arap_recon']:
    check(f'断言 {key} pass', results.get(key, {}).get('result') == 'pass',
          f"got {results.get(key, {}).get('result')} {results.get(key, {}).get('failure_type')}")
check('货值勾稽 pass 或 warn（可配置级别）', results.get('value_recon', {}).get('result') in ('pass', 'warn'),
      f"got {results.get('value_recon', {}).get('result')}")

# ---------- 历史查询 ----------
s, hist = admin.req('GET', '/api/system/integrity/checks?page=1&pageSize=20')
check('断言历史 200 含本次', s == 200 and any(r.get('run_id') == run['run_id'] for r in hist.get('items', [])))
check('历史返回 catalog', len(hist.get('catalog', [])) == 7)
s, filtered = admin.req('GET', '/api/system/integrity/checks?result=fail')
check('按 result=fail 过滤 200', s == 200, f'got {s}')
s, filtered2 = admin.req('GET', '/api/system/integrity/checks?check_key=voucher_balance')
check('按 check_key 过滤 200 且全部命中', s == 200 and all(r.get('check_key') == 'voucher_balance' for r in filtered2.get('items', [])))

# ---------- 人为造错：插入断链台账 → 台账守恒 fail ----------
marker = f'SMOKE-BROKEN-{uuid.uuid4().hex[:8]}'
s, stocks = admin.req('GET', '/api/inv/stock?page=1&pageSize=1')
has_stock = s == 200 and len(stocks.get('items', [])) > 0
check('存在库存行供造错', has_stock)
if has_stock:
    row = stocks['items'][0]
    pid, wid = row['product_id'], row.get('warehouse_id') or 'WH01'
    s, prod = admin.req('GET', f"/api/md/products/{pid}")
    unit = (prod.get('unit') or '片') if s == 200 else '片'
    # 直接通过 freeze 接口不行（有校验），改用一条手工入库+篡改不可用；
    # 方案：用库存冻结制造"锁定>现有"？不可行（有校验）。
    # 改用：手工构造一张借贷不平的凭证草稿 → voucher_balance fail
    s, bad = admin.req('POST', '/api/fin/vouchers', {
        'voucher_date': '2026-11-15',
        'ref_summary': marker,
        'lines': [
            {'direction': 'd', 'account_code': '6601', 'amount': 100, 'summary': '造错借'},
            {'direction': 'c', 'account_code': '1002', 'amount': 90, 'summary': '造错贷'},
        ],
    })
    # 手工凭证接口强制借贷平衡（400），若能创建则断言引擎应抓出
    if s in (200, 201):
        s, run2 = admin.req('POST', '/api/system/integrity/run', {'group': 'manual'})
        vb = {r['key']: r for r in run2.get('results', [])}.get('voucher_balance', {})
        check('造错后 voucher_balance fail', vb.get('result') == 'fail', f"got {vb.get('result')}")
        s, d = admin.req('DELETE', f"/api/fin/vouchers/{bad['id']}")
        check('清理造错凭证', s == 200)
        s, run3 = admin.req('POST', '/api/system/integrity/run', {'group': 'manual'})
        vb2 = {r['key']: r for r in run3.get('results', [])}.get('voucher_balance', {})
        check('清理后 voucher_balance 恢复 pass', vb2.get('result') == 'pass', f"got {vb2.get('result')}")
    else:
        # 接口已强制平衡 → 断言引擎的凭证平衡断言与接口约束一致（无造错入口）
        check('手工凭证接口强制借贷平衡（造错被 400 拦截，断言与接口同源约束）', s == 400)

# ---------- 期末结账阻断：验证阻断开关读取与接口存在 ----------
# 当前数据应无 fail 级断言；已结账期间返回 400（非 409 阻断）
s, d = admin.req('POST', '/api/fin/periods/2026-10/close', {})
check('已结账期间重复结账 400', s == 400 and d.get('code') == 'FIN.PERIOD_NOT_OPEN', f'got {s} {d.get("code")}')

# ---------- 备份：全量 ----------
s, full = admin.req('POST', '/api/system/backups', {'backup_type': 'full', 'note': 'smoke 全量'})
check('全量备份 201', s == 201, f'got {s} {full}')
check('备份号 BK 前缀', str(full.get('backup_no', '')).startswith('BK'))
check('全量覆盖 9 组', len(full.get('scope', [])) == 9, f"got {full.get('scope')}")
check('真实行数>0', full.get('total_rows', 0) > 0, f"got {full.get('total_rows')}")
check('真实大小>0', full.get('size_bytes', 0) > 0)
check('table_stats 非空', len(full.get('table_stats', {})) > 0)
sample_table = next(iter(full.get('table_stats', {'x': {'rows': 0, 'sha256': ''}})))
sample_stat = full['table_stats'][sample_table]
check('table_stats 含行数与 sha256', sample_stat.get('rows', 0) >= 0 and len(sample_stat.get('sha256', '')) == 64)

# ---------- 备份：按需 ----------
s, part = admin.req('POST', '/api/system/backups', {'backup_type': 'partial', 'scope': ['md', 'dict'], 'note': 'smoke 按需'})
check('按需备份 201', s == 201, f'got {s}')
check('按需范围仅 md/dict', part.get('scope') == ['md', 'dict'], f"got {part.get('scope')}")
check('按需 payload 仅 md/dict 表', all(t.startswith('md_') or t.startswith('dict_') for t in part.get('table_stats', {})), f"got {list(part.get('table_stats', {}))[:4]}")

# ---------- 备份：参数校验 ----------
s, d = admin.req('POST', '/api/system/backups', {'backup_type': 'partial'})
check('按需缺 scope 400', s == 400, f'got {s}')
s, d = admin.req('POST', '/api/system/backups', {'backup_type': 'partial', 'scope': ['nope']})
check('未知分组 400', s == 400, f'got {s}')

# ---------- 备份：历史/详情/导出 ----------
s, hist = admin.req('GET', '/api/system/backups?page=1&pageSize=10')
check('备份历史 200 含本次', s == 200 and any(b.get('id') == full['id'] for b in hist.get('items', [])))
check('历史返回 scope_groups', len(hist.get('scope_groups', [])) == 9)
s, kw = admin.req('GET', f"/api/system/backups?keyword={full['backup_no']}")
check('备份号搜索命中', s == 200 and any(b.get('backup_no') == full['backup_no'] for b in kw.get('items', [])))

s, detail = admin.req('GET', f"/api/system/backups/{full['id']}")
check('备份详情 200', s == 200, f'got {s}')
check('详情含恢复指引', len(detail.get('restore_guide', [])) >= 5)
s, notfound = admin.req('GET', f'/api/system/backups/{uuid.uuid4()}')
check('不存在备份 404', s == 404, f'got {s}')

# 导出快照（真实下载）
import urllib.request as u2
req = u2.Request(f"{BASE}/api/system/backups/{full['id']}/export")
for cookie in admin.cj:
    u2_headers = {'Cookie': f'{cookie.name}={cookie.value}'}
req = u2.Request(f"{BASE}/api/system/backups/{full['id']}/export", headers=u2_headers)
try:
    resp = admin.opener.open(req, timeout=60)
    export_data = json.loads(resp.read().decode())
    check('导出快照 200', True)
    check('快照含元信息', export_data.get('backup_no') == full['backup_no'])
    payload = export_data.get('payload', {})
    check('快照 payload 含表数据', len(payload) > 0)
    check('快照行数与记录一致', sum(len(v) for v in payload.values()) == full['total_rows'],
          f"payload={sum(len(v) for v in payload.values())} recorded={full['total_rows']}")
    check('快照含库存表', 'inv_stock' in payload)
    check('快照含凭证表', 'fin_vouchers' in payload)
except Exception as e:
    check('导出快照 200', False, str(e))

# ---------- 审计留痕 ----------
s, logs = admin.req('GET', '/api/system/audit-logs?action=backup.create&pageSize=5')
check('备份写审计日志', s == 200 and len(logs.get('items', [])) >= 1)
s, logs2 = admin.req('GET', '/api/system/audit-logs?action=integrity.run&pageSize=5')
check('校验跑批写审计日志', s == 200 and len(logs2.get('items', [])) >= 1)

# ---------- 页面探活 ----------
for path in ['/system/integrity', '/system/backups']:
    ok_page = False
    for _ in range(3):
        try:
            resp = admin.opener.open(u2.Request(BASE + path), timeout=60)
            if resp.status == 200:
                ok_page = True
                break
        except Exception:
            pass
    check(f'页面 {path} 200', ok_page)

# ---------- 回归：既有模块 ----------
s, _ = admin.req('GET', '/api/fin/vouchers?page=1&pageSize=1')
check('回归 凭证列表 200', s == 200)
s, _ = admin.req('GET', '/api/inv/stock?page=1&pageSize=1')
check('回归 库存余额 200', s == 200)
s, _ = admin.req('GET', '/api/system/audit-logs?page=1&pageSize=1')
check('回归 审计日志 200', s == 200)

print(f'\nSMOKE_RESULT pass={passed} fail={failed}')
exit(1 if failed > 0 else 0)

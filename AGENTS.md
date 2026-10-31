# 项目上下文

**瓷砖经销商 ERP 管理后台**（模块化单体）。首期交付：登录认证 + 角色权限雏形 + 基础资料（客户/供应商/商品主数据）CRUD。后续里程碑：采购 → 销售 → 库存 → 财务 → 加工 → 税务。

### 版本技术栈

- **Framework**: Next.js 16 (App Router) —— 前后端一体（React 19 前端 + Route Handlers 后端）
- **Core**: React 19
- **Language**: TypeScript 5
- **UI 组件**: shadcn/ui (基于 Radix UI)
- **Styling**: Tailwind CSS 4
- **数据库**: 托管 PostgreSQL（Supabase），SDK CRUD + Drizzle 管 schema
- **认证**: 自建会话（sys_sessions opaque token + httpOnly Cookie，scrypt 口令哈希）

### 环境差异（重要）

- **开发库（develop）与生产库（product）相互独立**：`exec_sql`/`coze-coding-ai db` 操作默认只影响开发库；生产部署站点（`*.coze.site`，非 `*.dev.coze.site`）使用生产库。种子脚本、手动改密码等数据操作**不会自动同步到生产库**。
- 生产库无法直接写入（exec_sql product 只读），生产数据初始化只能通过应用运行时代码完成。
- **首启自举**：`src/server/auth/bootstrap.ts` 在登录接口入口幂等执行——当 `admin123`（可用 `ERP_BOOTSTRAP_USER`/`ERP_BOOTSTRAP_PASSWORD` 覆盖）凭证不存在时自动创建初始管理员，并清理 DEV 种子凭证；绝不覆盖已有口令。生产部署后首次登录即自动建好账号。
- **预览约定**：开发反馈统一走开发预览地址（`*.dev.coze.site`，主仓端口 5000，常驻运行、代码改动热更新即时生效）；生产站点（`*.coze.site`）仅在里程碑验收时部署使用。

## 目录结构

```
├── public/                 # 静态资源
├── scripts/                # 构建与启动脚本
│   ├── build.sh            # 构建脚本
│   ├── dev.sh              # 开发环境启动脚本
│   ├── prepare.sh          # 预处理脚本
│   └── start.sh            # 生产环境启动脚本
├── src/
│   ├── app/                # 页面路由与布局
│   ├── components/ui/      # Shadcn UI 组件库
│   ├── hooks/              # 自定义 Hooks
│   ├── lib/                # 工具库
│   │   └── utils.ts        # 通用工具函数 (cn)
│   └── server.ts           # 自定义服务端入口
├── next.config.ts          # Next.js 配置
├── package.json            # 项目依赖管理
└── tsconfig.json           # TypeScript 配置
```

- 项目文件（如 app 目录、pages 目录、components 等）默认初始化到 `src/` 目录下。

## 业务架构（模块化单体）

### 模块边界与命名前缀

| 模块 | 表前缀 | 职责 |
| --- | --- | --- |
| 系统模块 | `sys_*` | 用户、凭证、会话、角色权限 |
| 基础资料模块 | `md_*` | 客户、供应商、商品主数据 |
| 采购模块（已交付 V2） | `po_*` | 五单主链路：申请单(审批)→订单(审批)→入库单(暂估/冲回)→退货单；四级审批引擎；入库即库存+移动加权成本 |
| 销售模块（已交付 V2） | `so_*` | 三单主链路：订单(审批+等级价格)→出库单(数量强校验+成本结转)→退货单(红字回补)；应收联动 |
| 库存模块（已交付 V2） | `inv_*` | 多仓台账（现有/在途/冻结/可用）+ 批次 FIFO + 只追加台账 + 调拨单(IT)双边单事务 + 盘点单(IC)差异过账 + 安全库存预警 |
| 财务模块（已交付，含应收应付核销） | `fin_*` | 应收/应付欠款汇总 + 收付款单（登记超额拦截 + plpgsql 核销/冲销）+ 应收/应付单物化 + 流水台账 + 科目/凭证/期末结账/费用报销/银行对账/现金流量表 + 固定资产卡片与折旧处置 |
| 报表模块（周边，V1） | `report_*`（无独立表，SDK 只读聚合） | 经营统计：汇总卡片/采购/销售/库存报表，dashboard 趋势图 |
| 系统字典模块（周边，V1） | `dict_*` | 字典类型+字典项（计量单位/付款方式/税率/客户等级/状态），种子预置、供下拉引用 |
| 系统管理模块（已交付 V1） | `sys_*`（复用前缀） | 四粒度权限（sys_roles/sys_role_permissions/sys_user_roles）+ 参数中心 sys_settings + 审计日志 sys_audit_logs（只追加）+ 审批流配置（复用 po_approval_rules） |
| 计量单位（周边，V1） | `md_units` | 基础资料扩充：计量单位档案 + 基准单位+换算系数 |
| 加工模块（已交付 V1） | `ma_*` | 加工单 MO（类型/损耗/投入产出）+ 四级审批 + 分批领料/分批完工 + 加工成本雏形（按投入均价分摊入成品） |
| 税务模块（已交付 V2 增强） | `tax_*` | 进/销项税登记 + 发票台账 + 异地预缴 + 税会差异 + 申报底稿 |

> 托管 PostgREST 仅暴露 public schema，故以表名前缀实现"单库逻辑多 schema"隔离。

### 认证与权限（T2 雏形 + 0020 四粒度增强）

- **数据模型**：`sys_users`（用户主体+role 枚举+dept 部门列 0020 新增）/ `sys_user_credentials`（凭证抽象，新增登录方式=新增 type）/ `sys_sessions`（会话）。
- **登录**：POST `/api/auth/login` `{type:'password', payload:{username,password}}` → httpOnly Cookie `erp_session`。
- **权限模型**：内置角色 → 权限点映射在 `src/server/auth/permissions.ts`（admin=`*`，manager=读写+审批+sys 管理+字段级，staff=只读）；0020 起叠加自定义角色（sys_roles/sys_role_permissions/sys_user_roles）。
- **有效授权（requireAuth 挂载）**：`resolveUserAuthorization(user)` = 内置角色权限 ∪ 自定义角色权限（仅 active），数据范围取所有角色最严格（`mergeScope`：self>dept>all，内置角色恒 all）；60s 内存缓存，角色/分配/权限变更时 `invalidateAuthorizationCache`。`AuthContext = { user, permissions, dataScope }`；`requirePermission` 优先读挂载的有效权限，未挂载回退静态映射（存量行为不变）。`/api/account/me` 返回有效 permissions + data_scope + custom_role_ids。
- **四粒度**：菜单级/操作级=权限点（PERMISSION_CATALOG，granularity menu/operation/data/field）；数据级=`dataScopeUserIds(user, scope)` 返回 created_by 过滤集（all→undefined 不过滤、self→本人、dept→同部门），已接入 po/so 订单与 fin/expenses 列表；字段级=`maskSensitiveFields(rows, perms)` 缺 `field.cost_price` 置 null 成本价类字段、缺 `field.customer_phone` 置 null 手机号，已接入 md/products 与 md/customers 列表+详情。
- **DEV 审批冒烟账号**：`dev_manager@coze.dev`（manager，密码 manager123456）、`dev_user@coze.dev`（staff）。
  API 层用 `requireAuth(request)` / `requirePermission(auth, 'md.write')` 做守卫；前端 `useAuth().can()` 控制菜单/按钮显隐。
- **升级路径**：T3 完整 RBAC（roles/permissions/role_permissions/user_roles 四表）为单向加表升级，见 `src/server/auth/permissions.ts` 注释。
- **DEV 测试账号**：`pnpm tsx scripts/seed-dev.ts`（仅 DEV 可执行，密码运行时随机生成、只打印控制台）。staff 角色冒烟账号为 `dev_user@coze.dev`（种子生成；密码需自设，可用临时脚本调 `hashPassword` 更新 `sys_user_credentials.secret_hash`）。

### API 清单（错误格式 `{ code, message }`）

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| POST | /api/auth/login | 公开 | 登录（含限流 5次/10min） |
| POST | /api/auth/logout | 已登录 | 登出 |
| GET | /api/account/me | 已登录 | 当前用户 + 权限点 |
| GET | /api/stats/overview | 已登录 | 仪表盘统计 |
| GET/POST | /api/md/customers | md.read / md.write | 客户分页列表 / 新增 |
| GET/PUT/DELETE | /api/md/customers/[id] | md.read / md.write | 客户详情 / 更新 / 删除 |
| GET/POST | /api/md/suppliers | 同上 | 供应商 |
| GET/PUT/DELETE | /api/md/suppliers/[id] | 同上 | 供应商 |
| GET/POST | /api/md/products | 同上 | 商品主数据（型号/规格/单位/条形码） |
| GET/PUT/DELETE | /api/md/products/[id] | 同上 | 商品 |
| GET/POST | /api/po/orders | po.read / po.write | 采购订单分页列表（status 筛选）/ 新建（草稿） |
| GET/PUT/DELETE | /api/po/orders/[id] | po.read / po.write | 订单详情（含明细+审批步骤）/ 更新（draft/rejected）/ 删除（仅 draft） |
| POST | /api/po/orders/[id]/submit | po.write | 提交审批（draft/rejected→pending，按金额定级） |
| POST | /api/po/orders/[id]/approve | po.approve | 审批通过当前步（角色须匹配步骤） |
| POST | /api/po/orders/[id]/reject | po.approve | 驳回当前步（→rejected） |
| POST | /api/po/orders/[id]/cancel | po.write | 关闭订单（draft/pending/rejected→closed） |
| POST | /api/po/orders/[id]/complete | po.write | 一键到货入库（approved→received，自动生成已审正式入库单 GR，防重复入库） |
| GET/POST | /api/po/requisitions | po.read / po.write | 采购申请单列表 / 新建（PR 单号，估算总额） |
| GET/DELETE | /api/po/requisitions/[id] | po.read / po.write | 申请单详情（含步骤）/ 删除（draft/rejected） |
| POST | /api/po/requisitions/[id]/submit、approve、reject | po.write / po.approve | 申请单审批动作 |
| POST | /api/po/requisitions/[id]/convert | po.write | 已审申请单转采购订单（申请单→closed，生成 draft 订单） |
| GET/POST | /api/po/receipts | po.read / po.write | 入库单列表 / 从已审订单创建（GR 单号，is_estimated 暂估） |
| GET/DELETE | /api/po/receipts/[id] | po.read / po.write | 入库单详情 / 删除（draft/rejected） |
| POST | /api/po/receipts/[id]/submit、approve、reject | po.write / po.approve | 入库单审批（终审通过=入库，单事务） |
| POST | /api/po/receipts/[id]/reverse | po.write | 暂估冲回（红字 GRR 冲销 + 蓝字 GRB 按发票价重入，单事务） |
| GET/POST | /api/po/returns | po.read / po.write | 退货单列表 / 新建（RT 单号） |
| GET/DELETE | /api/po/returns/[id] | po.read / po.write | 退货单详情 / 删除（draft/rejected） |
| POST | /api/po/returns/[id]/submit、approve、reject | po.write / po.approve | 退货单审批（终审通过=出库，库存不足整单 400） |
| GET/POST | /api/so/orders | so.read / so.write | 销售订单分页列表（status 筛选）/ 新建（草稿） |
| GET/PUT/DELETE | /api/so/orders/[id] | so.read / so.write | 订单详情（含明细+审批步骤）/ 更新（draft/rejected）/ 删除（仅 draft） |
| POST | /api/so/orders/[id]/submit | so.write | 提交审批（draft/rejected→pending，按金额定级） |
| POST | /api/so/orders/[id]/approve、reject | so.approve | 审批通过当前步 / 驳回（→rejected） |
| POST | /api/so/orders/[id]/cancel | so.write | 关闭订单（draft/pending/rejected→closed） |
| POST | /api/so/orders/[id]/complete | so.write | 一键发货出库（approved→shipped，自动生成并审核出库单 SH，防重复出库） |
| GET | /api/so/quote | so.read | 建议售价（customer_id+product_id，按客户等级折扣） |
| GET/POST | /api/so/shipments | so.read / so.write | 出库单列表 / 从已审订单创建（SH 单号，单价强制取订单成交价） |
| GET/DELETE | /api/so/shipments/[id] | so.read / so.write | 出库单详情 / 删除（draft/rejected） |
| POST | /api/so/shipments/[id]/submit、approve、reject | so.write / so.approve | 出库单审批（终审=出库扣库存+成本结转，超订单剩余量/负库存整单 400） |
| GET/POST | /api/so/returns | so.read / so.write | 退货单列表 / 新建（SR 单号，订单须 approved/shipped） |
| GET/DELETE | /api/so/returns/[id] | so.read / so.write | 退货单详情 / 删除（draft/rejected） |
| POST | /api/so/returns/[id]/submit、approve、reject | so.write / so.approve | 退货单审批（终审=红字回补库存/成本，超已出库量整单 400） |
| GET | /api/inv/stock | inv.read | 库存余额分页（商品名/编码 keyword、warehouse_id 仓过滤） |
| POST | /api/inv/stock/freeze | inv.write | 冻结量调整（正负增量，超额 400） |
| GET | /api/inv/movements | inv.read | 台账流水分页（type=in/out/adjust、商品/单号 keyword、warehouse_id） |
| GET | /api/inv/batches | inv.read | 批次分页（keyword 商品/批号、in_stock=1 仅有余量） |
| GET | /api/inv/alerts | inv.read | 安全库存预警（跨仓合计 ≤ safety_stock） |
| GET/POST | /api/inv/warehouses | inv.read / inv.write | 仓库列表 / 新增 |
| PUT | /api/inv/warehouses/[id] | inv.write | 仓库更新（改名/地址/启停） |
| GET/POST | /api/inv/transfers | inv.read / inv.write | 调拨单分页（status/from_warehouse_id/to_warehouse_id）/ 新建 |
| GET/PUT/DELETE | /api/inv/transfers/[id] | inv.read / inv.write | 调拨单详情（含明细+步骤）/ 更新 / 删除（仅 draft） |
| POST | /api/inv/transfers/[id]/submit、approve、reject | inv.write / inv.approve | 调拨单审批（终审=调出减存+调入在途） |
| POST | /api/inv/transfers/[id]/receive | inv.write | 调拨收货（approved→received，在途转调入库存+批次） |
| POST | /api/inv/transfers/[id]/cancel | inv.write | 关闭调拨单（draft/pending/rejected→closed） |
| GET/POST | /api/inv/checks | inv.read / inv.write | 盘点单分页 / 新建（按仓快照账面明细） |
| GET/PUT/DELETE | /api/inv/checks/[id] | inv.read / inv.write | 盘点单详情 / 录入实盘数 / 删除（仅 draft） |
| POST | /api/inv/checks/[id]/submit、approve、reject、cancel | inv.write / inv.approve | 盘点单审批（终审=差异过账，盘盈入/盘亏出） |
| GET | /api/fin/receivables | fin.read | 应收欠款按客户汇总分页（billed/received/outstanding，keyword 搜客户） |
| GET | /api/fin/payables | fin.read | 应付欠款按供应商汇总分页（billed/paid/outstanding） |
| GET/POST | /api/fin/receipts | fin.read / fin.write | 收款单分页列表（status 筛选）/ 登记收款（pending，可带 order_id 关联应收单） |
| POST | /api/fin/receipts/[id]/approve | fin.write | 收款核销（plpgsql 单事务，递减应收，超收 400） |
| POST | /api/fin/receipts/[id]/cancel | fin.write | 作废收款单（仅 pending） |
| GET | /api/fin/ar-bills | fin.read | 应收单列表（已出库销售订单物化，含 settles/余额/状态，keyword+status） |
| DELETE | /api/fin/receipts/[id] | fin.write | 删除收款单（仅 pending，欠款回升） |
| GET/POST | /api/fin/payments | fin.read / fin.write | 付款单分页列表（direction/status 筛选）/ 登记付款 |
| POST | /api/fin/payments/[id]/approve | fin.write | 付款核销（plpgsql 单事务，递减应付，超付 400） |
| POST | /api/fin/payments/[id]/cancel | fin.write | 作废付款单（仅 pending） |
| GET | /api/fin/ap-bills | fin.read | 应付单列表（已入库采购订单物化，含 settles/余额/状态，keyword+status） |
| DELETE | /api/fin/payments/[id] | fin.write | 删除付款单（仅 pending） |
| GET | /api/fin/vouchers | fin.read | 记账凭证分页（status/voucher_date_from/to/keyword/event_type/period/account_code 过滤，含明细行） |
| POST | /api/fin/vouchers | fin.write | 手工记账：登记平衡草稿 `{voucher_date, ref_summary, lines:[{direction,account_code,amount,summary}]}`（借贷必相等、科目须为末级） |
| GET / DELETE | /api/fin/vouchers/[id] | fin.read / fin.write | 凭证详情（含借贷行）/ 删除（仅未过账：status=draft，无红冲凭证） |
| POST | /api/fin/vouchers/[id]/post | fin.write | 过账：draft→posted，记录 changed_by/at（仅 draft） |
| POST | /api/fin/vouchers/[id]/void | fin.write | 红字冲销（红冲冗余：原凭证→void 并生成等额反号红冲凭证，禁对已作废/已冲销重复红冲） |
| GET/POST | /api/fin/subjects | fin.read / fin.write | 会计科目字典：分页（keyword/category/status）+ 新增（编码唯一409，末级自动） |
| GET/PUT/DELETE | /api/fin/subjects/[id] | fin.read / fin.write | 科目详情 / 更新（含期初、父级、可停用）/ 删除（有分录引用/子级/期初余额不可删，可停用） |
| GET | /api/fin/balances?period=YYYY-MM | fin.read | 科目余额表：按期初+本期借/贷+期末实时聚合，父级自动汇总子级 |
| GET | /api/fin/trial-balance?period=YYYY-MM | fin.read | 试算平衡表：以实际分录发生额为口径（红字符号相抵），借贷必等 + 差额定位 |
| GET | /api/fin/pnl?period=YYYY-MM | fin.read | 利润表：以损益科目本期发生额实时汇总（收入-成本=毛利、营业利润、利润总额、所得税、净利润、返点基数，本期/上期对比） |
| GET | /api/fin/balance-sheet?period=YYYY-MM | fin.read | 资产负债表：按类别期末余额实时汇总（期初/期末两列、货币资金、资产=负债+权益 balanced+diff） |
| GET | /api/fin/periods | fin.read | 月结清单：各会计期间状态/凭证数/借贷合计/试算平衡/结转损益单号 |
| POST | /api/fin/periods/[period]/profit-close | fin.write | 结转损益（损益→本年利润4103，借贷平衡、幂等防重，无发生额 skipped） |
| POST | /api/fin/periods/[period]/close | fin.write | 期间结账：先结转损益再把期间 open→closed 并锁定，写日志 |
| POST | /api/fin/periods/[period]/reopen | fin.write | 反结账留痕 {reason}：closed→open 解锁，记录谁/何时/原因（日志不可删） |
| POST | /api/fin/periods/[period]/year-close | fin.write | 年结：关全年各月+本年利润→未分配利润4104+资产/负债/权益结转次年期初，置 annual_closed |
| GET | /api/fin/periods/[period]/logs | fin.read | 期间结账/结转/反结账/年结留痕日志（仅追加） |
| GET | /api/tax/entries | tax.read | 税额登记分页（tax_type/period/keyword = 单号模糊） |
| GET | /api/tax/summary | tax.read | 期间×税率税额统计（销项/进项 金额·计税基数·税额，内存聚合） |
| GET | /api/tax/filing?period=YYYY-MM | tax.read | 增值税纳税申报（含增强字段：prepaid_total/net_payable/refundable/soc_diff 差异提示） |
| GET/POST | /api/tax/invoices | tax.read / tax.write | 发票台账分页列表（direction/invoice_type/status/period/keyword）/ 录入（direction+invoice_no 唯一 409，金额非负校验） |
| GET/PUT/DELETE | /api/tax/invoices/[id] | tax.read / tax.write | 发票详情 / 更新（filed 禁改 400）/ 删除（filed 禁删，作废可删） |
| POST | /api/tax/invoices/[id]/mark | tax.write | 勾选认证/标记申报/作废：pending→checked→filed，任意→void（filed 不可直接改） |
| GET/POST | /api/tax/prepaid | tax.read / tax.write | 异地预缴分页列表（period/keyword=工程/地区）/ 登记（prepaid_amount>0） |
| DELETE | /api/tax/prepaid/[id] | tax.write | 作废预缴（置 void，不再计入底稿抵减） |
| GET/POST | /api/tax/soc-diff | tax.read / tax.write | 税会差异分页列表（period/diff_type/keyword）/ 登记（diff_amount 服务端=税法−会计） |
| DELETE | /api/tax/soc-diff/[id] | tax.write | 删除差异登记 |
| GET | /api/tax/worksheet?period=YYYY-MM | tax.read | 申报底稿：销项/进项/应纳/预缴抵减/应补(退)/留抵 + sources 五类来源 + soc_diff 统计 |
| POST | /api/fin/vouchers/period-close | admin / fin.write | 期末成本结转批处理 { period }，幂等补生成成本凭证，返回新增计数 |
| GET/POST | /api/fin/expenses | fin.read / fin.write | 费用报销单分页列表（status/period/keyword=单号/报销人）/ 新建草稿（服务端重算价税分离） |
| GET/PUT/DELETE | /api/fin/expenses/[id] | fin.read / fin.write | 报销单详情（含明细+审批步骤）/ 更新（draft/rejected）/ 删除（仅 draft） |
| POST | /api/fin/expenses/[id]/submit、approve、reject | fin.write | 提交审批（docType=expense 按含税金额分级）/ 终审通过（生成费用确认凭证，幂等）/ 驳回 |
| POST | /api/fin/expenses/[id]/pay | fin.write | 登记付款：approved→paid，生成 fin_payments + 付款凭证（借2241/贷1002，幂等） |
| GET/POST | /api/fin/bank-statements | fin.read / fin.write | 银行对账单分页列表 / 录入（bank_account/tran_date/direction/amount） |
| PUT/DELETE | /api/fin/bank-statements/[id] | fin.write | 对账单更新 / 删除（已匹配不可删） |
| POST | /api/fin/bank-statements/auto-match | fin.write | 自动匹配：对账单↔日记账（同账户+方向+金额+日期临近，一对一） |
| POST | /api/fin/bank-statements/[id]/unmatch | fin.write | 取消匹配 |
| GET | /api/fin/bank-recon | fin.read | 银行对账视图：account + journal(日记账归集) + statements + reconciliation(未达账项调节表) |
| GET | /api/fin/cash-flow?period=YYYY-MM | fin.read | 现金流量表：直接法（经营/投资/筹资）+ 间接法净利润调节表，两法净增加额强制相等 |
| GET/POST | /api/fin/fixed-assets | fin.read / fin.write | 固定资产卡片分页列表（keyword=编码/名称、category、status）/ 新建（asset_no 可自定义，唯一 409，残值<原值校验） |
| GET/PUT/DELETE | /api/fin/fixed-assets/[id] | fin.read / fin.write | 卡片详情（含折旧历史+累计折旧+净值）/ 更新（已计提禁改计量字段）/ 删除（仅未计提且未处置，400 守卫） |
| POST | /api/fin/fixed-assets/[id]/dispose | fin.write | 处置（sell/scrap）：生成处置凭证（借1602+处置收入或损失6711/贷1601原值+收益6301，幂等），状态→disposed 停止折旧 |
| GET | /api/fin/depreciation | fin.read | 折旧历史分页（period/asset_id 过滤，含资产编码+名称） |
| POST | /api/fin/depreciation/run | fin.write | 月度计提 {period}：在用且未提足资产逐条生成折旧凭证（借费用科目/贷1602），UNIQUE(asset_id,period) 幂等 |
| GET | /api/report/overview | 已登录 | 经营报表汇总：cards(采购/销售/毛利/应收应付/库存总值) + buckets(今日/本月/累计) + trends(近12月趋势) |
| GET | /api/report/purchase | 已登录 | 采购报表（groupBy=suppider/month，from/to 过滤） |
| GET | /api/report/sales | 已登录 | 销售报表（groupBy=customer/product/month，from/to 过滤） |
| GET | /api/report/inventory | 已登录 | 库存报表（groupBy=warehouse/product，按数量/货值汇总） |
| GET/POST | /api/dict/types | md.read / md.write | 字典类型分页列表 / 新增 |
| GET/PUT/DELETE | /api/dict/types/[id] | md.read / md.write | 字典类型详情 / 更新 / 删除（is_system 内置类型不可删，级联删项） |
| GET/POST | /api/dict/items | md.read / md.write | 字典项分页列表（type= 过滤）/ 新增 |
| GET/PUT/DELETE | /api/dict/items/[id] | md.read / md.write | 字典项详情 / 更新 / 删除 |
| GET | /api/dict/lookup?types=unit,payment_method | 已登录 | 只读引用：按类型(逗号分隔)返回活跃字典项映射 { data: { type: items } }，供下拉 |
| GET/POST | /api/md/units | md.read / md.write | 计量单位分页列表（keyword）/ 新增 |
| GET/PUT/DELETE | /api/md/units/[id] | md.read / md.write | 计量单位详情 / 更新 / 删除 |
| GET/POST | /api/ma/orders | ma.read / ma.write | 加工单分页列表（status/processing_type 筛选）/ 新建草稿 |
| GET/PUT/DELETE | /api/ma/orders/[id] | ma.read / ma.write | 加工单详情（含投入产出明细+审批步骤）/ 更新（draft/rejected）/ 删除（仅 draft） |
| POST | /api/ma/orders/[id]/submit | ma.write | 提交审批（draft/rejected→pending） |
| POST | /api/ma/orders/[id]/approve、reject | ma.approve | 审批通过当前步 / 驳回（→rejected） |
| POST | /api/ma/orders/[id]/close | ma.write | 关闭加工单（draft/pending/rejected→closed） |
| POST | /api/ma/orders/[id]/issue | ma.write | 分批领料 `{warehouse_id, items}`，扣原料库存（超计划 400） |
| POST | /api/ma/orders/[id]/finish | ma.write | 分批完工 `{warehouse_id, items}`，产成品入库（损耗违约 400）；全部完成→completed |
| GET/POST | /api/system/roles | sys.read / sys.write | 角色分页列表（keyword=编码/名称）/ 新建（code 唯一 409） |
| GET/PUT/DELETE | /api/system/roles/[id] | sys.read / sys.write | 角色详情（含权限点+用户数）/ 更新（内置角色仅名称/描述）/ 删除（内置/已分配禁删 400） |
| GET/PUT | /api/system/roles/[id]/permissions | sys.read / sys.write | 角色权限点读取 / 全量替换（内置角色禁改 400；非法点 400） |
| GET | /api/system/users | sys.read | 用户列表（含内置角色+已分配自定义角色+部门，keyword） |
| PUT | /api/system/users/[id]/roles | sys.write | 用户自定义角色全量分配（失效授权缓存） |
| PUT | /api/system/users/[id]/dept | sys.write | 调整用户部门（数据级 dept 范围依据） |
| GET/POST | /api/system/settings | sys.read / sys.write | 参数分页列表（group/keyword，返回 groups）/ 新建（key 唯一 409，值按类型校验 400，敏感仅 admin） |
| GET/PUT/DELETE | /api/system/settings/[id] | sys.read / sys.write | 参数详情 / 更新（内置仅值+描述；敏感仅 admin 403）/ 删除（内置禁删 400） |
| GET | /api/system/audit-logs | sys.read | 审计日志分页（action/resource/user/时间范围/keyword，只读无写端点） |
| GET | /api/system/approval-rules | sys.read | 审批规则列表（含步骤，按 doc_type+level，返回 doc_types） |
| PUT | /api/system/approval-rules/[id] | sys.write | 审批规则更新：金额区间+步骤序列全量替换（角色校验 400，写审计） |

分页参数：`page`(≥1) `pageSize`(1-100) `keyword`（模糊搜索）；响应 `{ items, total, page, page_size }`。

### 采购模块约定（po_*，V2 五单主链路）

- **五单**：申请单 `po_requisitions`(PR) → 订单 `po_purchase_orders`(PO) → 入库单 `po_receipts`(GR；红蓝冲回 GRR/GRB) → 退货单 `po_returns`(RT)；明细表均为 `_items`（order_id 类 FK cascade + product_id FK + unit 快照，金额服务端重算）。
- **统一状态机**：`draft`(草稿) → `pending`(待审) → `approved`(已审) / `rejected`(驳回，可编辑重提) → 业务终态：订单 `received`(已入库)、入库单 approved 即入库、原暂估单冲回后 `reversed`；`draft/pending/rejected` 可 `closed`(关闭)。仅 `draft` 可删，`draft/rejected` 可编辑。
- **状态映射（0006 迁移）**：旧采购订单数据 confirmed→approved、completed→received、cancelled→closed；销售侧同类映射在 0007 完成（confirmed→approved、completed→shipped、cancelled→closed）。
- **四级审批引擎**（`src/server/approval/engine.ts`，采购/销售共用）：规则表 `po_approval_rules`(doc_type+level+金额区间) + `po_approval_rule_steps`(step_no+approver_role)，实例表 `po_approval_steps`（doc_type+doc_id 多态，不建 FK）。提交时按金额命中规则生成步骤实例（申请/订单四级：≤5k/≤50k 一级 manager，≤200k/>200k 两级 manager→admin；入库/退货默认一级 manager）。改规则表即可重配级数与角色。审批角色匹配：步骤角色=manager 时 manager/admin 可审，=admin 时仅 admin；权限点 `po.approve`/`so.approve`（admin、manager）。**终审 RPC 失败回滚**：步骤先置 approved，若终审数据库函数报错（库存不足/超量等）则自动回滚该步骤为 pending，单据可修正后重新审批，不会卡死。
- **入库终审**由 plpgsql 单事务完成：`po_execute_receipt`（状态+库存+成本）、`po_execute_return`（退货出库）、`po_fulfill_order`（订单一键入库，自动生成已审正式入库单并防重复入库）、`po_reverse_receipt`（暂估红蓝冲回）。错误码沿用 P0001 库存不足 / P0400 状态错误 / P0404 不存在（`src/server/inventory/shared.ts` 映射）。
- **移动加权成本**（雏形）：`inv_stock` 加 `avg_cost`/`total_cost`，`inv_stock_movements` 加 `unit_cost` 快照。入库 `inv_apply_receipt_in`（加权均价）、出库 `inv_apply_issue_out`（按均价减货值）；销售出库终审内联同口径结转并写明细成本（成本引擎后续里程碑统一）。
- **暂估冲回**：暂估单（is_estimated，发票未到）审批入库；来票后 `POST reverse {invoice_no, items[实际价]}` → 单事务生成红字单（按暂估价出库回冲）+蓝字单（按发票价入库重算成本），原单→reversed；红蓝金额对账平衡，净差计入应付。
- **供应商应付口径**（fin 聚合）：Σ(订单 status∈received/completed) + Σ(蓝字−红字) − Σ(approved 退货) − Σ(付款)。
- **单号**：PO/PR/GR/RT + `yyyymmdd-NNNN`；GRR/GRB 在数据库函数内生成。所有单号生成统一走 `src/server/doc-no.ts` 的 `nextDocNo`（**当日最大序号+1**，非 count+1——删除中间单号后 count 与 max 错位会撞号；数据库函数内同样用 `MAX(substring(no from '-(\d+)$'))+1`），unique 约束兜底。

### 库存模块约定（inv_*，V2 多仓 + 批次 + 调拨/盘点）

- **表**：`inv_warehouses`（仓库档案，code 唯一，WH01 默认仓）、`inv_stock`（余额：(warehouse_id, product_id) 复合唯一；quantity 现有 / in_transit 在途 / frozen_quantity 冻结；可用量 = quantity − frozen）、`inv_stock_ledger`（原 inv_stock_movements 0008 改名；**只追加**流水：type in/out/adjust、quantity 带符号、balance 余额快照 **CHECK 非负**、warehouse_id FK、batch_id、source purchase_in/sales_out/purchase_return/receipt_reversal/sales_return_in/transfer_out/transfer_in/check_in/check_out/manual、unit_cost 成本快照、ref_no 关联单号、created_by FK→sys_users）、`inv_batches`（批次：(product_id, warehouse_id, batch_no) 唯一，批号=来源单号；initial_quantity 累计入库 / remaining_quantity FIFO 扣减 CHECK 非负；unit_cost 入库成本快照；production_date/expiry_date 效期）。流水不做 UPDATE/DELETE。
- **调拨/盘点单**：`inv_transfers`(IT) 状态机 draft→pending→approved(调出已出库/调入在途)→received(收货转库存)；`inv_checks`(IC) draft→pending→approved(差异已过账)；明细表 `_items`（调拨明细带 unit_cost 成本快照；盘点明细 book_quantity 账面快照/counted_quantity 实盘/difference 差异）。仅 draft 可删，draft/rejected 可编辑，draft/pending/rejected 可 closed。
- **强一致联动**：plpgsql 数据库函数单事务完成（`db/migrations/0008_inventory.sql`）：
  - `inv_apply_receipt_in(p_product, p_warehouse, p_qty, p_unit_cost, p_source, p_ref_no, p_remark, p_user)`：仓维度移动加权 + 批次 upsert + 台账。
  - `inv_apply_issue_out(p_product, p_warehouse, p_qty, p_source, p_ref_no, p_remark, p_user)`：FIFO 扣批次剩余量 + 按均价出库，返回出库成本总额。
  - `inv_adjust_frozen`（冻结/解冻，行锁校验 0≤frozen≤quantity）、`inv_execute_transfer`（终审=调出出库+调入在途，超可用量 P0001）、`inv_receive_transfer`（在途转现有+批次入库）、`inv_execute_check`（差异过账：盘盈 check_in/盘亏 check_out+台账）。
  - 购销终审函数全部带仓（单据 warehouse_id 可空=默认仓 WH01，函数内 COALESCE 兜底）：`po_execute_receipt`/`po_execute_return`/`po_reverse_receipt`/`po_fulfill_order`/`so_execute_shipment`/`so_execute_return`/`so_fulfill_order`。
- **审批**：复用通用引擎 `src/server/approval/engine.ts`，doc_type 扩展 `transfer`/`check`（规则种子：一级 manager）；终审 RPC 失败自动回滚步骤 pending。权限点 `inv.write`（建单/收货/冻结）、`inv.approve`（审批），均 admin+manager；staff 只读 `inv.read`。
- **错误码映射**：服务端 `src/server/inventory/shared.ts` 解析 SQLSTATE —— `P0001`→400 `INV.INSUFFICIENT_STOCK`、`P0404`→404、`P0400`→400 `INV.BAD_TRANSITION`。
- **预警**：`/api/inv/alerts` 按商品跨仓合计 quantity ≤ md_products.safety_stock 命中（safety_stock>0）；仪表盘 `inventory:{tracked_kinds, out_of_stock, alerts}`。
- **仪表盘**：`/api/stats/overview` 返回 `inventory:{tracked_kinds, out_of_stock, alerts}`（alerts=命中预警品项数）。

### PostgREST 查询注意事项

- `.or()` 过滤器**不支持嵌入表列名前缀**（`or=(product.name.ilike.*,...*)` 或带表别名均报 `failed to parse logic tree`）。需要按嵌入商品名/编码模糊搜索时，先在主数据查出匹配 `md_products.id` 列表，再对库存/流水用 `.in('product_id', ids)`（无匹配则直接返回空页）。见 `src/server/inventory/stock.ts` 的 `matchProductIds`。
- 嵌入关联依赖真实外键约束；`created_by` 等 FK 若 db upgrade 未生成，需 exec_sql 补建并在迁移文件加幂等 DO 块。补全操作人姓名采用两步查询（批量取 sys_users 的 username/display_name 再 map），不依赖嵌入。

### PDA / 移动端（周边弱耦合，/m/ 前缀）

- **定位**：仓库作业手持端简化入口，**不新建表、不新增核心 API**，纯前端装配复用既有 `inv_*` 能力；与桌面端数据/权限同源。
- **路由**：移动端独立布局 `src/app/m/layout.tsx`（`/m/` 段路由守卫 + 底部大按钮导航），与桌面 `(app)` 并存，不进 AppShell。
- **页面**（`src/app/m/pda/*`，均为 'use client'）：
  - `/m/pda` 首页：三张便携卡片跳转。
  - `/m/pda/scan-count` 扫码盘点录入：选仓 → `POST /api/inv/checks` 建盘点单(IC)快照账面 → 扫条码定位行/录实盘 → `PUT /api/inv/checks/[id]` 保存 → `POST submit/approve` 提交并审核过账；可续盘进行中的 draft/pending 单。写操作需 `inv.write`、审批需 `inv.approve`。
  - `/m/pda/inventory` 口袋版查余额：`GET /api/inv/stock?keyword=` 快速查余额/可用/冻结（跨仓）。
  - `/m/pda/movements` 出入库核对（只读）：`GET /api/inv/movements?keyword=` 扫条码/单号查最近收发货台账流水（含 source 类型、单号、成本快照）。
- **权限**：读 `inv.read`（含 staff）、写 `inv.write` / 审批 `inv.approve`（admin+manager）；与桌面端一致，无独立权限点。
- **约束**：`/m/` 页面不做服务端数据写入型新端点，创建盘点/出入库全部走既有 API。页面组件内定义轻量本地类型，不写入 `src/lib/types.ts`（保持弱耦合）。

### 财务模块约定（fin_*）

- **表**：单表 `fin_payments` 承载收付款单——`doc_no` 唯一（收款 `RCyyyymmdd-NNNN`、付款 `PYyyyymmdd-NNNN`）、`direction`(receipt/payment)、`customer_id`/`supplier_id` 二选一 FK（方向决定哪个非空）、`order_id`+`order_no` 冗余快照（关联订单可空，不建 FK，因方向不同指向 so/po 两张表；**收款单关联销售订单即应收单、付款单关联采购订单即应付单，供核销明细可溯**）、`amount numeric(14,2)`、`method`(cash/bank/wechat/alipay/other)、`paid_at`、`bill_no`（对账单号，可选）、`created_by` FK、核销状态列 `status`(pending待核销/approved已核销/cancelled作废，默认 approved 兼容旧数据)、`approved_by/approved_at`、`cancelled_by/cancelled_at`、`bill_no`/`status` 索引(`fin_payments_bill_no_idx`/`fin_payments_status_idx`)。
- **应收/应付单（物化，不建物理表）**：应收单=已出库销售订单（status∈shipped/completed）、应付单=已入库采购订单（status∈received/completed），由 `GET /api/fin/ar-bills`、`ap-bills` 实时物化（SDK 只读聚合）。每单 `settled` = 该订单已核销（approved 且 order_id 指向该单）的收/付款合计，`outstanding = amount − settled`，`status`(open/settled)；支持 keyword（单号/往来单位）+ `status` 过滤。列入款随收款/付款单 `order_id` 关联而递减，未关联订单的收付款按往来单位聚合（不细分到单）。
- **欠款口径**：客户应收 = Σ(shipped/completed 销售订单总额) − Σ(approved 销售退货) − Σ(**approved 收款**)；供应商应付 = Σ(received/completed 采购订单总额) + Σ(蓝字−红字冲回净差) − Σ(approved 采购退货) − Σ(**approved 付款**)。**仅统计 status='approved' 的收付款（审核核销后方递减余额）**；汇总在服务端内存聚合（先分页查客户/供应商，再批量聚合该页 ID 的订单与收付款），不建数据库视图，保持 SDK-only 约束。
- **登记拦截 + plpgsql 核销**：登记收/付款时先做余额校验（Σapproved + 本次 ≤ 该往来单位欠款，超出返回 400 `FIN.OVER_AMOUNT`）；核销（审核通过）由 plpgsql 单事务 `fin_apply_receipt`/`fin_apply_payment` 执行——FOR UPDATE 锁客户/供应商行防并发错账、校验不超该单位剩余欠款（超收/超付 `RAISE 'FIN_OVER_AMOUNT' ERRCODE='P0001'`→400 `FIN.OVER_AMOUNT`），成功后单据→approved 并记核销人。作废 `fin_cancel_receipt`/`fin_cancel_payment` 仅限 pending（未核销）。终审 RPC 失败自动保证余额不变（事务回滚）。
- **删除即回滚**：仅 `pending`（未核销）收付款单可 DELETE（欠款相应回升）；已核销/作废单据删除返回 400 `FIN.BAD_TRANSITION`（正式红冲留待后续里程碑）。
- **RPC 错误映射**（`src/server/finance/payments.ts#throwFinRpcError`，参照 inventory/shared.ts 关键字匹配）：`FIN_OVER_AMOUNT`/P0001→400 `FIN.OVER_AMOUNT`、`FIN_NOT_FOUND`→404、`FIN_BAD_STATE`/`FIN_BAD_PARAM`→400 `FIN.BAD_TRANSITION`。
- **权限**：`fin.read` / `fin.write`（manager 读写、staff 只读）；核销/作废/删除均需 `fin.write`。
- **仪表盘**：`/api/stats/overview` 返回 `finance:{receivable_outstanding, payable_outstanding}`（仅统计 approved 收付款）。
- **前端**：`src/components/finance/balance-list.tsx` 欠款汇总列表（kind 区分应收/应付，行内收/付款按钮）、`payment-form-dialog.tsx` 登记对话框（金额预填当前欠款）、`fin-bills.tsx` 应收/应付单明细表格（金额/已核销/余额/状态）；页面 `/finance/receivables`、`/finance/payables`（汇总 + 应收/应付单表格）、`/finance/payments`（流水台账：类型/状态筛选、pending 行内核销/作废、核销单号列）。

### 凭证引擎 + 税务约定（fin_/tax_，0011）

- **表**：`fin_voucher_templates`（模板：event_type 唯一、spec JSONB 分录规则、可配尾差归集科目 balance_to）、`fin_vouchers`（凭证：voucher_no 唯一=凭证序+日期、UNIQUE(event_type,event_id) 幂等、CHECK total_debit=total_credit、status posted/void、红冲字段 void_of_no/void_by/at）、`fin_voucher_lines`（借贷行：direction/account_code/account_name/amount/summary，FK cascade）、`tax_entries`（销项/进项登记：UNIQUE(ref_type,ref_id,tax_type)、period 期间、rate/base/amount/tax）。均为幂等表+RLS。
- **口径**：单据金额为**含税价**；单税率（按 `md_products.tax_rate`，缺省 13%）拆分：`tax=round2(amount*r/(100+r))`、`excl=round2(amount-tax)`；多税率按行累加；尾差（借≠贷且舍入/0.01 内）归入模板 `balance_to` 指定科目（如管理费用）；超过阈值则该事件抛错不生成。
- **五套事件模板（内置种子）**：`sales_shipment`(借应收/贷主营收入+销项税)、`purchase_receipt`(借库存+进项税/贷应付；暂估单不确认进项税)、`receipt_settle`(借银行/贷应收)、`payment_settle`(借应付/贷银行)、`receipt_reverse`(红字冲销暂估-借库存-贷应付-暂估 各 `-est`，+ 蓝字按发票价借库存+进项税/贷应付)。
- **自动生成**：`src/server/ledger/events.ts`（onSalesShipment/onPurchaseReceipt/onReceiptSettle/onPaymentSettle/onReceiptReverse）在各业务终审/核销/冲回服务 RPC 成功后调用——凭证 `ensureVoucher`（按 event 幂等防重）+ 税额 `registerTaxEntry`（按 ref 幂等）；`computeItemsTax` 按商品税率聚合。配销项：销售出库（含一键发货）；进项：采购入库非暂估 + 暂估冲回蓝字。
- **红字冲销**：`POST /api/fin/vouchers/[id]/void` 仅对已过账(unvoid)凭证——原凭证 status→void，自动生成等额反号红冲凭证（event_type=void、source=redline），旧凭证与红冲凭证均不可再红冲（400）。DELETE 仅限 status=draft（未过账）且无红冲凭证。
- **税额统计**：`GET /api/tax/summary` 按(period,tax_rate) 内存聚合 output/input 的金额/计税基数/税额，为报税提供口径（SDK-only，不建视图；不做完整申报）。
- **正确性回归**：`scripts/ledger-golden.ts`（`pnpm tsx scripts/ledger-golden.ts`）纯函数 23 条断言（buildVoucherEntries 借贷平衡/尾差归集/五模板分录、含税拆分、多税率），CI 必跑。
- **权限**：凭证读 `fin.read`（staff 只读）、红冲/删除 `fin.write`（manager）；税务自 0019 起用独立权限点 `tax.read`/`tax.write`（见税务增强节）。
- **前端**：`/finance/vouchers`（凭证列表：日期/状态筛选、查看借贷行明细、行内红冲）、`/tax/taxes`（期间×税率税额汇总 + 登记明细）；导航「财务→记账凭证、税务→税额统计」。

### 会计科目 + 凭证管理增强（fin_subjects，0015）

- **迁移 0015_account.sql**（独立文件，幂等种子）：建 `fin_subjects` 科目字典（`subject_code` 唯一、`category` 1资产/2负债/3共同/4权益/5成本/6损益、`parent_code` 层级、`direction` 0借1贷、`is_leaf` 末级、`balance_flag` 是否参与余额表、`opening_amount/opening_direction` 期初、`status` active/disabled、`sort_no`），RLS 开启；种子预置 28 个常用科目（含 2221 应交税费 非末级→22210101/22210102 末级进/销项、5011 生产成本 非末级→5101 加工归集 末级，与 0013 成本模板科目对齐）。
- **科目字典即唯一账务来源**：凭证分录 account_code 与余额表均以 `fin_subjects` 为准；非末级（is_leaf=false）科目**不可直接用于凭证分录**（服务端强制校验，记账 400）。服务端 `src/server/finance/subjects.ts`（CRUD + 账面）+ `leaf-guard.ts`（`ensureLeafCodes` 检索末级科目做记账校验）。
- **删除保护**：科目被凭证分录引用 / 有子级 / 已配期初余额 → 不可删（400 `FIN.SUBJECT_REFERENCED/HAS_CHILDREN/HAS_BALANCE`），可 `status=disabled` 停用；编码重复 409。
- **手工记账 + 过账**：`POST /api/fin/vouchers` 登记平衡草稿（draft，借方合计=贷方合计、仅末级科目），`POST ...[id]/post` draft→posted（仅 draft），`void` 对草稿直接作废、对已过账红字冲销；`DELETE` 仅 draft。前端 `/finance/vouchers` 增 period/科目筛选 + 手工记账对话框 + 行内 过账/红冲/作废/删除。
- **科目余额表 / 试算平衡**：`src/server/finance/subjects.ts#getSubjectBalances(period)` 按期间实时聚合 期初+本期借/贷+期末（父级自动汇总子级，方向符号：正=借 负=贷）；`#getTrialBalance(period)` 以**实际分录发生额**为口径（含红字符号相抵），借贷必等，不平衡展示差额定位。调试口径由 `src/server/ledger/balance-math.ts`（`computeClosing`/`sumTrial`/`round2`）纯函数支撑，金标准 `scripts/ledger-golden.ts` 已加用例。
- **前端页面**：`/finance/subjects`（科目字典：类别分组/树表/增删改/期初/启停）、`/finance/balances`（余额表，期间选择）、`/finance/trial-balance`（试算平衡，期间选择，借贷合计+平衡标识+差额）；导航「财务→会计科目/资金模块→记账凭证·科目余额·试算平衡」。

### 财务报表 + 期末结账与年结（0016，fin_*）

- **迁移 0016_financial_close.sql**（独立文件，幂等 + RLS）：建 `fin_accounting_periods`（期间状态表：`period` PK、`status` open/closed/annual_closed、`locked` 期间锁定、`year_end` 年结标记、`profit_close_voucher_no/id` 结转损益凭证引用、`closed_by/at`、`reversed_by/at/reason` 反结账留痕）与 `fin_period_logs`（留痕日志表，**仅 INSERT**：action close/ reopen/ profit_close/ year_close、actor、reason、ref_voucher_no、payload、happened_at）；种子补 `4103 本年利润`、`4104 未分配利润`、`6402 所得税费用`、`6403 税金及附加` 科目。
- **利润表 P&L**（`GET /api/fin/pnl?period=YYYY-MM`，fin.read）：以损益类科目(category=6)本期发生额**实时汇总**（不缓存/不写死）；行=营业收入(6001，含退货贷方冲减)/营业成本(6401)/税金及附加/销管财三项费用/营业利润/营业外收支/利润总额/所得税费用/净利润；summary 附 毛利=收入−成本、毛利率、返点基数=不含税收入−退货（MOD-06）。金额口径=已过账凭证分录，价税分离（销售收入科目本身即不含税）。支持与上期(`shiftPeriod`)对比。页面 `/reports/pnl`（本期/上期两列、summary 卡片、可打印）。
- **资产负债表**（`GET /api/fin/balance-sheet?period=`，fin.read）：按科目类别 资产1/负债2/共同3/权益4 的**期末余额（结转后口径）实时汇总**，期初/期末两列按 `opening_*` 与 `closing_*`；`money_fund` 货币资金=库存现金+银行存款等现金类；`total_assets` vs `total_liab_equity` 必须 `balanced`（差值 `diff` 定位展示）。页面 `/reports/balance-sheet`（分组卡片、期初/期末、平衡徽章 + 差值、可打印）。
- **服务端**：`src/server/finance/reports.ts`（getPnl/getBalanceSheet，复用 `subjects.ts` 的 `accountFlowsBetween`/`getSubjectBalances` 与 `loadSubjects`）；纯函数在 `src/server/ledger/balance-math.ts`（`pnlRevenue/pnlExpense/pnlNet/balanceEquality/periodLocked`）。
- **期末结账 / 补结转**（`/api/fin/periods`，fin.read；动作 POST fin.write）：
  - `GET /api/fin/periods` → 月结清单：各期间 status/locked/voucher_count（posted 凭证数）/total_debit/credit/balanced（试算平衡）/profit_close_voucher_no。
  - `POST /api/fin/periods/[period]/profit-close` → **结转损益**：把所有损益科目余额结转至「本年利润 4103」，借贷恒平衡、`(event_type=period_profit_close,event_id=period)` 幂等防重；无发生额返回 `{skipped:true}`。
  - `POST /api/fin/periods/[period]/close` → **期间结账**：先结转损益再把期间 open→closed 并 locked，写日志。
  - `POST /api/fin/periods/[period]/reopen` body `{reason}` → **反结账留痕**：closed→open、unlock，记录谁/何时/原因到 `fin_period_logs`（日志不可删除）。
  - `POST /api/fin/periods/[period]/year-close`（period 取年份前 4 位）→ **年结**：顺带把该年 12 个月 closed → 本年利润→未分配利润(4104) 凭证（event_type=year_retained,event_id=year 幂等）→ 资产/负债/权益科目期末结转次年期初（更新 `opening_amount/opening_direction`）、本年利润期初清零、期间置 annual_closed。
  - `GET /api/fin/periods/[period]/logs` → 期间留痕日志。
- **期间锁定（period-guard）**：`src/server/finance/period-guard.ts`（叶模块避免循环依赖）`isPeriodLocked/assertPeriodOpen`；接入手工凭证创建(`createManualDraftVoucher`)与过账(`postVoucher`)——无 `fin_accounting_periods` 记录或 locked 期间禁止过账新凭证（400 `FIN.PERIOD_LOCKED`）。**结账后该期间不再允许新增/修改/过账，只可红字冲销或反结账。**
- **凭证事件**：`EVENT_PERIOD_PROFIT_CLOSE='period_profit_close'`、`EVENT_YEAR_TO_RETAINED='year_retained'`（`src/server/ledger/ledger.ts`）；结转凭证 status=posted/source=auto/template_code=period_profit_close 或 year_to_retained。
- **前端**：`/finance/period-close`（'use client'，`useAuth().can('fin.write')` 控制操作按钮）：月结清单表格（期间/状态徽章/凭证数/借贷合计/试算平衡/结转损益单号），行内 转损益·结账·反结账（弹 reason 必填框）·日志抽屉，右上「年结」对话框（输入年份）。合计金额 `formatMoney`，`fin.read` 只读、写操作需 `fin.write`。
- **导航**：`app-shell.tsx` 财务组新增「财务报表→/reports/pnl、期末结账→/finance/period-close」；报表组新增「利润表→/reports/pnl、资产负债表→/reports/balance-sheet」。

### 费用报销 / 银行对账 / 现金流量表（0017，fin_*）

- **迁移 0017_expense_bank_cf.sql**（独立文件，幂等 + RLS，不改既有迁移）：
  - `fin_expense_claims`（报销单头：`claim_no` 唯一 BX+yyyymmdd-NNNN、applicant、dept、claim_date、period、payee、`pay_account`(贷方科目，默认 2241 其他应付款)、status(draft/pending/approved/rejected/paid)、total_amount/excl_amount/tax_amount、approval_level/current_step/submitted_*/approved_at、`voucher_no`(费用确认凭证)、`payment_id`(付款单)、reject_reason、remark、created_by/at）与 `fin_expense_claim_items`（明细：subject_code/name 快照、summary、amount 含税、tax_rate、excl_amount、tax_amount）。
  - `fin_bank_statements`（银行对账单：bank_account、tran_date、direction in/out、amount、summary、balance、`matched_status` unmatched/matched、matched_ref_type/id/no、source、remark）。
  - 种子：`2241 其他应付款`（负债类、贷）；审批规则 `doc_type='expense'` 按含税金额分档（第 1 档 0–1000 一级 manager，第 2 档 >1000 两级 manager→admin）；
- **费用报销**（`src/server/finance/expenses.ts`）：
  - `GET/POST /api/fin/expenses`、`GET/PUT/DELETE /api/fin/expenses/[id]`（fin.read/fin.write）：列表分页(status/period/keyword=单号/申请人)、详情含明细+审批步骤；服务端重算价税分离（`computeItem`：amount=r/(1+rate)，excl、tax 分别 round2）与合计，禁客户端传金额；仅 draft/rejected 可编辑，仅 draft 可删。
  - `POST .../submit`（draft/rejected→pending，按含税金额分级）、`.../approve`、`.../reject`：复用四级审批引擎 `docType='expense'`（`src/server/approval/engine.ts` 已扩展 table=fin_expense_claims）。
  - **审核通过生成费用确认凭证**（幂等 UNIQUE event_type,event_id）：`onExpenseApprove`（events.ts）→ 借 各费用科目(不含税 excl) + 借 22210101 可抵扣进项税(合计 tax) + 贷 `pay_account`(默认 2241 其他应付款) 含税合计；回写 claim.voucher_no。
  - `POST .../pay`（仅 approved→paid）：登记 `fin_payments`(direction=payment,status=approved) + `onExpensePay` 生成付款凭证（借 2241 其他应付款 / 贷 1002 银行存款）+ 回写 payment_id。
- **银行对账**（`src/server/finance/bank.ts` + 纯函数 `bank-math.ts`）：
  - `GET/POST /api/fin/bank-statements`、`PUT/DELETE /[id]`、`POST /auto-match`、`POST /[id]/unmatch`、`GET /api/fin/bank-recon`（fin.read/fin.write）。
  - 日记账（book）源：`fin_payments`(status=approved；receipt→in、payment→out) 按银行账户归集；对账单（bank）= `fin_bank_statements`。
  - **自动匹配** `matchStatements`：同账户 + 同方向 + 金额(±0.01) + 日期(±3 天) 一对一贪心，优先日期最近；命中置 matched_status=matched + matched_ref_*。
  - **未达账项调节表** `reconcile`：账面调节 = 账面余额 + 银行已记企业未记净额；银行调节 = 银行余额 + 企业已记银行未记净额；两者 `diff≈0` 即 `balanced`。前端 `/finance/bank-recon`（账户/自动匹配/录入/导入、未达账项表、调节表平衡徽章）。
- **现金流量表**（`src/server/finance/cashflow.ts` + 纯函数 `cashflow-math.ts`，`GET /api/fin/cash-flow?period=YYYY-MM`，fin.read）：
  - **直接法**：遍历期间已过账凭证，凡触及货币资金科目(1001/1002)按**对方科目编码归类**活动——`classifyActivity`：16xx/17xx/15xx/1901→投资、4xxx→筹资、其余→经营；汇总各类流入/流出/净额，`directNetChange`=三类净额之和=货币资金净变动。
  - **间接法**：净利润(取自 P&L) + 非付现/营运资本调整，以直接法经营净额为锚点、差异列入「其他调整（结构性差异）」，`reconcileIndirect` 保证 `balanced`；**两法现金净增加额强制相等**（FR-FIN-024），接口返回 `methods_equal`/`diff`。
  - 前端 `/reports/cash-flow`（直接法/间接法 Tab、可打印、两法恒等徽章）。
- **权限**：fin.read（含 staff 只读）/ fin.write（admin+manager 可写，报销/对账/付款）；匿名 401。
- **前端/导航**：页面 `/finance/expenses`（报销单列表+`expense-form-dialog`新建多明细行+`expense-detail-sheet`详情/审批/`pay`登记付款）、`/finance/bank-recon`、`/reports/cash-flow`；`app-shell.tsx` 财务组新增「费用报销(ReceiptText)、银行对账(Banknote)」、报表组新增「现金流量表(Waves)」；`ApprovalPanel` docType 已扩展 `expense`（API_BASE→/api/fin/expenses）。
- **纯函数测试**：`scripts/ledger-golden.ts` 新增费用报销价税分离、银行对账匹配/未达账项调节、现金流量活动归类/两法恒等用例（共 68 passed）。

- **固定资产与折旧**（`src/server/finance/fixed-assets.ts` + 纯函数 `fixed-assets-math.ts`，迁移 `0018_fixed_assets.sql`）：
  - **表**：`fin_fixed_assets`（asset_no 唯一 FAyyyymmdd-NNNN、name/category/spec、original_value、depreciation_method='straight_line'、useful_life(月)、salvage_value、acquisition_date/acquisition_period、related_subject(折旧费用科目，默认 6601 管理费用)、status in_use/fully_depreciated/disposed、处置字段 disposal_*）；`fin_depreciation_records`（asset_id FK、period、amount、voucher_id/voucher_no，**UNIQUE(asset_id,period) 幂等**）。两表 RLS。
  - **直线法口径**（纯函数，golden 直接回归）：月折旧额=(原值−残值)/使用年限(月)；**最后一期兜底**（`periodDepreciation` 当 months_accrued+1=useful_life 时取剩余应提，尾差归零，提足后净额=残值）；**入账次月起提**（runDepreciation 筛选 `acquisition_period < period`）。
  - **月度计提** `runDepreciation(period)`（fin.write，期间须开放）：对在用未提足资产逐条生成折旧凭证（借 related_subject / 贷 1602 累计折旧，event=depreciation id=`{period}:{asset_id}` 幂等）+ 写 records（UNIQUE 兜底，重复执行 processed=0）；提足自动置 fully_depreciated。`GET /api/fin/depreciation` 折旧历史（period/asset_id 过滤，含资产编码+名称）。
  - **处置** `disposeFixedAsset`（fin.write，期间须开放）：`buildDisposalLines` 恒平衡——借 1602 累计折旧 + 1002 处置收入 + (净值>收入时借 6711 营业外支出损失) / 贷 1601 原值 + (收入>净值时贷 6301 营业外收入收益)；event=asset_disposal id=asset_id 幂等；状态→disposed 停止折旧。
  - **守卫**：残值须<原值（400 FIN.SALVAGE_TOO_HIGH）；asset_no 唯一（409 FIN.ASSET_NO_DUP）；已计提(months_accrued>0)禁改原值/残值/年限/入账日期且禁删（400 FIN.ASSET_HAS_DEPRECIATION）；已处置禁改禁删禁重复处置（400 FIN.ASSET_DISPOSED）。
  - **迁移 0018 附带**：`fin_vouchers.event_id` varchar(36)→**varchar(64)**（折旧 event_id `YYYY-MM:uuid` 需 44 字符，非破坏扩宽）；种子 6301/6711 科目（ON CONFLICT 幂等）。
  - **前端/导航**：`/finance/fixed-assets`（列表+类别/状态筛选+`fixed-asset-form-dialog`新建（实时月折旧预览）+`fixed-asset-detail-sheet`详情含折旧进度条/折旧历史/处置弹层（实时损益测算））、`/finance/depreciation`（汇总卡片+选期间执行计提+本次明细+折旧历史）；导航「固定资产(Landmark)、折旧计提(Calculator)」入财务组。
  - **纯函数测试**：golden 新增直线法(含残值)/最后月归零兜底/净值口径/处置损失与收益与报废三种平衡用例（共 86 passed）。

- **税务增强**（发票台账/异地预缴/税会差异/申报底稿，迁移 `0019_tax_enhance.sql`，`src/server/tax/{invoices,prepaid,soc-diff,worksheet}.ts` + 纯函数 `tax-math.ts`）：
  - **表**：`tax_invoices`（invoice_type special/normal、direction input/output、invoice_date→period 自动取值、amount_ex_tax/tax_amount/amount_total=excl+tax、rate、related_bill、supplier/customer_name、status pending待勾选/checked已勾选/filed已申报/void已作废，**UNIQUE(direction, invoice_no)**）；`tax_prepaid`（period、project、region、prepaid_amount、based_tax、prepaid_date、status active/void）；`tax_soc_diff`（period、diff_type temporary/permanent、item、tax_base/accounting_base、diff_amount=税法−会计服务端算）。三表 RLS。
  - **发票流转**：pending→checked（勾选认证）→filed（标记申报），任意状态→void；filed 禁改禁删（400），void 可删；同方向重号 409（TAX.INVOICE_DUP）。
  - **申报底稿** `GET /api/tax/worksheet?period=`（`getWorksheet`）：以 `getTaxFiling` 销项/进项为基，`vat_before_prepaid=max(销−进,0)`、`carried_forward=max(进−销,0)`；叠加 active 预缴合计 → `net_payable=max(应纳−预缴,0)` 应补 / `refundable=max(预缴−应纳,0)` 应退（纯函数 `computeWorksheet`）；`sources` 五类来源计数（tax_entries 销/进项、发票台账、预缴、差异）；`soc_diff` 输出时间性/永久性笔数与金额。
  - **filing 增强**：`getTaxFiling` 返回 superset 追加 `prepaid_total/net_payable/refundable/soc_diff`（前端 `/tax/filing` 展示「已抵预缴/应补(退)/差异提示」卡）。
  - **差异口径**：日常只做**时间性**差异提示（bottomline 汇算清缴时处理**永久性**），`socDiffAmount=税法−会计`（正=税法多计）。
  - **权限**：新增 `tax.read`/`tax.write` 权限点（admin=*；manager 读写；staff 只读）；既有 `/api/tax/entries|summary|filing` 同步由 fin.read 切至 tax.read（访问面不变）；匿名 401。
  - **前端/导航**：`/tax/invoices`（台账+方向/类型/状态筛选+录入弹窗（价税合计实时预览）+行内勾选/申报/作废/删除）、`/tax/prepaid`（登记+作废）、`/tax/tax-diff`（登记+类型统计卡）；导航「税务」组新增 发票台账(FileText)/异地预缴(MapPin)/税会差异(GitCompareArrows)，税额统计权限点同步 tax.read。
  - **纯函数测试**：golden 新增价税合计/税率反算/税会差异符号/底稿应补·应退·留抵口径用例（共 99 passed）。

- **系统管理**（四粒度权限/参数中心/审计日志/审批流配置，迁移 `0020_system_mgmt.sql`，`src/server/system/{roles,settings,audit,approval-rules}.ts`，页面 `/system/{roles,settings,audit-logs,approval-flows}`）：
  - **表**：`sys_roles`（code 唯一、data_scope CHECK all/dept/self、is_system、status active/disabled）；`sys_role_permissions`（UNIQUE(role_id,permission_key)，FK cascade）；`sys_user_roles`（UNIQUE(user_id,role_id)，FK cascade）；`sys_settings`（key 唯一、value_type CHECK number/string/boolean/json、group_name、is_sensitive、is_system、updated_by FK）；`sys_audit_logs`（user_id 可空、username 快照、action、resource、resource_id、detail jsonb、ip、operated_at；**BEFORE UPDATE/DELETE 触发器 RAISE P0403 只追加**）；`sys_users` 加列 `dept`。五表 RLS。
  - **角色**：内置 admin/manager/staff（is_system）种子——admin 通配不可配、内置角色禁删/禁改权限点（400）、已分配用户的角色禁删（400）；自定义角色 code 唯一 409；权限点全量替换须 ⊆ PERMISSION_CATALOG（非法 400）；用户-角色分配/部门调整后 `invalidateAuthorizationCache`。
  - **参数中心**：`getSetting(key)`/`getNumberSetting` 带 30s 缓存供模块引用（阈值只在参数中心维护）；`validateValueByType`（number 须数字、boolean 限 true/false/1/0、json 须合法 JSON，违例 400）；敏感参数仅 admin 可建/改（403）；内置参数仅可改 value/description、禁删。
  - **审计日志**：`writeAuditLog`（失败静默 console.error 不阻断业务）已埋点——登录成功、审批 submit/approve/reject（引擎中央函数）、凭证 post/void、参数增删改、角色增删改/权限配置/角色分配/部门调整、审批规则更新；查询仅 GET 只读（无写端点）。
  - **审批流配置**：`listApprovalRules`（按 doc_type+level 排序，返回 doc_types）/ `updateApprovalRule`（金额区间 + steps 全量替换；步骤角色限 manager/admin 400；写审计）；前端 `/system/approval-flows` 按单据类型分组可视化编辑，配置即时生效于下次提交（引擎按提交时金额命中规则）。
  - **权限点**：新增 `sys.read`（admin/manager）/ `sys.write`（admin/manager）/ `field.cost_price`（admin/manager）/ `field.customer_phone`（admin/manager）；staff 对 /api/system/* 全 403；匿名 401。
  - **前端/导航**：`/system/roles`（角色列表+新建/编辑弹窗+权限点四粒度勾选面板+用户-角色分配与部门调整）、`/system/settings`（分组卡片+新建/编辑弹窗，值类型校验提示+敏感锁标识）、`/system/audit-logs`（操作/资源/用户/时间范围筛选+详情 JSON 弹层）、`/system/approval-flows`（按单据类型分组的档位卡片+编辑弹窗步骤序列）；导航「系统设置」组新增 角色权限(ShieldCheck)/参数中心(SlidersHorizontal)/审批流配置(GitBranch)/审计日志(ScrollText)，均 sys.read。
  - **冒烟**：/tmp/system_mgmt_smoke.py 53 项——角色 CRUD/code409/权限配置、staff 分配自定义角色后并集获得 po.write+数据范围 self+成本价可见（回收后还原）、越权 md.write 仍 403、self 范围看不到他人单据、手机号脱敏置 null、参数 key409/坏值400/敏感 manager403、审计写入+无删除端点、审批规则更新/非法角色400、四页面 200、既有模块回归；golden 第 20 节 33 用例（共 160 passed）。

- **成本结转两套模板（迁移 0013，幂等种子）**：`MANUFACTURE_FINISH`（event=manufacture_finish，借 1405 库存商品 `#amount` / 贷 5101 生产成本—加工归集 `#amount`）与 `SALES_SHIPMENT_COST`（event=sales_cof_shipment，借 6401 主营业务成本 `#amount` / 贷 1405 库存商品 `#amount`）；均 `balance_to=6601 管理费用`。`src/server/ledger/events.ts` 新增 `onSalesShipmentCost` / `onManufactureFinish`（按 (event_type,event_id) 幂等）。
- **接入点**：`sales/shipments.ts#approveShipment` 与 `sales/orders.ts#completeOrder`（一键发货）终审出库后生成销售成本凭证（cost=单头 `total_cost`）；`processing.ts#finishManufacturing` 在加工单 →completed 后生成加工完工成本凭证（cost=`issued_cost` 投入成本，差额按损耗处理）。
- **期末成本结转批处理**：`src/server/ledger/period-close.ts#closePeriodCostTransfer(period, operatorId)` 扫描期间内 `so_shipments.status=approved`（按 approved_at）与 `ma_* status=completed`（按 updated_at），对缺失凭证幂等补生成；`POST /api/fin/vouchers/period-close {period}`（admin 或 fin.write），返回 `{shipment_cost, manufacture_finish}` 新增计数（二次执行为 0）。
- **纳税申报雏形**：`src/server/tax/tax.ts#getTaxFiling(period)` 按期间聚合 `tax_entries` → 销项/进项 金额·基数·税额，`deductible_input=进项税`（雏形默认全可抵扣）、`vat_payable=max(销项−可抵扣,0)`、`carried_forward=max(可抵扣−销项,0)`，并分税率 rows（0019 起返回 superset 追加预缴/应补退/差异提示字段，见税务增强节）；`GET /api/tax/filing?period=YYYY-MM`（tax.read，校验格式）→ 页面 `/tax/filing`（导航「税务→纳税申报」）；`md_products.tax_rate` 已贯穿 create/update zod schema + normalize（数字，>0，缺省 13），确保写读路径生效。
- **按单核销前端**：`fin_payments` 本已支持 `order_id`（收款=销售订单=应收单、付款=采购订单=应付单）；`FinBillRow` 服务端(payments.ts#listBills)与 `src/lib/types.ts` 补 `order_id`；`fin-bills.tsx` 应收/应付单表格升级为复选框多选（open 行）+ 按所选核销 + 每行核销按钮；`payment-form-dialog.tsx` 支持 `bills?: FinBillRow[]` 多单分摊登记（先扣 outstanding 大者），前端校验合计 ≤ 所选 outstanding，服务端靠 `fin_apply_receipt/payment` 超额拦截兜底（400 `FIN.OVER_AMOUNT`）。
- **PDA 扫码出入库**：`/m/pda/stock-io`（'use client'，采购入库 GR / 销售出库 SH 双 Tab）弱耦合只读复用 `GET /api/po/receipts`、`GET /api/so/shipments`（列表，draft/pending/approved）与 `GET ...[id]`（明细含 `product_sku`）；扫描/输入条码按 `product_sku`（或品名含）匹配明细并高亮核对计数，本地确认汇总、**不新增端点/不落数据**。`/m/` 首页新增「扫码出入库」卡片、底部导航 `grid-cols-5` 补「出入库」。

### 销售模块约定（so_*，V2 三单主链路）

- **三单**：订单 `so_sales_orders`(SO) → 出库单 `so_shipments`(SH) → 退货单 `so_returns`(SR)；明细表 `so_sales_order_items` / `so_shipment_items`（含 `cost` 成本列）/ `so_return_items`（含 `unit_cost` 快照列）。订单/出库/退货表均带审批列（approval_level/current_step/submitted_by/at/approved_by/at/reject_reason）。
- **状态机**：与采购统一——`draft` → `pending` → `approved` / `rejected` → 订单终态 `shipped`（全部明细出库完成）；`draft/pending/rejected` 可 `closed`。仅 `draft` 可删，`draft/rejected` 可编辑。**0007 迁移**：旧数据 confirmed→approved、completed→shipped、cancelled→closed。
- **审批**：复用通用引擎 `src/server/approval/engine.ts`（doc_type 扩展 `sales_order`/`shipment`/`sales_return`；终审 RPC 映射 `so_execute_shipment`/`so_execute_return`）。规则种子：sales_order 四级金额档（同采购），shipment/sales_return 一级 manager。权限点新增 `so.approve`（admin、manager）。
- **价格策略雏形**：`GET /api/so/quote?customer_id&product_id` 按客户等级折扣建议售价（`md_customers.level`：normal=1 / vip=0.98 / strategic=0.95 × `reference_sale_price`）；订单锁定成交价，出库单创建时单价**强制取订单价**（不信任客户端传价）。
- **出库终审** `so_execute_shipment`（plpgsql 单事务）：FOR UPDATE 锁订单 → **数量强校验**（累计已审出库+本次 ≤ 订单量，超出 P0400）→ 逐行负库存拦截（P0001）→ 按 `avg_cost` 结转销售成本写入明细 `cost` 与单头 `total_cost` → 全部出库完成则订单→shipped。部分出库时订单保持 approved，可继续建出库单。
- **一键发货** `so_fulfill_order`（订单 approved → 自动生成出库单并即审出库，防重复出库校验），`POST complete` 返回 `{shipment_no}`。
- **退货终审** `so_execute_return`：退货量 ≤（已出库−已退）强校验；按明细 `unit_cost`（建单时快照当时 avg_cost）红字回补库存并重算加权均价；与出库单关联（shipment_id 可空）。
- **应收口径**（fin 聚合）：Σ(订单 status∈shipped/completed) − Σ(approved 退货) − Σ(收款)；`createPayment` 关联销售订单校验 status∈shipped/completed。
- **单号**：SO/SH/SR + `yyyymmdd-NNNN`；shipment 单号也可由 `so_fulfill_order` 在库内生成。
- **前端**：`/sales/orders`（列表+new+[id]，详情含审批面板/发货出库/建出库单/建退货单入口）、`/sales/shipments`、`/sales/returns`（均列表+new+[id]）；订单编辑器选客户+商品后自动调 quote 预填建议价；ApprovalPanel DOC_PATH 已含销售三种 docType。

### 报表模块约定（report_*，周边 V1，纯只读聚合）

- **无独立表**：报表为只读实时聚合（SDK-only，不建表/视图/物化），满足"不用真实时序、SQL 聚合即可"的应用场景。数据源：`po_purchase_orders`(status=received)、`so_sales_orders`(status=shipped)、`so_shipments`(status=approved 的出库成本)、`inv_stock`(跨仓数量×avg_cost)、`fin_*`(应收应付口径同财务模块)。
- **口径**：采购总额=Σ(received 采购订单总额)；销售总额=Σ(shipped 销售订单总额)；毛利=销售总额−Σ(approved 出库单 total_cost)；库存总值=Σ(inv_stock.quantity×avg_cost)，库存品项=Σ(有余额的 SKU)；应收/应付沿用财务模块欠款口径。
- **分组**：`GET /api/report/{purchase,sales}?groupBy=` 支持 supplier/customer/product/month（按单号/商品名聚合，from/to 日期过滤）；inventory 支持 warehouse/product。
- **服务端**：`src/server/reporting/*`（overview/purchase/sales/inventory/parse/shared）；/api/report/* 均走 `requireAuth`（已登录即可看，无独立权限点）。
- **前端**：`/dashboard`（指标卡+今日/本月/累计+近12月 SVG 折线趋势）、`/reports/overview|purchase|sales|inventory`（可分组切换+打印）。图表为纯 SVG/CSS 组件（`src/components/reports/bar-chart.tsx`、`line-chart.tsx`、`report-panel.tsx`），无重库依赖。

### 加工模块约定（ma_*，V1）

- **表**：`ma_manufacturing_orders`（加工单：doc_no=`MAyyyymmdd-NNNN`、processing_type（字典 processing_type：cut/slot/edge/combine）、loss_ratio 损耗比例 default 0.05、status draft/pending/approved/completed/closed、estimate_cost 预估(Σ投入×参考价)、issued_cost 已领料成本、allocated_cost 已分摊成本、审批列）+ `ma_manufacturing_items`（kind input 投入原料 / output 产出成品；quantity 计划 / done_quantity 已完成 / unit_cost 领料均价或完工分摊单价 / product 快照）。新表全启 RLS。
- **状态机**：`draft` → `pending` → `approved` → `completed`；`rejected` 可编辑重提；`draft/pending/rejected` 可 `closed`。仅 `draft` 可删，`draft/rejected` 可编辑。
- **审批**：复用通用引擎 `src/server/approval/engine.ts`，docType `manufacture`（**刻意不加 EXECUTE_RPC**，走非 rpc 分支仅置 status=approved，以支持后续分批执行）。规则种子两档金额：≤5w 一级 manager、>5w manager+admin。权限点 `ma.read`（staff 只读）/ `ma.write`（建单/领料/完工/关闭）/ `ma.approve`，均 admin+manager。
- **执行（plpgsql 单事务，db/migrations/0012_processing.sql）**：
  - `mo_execute_issue(p_mo_id,p_warehouse_id,p_items jsonb,p_user_id)`：仅 approved；按行校验 累计领料 ≤ 计划（超 `MA_OVER_ISSUE`）；逐个 `inv_apply_issue_out('manufacture_issue')` 扣原料（按移动加权均价），累加 `issued_cost`，返回本次领料成本。
  - `mo_execute_finish(...)`：校验 Σ产出已完 ≤ Σ投入已完×(1−损耗)（`MA_LOSS_VIOLATION`）→ 按**未分摊成本**(issued−allocated)均摊单价 → `inv_apply_receipt_in('manufacture_finish')` 产成品入库并批次，累加 `allocated_cost`；投入+产出全部完成 → completed。
  - 投入-产出-损耗守恒由 plpgsql CHECK/函数保证；完全完工前的累计产出受 `round(Σinput.done×(1-loss),2)` 上限约束。
- **领料/完工为分批**：可多次 POST issue/finish，每次按 `items[]`（product_id+quantity）增量执行；`p_items` 传 JSON 数组（PostgREST jsonb 绑定，**勿 JSON.stringify 成字符串**否则 `cannot extract elements from a scalar`）。
- **错误映射**：`src/server/processing/processing.ts#throwMaRpcError`，message 小写匹配：`ma_not_found`→404、`ma_bad_state`→400 MA.BAD_TRANSITION、`ma_over_issue`/`ma_over_output`→400、`ma_loss_violation`→400、`p0001/库存不足`→400 INV.INSUFFICIENT_STOCK、`ma_bad_param`→400。
- **成本雏形**：产成品 `unit_cost` = (issued_cost−allocated_cost)/本次完工量，随 `inv_apply_receipt_in` 进移动加权均价，为成本引擎/毛利服务；**不强制结转凭证**（留待后续）。
- **前端**：`/manufacturing/orders`（列表 status/processing_type 筛选 + 新建）、`/manufacturing/orders/[id]`（投入/产出明细、ApprovalPanel docType=manufacture、分批领料/完工对话框、编辑/关闭/删除）；`app-shell` 导航「加工管理→加工单」；`src/components/processing/mo-editor-dialog.tsx` 编辑器（加工类型取 `/api/dict/lookup?types=processing_type`）。
- **动作型路由必须包 `handleError`**：加工 8 个 API 路由全部 try/catch `handleError(error)`，否则业务 400/404 会变 500。

### 系统数据字典 + 基础资料扩充约定（周边 V1）

- **表**：`dict_system_types`（字典类型，type_code 唯一、is_system 内置标记）+ `dict_system_items`（字典项，UNIQUE(type_code,item_code)、extra JSONB 存折扣/税率等扩展）+ `md_units`（计量单位：unit_code 唯一、base_unit 基准单位、conversion_ratio 换算系数）。
- **种子**（0009_dict.sql 幂等）：unit(片/箱/㎡)、payment_method(现金/银行/微信/支付宝)、tax_rate(0/3/6/9/13%)、customer_level(normal/vip/strategic，extra.discount_rate 与销售等级一致)、status(启用/停用)；单位 片(基准)/箱(=10片)/㎡(=0.8片)。
- **引用**：`GET /api/dict/lookup?types=a,b` 只读返回活跃项映射 `{data:{type:[items]}}`，供任意模块下拉（不建 FK，值快照在业务侧）。
- **权限**：dict_* 与 md_units 写操作用 `md.write`（manager），读 `md.read`（staff 只读，写 403）；报表 `/api/report/*` 仅要求登录。
- **仓库完善**：仓库管理沿用库存 `inv_warehouses`（已有清单+新增+启停维护），不另建 md_warehouse，避免双套仓库档案。
- **前端**：`/system/dictionary`（类型+字典项双栏维护，系统内置类型不可删）、`/master-data/units`（计量单位分页+换算维护）。

### 数据库工作流（强制）

1. `coze-coding-ai db generate-models`（首次）
2. 编辑 `src/storage/database/shared/schema.ts`（**唯一权威来源**）
3. `coze-coding-ai db upgrade`
4. 新表必须启用 RLS（exec_sql: `ALTER TABLE xxx ENABLE ROW LEVEL SECURITY;`，不自建 Auth 的场景不建 policy）
5. 同步更新 `db/migrations/*.sql` 版本化记录（独立部署时使用）
6. 约束：`src/storage/database/` 下除 supabase-client.ts 外不新增文件；CRUD 一律走 Supabase SDK（`getSupabaseClient()`），禁手写 SQL/原生驱动/直连连接串。

### 关键目录

```
src/
├── server/                  # 服务端业务逻辑（仅服务端可 import）
│   ├── http.ts              # ApiError + 统一错误处理
│   ├── doc-no.ts            # 业务单号生成（当日最大序号+1，全模块共用）
│   ├── auth/                # password(scrypt)/session/permissions/guard/bootstrap
│   ├── master-data/         # 客户/供应商/商品的查询/校验/序列化 + helpers(分页/模糊搜索)
│   ├── approval/            # 通用四级审批引擎（engine.ts，采购/销售共用，终审 RPC 失败自动回滚步骤）
│   ├── purchase/            # 采购 V2：orders(订单) / requisitions(申请+转订单) / receipts(入库+暂估冲回) / returns(退货)
│   ├── sales/               # 销售 V2：orders(订单+quote 等级报价) / shipments(出库+成本结转) / returns(退货红字回补)
│   ├── inventory/           # 库存服务（stock 余额/warehouses 仓库/batches 批次/alerts 预警/movements 流水/transfers 调拨/checks 盘点/RPC 错误映射）
│   ├── finance/             # 财务服务（payments 收付款单 CRUD + 应收/应付欠款汇总 + 超额校验 + subjects 科目字典/余额/试算平衡 + reports 利润表/资产负债表 + period-close 期末结账/结转损益/反结账/年结 + period-guard 期间锁定）
│   ├── ledger/              # 凭证引擎（ledger 模板+平衡+幂等+红冲 / events 业务事件接入层 computeItemsTax+fetchName）
│   ├── tax/                 # 税务（tax 进/销项登记+filing 汇总增强 / invoices 发票台账 / prepaid 异地预缴 / soc-diff 税会差异 / worksheet 申报底稿 / tax-math 纯函数）
│   ├── reporting/           # 报表服务（overview 汇总卡片+趋势 / purchase / sales / inventory 分组聚合 / parse/shared）
│   └── dict/                # 系统字典（dict.ts：类型/项的查询校验序列化 + lookup 引用）
├── app/api/                 # Route Handlers（薄层，调 server 服务）
├── app/(app)/               # 登录后区域（路由组，layout 内做守卫）
│   ├── dashboard/           # 仪表盘（含采购/销售/库存/财务统计卡片 + 经营指标卡 + 近12月 SVG 趋势）
│   ├── master-data/         # customers / suppliers / products / units(计量单位) 页面
│   ├── reports/             # 经营报表：overview / purchase / sales / inventory（分组切换+打印）+ pnl 利润表 / balance-sheet 资产负债表（期间+本期/上期或期初/期末、可打印）
│   ├── system/              # system/dictionary 数据字典（类型+字典项双栏维护）
│   ├── purchase/            # orders(订单) / requisitions(申请+convert) / receipts(入库+冲回) / returns(退货)，均列表+new+[id]
│   ├── sales/               # orders(订单) / shipments(出库) / returns(退货)，均列表+new+[id]（new 需 ?order= 预填）
│   ├── inventory/           # stock 库存余额(冻结) / movements 台账 / batches 批次 / alerts 预警 / warehouses 仓库 / transfers 调拨(列表+new+[id]) / checks 盘点(列表+new+[id])
│   └── finance/             # receivables 应收欠款 / payables 应付欠款 / payments 收付款流水 / subjects 会计科目 / vouchers 记账凭证 / balances 科目余额表 / trial-balance 试算平衡 / period-close 期末结账与年结
├── components/
│   ├── auth/auth-provider.tsx   # 会话 Context（useAuth().can()）
│   ├── layout/app-shell.tsx     # 侧边栏 + 顶栏（移动端抽屉导航）
│   ├── master-data/             # 表单对话框 / 分页 / 状态徽章 / 删除确认
│   ├── trade/                   # 购销通用：订单编辑器(kind 区分购销) / 状态徽章 / 动作确认弹窗
│   ├── purchase/                # 采购 V2 通用：approval-panel(审批步骤+操作) / doc-item-editor(明细编辑器)
│   ├── inventory/             # 库存通用：warehouse-select（仓下拉，filter 模式+表单模式）
│   ├── reports/               # 报表图表：bar-chart(纯 SVG 横向柱状+formatMoney) / line-chart / report-panel(分组+打印)
│   └── finance/                 # 财务通用：欠款汇总列表(kind 区分应收应付) / 收付款登记对话框 / 凭证/税务页面组件
├── lib/                     # api-client / types / use-paged-list(支持 filters)
└── storage/database/        # supabase-client.ts + shared/schema.ts
db/migrations/               # 版本化 SQL（0001 基础+认证 / 0002 采购 / 0003 销售 / 0004 库存 / 0005 财务 / 0006 采购 V2 五单+审批+成本+冲回 / 0007 销售 V2 出库+退货+等级报价 / 0008 库存 V2 多仓+批次+调拨+盘点+预警 / 0009 周边：系统字典 dict_* + 计量单位 md_units / 0010 财务 V2 应收应付核销 / 0011 财务凭证引擎+税务 / 0012 加工 ma_* / 0013 成本结转凭证 / 0014 PDA 移动端零迁移 / 0015 会计科目 fin_subjects/凭证手工记账 / 0016 期末结账：fin_accounting_periods 期间状态表(open/closed/annual_closed+locked+结转损益凭证号+结账/反结账留痕) + fin_period_logs 留痕日志表(仅INSERT) + 本年利润4103/未分配利润4104/所得税费用6402/税金及附加6403 种子 / 0017 费用报销 fin_expense_claims(+items)+ 银行对账单 fin_bank_statements + 其他应付款2241 种子 + expense 审批规则 / 0018 固定资产 fin_fixed_assets + 折旧记录 fin_depreciation_records(UNIQUE(asset_id,period)) + 6301/6711 种子 + fin_vouchers.event_id 扩宽 36→64 / 0019 税务增强：tax_invoices 发票台账(UNIQUE(direction,invoice_no)) + tax_prepaid 异地预缴 + tax_soc_diff 税会差异 / 0020 系统管理：sys_roles + sys_role_permissions + sys_user_roles + sys_settings + sys_audit_logs(只追加触发器) + sys_users.dept）
scripts/seed-dev.ts          # DEV 测试账号种子
```

### 冒烟测试注意事项

- `test_run` 命令并行执行且跨命令共享状态不可靠：每条命令必须自包含（自带 login、独立 cookie jar）；负向断言用 `CODE=$(curl -w '%{http_code}' ...)` + `test` 收口。
- curl 直接发**未百分号编码的非 ASCII query**（如 `?keyword=冒烟`）会被 Node HTTP 层以 400 空响应拒绝（非业务错误）；冒烟用 ASCII 关键字（如单号），中文模糊搜索由浏览器自动编码，不影响前端使用。
- 超长、含多层嵌套引号的 shell 在 test_run 中转义易被破坏；复杂全链路（登录→建资料→建单→确认→出入库→断言）用自包含 Python 脚本（`urllib` + `http.cookiejar.CookieJar`，TS 后缀避免单号/编码冲突）驱动，打印 `XXX_SMOKE_OK` 收口。
- completed 单据不可删除且外键引用客户/供应商/商品，库存流水只追加，故冒烟产生的主数据与库存数据保留在 DEV 库（业务断言通过即可），不要在脚本末尾强删。

## 包管理规范

**仅允许使用 pnpm** 作为包管理器，**严禁使用 npm 或 yarn**。
**常用命令**：
- 安装依赖：`pnpm add <package>`
- 安装开发依赖：`pnpm add -D <package>`
- 安装所有依赖：`pnpm install`
- 移除依赖：`pnpm remove <package>`

## 开发规范

### 编码规范

- 默认按 TypeScript `strict` 心智写代码；优先复用当前作用域已声明的变量、函数、类型和导入，禁止引用未声明标识符或拼错变量名。
- 禁止隐式 `any` 和 `as any`；函数参数、返回值、解构项、事件对象、`catch` 错误在使用前应有明确类型或先完成类型收窄，并清理未使用的变量和导入。

### next.config 配置规范

- 配置的路径不要写死绝对路径，必须使用 path.resolve(__dirname, ...)、import.meta.dirname 或 process.cwd() 动态拼接。

### Hydration 问题防范

1. 严禁在 JSX 渲染逻辑中直接使用 typeof window、Date.now()、Math.random() 等动态数据。**必须使用 'use client' 并配合 useEffect + useState 确保动态内容仅在客户端挂载后渲染**；同时严禁非法 HTML 嵌套（如 <p> 嵌套 <div>）。
2. **禁止使用 head 标签**，优先使用 metadata，详见文档：https://nextjs.org/docs/app/api-reference/functions/generate-metadata
   1. 三方 CSS、字体等资源可在 `globals.css` 中顶部通过 `@import` 引入或使用 next/font
   2. preload, preconnect, dns-prefetch 通过 ReactDOM 的 preload、preconnect、dns-prefetch 方法引入
   3. json-ld 可阅读 https://nextjs.org/docs/app/guides/json-ld

## UI 设计与组件规范 (UI & Styling Standards)

- 模板默认预装核心组件库 `shadcn/ui`，位于`src/components/ui/`目录下
- Next.js 项目**必须默认**采用 shadcn/ui 组件、风格和规范，**除非用户指定用其他的组件和规范。**

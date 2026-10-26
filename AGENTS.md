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
| 库存模块（已交付 MVP） | `inv_*` | 库存余额 + 只追加流水台账，采购到货入库 / 销售发货出库 |
| 财务模块（已交付 MVP） | `fin_*` | 应收/应付欠款汇总 + 收付款单（超额拦截）+ 流水台账 |
| 后续业务模块（预留） | `proc_*` / `tax_*` | 加工、税务 |

> 托管 PostgREST 仅暴露 public schema，故以表名前缀实现"单库逻辑多 schema"隔离。

### 认证与权限（T2 雏形）

- **数据模型**：`sys_users`（用户主体+role 枚举）/ `sys_user_credentials`（凭证抽象，新增登录方式=新增 type）/ `sys_sessions`（会话）。
- **登录**：POST `/api/auth/login` `{type:'password', payload:{username,password}}` → httpOnly Cookie `erp_session`。
- **权限模型**：角色 → 权限点映射在 `src/server/auth/permissions.ts`（admin=`*`，manager=读写+`po.approve`，staff=只读）。
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
| GET | /api/inv/stock | inv.read | 库存余额分页（商品名/编码 keyword 搜索） |
| GET | /api/inv/movements | inv.read | 库存流水分页（type=in/out/adjust、商品/单号 keyword） |
| GET | /api/fin/receivables | fin.read | 应收欠款按客户汇总分页（billed/received/outstanding，keyword 搜客户） |
| GET | /api/fin/payables | fin.read | 应付欠款按供应商汇总分页（billed/paid/outstanding） |
| GET/POST | /api/fin/receipts | fin.read / fin.write | 收款单分页列表 / 登记收款 |
| DELETE | /api/fin/receipts/[id] | fin.write | 删除收款单（欠款回升） |
| GET/POST | /api/fin/payments | fin.read / fin.write | 付款单分页列表（direction 筛选）/ 登记付款 |
| DELETE | /api/fin/payments/[id] | fin.write | 删除付款单 |

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

### 库存模块约定（inv_*）

- **表**：`inv_stock`（余额，product_id 唯一 FK→md_products，quantity numeric(14,3)）+ `inv_stock_movements`（**只追加**流水：type in/out/adjust、quantity 带符号、balance 余额快照、source purchase_in/sales_out/manual、ref_no 关联单号、remark、created_by FK→sys_users）。流水不做 UPDATE/DELETE。
- **强一致联动**：Supabase SDK 无多语句事务，故"状态流转 + 库存余额更新 + 流水追加"下沉为 plpgsql 数据库函数在**单事务**内完成（见 `db/migrations/0004_inventory.sql` 起的演进；购销终审函数见 0006/0007）：
  - `inv_apply_movement(p_product_id, p_type, p_quantity, p_source, p_ref_no, p_remark, p_user_id)`：`SELECT ... FOR UPDATE` 行锁串行化更新余额，upsert 余额行，写流水；库存不足（出库后余额<0）`RAISE EXCEPTION 'P0001:...'` 整事务回滚。
  - 采购：`inv_apply_receipt_in`（入库加权）、`inv_apply_issue_out`（按均价出库）、`po_execute_receipt`/`po_execute_return`/`po_fulfill_order`/`po_reverse_receipt`；销售：`so_execute_shipment`/`so_execute_return`/`so_fulfill_order`。旧函数 `inv_complete_purchase`/`inv_complete_sales` 已在 V2 迁移中 DROP。
- **错误码映射**：服务端 `src/server/inventory/shared.ts` 解析 SQLSTATE —— `P0001`→400 `INV.INSUFFICIENT_STOCK`（库存不足）、`P0404`→404、`P0400`→400 `INV.BAD_TRANSITION`，其余→500。终审 RPC 失败时单据保持 pending（审批步骤已自动回滚）、余额不变。
- **触发时机**：采购订单 approved 态"到货入库"（一键生成并审核入库单）、销售订单 approved 态"发货出库"（一键生成并审核出库单），均走 `POST /api/{po|so}/orders/[id]/complete`；或在入库单/出库单详情页单独提交审批。
- **权限**：`inv.read`（manager/staff/admin 只读）；当前无手工写库存界面，`inv.write` 预留给后续"手工盘点调整"。
- **仪表盘**：`/api/stats/overview` 返回 `inventory:{tracked_kinds, out_of_stock}`（纳管品类数、quantity<=0 缺货数）。

### PostgREST 查询注意事项

- `.or()` 过滤器**不支持嵌入表列名前缀**（`or=(product.name.ilike.*,...*)` 或带表别名均报 `failed to parse logic tree`）。需要按嵌入商品名/编码模糊搜索时，先在主数据查出匹配 `md_products.id` 列表，再对库存/流水用 `.in('product_id', ids)`（无匹配则直接返回空页）。见 `src/server/inventory/stock.ts` 的 `matchProductIds`。
- 嵌入关联依赖真实外键约束；`created_by` 等 FK 若 db upgrade 未生成，需 exec_sql 补建并在迁移文件加幂等 DO 块。补全操作人姓名采用两步查询（批量取 sys_users 的 username/display_name 再 map），不依赖嵌入。

### 财务模块约定（fin_*）

- **表**：单表 `fin_payments` 承载收付款单——`doc_no` 唯一（收款 `RCyyyymmdd-NNNN`、付款 `PYyyyymmdd-NNNN`）、`direction`(receipt/payment)、`customer_id`/`supplier_id` 二选一 FK（方向决定哪个非空）、`order_id`+`order_no` 冗余快照（关联订单可空，不建 FK，因方向不同指向 so/po 两张表）、`amount numeric(14,2)`、`method`(cash/bank/wechat/alipay/other)、`paid_at`、`created_by` FK。
- **欠款口径**：客户应收 = Σ(shipped/completed 销售订单总额) − Σ(approved 销售退货) − Σ(该客户收款)；供应商应付 = Σ(received/completed 采购订单总额) + Σ(蓝字−红字冲回净差) − Σ(approved 采购退货) − Σ(该供应商付款)。汇总在服务端内存聚合（先分页查客户/供应商，再批量聚合该页 ID 的订单与收付款），不建数据库视图，保持 SDK-only 约束。
- **超额拦截**：登记收/付款时校验不超该客户/供应商当前欠款，超出返回 400 `FIN.OVER_AMOUNT`（含剩余金额提示）；关联订单时另校验订单归属与 已出库/已入库 状态。预付/预收科目留待后续里程碑。
- **删除即回滚**：MVP 允许 DELETE 收付款单（欠款相应回升）；正式财务场景后续改红冲。
- **权限**：`fin.read` / `fin.write`（manager 读写、staff 只读）。
- **仪表盘**：`/api/stats/overview` 返回 `finance:{receivable_outstanding, payable_outstanding}`。
- **前端**：`src/components/finance/balance-list.tsx` 欠款汇总列表（kind 区分应收/应付，行内收/付款按钮）、`payment-form-dialog.tsx` 登记对话框（金额预填当前欠款）；页面 `/finance/receivables`、`/finance/payables`、`/finance/payments`（流水台账，可删除）。

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
│   ├── inventory/           # 库存服务（stock 余额查询 / movements 流水 / shared RPC 错误映射）
│   └── finance/             # 财务服务（payments 收付款单 CRUD + 应收/应付欠款汇总 + 超额校验）
├── app/api/                 # Route Handlers（薄层，调 server 服务）
├── app/(app)/               # 登录后区域（路由组，layout 内做守卫）
│   ├── dashboard/           # 仪表盘（含采购/销售/库存/财务统计卡片）
│   ├── master-data/         # customers / suppliers / products 页面
│   ├── purchase/            # orders(订单) / requisitions(申请+convert) / receipts(入库+冲回) / returns(退货)，均列表+new+[id]
│   ├── sales/               # orders(订单) / shipments(出库) / returns(退货)，均列表+new+[id]（new 需 ?order= 预填）
│   ├── inventory/           # stock 库存余额 / movements 库存流水
│   └── finance/             # receivables 应收欠款 / payables 应付欠款 / payments 收付款流水
├── components/
│   ├── auth/auth-provider.tsx   # 会话 Context（useAuth().can()）
│   ├── layout/app-shell.tsx     # 侧边栏 + 顶栏（移动端抽屉导航）
│   ├── master-data/             # 表单对话框 / 分页 / 状态徽章 / 删除确认
│   ├── trade/                   # 购销通用：订单编辑器(kind 区分购销) / 状态徽章 / 动作确认弹窗
│   ├── purchase/                # 采购 V2 通用：approval-panel(审批步骤+操作) / doc-item-editor(明细编辑器)
│   └── finance/                 # 财务通用：欠款汇总列表(kind 区分应收应付) / 收付款登记对话框
├── lib/                     # api-client / types / use-paged-list(支持 filters)
└── storage/database/        # supabase-client.ts + shared/schema.ts
db/migrations/               # 版本化 SQL（0001 基础+认证 / 0002 采购 / 0003 销售 / 0004 库存 / 0005 财务 / 0006 采购 V2 五单+审批+成本+冲回 / 0007 销售 V2 出库+退货+等级报价）
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

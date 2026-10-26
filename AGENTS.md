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
| 采购模块（已交付 MVP） | `po_*` | 采购订单 + 明细，状态机 draft→confirmed→completed / cancelled |
| 销售模块（已交付 MVP） | `so_*` | 销售订单 + 明细，状态机同采购 |
| 库存模块（已交付 MVP） | `inv_*` | 库存余额 + 只追加流水台账，采购到货入库 / 销售发货出库 |
| 财务模块（已交付 MVP） | `fin_*` | 应收/应付欠款汇总 + 收付款单（超额拦截）+ 流水台账 |
| 后续业务模块（预留） | `proc_*` / `tax_*` | 加工、税务 |

> 托管 PostgREST 仅暴露 public schema，故以表名前缀实现"单库逻辑多 schema"隔离。

### 认证与权限（T2 雏形）

- **数据模型**：`sys_users`（用户主体+role 枚举）/ `sys_user_credentials`（凭证抽象，新增登录方式=新增 type）/ `sys_sessions`（会话）。
- **登录**：POST `/api/auth/login` `{type:'password', payload:{username,password}}` → httpOnly Cookie `erp_session`。
- **权限模型**：角色 → 权限点映射在 `src/server/auth/permissions.ts`（admin=`*`，manager=读写，staff=只读）。
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
| GET/POST | /api/po/orders | po.read / po.write | 采购订单分页列表（支持 status 筛选）/ 新建（草稿） |
| GET/PUT/DELETE | /api/po/orders/[id] | po.read / po.write | 订单详情（含明细）/ 更新 / 删除（仅 draft） |
| POST | /api/po/orders/[id]/confirm | po.write | 确认订单（draft→confirmed） |
| POST | /api/po/orders/[id]/cancel | po.write | 取消订单（draft/confirmed→cancelled） |
| POST | /api/po/orders/[id]/complete | po.write | 到货入库（confirmed→completed，联动库存） |
| GET/POST | /api/so/orders | so.read / so.write | 销售订单分页列表 / 新建（草稿） |
| GET/PUT/DELETE | /api/so/orders/[id] | so.read / so.write | 订单详情 / 更新 / 删除（仅 draft） |
| POST | /api/so/orders/[id]/confirm | so.write | 确认订单（draft→confirmed） |
| POST | /api/so/orders/[id]/cancel | so.write | 取消订单（draft/confirmed→cancelled） |
| POST | /api/so/orders/[id]/complete | so.write | 发货出库（confirmed→completed，联动库存，库存不足整单 400 拦截） |
| GET | /api/inv/stock | inv.read | 库存余额分页（商品名/编码 keyword 搜索） |
| GET | /api/inv/movements | inv.read | 库存流水分页（type=in/out/adjust、商品/单号 keyword） |
| GET | /api/fin/receivables | fin.read | 应收欠款按客户汇总分页（billed/received/outstanding，keyword 搜客户） |
| GET | /api/fin/payables | fin.read | 应付欠款按供应商汇总分页（billed/paid/outstanding） |
| GET/POST | /api/fin/receipts | fin.read / fin.write | 收款单分页列表 / 登记收款 |
| DELETE | /api/fin/receipts/[id] | fin.write | 删除收款单（欠款回升） |
| GET/POST | /api/fin/payments | fin.read / fin.write | 付款单分页列表（direction 筛选）/ 登记付款 |
| DELETE | /api/fin/payments/[id] | fin.write | 删除付款单 |

分页参数：`page`(≥1) `pageSize`(1-100) `keyword`（模糊搜索）；响应 `{ items, total, page, page_size }`。

### 采购模块约定（po_*）

- **表**：`po_purchase_orders`（单头：order_no 唯一、supplier_id FK、status、order_date、total_amount、created_by）+ `po_purchase_order_items`（明细：order_id FK cascade、product_id FK、quantity/unit_price/amount、unit 快照）。
- **单号**：`POyyyymmdd-NNNN`，按当日数量+1 生成，唯一约束冲突（23505）重试一次。
- **金额**：一律服务端按明细 `quantity × unit_price` 计算行金额与总额，不信任客户端传值。
- **状态机**：仅 `draft` 可编辑/删除；`confirmed` 不可再改明细；`completed` 由"到货入库"（complete）流转，同时联动库存入账。
- **补偿式写入**：Supabase SDK 无多语句事务，"单头+明细"写入采用补偿模式（明细插入失败则删除单头），见 `src/server/purchase/orders.ts` 头注释；后续可迁移存储过程。

### 库存模块约定（inv_*）

- **表**：`inv_stock`（余额，product_id 唯一 FK→md_products，quantity numeric(14,3)）+ `inv_stock_movements`（**只追加**流水：type in/out/adjust、quantity 带符号、balance 余额快照、source purchase_in/sales_out/manual、ref_no 关联单号、remark、created_by FK→sys_users）。流水不做 UPDATE/DELETE。
- **强一致联动**：Supabase SDK 无多语句事务，故"状态流转 + 库存余额更新 + 流水追加"下沉为 plpgsql 数据库函数在**单事务**内完成（见 `db/migrations/0004_inventory.sql`）：
  - `inv_apply_movement(p_product_id, p_type, p_quantity, p_source, p_ref_no, p_remark, p_user_id)`：`SELECT ... FOR UPDATE` 行锁串行化更新余额，upsert 余额行，写流水；库存不足（出库后余额<0）`RAISE EXCEPTION 'P0001:...'` 整事务回滚。
  - `inv_complete_purchase(p_order_id, p_user_id)` / `inv_complete_sales(...)`：校验订单 confirmed、遍历明细逐行 apply movement，最后置 completed。
- **错误码映射**：服务端 `src/server/inventory/shared.ts` 解析 SQLSTATE —— `P0001`→400 `INV.INSUFFICIENT_STOCK`（库存不足）、`P0404`→404、`P0400`→400 `INV.BAD_TRANSITION`，其余→500。库存不足时订单保持 `confirmed`、余额不变。
- **触发时机**：采购详情 confirmed 态"到货入库"、销售详情 confirmed 态"发货出库"，均走 `POST /api/{po|so}/orders/[id]/complete`。
- **权限**：`inv.read`（manager/staff/admin 只读）；当前无手工写库存界面，`inv.write` 预留给后续"手工盘点调整"。
- **仪表盘**：`/api/stats/overview` 返回 `inventory:{tracked_kinds, out_of_stock}`（纳管品类数、quantity<=0 缺货数）。

### PostgREST 查询注意事项

- `.or()` 过滤器**不支持嵌入表列名前缀**（`or=(product.name.ilike.*,...*)` 或带表别名均报 `failed to parse logic tree`）。需要按嵌入商品名/编码模糊搜索时，先在主数据查出匹配 `md_products.id` 列表，再对库存/流水用 `.in('product_id', ids)`（无匹配则直接返回空页）。见 `src/server/inventory/stock.ts` 的 `matchProductIds`。
- 嵌入关联依赖真实外键约束；`created_by` 等 FK 若 db upgrade 未生成，需 exec_sql 补建并在迁移文件加幂等 DO 块。补全操作人姓名采用两步查询（批量取 sys_users 的 username/display_name 再 map），不依赖嵌入。

### 财务模块约定（fin_*）

- **表**：单表 `fin_payments` 承载收付款单——`doc_no` 唯一（收款 `RCyyyymmdd-NNNN`、付款 `PYyyyymmdd-NNNN`）、`direction`(receipt/payment)、`customer_id`/`supplier_id` 二选一 FK（方向决定哪个非空）、`order_id`+`order_no` 冗余快照（关联订单可空，不建 FK，因方向不同指向 so/po 两张表）、`amount numeric(14,2)`、`method`(cash/bank/wechat/alipay/other)、`paid_at`、`created_by` FK。
- **欠款口径**：客户应收 = Σ(completed 销售订单总额) − Σ(该客户收款)；供应商应付 = Σ(completed 采购订单总额) − Σ(该供应商付款)。汇总在服务端内存聚合（先分页查客户/供应商，再批量聚合该页 ID 的订单与收付款），不建数据库视图，保持 SDK-only 约束。
- **超额拦截**：登记收/付款时校验不超该客户/供应商当前欠款，超出返回 400 `FIN.OVER_AMOUNT`（含剩余金额提示）；关联订单时另校验订单归属与 completed 状态。预付/预收科目留待后续里程碑。
- **删除即回滚**：MVP 允许 DELETE 收付款单（欠款相应回升）；正式财务场景后续改红冲。
- **权限**：`fin.read` / `fin.write`（manager 读写、staff 只读）。
- **仪表盘**：`/api/stats/overview` 返回 `finance:{receivable_outstanding, payable_outstanding}`。
- **前端**：`src/components/finance/balance-list.tsx` 欠款汇总列表（kind 区分应收/应付，行内收/付款按钮）、`payment-form-dialog.tsx` 登记对话框（金额预填当前欠款）；页面 `/finance/receivables`、`/finance/payables`、`/finance/payments`（流水台账，可删除）。

### 销售模块约定（so_*）

- 结构与约定完全镜像采购模块：`so_sales_orders`（customer_id FK → md_customers）+ `so_sales_order_items`；单号前缀 `SO`；权限 `so.read` / `so.write`。
- 价格快照字段差异：采购编辑器预填 `reference_purchase_price`，销售预填 `reference_sale_price`，均以服务端重算金额为准。
- 前端采购/销售共用 `src/components/trade/` 通用组件（order-editor 按 `kind: 'purchase' | 'sales'` 切换往来单位/接口/文案；trade-status-badge、confirm-action-dialog），新增同类单据模块时优先复用而非复制。

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
│   ├── auth/                # password(scrypt)/session/permissions/guard/bootstrap
│   ├── master-data/         # 客户/供应商/商品的查询/校验/序列化 + helpers(分页/模糊搜索)
│   ├── purchase/            # 采购订单服务（单号生成/金额核算/状态流转/complete 入库）
│   ├── sales/               # 销售订单服务（镜像采购/complete 出库）
│   ├── inventory/           # 库存服务（stock 余额查询 / movements 流水 / shared RPC 错误映射）
│   └── finance/             # 财务服务（payments 收付款单 CRUD + 应收/应付欠款汇总 + 超额校验）
├── app/api/                 # Route Handlers（薄层，调 server 服务）
├── app/(app)/               # 登录后区域（路由组，layout 内做守卫）
│   ├── dashboard/           # 仪表盘（含采购/销售/库存/财务统计卡片）
│   ├── master-data/         # customers / suppliers / products 页面
│   ├── purchase/orders/     # 采购订单列表 / new / [id] 详情（详情页内切换编辑态，confirmed 可到货入库）
│   ├── sales/orders/        # 销售订单列表 / new / [id] 详情（confirmed 可发货出库）
│   ├── inventory/           # stock 库存余额 / movements 库存流水
│   └── finance/             # receivables 应收欠款 / payables 应付欠款 / payments 收付款流水
├── components/
│   ├── auth/auth-provider.tsx   # 会话 Context（useAuth().can()）
│   ├── layout/app-shell.tsx     # 侧边栏 + 顶栏（移动端抽屉导航）
│   ├── master-data/             # 表单对话框 / 分页 / 状态徽章 / 删除确认
│   ├── trade/                   # 购销通用：订单编辑器(kind 区分购销) / 状态徽章 / 动作确认弹窗
│   └── finance/                 # 财务通用：欠款汇总列表(kind 区分应收应付) / 收付款登记对话框
├── lib/                     # api-client / types / use-paged-list(支持 filters)
└── storage/database/        # supabase-client.ts + shared/schema.ts
db/migrations/               # 版本化 SQL（0001 基础+认证 / 0002 采购 / 0003 销售 / 0004 库存 / 0005 财务）
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

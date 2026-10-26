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
| 后续业务模块（预留） | `po_*` / `so_*` / `inv_*` / `fin_*` | 采购 / 销售 / 库存 / 财务 |

> 托管 PostgREST 仅暴露 public schema，故以表名前缀实现"单库逻辑多 schema"隔离。

### 认证与权限（T2 雏形）

- **数据模型**：`sys_users`（用户主体+role 枚举）/ `sys_user_credentials`（凭证抽象，新增登录方式=新增 type）/ `sys_sessions`（会话）。
- **登录**：POST `/api/auth/login` `{type:'password', payload:{username,password}}` → httpOnly Cookie `erp_session`。
- **权限模型**：角色 → 权限点映射在 `src/server/auth/permissions.ts`（admin=`*`，manager=读写，staff=只读）。
  API 层用 `requireAuth(request)` / `requirePermission(auth, 'md.write')` 做守卫；前端 `useAuth().can()` 控制菜单/按钮显隐。
- **升级路径**：T3 完整 RBAC（roles/permissions/role_permissions/user_roles 四表）为单向加表升级，见 `src/server/auth/permissions.ts` 注释。
- **DEV 测试账号**：`pnpm tsx scripts/seed-dev.ts`（仅 DEV 可执行，密码运行时随机生成、只打印控制台）。

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

分页参数：`page`(≥1) `pageSize`(1-100) `keyword`（模糊搜索）；响应 `{ items, total, page, pageSize }`。

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
│   ├── auth/                # password(scrypt)/session/permissions/guard
│   └── master-data/         # 三个模块的查询/校验/序列化
├── app/api/                 # Route Handlers（薄层，调 server 服务）
├── app/(app)/               # 登录后区域（路由组，layout 内做守卫）
│   ├── dashboard/           # 仪表盘
│   └── master-data/         # customers / suppliers / products 页面
├── components/
│   ├── auth/auth-provider.tsx   # 会话 Context（useAuth().can()）
│   ├── layout/app-shell.tsx     # 侧边栏 + 顶栏
│   └── master-data/             # 表单对话框 / 分页 / 状态徽章 / 删除确认
├── lib/                     # api-client / types / use-paged-list
└── storage/database/        # supabase-client.ts + shared/schema.ts
db/migrations/               # 版本化 SQL（与 schema.ts 保持一致）
scripts/seed-dev.ts          # DEV 测试账号种子
```

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

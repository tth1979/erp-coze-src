-- ============================================================
-- 瓷砖经销商 ERP · 数据库 schema 初版（V0001）
--
-- 说明：
-- 1. 本文件为版本化迁移记录；沙箱内的权威同步通道是
--    `src/storage/database/shared/schema.ts` + `coze-coding-ai db upgrade`，
--    两者保持一致。独立部署环境可直接执行本脚本完成初始化。
-- 2. 单库逻辑多模块：sys_*(系统/认证/RBAC) + md_*(基础资料)。
--    托管 PostgREST 仅暴露 public schema，故以表名前缀实现逻辑 schema 隔离。
-- 3. 所有表启用 RLS；服务端以 service_role_key 访问自动绕过，
--    anon/authenticated 角色无任何 policy 即完全阻断。
-- ============================================================

-- ---------- sys_ 系统模块：认证 + 基于角色的权限（T2） ----------

CREATE TABLE IF NOT EXISTS sys_users (
  id           varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  username     varchar(64) NOT NULL UNIQUE,
  display_name varchar(128) NOT NULL,
  role         varchar(32) NOT NULL DEFAULT 'staff',   -- admin | manager | staff
  status       varchar(20) NOT NULL DEFAULT 'active',  -- active | disabled
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sys_users_status_idx ON sys_users (status);
CREATE INDEX IF NOT EXISTS sys_users_role_idx ON sys_users (role);

CREATE TABLE IF NOT EXISTS sys_user_credentials (
  id          varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     varchar(36) NOT NULL REFERENCES sys_users (id) ON DELETE CASCADE,
  type        varchar(32) NOT NULL,                    -- password | email_otp | oauth_* ...
  identifier  varchar(128) NOT NULL,
  secret_hash varchar(256) NOT NULL,                   -- scrypt$N$r$p$salt$hash
  verified_at timestamptz,
  metadata    jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sys_user_credentials_type_identifier_uniq UNIQUE (type, identifier)
);
CREATE INDEX IF NOT EXISTS sys_user_credentials_user_id_idx ON sys_user_credentials (user_id);

CREATE TABLE IF NOT EXISTS sys_sessions (
  id            varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       varchar(36) NOT NULL REFERENCES sys_users (id) ON DELETE CASCADE,
  token_hash    varchar(128) NOT NULL UNIQUE,          -- SHA-256(token)
  user_agent    varchar(256),
  ip            varchar(64),
  issued_at     timestamptz NOT NULL DEFAULT now(),
  last_active_at timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz
);
CREATE INDEX IF NOT EXISTS sys_sessions_user_id_idx ON sys_sessions (user_id);
CREATE INDEX IF NOT EXISTS sys_sessions_expires_at_idx ON sys_sessions (expires_at);

-- ---------- md_ 基础资料模块 ----------

CREATE TABLE IF NOT EXISTS md_customers (
  id         varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  code       varchar(32) NOT NULL UNIQUE,
  name       varchar(128) NOT NULL,
  contact    varchar(64),
  phone      varchar(32),
  email      varchar(128),
  address    varchar(256),
  level      varchar(32) NOT NULL DEFAULT 'normal',    -- normal | vip | strategic
  tax_no     varchar(64),
  status     varchar(20) NOT NULL DEFAULT 'active',
  remark     text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS md_customers_name_idx ON md_customers (name);
CREATE INDEX IF NOT EXISTS md_customers_status_idx ON md_customers (status);
CREATE INDEX IF NOT EXISTS md_customers_created_at_idx ON md_customers (created_at);

CREATE TABLE IF NOT EXISTS md_suppliers (
  id         varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  code       varchar(32) NOT NULL UNIQUE,
  name       varchar(128) NOT NULL,
  contact    varchar(64),
  phone      varchar(32),
  email      varchar(128),
  address    varchar(256),
  tax_no     varchar(64),
  settlement varchar(64),
  status     varchar(20) NOT NULL DEFAULT 'active',
  remark     text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS md_suppliers_name_idx ON md_suppliers (name);
CREATE INDEX IF NOT EXISTS md_suppliers_status_idx ON md_suppliers (status);
CREATE INDEX IF NOT EXISTS md_suppliers_created_at_idx ON md_suppliers (created_at);

CREATE TABLE IF NOT EXISTS md_products (
  id                       varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  sku_code                 varchar(32) NOT NULL UNIQUE,
  name                     varchar(128) NOT NULL,
  model                    varchar(64),                -- 型号
  spec                     varchar(64),                -- 规格 如 800x800
  unit                     varchar(16) NOT NULL DEFAULT '片',  -- 片 | 箱 | ㎡
  barcode                  varchar(64),                -- 条形码
  category                 varchar(64),                -- 品类
  brand                    varchar(64),
  color                    varchar(64),
  pieces_per_box           integer,
  area_per_box             numeric(10, 3),             -- 每箱面积（㎡）
  reference_purchase_price numeric(12, 2),
  reference_sale_price     numeric(12, 2),
  status                   varchar(20) NOT NULL DEFAULT 'active',
  remark                   text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS md_products_name_idx ON md_products (name);
CREATE INDEX IF NOT EXISTS md_products_barcode_idx ON md_products (barcode);
CREATE INDEX IF NOT EXISTS md_products_category_idx ON md_products (category);
CREATE INDEX IF NOT EXISTS md_products_status_idx ON md_products (status);
CREATE INDEX IF NOT EXISTS md_products_created_at_idx ON md_products (created_at);

-- ---------- RLS（场景 A：启用即可，不建任何 policy） ----------

ALTER TABLE sys_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE sys_user_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE sys_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE md_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE md_suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE md_products ENABLE ROW LEVEL SECURITY;

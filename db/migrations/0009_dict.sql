-- ============================================================
-- 0009_dict.sql —— 系统数据字典 + 基础资料扩充（独立部署参考脚本）
-- 表：dict_system_types / dict_system_items / md_units
-- 说明：
--   * 本文件为版本化记录，供独立/生产部署时手工执行（db upgrade 优先按 schema.ts 对齐；
--     若表已由 upgrade 或首次自举创建，以下 DDL 均为幂等 IF NOT EXISTS，可安全重复执行）。
--   * 开发库对应对象的真实 DDL 以 src/storage/database/shared/schema.ts 为准。
--   * 所有新表启用 RLS（不自建 Auth 场景不建 policy）。
-- ============================================================

-- ---------- 1. 字典类型 ----------
CREATE TABLE IF NOT EXISTS dict_system_types (
  id          VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  type_code   VARCHAR(48) NOT NULL UNIQUE,
  name        VARCHAR(128) NOT NULL,
  description VARCHAR(256),
  is_system   BOOLEAN NOT NULL DEFAULT false,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dict_types_active_idx ON dict_system_types (is_active);
ALTER TABLE dict_system_types ENABLE ROW LEVEL SECURITY;

-- ---------- 2. 字典项 ----------
CREATE TABLE IF NOT EXISTS dict_system_items (
  id         VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  type_code  VARCHAR(48) NOT NULL,
  item_code  VARCHAR(48) NOT NULL,
  label      VARCHAR(128) NOT NULL,
  extra      JSONB,
  sort       INTEGER NOT NULL DEFAULT 0,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT dict_items_type_code_item_code_uniq UNIQUE (type_code, item_code)
);
CREATE INDEX IF NOT EXISTS dict_items_type_idx   ON dict_system_items (type_code);
CREATE INDEX IF NOT EXISTS dict_items_active_idx ON dict_system_items (is_active);
ALTER TABLE dict_system_items ENABLE ROW LEVEL SECURITY;

-- ---------- 3. 计量单位（含换算） ----------
CREATE TABLE IF NOT EXISTS md_units (
  id               VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_code        VARCHAR(32) NOT NULL UNIQUE,
  unit_name        VARCHAR(64) NOT NULL,
  base_unit        VARCHAR(16) NOT NULL,
  conversion_ratio NUMERIC(12,4) NOT NULL DEFAULT 1,
  remark           VARCHAR(256),
  is_active        BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS md_units_active_idx   ON md_units (is_active);
CREATE INDEX IF NOT EXISTS md_units_base_unit_idx ON md_units (base_unit);
ALTER TABLE md_units ENABLE ROW LEVEL SECURITY;

-- ---------- 4. 字典种子（幂等） ----------
INSERT INTO dict_system_types (type_code, name, description, is_system, sort) VALUES
  ('unit', '计量单位', '商品/单据通用计量单位', true, 1),
  ('payment_method', '付款方式', '收付款方式', true, 2),
  ('tax_rate', '税率', '常用开票税率', true, 3),
  ('customer_level', '客户等级', '客户等级与折扣', true, 4),
  ('status', '状态枚举', '通用启用/停用状态', true, 5)
ON CONFLICT (type_code) DO NOTHING;

INSERT INTO dict_system_items (type_code, item_code, label, extra, sort) VALUES
  ('unit', 'piece', '片', '{}', 1),
  ('unit', 'box', '箱', '{}', 2),
  ('unit', 'sqm', '平方米', '{}', 3),
  ('payment_method', 'cash', '现金', '{}', 1),
  ('payment_method', 'bank', '银行转账', '{}', 2),
  ('payment_method', 'wechat', '微信', '{}', 3),
  ('payment_method', 'alipay', '支付宝', '{}', 4),
  ('tax_rate', 'tax_0', '0%', '{"rate":0}', 1),
  ('tax_rate', 'tax_3', '3%', '{"rate":0.03}', 2),
  ('tax_rate', 'tax_6', '6%', '{"rate":0.06}', 3),
  ('tax_rate', 'tax_9', '9%', '{"rate":0.09}', 4),
  ('tax_rate', 'tax_13', '13%', '{"rate":0.13}', 5),
  ('customer_level', 'normal', '普通客户', '{"discount_rate":1}', 1),
  ('customer_level', 'vip', 'VIP 客户', '{"discount_rate":0.98}', 2),
  ('customer_level', 'strategic', '战略客户', '{"discount_rate":0.95}', 3),
  ('status', 'active', '启用', '{}', 1),
  ('status', 'disabled', '停用', '{}', 2)
ON CONFLICT (type_code, item_code) DO NOTHING;

-- ---------- 5. 计量单位种子 ----------
INSERT INTO md_units (unit_code, unit_name, base_unit, conversion_ratio, remark) VALUES
  ('piece', '片', 'piece', 1, '基础单位'),
  ('box', '箱', 'piece', 10, '示例：1箱=10片（按商品实际调整）'),
  ('sqm', '平方米', 'piece', 0.8, '示例：1㎡≈0.8片（按规格调整）')
ON CONFLICT (unit_code) DO NOTHING;
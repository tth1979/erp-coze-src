-- 0020_system_mgmt.sql — 系统管理：角色与四粒度权限 / 参数中心 / 审计日志
-- 幂等 + RLS；不改既有迁移。
--
-- 四粒度权限模型（需求书 2.3.1）：
--   菜单级：既有权限点（dashboard.read/po.read/...）驱动导航显隐，见 app-shell NAV.permission
--   操作级：既有 *.write/*.approve 权限点 + 新增 sys.read/sys.write
--   数据级：sys_roles.data_scope（all 全部/dept 本部门/self 本人），作用于单据列表查询
--   字段级：field.cost_price / field.customer_phone 权限点，缺失时服务端脱敏为 null
--
-- 内置角色 admin/manager/staff 的权限点集合仍以代码 ROLE_PERMISSIONS 为准（admin='*' 不可配），
-- 库中 sys_roles 种子行用于展示与分配参照；自定义角色权限 = sys_role_permissions，
-- 用户有效权限 = 内置角色权限 ∪ 自定义角色权限（仅做并集，不做减法，保证不破坏存量行为）。

-- 1) sys_users 增加部门列（数据级"本部门"范围的归属依据）
ALTER TABLE public.sys_users ADD COLUMN IF NOT EXISTS dept varchar(64) NULL;
CREATE INDEX IF NOT EXISTS sys_users_dept_idx ON public.sys_users (dept);

-- 2) 角色表
CREATE TABLE IF NOT EXISTS public.sys_roles (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  code varchar(64) NOT NULL,
  name varchar(64) NOT NULL,
  description text,
  /** 数据范围：all 全部 / dept 本部门 / self 本人（多角色取最严格） */
  data_scope varchar(16) NOT NULL DEFAULT 'all' CHECK (data_scope IN ('all', 'dept', 'self')),
  /** 内置角色（admin/manager/staff）不可删改，权限点以代码为准 */
  is_system boolean NOT NULL DEFAULT false,
  status varchar(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_by varchar(36),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sys_roles_code_key ON public.sys_roles (code);
ALTER TABLE public.sys_roles ENABLE ROW LEVEL SECURITY;

-- 3) 角色-权限点表
CREATE TABLE IF NOT EXISTS public.sys_role_permissions (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  role_id varchar(36) NOT NULL REFERENCES public.sys_roles(id) ON DELETE CASCADE,
  permission_key varchar(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sys_role_permissions_uniq ON public.sys_role_permissions (role_id, permission_key);
CREATE INDEX IF NOT EXISTS sys_role_permissions_key_idx ON public.sys_role_permissions (permission_key);
ALTER TABLE public.sys_role_permissions ENABLE ROW LEVEL SECURITY;

-- 4) 用户-角色分配表（自定义角色分配；内置角色仍在 sys_users.role）
CREATE TABLE IF NOT EXISTS public.sys_user_roles (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id varchar(36) NOT NULL REFERENCES public.sys_users(id) ON DELETE CASCADE,
  role_id varchar(36) NOT NULL REFERENCES public.sys_roles(id) ON DELETE CASCADE,
  created_by varchar(36),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sys_user_roles_uniq ON public.sys_user_roles (user_id, role_id);
CREATE INDEX IF NOT EXISTS sys_user_roles_role_idx ON public.sys_user_roles (role_id);
ALTER TABLE public.sys_user_roles ENABLE ROW LEVEL SECURITY;

-- 5) 参数中心
CREATE TABLE IF NOT EXISTS public.sys_settings (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  key varchar(64) NOT NULL,
  name varchar(128) NOT NULL,
  value text NOT NULL DEFAULT '',
  value_type varchar(16) NOT NULL DEFAULT 'string' CHECK (value_type IN ('number', 'string', 'boolean', 'json')),
  group_name varchar(64) NOT NULL DEFAULT '通用',
  description text,
  /** 敏感参数仅 admin 可改 */
  is_sensitive boolean NOT NULL DEFAULT false,
  /** 内置种子参数（不可删除，仅可改值） */
  is_system boolean NOT NULL DEFAULT false,
  updated_by varchar(36),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sys_settings_key_key ON public.sys_settings (key);
CREATE INDEX IF NOT EXISTS sys_settings_group_idx ON public.sys_settings (group_name);
ALTER TABLE public.sys_settings ENABLE ROW LEVEL SECURITY;

-- 6) 审计日志（只追加：触发器禁改禁删）
CREATE TABLE IF NOT EXISTS public.sys_audit_logs (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id varchar(36),
  username varchar(64),
  action varchar(64) NOT NULL,
  resource varchar(64) NOT NULL,
  resource_id varchar(64),
  detail jsonb,
  ip varchar(64),
  operated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sys_audit_logs_operated_idx ON public.sys_audit_logs (operated_at DESC);
CREATE INDEX IF NOT EXISTS sys_audit_logs_user_idx ON public.sys_audit_logs (user_id);
CREATE INDEX IF NOT EXISTS sys_audit_logs_action_idx ON public.sys_audit_logs (action);
CREATE INDEX IF NOT EXISTS sys_audit_logs_resource_idx ON public.sys_audit_logs (resource);
ALTER TABLE public.sys_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.sys_audit_logs_block_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit log is append-only' USING ERRCODE = 'P0403';
END $$;

DROP TRIGGER IF EXISTS sys_audit_logs_no_update ON public.sys_audit_logs;
CREATE TRIGGER sys_audit_logs_no_update BEFORE UPDATE ON public.sys_audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.sys_audit_logs_block_mutation();
DROP TRIGGER IF EXISTS sys_audit_logs_no_delete ON public.sys_audit_logs;
CREATE TRIGGER sys_audit_logs_no_delete BEFORE DELETE ON public.sys_audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.sys_audit_logs_block_mutation();

-- 7) 种子：内置角色（is_system，权限点以代码为准，此处仅作展示/分配参照）
INSERT INTO public.sys_roles (code, name, description, data_scope, is_system)
VALUES
  ('admin', '系统管理员', '全部权限（不可配置）', 'all', true),
  ('manager', '业务主管', '读写 + 审批', 'all', true),
  ('staff', '业务员', '只读', 'all', true)
ON CONFLICT (code) DO NOTHING;

-- 8) 种子：内置角色权限点（与代码 ROLE_PERMISSIONS 对齐，供角色配置页展示）
INSERT INTO public.sys_role_permissions (role_id, permission_key)
SELECT r.id, p.key FROM public.sys_roles r
JOIN (VALUES
  ('manager', 'dashboard.read'), ('manager', 'md.read'), ('manager', 'md.write'),
  ('manager', 'po.read'), ('manager', 'po.write'), ('manager', 'po.approve'),
  ('manager', 'so.read'), ('manager', 'so.write'), ('manager', 'so.approve'),
  ('manager', 'inv.read'), ('manager', 'inv.write'), ('manager', 'inv.approve'),
  ('manager', 'ma.read'), ('manager', 'ma.write'), ('manager', 'ma.approve'),
  ('manager', 'fin.read'), ('manager', 'fin.write'),
  ('manager', 'tax.read'), ('manager', 'tax.write'),
  ('manager', 'sys.read'), ('manager', 'sys.write'),
  ('manager', 'field.cost_price'), ('manager', 'field.customer_phone'),
  ('staff', 'dashboard.read'), ('staff', 'md.read'),
  ('staff', 'po.read'), ('staff', 'so.read'), ('staff', 'inv.read'),
  ('staff', 'ma.read'), ('staff', 'fin.read'), ('staff', 'tax.read')
) AS p(role_code, key) ON p.role_code = r.code
ON CONFLICT (role_id, permission_key) DO NOTHING;

-- 9) 种子：参数中心（阈值/基准只在参数中心维护，模块只引用不重定义）
INSERT INTO public.sys_settings (key, name, value, value_type, group_name, description, is_sensitive, is_system)
VALUES
  ('approval.expense.threshold', '报销审批金额分档阈值', '1000', 'number', '审批阈值', '费用报销单含税金额分档：≤阈值一级审批，>阈值两级审批', true, true),
  ('approval.order.threshold', '订单审批金额分档阈值', '50000', 'number', '审批阈值', '采购/销售订单金额分档：≤阈值一级，阈值~大额两级，超大额三级', true, true),
  ('ma.yield_rate.base', '出材率基准', '0.95', 'number', '加工参数', '加工单产出/投入基准比率，损耗预警参照', false, true),
  ('fin.salvage_rate.boundary', '固定资产残值率边界', '0.05', 'number', '固定资产', '残值率=残值/原值的常规上限提示', false, true),
  ('ma.labor_rate.coefficient', '工价系数', '1.0', 'number', '加工参数', '加工计价工时系数，加工费估算参照', false, true)
ON CONFLICT (key) DO NOTHING;

NOTIFY pgrst, 'reload schema';

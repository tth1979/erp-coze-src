-- 0019_tax_enhance.sql
-- 税务增强：发票台账 / 异地预缴 / 税会差异（配合既有 tax_entries 形成申报底稿）
-- 幂等：CREATE TABLE IF NOT EXISTS + 索引 IF NOT EXISTS；不改既有迁移/表结构

-- ============================================================
-- 1. 发票台账 tax_invoices
-- ============================================================
CREATE TABLE IF NOT EXISTS public.tax_invoices (
  id              varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_no      varchar(32) NOT NULL,
  invoice_code    varchar(16),
  invoice_type    varchar(12) NOT NULL DEFAULT 'special',  -- special 专用 / normal 普通
  direction       varchar(10) NOT NULL,                    -- input 进项 / output 销项
  invoice_date    date NOT NULL,
  period          varchar(7) NOT NULL,
  amount_ex_tax   numeric(14,2) NOT NULL DEFAULT 0,        -- 不含税额
  tax_amount      numeric(14,2) NOT NULL DEFAULT 0,        -- 税额
  amount_total    numeric(14,2) NOT NULL DEFAULT 0,        -- 价税合计
  rate            numeric(5,2) NOT NULL DEFAULT 13,        -- 税率
  related_bill    varchar(32),                             -- 关联采购/销售单号
  supplier_id     varchar(36),
  supplier_name   varchar(128),
  customer_id     varchar(36),
  customer_name   varchar(128),
  status          varchar(12) NOT NULL DEFAULT 'pending',  -- pending 待勾选 / checked 已勾选 / filed 已申报 / void 已作废
  remark          text,
  created_by      varchar(36),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tax_invoices_dir_uniq UNIQUE (direction, invoice_no),
  CONSTRAINT tax_invoices_dir_chk CHECK (direction IN ('input','output')),
  CONSTRAINT tax_invoices_type_chk CHECK (invoice_type IN ('special','normal')),
  CONSTRAINT tax_invoices_status_chk CHECK (status IN ('pending','checked','filed','void'))
);
CREATE INDEX IF NOT EXISTS tax_invoices_period_idx ON public.tax_invoices (period);
CREATE INDEX IF NOT EXISTS tax_invoices_dir_idx ON public.tax_invoices (direction);
CREATE INDEX IF NOT EXISTS tax_invoices_status_idx ON public.tax_invoices (status);
ALTER TABLE public.tax_invoices ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 2. 异地预缴 tax_prepaid
-- ============================================================
CREATE TABLE IF NOT EXISTS public.tax_prepaid (
  id              varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  period          varchar(7) NOT NULL,
  project         varchar(128) NOT NULL,                   -- 工程项目名称
  region          varchar(64),                             -- 项目所在地
  prepaid_amount  numeric(14,2) NOT NULL DEFAULT 0,        -- 预缴税额
  based_tax       numeric(14,2) NOT NULL DEFAULT 0,        -- 计税依据（预缴基数）
  prepaid_date    date NOT NULL,
  related         varchar(64),                             -- 关联单号/备注
  status          varchar(12) NOT NULL DEFAULT 'active',   -- active / void
  remark          text,
  created_by      varchar(36),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tax_prepaid_status_chk CHECK (status IN ('active','void'))
);
CREATE INDEX IF NOT EXISTS tax_prepaid_period_idx ON public.tax_prepaid (period);
ALTER TABLE public.tax_prepaid ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 3. 税会差异 tax_soc_diff
-- ============================================================
CREATE TABLE IF NOT EXISTS public.tax_soc_diff (
  id                varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  period            varchar(7) NOT NULL,
  diff_type         varchar(12) NOT NULL DEFAULT 'temporary', -- temporary 时间性 / permanent 永久性
  item              varchar(128) NOT NULL,                     -- 差异项目
  description       text,
  tax_base          numeric(14,2) NOT NULL DEFAULT 0,          -- 税法金额
  accounting_base   numeric(14,2) NOT NULL DEFAULT 0,          -- 会计金额
  diff_amount       numeric(14,2) NOT NULL DEFAULT 0,          -- 差异额 = 税法 − 会计
  status            varchar(12) NOT NULL DEFAULT 'open',       -- open / closed
  remark            text,
  created_by        varchar(36),
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tax_soc_diff_type_chk CHECK (diff_type IN ('temporary','permanent')),
  CONSTRAINT tax_soc_diff_status_chk CHECK (status IN ('open','closed'))
);
CREATE INDEX IF NOT EXISTS tax_soc_diff_period_idx ON public.tax_soc_diff (period);
CREATE INDEX IF NOT EXISTS tax_soc_diff_type_idx ON public.tax_soc_diff (diff_type);
ALTER TABLE public.tax_soc_diff ENABLE ROW LEVEL SECURITY;

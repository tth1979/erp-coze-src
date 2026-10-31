-- 0018 固定资产与折旧
-- 幂等：全部 IF NOT EXISTS / ON CONFLICT / 条件 ALTER 保护，可重复执行。
-- 新增：
--   1) fin_fixed_assets          固定资产卡片（头）
--   2) fin_depreciation_records  折旧计提明细（每资产每期间一条，UNIQUE(asset_id, period) 幂等）

-- ---------------------------------------------------------------------------
-- 1) 固定资产卡片
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.fin_fixed_assets (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_no varchar(32) NOT NULL UNIQUE,                       -- 资产编码 FAyyyymmdd-NNNN
  name varchar(128) NOT NULL,                                 -- 资产名称
  category varchar(64),                                       -- 类别（房屋/设备/车辆/办公等，字典化可选）
  spec varchar(128),                                          -- 规格型号
  original_value numeric(14,2) NOT NULL DEFAULT 0,            -- 原值
  depreciation_method varchar(20) NOT NULL DEFAULT 'straight_line', -- 折旧方法（本期仅直线法）
  useful_life int NOT NULL DEFAULT 0,                         -- 使用年限（月）
  salvage_value numeric(14,2) NOT NULL DEFAULT 0,             -- 预计残值
  acquisition_date date NOT NULL,                             -- 入账日期
  acquisition_period varchar(7) NOT NULL,                     -- 入账期间 YYYY-MM
  related_subject varchar(32) NOT NULL DEFAULT '6601',        -- 折旧费用科目（fin_subjects 末级，默认管理费用）
  status varchar(20) NOT NULL DEFAULT 'in_use',               -- in_use 在用 / fully_depreciated 已折旧完 / disposed 已处置
  -- 处置与清理
  disposal_date date,                                         -- 处置日期
  disposal_type varchar(16),                                  -- sell 出售 / scrap 报废
  disposal_income numeric(14,2) NOT NULL DEFAULT 0,           -- 处置收入
  disposal_reason text,                                       -- 处置原因
  disposal_voucher_no varchar(32),                            -- 处置凭证号（幂等）
  disposed_at timestamptz,
  remark text,
  created_by varchar(36),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fin_fixed_assets_status_ck CHECK (status IN ('in_use','fully_depreciated','disposed')),
  CONSTRAINT fin_fixed_assets_method_ck CHECK (depreciation_method IN ('straight_line')),
  CONSTRAINT fin_fixed_assets_salvage_ck CHECK (salvage_value >= 0 AND salvage_value < original_value),
  CONSTRAINT fin_fixed_assets_value_ck CHECK (original_value > 0),
  CONSTRAINT fin_fixed_assets_life_ck CHECK (useful_life > 0)
);
CREATE INDEX IF NOT EXISTS fin_fixed_assets_status_idx ON public.fin_fixed_assets(status);
CREATE INDEX IF NOT EXISTS fin_fixed_assets_category_idx ON public.fin_fixed_assets(category);
ALTER TABLE public.fin_fixed_assets ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 2) 折旧计提明细（每资产每期间一条，幂等 UNIQUE(asset_id, period)）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.fin_depreciation_records (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id varchar(36) NOT NULL REFERENCES public.fin_fixed_assets(id) ON DELETE CASCADE,
  period varchar(7) NOT NULL,                                 -- 计提期间 YYYY-MM
  amount numeric(14,2) NOT NULL DEFAULT 0,                    -- 本期折旧额
  voucher_id varchar(36),                                     -- 折旧凭证 fin_vouchers.id
  voucher_no varchar(32),                                     -- 折旧凭证号（冗余便于展示）
  created_by varchar(36),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fin_depreciation_records_uniq UNIQUE (asset_id, period)
);
CREATE INDEX IF NOT EXISTS fin_depreciation_records_asset_idx ON public.fin_depreciation_records(asset_id);
CREATE INDEX IF NOT EXISTS fin_depreciation_records_period_idx ON public.fin_depreciation_records(period);
ALTER TABLE public.fin_depreciation_records ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 3) 营业外收支科目种子（处置损益落点；既有库可能已有，ON CONFLICT 幂等）
--    category=6 损益类；6301 贷方 / 6711 借方
-- ---------------------------------------------------------------------------
INSERT INTO public.fin_subjects (subject_code, subject_name, category, parent_code, direction, is_leaf, balance_flag, sort_no, remark)
VALUES
  ('6301', '营业外收入', 6, NULL, 1, true, true, 610, '处置固定资产收益等'),
  ('6711', '营业外支出', 6, NULL, 0, true, true, 611, '处置固定资产损失等')
ON CONFLICT (subject_code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4) 凭证事件 ID 扩宽：折旧 event_id 形如 "YYYY-MM:<assetId>"（44 字符），
--    原 fin_vouchers.event_id varchar(36) 不足，扩宽到 64（非破坏性，幂等）。
-- ---------------------------------------------------------------------------
ALTER TABLE public.fin_vouchers ALTER COLUMN event_id TYPE varchar(64);

-- ---------------------------------------------------------------------------
-- 4) 重载 PostgREST schema cache
-- ---------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';

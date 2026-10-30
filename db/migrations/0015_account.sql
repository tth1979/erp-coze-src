-- ============================================================
-- 0015 会计科目字典（fin_）
-- 可维护科目实体 + 期初余额 + 层级（非末级科目不可用于凭证分录）
-- 幂等：仅当对象不存在时创建 / 种子 ON CONFLICT 不覆盖
-- ============================================================

-- 科目字典
CREATE TABLE IF NOT EXISTS public.fin_subjects (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_code varchar(32) NOT NULL,
  subject_name varchar(128) NOT NULL,
  category smallint NOT NULL DEFAULT 1,          -- 1资产 2负债 3共同 4权益 5成本 6损益
  parent_code varchar(32),                        -- 上级科目编码（自引用逻辑层级，按编码前缀）
  direction smallint NOT NULL DEFAULT 0,          -- 余额方向 0借 1贷
  is_leaf boolean NOT NULL DEFAULT true,          -- 是否末级（非末级不可直接用于凭证分录）
  balance_flag boolean NOT NULL DEFAULT true,     -- 是否纳入余额表/试算平衡
  opening_amount numeric(14,2) NOT NULL DEFAULT 0, -- 期初余额（金额）
  opening_direction smallint NOT NULL DEFAULT 0,  -- 期初余额方向 0借 1贷
  status varchar(20) NOT NULL DEFAULT 'active',   -- active 启用 / disabled 停用
  sort_no integer NOT NULL DEFAULT 0,
  remark text,
  created_by varchar(36),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fin_subjects_code_uniq UNIQUE (subject_code),
  CONSTRAINT fin_subjects_category_ck CHECK (category BETWEEN 1 AND 6),
  CONSTRAINT fin_subjects_direction_ck CHECK (direction IN (0, 1)),
  CONSTRAINT fin_subjects_open_dir_ck CHECK (opening_direction IN (0, 1))
);
CREATE INDEX IF NOT EXISTS fin_subjects_parent_idx ON public.fin_subjects(parent_code);
CREATE INDEX IF NOT EXISTS fin_subjects_category_idx ON public.fin_subjects(category);
CREATE INDEX IF NOT EXISTS fin_subjects_status_idx ON public.fin_subjects(status);

-- RLS（服务端走 service_role 可写，前端受 API 权限控制）
ALTER TABLE public.fin_subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fin_subjects FORCE ROW LEVEL SECURITY;

-- 种子预置常用科目（与既有凭证引擎科目编码对齐；末级科目 = 模板实际使用编码）
INSERT INTO public.fin_subjects (subject_code, subject_name, category, parent_code, direction, is_leaf, balance_flag, sort_no, remark)
VALUES
  -- 资产 1
  ('1001', '库存现金', 1, NULL, 0, true, true, 101, '库存现金'),
  ('1002', '银行存款', 1, NULL, 0, true, true, 102, '银行存款'),
  ('1122', '应收账款', 1, NULL, 0, true, true, 111, '应收账款'),
  ('1123', '预付账款', 1, NULL, 0, true, true, 112, '预付账款'),
  ('1402', '在途物资', 1, NULL, 0, true, true, 121, '在途物资'),
  ('1405', '库存商品', 1, NULL, 0, true, true, 122, '库存商品'),
  ('1406', '发出商品', 1, NULL, 0, true, true, 123, '发出商品'),
  ('1601', '固定资产', 1, NULL, 0, true, true, 131, '固定资产'),
  ('1602', '累计折旧', 1, NULL, 1, true, true, 132, '累计折旧（备抵，贷方余额）'),
  ('1901', '待处理财产损溢', 1, NULL, 0, true, true, 141, '待处理财产损溢'),
  -- 负债 2
  ('2202', '应付账款', 2, NULL, 1, true, true, 201, '应付账款'),
  ('2203', '应付账款—暂估', 2, NULL, 1, true, true, 202, '应付账款—暂估入库'),
  ('2204', '预收账款', 2, NULL, 1, true, true, 203, '预收账款'),
  ('2211', '应付职工薪酬', 2, NULL, 1, true, true, 211, '应付职工薪酬'),
  ('2221', '应交税费', 2, NULL, 1, false, true, 221, '应交税费（汇总，非末级）'),
  ('22210101', '应交税费—进项税额', 2, '2221', 1, true, true, 222, '应交税费—进项税额'),
  ('22210102', '应交税费—销项税额', 2, '2221', 1, true, true, 223, '应交税费—销项税额'),
  -- 权益 4
  ('4001', '实收资本', 4, NULL, 1, true, true, 401, '实收资本'),
  ('4104', '未分配利润', 4, NULL, 1, true, true, 411, '未分配利润'),
  -- 成本 5（5011 为汇总父级，5101 为模板实际使用的末级科目）
  ('5011', '生产成本', 5, NULL, 0, false, true, 501, '生产成本（汇总，非末级）'),
  ('5101', '生产成本—加工归集', 5, '5011', 0, true, true, 502, '生产成本—加工归集（加工完工/凭证模板实际使用）'),
  -- 损益 6
  ('6001', '主营业务收入', 6, NULL, 1, true, true, 601, '主营业务收入'),
  ('6401', '主营业务成本', 6, NULL, 0, true, true, 611, '主营业务成本'),
  ('6601', '管理费用', 6, NULL, 0, true, true, 621, '管理费用'),
  ('6602', '销售费用', 6, NULL, 0, true, true, 622, '销售费用'),
  ('6603', '财务费用', 6, NULL, 0, true, true, 623, '财务费用'),
  ('6301', '营业外收入', 6, NULL, 1, true, true, 631, '营业外收入'),
  ('6711', '营业外支出', 6, NULL, 0, true, true, 632, '营业外支出')
ON CONFLICT (subject_code) DO NOTHING;

NOTIFY pgrst, 'reload schema';
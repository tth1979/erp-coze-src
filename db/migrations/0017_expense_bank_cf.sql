-- 0017 费用报销 / 银行对账 / 现金流量表
-- 幂等：全部 IF NOT EXISTS / ON CONFLICT 保护，可重复执行。
-- 新增：
--   1) fin_expense_claims       费用报销单（头）
--   2) fin_expense_claim_items  费用报销明细（行：费用科目/摘要/价税分离金额）
--   3) fin_bank_statements      银行对账单（导入/录入流水，含匹配状态）
--   4) 其他应付款科目（2241）+ 费用报销审批规则 + 费用报销凭证模板种子

-- ---------------------------------------------------------------------------
-- 1) 费用报销单（头）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.fin_expense_claims (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_no varchar(32) NOT NULL UNIQUE,                    -- 单号 BXyyyymmdd-NNNN
  applicant varchar(64) NOT NULL,                          -- 报销人
  dept varchar(64),                                        -- 部门
  claim_date date NOT NULL,                                -- 报销日期
  period varchar(7) NOT NULL,                              -- 会计期间 YYYY-MM
  payee varchar(64),                                       -- 收款人（默认=报销人）
  pay_account varchar(32),                                 -- 贷方科目：2241 其他应付款-员工 / 1002 银行存款
  status varchar(20) NOT NULL DEFAULT 'draft',             -- draft/pending/approved/rejected/paying/paid
  total_amount numeric(14,2) NOT NULL DEFAULT 0,           -- 含税合计
  excl_amount numeric(14,2) NOT NULL DEFAULT 0,            -- 不含税合计
  tax_amount numeric(14,2) NOT NULL DEFAULT 0,             -- 税额合计
  approval_level int,
  current_step int NOT NULL DEFAULT 0,
  submitted_by varchar(36),
  submitted_at timestamptz,
  approved_by varchar(36),
  approved_at timestamptz,
  reject_reason text,
  voucher_no varchar(32),                                   -- 审核生成费用凭证号（幂等）
  payment_id varchar(36),                                   -- 付款单关联 fin_payments.id
  remark text,
  created_by varchar(36),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fin_expense_claims_status_ck CHECK (status IN ('draft','pending','approved','rejected','paying','paid'))
);
CREATE INDEX IF NOT EXISTS fin_expense_claims_status_idx ON public.fin_expense_claims(status);
CREATE INDEX IF NOT EXISTS fin_expense_claims_period_idx ON public.fin_expense_claims(period);
ALTER TABLE public.fin_expense_claims ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 2) 费用报销明细
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.fin_expense_claim_items (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id varchar(36) NOT NULL REFERENCES public.fin_expense_claims(id) ON DELETE CASCADE,
  line_no int NOT NULL DEFAULT 0,
  subject_code varchar(32) NOT NULL,                        -- 费用科目（fin_subjects 末级）
  subject_name varchar(128) NOT NULL,
  summary varchar(255),
  amount numeric(14,2) NOT NULL DEFAULT 0,                  -- 含税金额
  tax_rate numeric(6,2) NOT NULL DEFAULT 0,                 -- 税率% (0=不可抵扣/无票)
  excl_amount numeric(14,2) NOT NULL DEFAULT 0,             -- 不含税
  tax_amount numeric(14,2) NOT NULL DEFAULT 0,              -- 税额
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fin_expense_claim_items_claim_idx ON public.fin_expense_claim_items(claim_id);
ALTER TABLE public.fin_expense_claim_items ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 3) 银行对账单（银行流水/日记账）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.fin_bank_statements (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_account varchar(64) NOT NULL,                        -- 银行账号/账户名
  tran_date date NOT NULL,                                  -- 交易日期
  direction varchar(8) NOT NULL,                            -- in 收入 / out 支出
  amount numeric(14,2) NOT NULL DEFAULT 0,                  -- 金额（正数）
  summary varchar(255),                                     -- 摘要
  balance numeric(14,2),                                     -- 交易后余额（可选）
  matched_status varchar(16) NOT NULL DEFAULT 'unmatched',  -- unmatched/matched
  matched_ref_type varchar(16),                             -- journal(系统日记账) / manual
  matched_ref_id varchar(36),                               -- 系统日记账来源 id
  matched_ref_no varchar(64),                               -- 系统日记账单号
  source varchar(16) NOT NULL DEFAULT 'import',             -- import 导入 / manual 手工
  remark text,
  created_by varchar(36),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fin_bank_statements_dir_ck CHECK (direction IN ('in','out')),
  CONSTRAINT fin_bank_statements_match_ck CHECK (matched_status IN ('unmatched','matched'))
);
CREATE INDEX IF NOT EXISTS fin_bank_statements_account_idx ON public.fin_bank_statements(bank_account);
CREATE INDEX IF NOT EXISTS fin_bank_statements_match_idx ON public.fin_bank_statements(matched_status);
CREATE INDEX IF NOT EXISTS fin_bank_statements_date_idx ON public.fin_bank_statements(tran_date);
ALTER TABLE public.fin_bank_statements ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 4) 其他应付款（2241，负债类贷方末级）种子
-- ---------------------------------------------------------------------------
INSERT INTO public.fin_subjects (subject_code, subject_name, category, parent_code, direction, is_leaf, balance_flag, sort_no, remark)
VALUES ('2241', '其他应付款', 2, NULL, 1, true, true, 300, '其他应付款（员工报销贷方）')
ON CONFLICT (subject_code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 5) 费用报销审批规则（expense，按金额分级）
-- ---------------------------------------------------------------------------
INSERT INTO public.po_approval_rules (id, doc_type, level, min_amount, max_amount)
VALUES
  ('rule_expense_l1', 'expense', 1, 0, 500000),
  ('rule_expense_l2', 'expense', 2, 500000, 5000000),
  ('rule_expense_l3', 'expense', 3, 5000000, 20000000),
  ('rule_expense_l4', 'expense', 4, 20000000, NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.po_approval_rule_steps (id, rule_id, step_no, approver_role)
VALUES
  ('step_expense_l1_1', 'rule_expense_l1', 1, 'manager'),
  ('step_expense_l2_1', 'rule_expense_l2', 1, 'manager'),
  ('step_expense_l3_1', 'rule_expense_l3', 1, 'manager'),
  ('step_expense_l3_2', 'rule_expense_l3', 2, 'admin'),
  ('step_expense_l4_1', 'rule_expense_l4', 1, 'manager'),
  ('step_expense_l4_2', 'rule_expense_l4', 2, 'admin')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 6) 费用报销凭证模板（EXPENSE_CLAIM）
--    借：各项费用科目（不含税） + 进项税额（可抵扣部分）
--    贷：其他应付款-员工（含税合计）
--    注：多费用科目场景由服务端按明细逐行建分录取模板；单模板用于统一尾差归集科目。
-- ---------------------------------------------------------------------------
INSERT INTO public.fin_voucher_templates (template_code, name, event_type, spec, balance_to, is_system, remark)
VALUES (
  'EXPENSE_CLAIM', '费用报销(确认费用)',
  'expense_claim',
  '[{"dc":"d","account":"6601","account_name":"管理费用","expr":"#excl","summary":"报销费用"},
    {"dc":"d","account":"22210101","account_name":"应交税费—进项税额","expr":"#tax","summary":"可抵扣进项税"},
    {"dc":"c","account":"2241","account_name":"其他应付款","expr":"#amount","summary":"应付员工报销款"}]',
  '{"account":"6601","account_name":"管理费用","summary":"尾差调整"}',
  true, '费用报销确认：借费用+进项税，贷其他应付款'
)
ON CONFLICT (template_code) DO NOTHING;

NOTIFY pgrst, 'reload schema';

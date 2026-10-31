-- 0016 财务报表与期末结账：期间结账状态表 + 反结账留痕日志 + 本年利润科目种子
-- 幂等：全部 IF NOT EXISTS / ON CONFLICT 保护，可重复执行。

-- 1) 期间结账状态表（月/年会计期间）
CREATE TABLE IF NOT EXISTS public.fin_accounting_periods (
  period varchar(7) PRIMARY KEY,
  status varchar(20) NOT NULL DEFAULT 'open',          -- open / closed / annual_closed
  locked boolean NOT NULL DEFAULT false,
  profit_close_voucher_no varchar(32),
  profit_close_voucher_id varchar(36),
  closed_by varchar(36),
  closed_at timestamptz,
  reversed_by varchar(36),
  reversed_at timestamptz,
  reversed_reason text,
  year_end boolean NOT NULL DEFAULT false,             -- 年末结账标识
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fin_accounting_periods_status_ck CHECK (status IN ('open','closed','annual_closed'))
);
CREATE INDEX IF NOT EXISTS fin_accounting_periods_status_idx ON public.fin_accounting_periods(status);
ALTER TABLE public.fin_accounting_periods ENABLE ROW LEVEL SECURITY;

-- 2) 反结账 / 结账 / 年结 留痕日志（不可删除、不可修改：仅 INSERT 策略）
CREATE TABLE IF NOT EXISTS public.fin_period_logs (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  period varchar(7) NOT NULL,
  action varchar(40) NOT NULL,                          -- close / reopen / profit_close / year_close / retained_close
  actor varchar(36),
  reason text,
  ref_voucher_no varchar(32),
  payload jsonb,
  happened_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fin_period_logs_period_idx ON public.fin_period_logs(period);
ALTER TABLE public.fin_period_logs ENABLE ROW LEVEL SECURITY;

-- 3) 本年利润（权益类）种子：4103 本年利润；4104 未分配利润（已有则不动）
INSERT INTO public.fin_subjects (subject_code, subject_name, category, parent_code, direction, is_leaf, balance_flag, sort_no, remark)
VALUES ('4103', '本年利润', 4, NULL, 1, true, true, 412, '本年利润（期末结转损益归集）'),
       ('4104', '未分配利润', 4, NULL, 1, true, true, 413, '未分配利润（年结转入）'),
       ('6402', '所得税费用', 6, NULL, 0, true, true, 612, '所得税费用'),
       ('6403', '税金及附加', 6, NULL, 0, true, true, 613, '税金及附加')
ON CONFLICT (subject_code) DO NOTHING;
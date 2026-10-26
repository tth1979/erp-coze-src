-- ============================================================
-- 0011 财务凭证引擎 + 税务（fin_ / tax_）
-- 幂等：仅当对象不存在时创建，可重复执行
-- ============================================================

-- 商品税率（销项/进项按此计算，可配）
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='md_products' AND column_name='tax_rate') THEN
    ALTER TABLE public.md_products ADD COLUMN tax_rate numeric(5,2) NOT NULL DEFAULT 13;
  END IF;
END $$;

-- 凭证模板
CREATE TABLE IF NOT EXISTS public.fin_voucher_templates (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  template_code varchar(64) NOT NULL UNIQUE,
  name varchar(128) NOT NULL,
  event_type varchar(32) NOT NULL UNIQUE,
  spec jsonb NOT NULL,
  balance_to jsonb,
  is_system boolean NOT NULL DEFAULT false,
  status varchar(20) NOT NULL DEFAULT 'active',
  remark text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 记账凭证
CREATE TABLE IF NOT EXISTS public.fin_vouchers (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_no varchar(40) NOT NULL UNIQUE,
  voucher_date date NOT NULL,
  event_type varchar(32) NOT NULL,
  event_id varchar(36) NOT NULL,
  ref_no varchar(32),
  ref_summary text,
  template_code varchar(64) NOT NULL,
  total_debit numeric(14,2) NOT NULL DEFAULT 0,
  total_credit numeric(14,2) NOT NULL DEFAULT 0,
  status varchar(20) NOT NULL DEFAULT 'posted',
  source varchar(20) NOT NULL DEFAULT 'manual',
  created_by varchar(36),
  created_at timestamptz NOT NULL DEFAULT now(),
  posted_by varchar(36),
  posted_at timestamptz,
  void_of_no varchar(40),
  void_by varchar(36),
  void_at timestamptz,
  void_remark text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fin_vouchers_event_uniq UNIQUE (event_type, event_id),
  CONSTRAINT fin_vouchers_balance_ck CHECK (total_debit = total_credit)
);
CREATE INDEX IF NOT EXISTS fin_vouchers_date_idx ON public.fin_vouchers(voucher_date);
CREATE INDEX IF NOT EXISTS fin_vouchers_status_idx ON public.fin_vouchers(status);
CREATE INDEX IF NOT EXISTS fin_vouchers_event_idx ON public.fin_vouchers(event_type);
CREATE INDEX IF NOT EXISTS fin_vouchers_ref_no_idx ON public.fin_vouchers(ref_no);

-- 凭证分录
CREATE TABLE IF NOT EXISTS public.fin_voucher_lines (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id varchar(36) NOT NULL REFERENCES public.fin_vouchers(id) ON DELETE CASCADE,
  line_no integer NOT NULL,
  direction varchar(2) NOT NULL,
  account_code varchar(32) NOT NULL,
  account_name varchar(64) NOT NULL,
  amount numeric(14,2) NOT NULL,
  summary text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fin_voucher_lines_voucher_idx ON public.fin_voucher_lines(voucher_id);
CREATE INDEX IF NOT EXISTS fin_voucher_lines_account_idx ON public.fin_voucher_lines(account_code);

-- 税额登记
CREATE TABLE IF NOT EXISTS public.tax_entries (
  id varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  tax_type varchar(12) NOT NULL,
  period varchar(7) NOT NULL,
  tax_rate numeric(5,2) NOT NULL,
  amount numeric(14,2) NOT NULL,
  base_amount numeric(14,2) NOT NULL,
  tax_amount numeric(14,2) NOT NULL,
  doc_no varchar(32),
  ref_type varchar(32),
  ref_id varchar(36),
  source varchar(20) NOT NULL DEFAULT 'auto',
  status varchar(20) NOT NULL DEFAULT 'active',
  created_by varchar(36),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tax_entries_ref_uniq UNIQUE (ref_type, ref_id, tax_type)
);
CREATE INDEX IF NOT EXISTS tax_entries_period_idx ON public.tax_entries(period);
CREATE INDEX IF NOT EXISTS tax_entries_type_idx ON public.tax_entries(tax_type);
CREATE INDEX IF NOT EXISTS tax_entries_rate_idx ON public.tax_entries(tax_rate);

-- RLS
ALTER TABLE public.fin_voucher_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fin_vouchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fin_voucher_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tax_entries ENABLE ROW LEVEL SECURITY;

-- 内置凭证模板种子（幂等 upsert）
INSERT INTO public.fin_voucher_templates (template_code, name, event_type, spec, balance_to, is_system, remark)
VALUES
  (
    'SALES_SHIPMENT', '销售出库(确认收入)',
    'sales_shipment',
    '[{"dc":"d","account":"1122","account_name":"应收账款","expr":"#amount","summary":"销售商品款"},
      {"dc":"c","account":"6001","account_name":"主营业务收入","expr":"#excl","summary":"确认销售收入"},
      {"dc":"c","account":"22210102","account_name":"应交税费—销项税额","expr":"#tax","summary":"计提销项税"}]',
    '{"account":"6601","account_name":"管理费用","summary":"尾差调整"}',
    true, '销售出库确认收入：借应收，贷收入+销项税'
  ),
  (
    'PURCHASE_RECEIPT', '采购入库(确认应付)',
    'purchase_receipt',
    '[{"dc":"d","account":"1405","account_name":"库存商品","expr":"#excl","summary":"采购入库成本"},
      {"dc":"d","account":"22210101","account_name":"应交税费—进项税额","expr":"#tax","summary":"可抵扣进项税"},
      {"dc":"c","account":"2202","account_name":"应付账款","expr":"#amount","summary":"应付供应商货款"}]',
    '{"account":"6601","account_name":"管理费用","summary":"尾差调整"}',
    true, '采购入库：借库存+进项税，贷应付'
  ),
  (
    'RECEIPT_SETTLE', '收款核销',
    'receipt_settle',
    '[{"dc":"d","account":"1002","account_name":"银行存款","expr":"#amount","summary":"收到客户货款"},
      {"dc":"c","account":"1122","account_name":"应收账款","expr":"#amount","summary":"冲减应收"}]',
    null,
    true, '收款核销：借银行，贷应收'
  ),
  (
    'PAYMENT_SETTLE', '付款核销',
    'payment_settle',
    '[{"dc":"d","account":"2202","account_name":"应付账款","expr":"#amount","summary":"偿付供应商货款"},
      {"dc":"c","account":"1002","account_name":"银行存款","expr":"#amount","summary":"付供应商货款"}]',
    null,
    true, '付款核销：借应付，贷银行'
  ),
  (
    'RECEIPT_REVERSE', '暂估冲回(红蓝)',
    'receipt_reverse',
    '[{"dc":"d","account":"1405","account_name":"库存商品","expr":"#neg_est","summary":"红字冲回暂估"},
      {"dc":"c","account":"2203","account_name":"应付账款—暂估","expr":"#neg_est","summary":"红字冲回暂估"},
      {"dc":"d","account":"1405","account_name":"库存商品","expr":"#excl","summary":"蓝字按发票价重入"},
      {"dc":"d","account":"22210101","account_name":"应交税费—进项税额","expr":"#tax","summary":"蓝字进项税"},
      {"dc":"c","account":"2202","account_name":"应付账款","expr":"#amount","summary":"蓝字应付发票款"}]',
    '{"account":"6601","account_name":"管理费用","summary":"尾差调整"}',
    true, '暂估冲回：红字冲销暂估+蓝字按发票价重入'
  )
ON CONFLICT (template_code) DO NOTHING;

NOTIFY pgrst, 'reload schema';
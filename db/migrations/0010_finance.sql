-- ============================================================================
-- 0010_finance.sql · 财务-应收应付
-- 在既有 fin_payments（单表收付款台账）基础上增量扩展，不新建第二套收付款模型。
--
-- 改动：
-- 1. fin_payments 增加 status(审批/核销状态) 与核销追溯列：
--    - status      pending(待核销)/approved(已核销生效)/cancelled(作废)，默认 approved 兼容历史数据
--    - bill_no     核销对象单号快照（应收/应付单号，台账追溯）
--    - approved_by / approved_at / cancelled_by / cancelled_at  审核与作废留痕
-- 2. 新增核销 plpgsql 函数（单事务 + 行级锁，杜绝超收/超付与并发错账）：
--    - fin_apply_receipt  : 收款单核销（校验 本次+已核销 ≤ 应收 → 置 approved）
--    - fin_apply_payment  : 付款单核销（对称校验应付）
--    - fin_cancel_receipt / fin_cancel_payment : 仅允许作废 pending(未核销) 单据
-- 3. 应收/应付"单"不新增物理表：沿用本工程 SDK-only 聚合约定，由已出库/已入库
--    订单 + 核销流水按账期实时物化（see src/server/finance/payments.ts arBills/apBills）。
--    收付对账平衡恒成立：billed − received(approved) = outstanding(≥0)。
-- ============================================================================

-- 1. fin_payments 加列（幂等）
ALTER TABLE fin_payments ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'approved';
ALTER TABLE fin_payments ADD COLUMN IF NOT EXISTS bill_no VARCHAR(32);
ALTER TABLE fin_payments ADD COLUMN IF NOT EXISTS approved_by VARCHAR(36) REFERENCES sys_users(id);
ALTER TABLE fin_payments ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE fin_payments ADD COLUMN IF NOT EXISTS cancelled_by VARCHAR(36) REFERENCES sys_users(id);
ALTER TABLE fin_payments ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

-- 状态过滤索引
CREATE INDEX IF NOT EXISTS fin_payments_status_idx ON fin_payments (status);
CREATE INDEX IF NOT EXISTS fin_payments_bill_no_idx ON fin_payments (bill_no);

-- 2. 核销函数 --------------------------------------------------------------
CREATE OR REPLACE FUNCTION fin_apply_receipt(p_id VARCHAR)
RETURNS void AS $$
DECLARE
  v_customer_id fin_payments.customer_id%TYPE;
  v_amount fin_payments.amount%TYPE;
  v_status fin_payments.status%TYPE;
  v_billed NUMERIC;
  v_received NUMERIC;
BEGIN
  SELECT status, customer_id, amount INTO v_status, v_customer_id, v_amount
  FROM fin_payments WHERE id = p_id FOR UPDATE;
  IF v_status IS NULL THEN RAISE EXCEPTION 'FIN_NOT_FOUND' USING ERRCODE='P0404'; END IF;
  IF v_status <> 'pending' THEN RAISE EXCEPTION 'FIN_BAD_STATE' USING ERRCODE='P0400'; END IF;
  IF v_customer_id IS NULL OR v_amount IS NULL THEN RAISE EXCEPTION 'FIN_BAD_PARAM' USING ERRCODE='P0400'; END IF;
  PERFORM 1 FROM md_customers WHERE id = v_customer_id FOR UPDATE;
  SELECT COALESCE(SUM(total_amount),0) - COALESCE(
    (SELECT SUM(total_amount) FROM so_returns WHERE customer_id = v_customer_id AND status = 'approved'), 0)
  INTO v_billed
  FROM so_sales_orders WHERE customer_id = v_customer_id AND status IN ('completed','shipped');
  SELECT COALESCE(SUM(amount),0) INTO v_received
  FROM fin_payments WHERE direction = 'receipt' AND status = 'approved' AND customer_id = v_customer_id;
  IF v_amount > (v_billed - v_received) + 0.001 THEN
    RAISE EXCEPTION 'FIN_OVER_AMOUNT' USING ERRCODE='P0001';
  END IF;
  UPDATE fin_payments SET status = 'approved', approved_at = now() WHERE id = p_id;
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fin_apply_payment(p_id VARCHAR)
RETURNS void AS $$
DECLARE
  v_supplier_id fin_payments.supplier_id%TYPE;
  v_amount fin_payments.amount%TYPE;
  v_status fin_payments.status%TYPE;
  v_billed NUMERIC;
  v_paid NUMERIC;
BEGIN
  SELECT status, supplier_id, amount INTO v_status, v_supplier_id, v_amount
  FROM fin_payments WHERE id = p_id FOR UPDATE;
  IF v_status IS NULL THEN RAISE EXCEPTION 'FIN_NOT_FOUND' USING ERRCODE='P0404'; END IF;
  IF v_status <> 'pending' THEN RAISE EXCEPTION 'FIN_BAD_STATE' USING ERRCODE='P0400'; END IF;
  IF v_supplier_id IS NULL OR v_amount IS NULL THEN RAISE EXCEPTION 'FIN_BAD_PARAM' USING ERRCODE='P0400'; END IF;
  PERFORM 1 FROM md_suppliers WHERE id = v_supplier_id FOR UPDATE;
  SELECT COALESCE(SUM(total_amount),0) INTO v_billed
  FROM po_purchase_orders WHERE supplier_id = v_supplier_id AND status IN ('completed','received');
  v_billed := v_billed - COALESCE((SELECT SUM(total_amount) FROM po_returns WHERE supplier_id = v_supplier_id AND status = 'approved'), 0);
  v_billed := v_billed + COALESCE((SELECT SUM(CASE WHEN reversal_kind = 'blue' THEN total_amount ELSE -total_amount END)
    FROM po_receipts WHERE supplier_id = v_supplier_id AND status = 'approved' AND reversal_kind IS NOT NULL), 0);
  SELECT COALESCE(SUM(amount),0) INTO v_paid
  FROM fin_payments WHERE direction = 'payment' AND status = 'approved' AND supplier_id = v_supplier_id;
  IF v_amount > (v_billed - v_paid) + 0.001 THEN
    RAISE EXCEPTION 'FIN_OVER_AMOUNT' USING ERRCODE='P0001';
  END IF;
  UPDATE fin_payments SET status = 'approved', approved_at = now() WHERE id = p_id;
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fin_cancel_receipt(p_id VARCHAR)
RETURNS void AS $$
DECLARE
  v_status fin_payments.status%TYPE;
BEGIN
  SELECT status INTO v_status FROM fin_payments WHERE id = p_id FOR UPDATE;
  IF v_status IS NULL THEN RAISE EXCEPTION 'FIN_NOT_FOUND' USING ERRCODE='P0404'; END IF;
  IF v_status <> 'pending' THEN RAISE EXCEPTION 'FIN_BAD_STATE' USING ERRCODE='P0400'; END IF;
  UPDATE fin_payments SET status = 'cancelled', cancelled_at = now() WHERE id = p_id;
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fin_cancel_payment(p_id VARCHAR)
RETURNS void AS $$
DECLARE
  v_status fin_payments.status%TYPE;
BEGIN
  SELECT status INTO v_status FROM fin_payments WHERE id = p_id FOR UPDATE;
  IF v_status IS NULL THEN RAISE EXCEPTION 'FIN_NOT_FOUND' USING ERRCODE='P0404'; END IF;
  IF v_status <> 'pending' THEN RAISE EXCEPTION 'FIN_BAD_STATE' USING ERRCODE='P0400'; END IF;
  UPDATE fin_payments SET status = 'cancelled', cancelled_at = now() WHERE id = p_id;
END; $$ LANGUAGE plpgsql;

-- 3. RLS：fin_payments 既有 RLS 已开启（早期迁移），新增列为同表追加自动继承，无需重复配置。
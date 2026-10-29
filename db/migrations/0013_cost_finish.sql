-- 0013 成本与结转凭证（fin ledger）
-- 新增加工完工成本结转、销售出库成本结转两套凭证模板（复用 fin_voucher_templates）
-- 幂等种子：ON CONFLICT (template_code) DO NOTHING

INSERT INTO public.fin_voucher_templates (template_code, name, event_type, spec, balance_to, is_system, remark)
VALUES
  (
    'MANUFACTURE_FINISH', '加工完工(成本结转)',
    'manufacture_finish',
    '[{"dc":"d","account":"1405","account_name":"库存商品","expr":"#amount","summary":"加工完工入库成本"},
      {"dc":"c","account":"5101","account_name":"生产成本—加工归集","expr":"#amount","summary":"结转加工投入成本"}]',
    '{"account":"6601","account_name":"管理费用","summary":"尾差调整"}',
    true, '加工完工：借库存产成品，贷加工成本归集（差额按损耗处理）'
  ),
  (
    'SALES_SHIPMENT_COST', '销售出库(成本结转)',
    'sales_cof_shipment',
    '[{"dc":"d","account":"6401","account_name":"主营业务成本","expr":"#amount","summary":"结转已售商品成本"},
      {"dc":"c","account":"1405","account_name":"库存商品","expr":"#amount","summary":"出库冲减库存商品"}]',
    '{"account":"6601","account_name":"管理费用","summary":"尾差调整"}',
    true, '销售出库成本结转：借主营成本，贷库存商品（与销售收入凭证区分模板）'
  )
ON CONFLICT (template_code) DO NOTHING;

NOTIFY pgrst, 'reload schema';
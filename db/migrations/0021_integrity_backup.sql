-- 0021_integrity_backup.sql
-- 数据一致性断言结果 + 系统备份记录（幂等、RLS、只追加）

-- ============================================================
-- 1) 断言结果表（只追加）
-- ============================================================
CREATE TABLE IF NOT EXISTS sys_integrity_checks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id        uuid NOT NULL,                       -- 一次跑批的全部断言共享同一 run_id
  check_group   varchar(16) NOT NULL,                -- startup / daily / manual
  check_key     varchar(48) NOT NULL,                -- quantity_state / batch_closure / ledger_conservation / doc_no_unique / value_recon / voucher_balance / arap_recon
  check_name    varchar(128) NOT NULL,
  result        varchar(8) NOT NULL,                 -- pass / fail / warn
  severity      varchar(8) NOT NULL DEFAULT 'fail',  -- 失败时严重级别（fail 阻断结账 / warn 仅提示）
  failure_type  varchar(64),                         -- 失败分类（如 QTY_STATE_MISMATCH / LEDGER_CHAIN_BROKEN）
  detail        jsonb NOT NULL DEFAULT '{}'::jsonb,  -- 失败定位（表/单号/差异金额等）
  resolve_note  text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sys_integrity_checks_run ON sys_integrity_checks (run_id);
CREATE INDEX IF NOT EXISTS idx_sys_integrity_checks_time ON sys_integrity_checks (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sys_integrity_checks_result ON sys_integrity_checks (result, check_key);

ALTER TABLE sys_integrity_checks ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 2) 备份记录表（只追加）
-- ============================================================
CREATE TABLE IF NOT EXISTS sys_backups (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  backup_no     varchar(32) NOT NULL UNIQUE,         -- BKyyyymmdd-NNNN
  backup_time   timestamptz NOT NULL DEFAULT now(),
  backup_type   varchar(16) NOT NULL,                -- full / partial
  scope         jsonb NOT NULL DEFAULT '[]'::jsonb,  -- 备份覆盖的表清单
  status        varchar(16) NOT NULL DEFAULT 'success', -- success / failed
  operator_id   uuid,
  operator_name varchar(64),
  note          text,
  table_stats   jsonb NOT NULL DEFAULT '{}'::jsonb,  -- { table: { rows, sha256 } }
  total_rows    integer NOT NULL DEFAULT 0,
  payload       jsonb,                               -- 快照数据 { table: rows[] }（全量/按需备份真实内容）
  size_bytes    bigint NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sys_backups_time ON sys_backups (backup_time DESC);

ALTER TABLE sys_backups ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 3) 只追加触发器（两表共用函数）
-- ============================================================
CREATE OR REPLACE FUNCTION sys_integrity_block_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'SYS.IMMUTABLE: sys_integrity_checks/sys_backups 为只追加表，禁止 UPDATE/DELETE'
    USING ERRCODE = 'P0403';
END $$;

DROP TRIGGER IF EXISTS trg_sys_integrity_checks_block ON sys_integrity_checks;
CREATE TRIGGER trg_sys_integrity_checks_block
  BEFORE UPDATE OR DELETE ON sys_integrity_checks
  FOR EACH ROW EXECUTE FUNCTION sys_integrity_block_mutation();

DROP TRIGGER IF EXISTS trg_sys_backups_block ON sys_backups;
CREATE TRIGGER trg_sys_backups_block
  BEFORE UPDATE OR DELETE ON sys_backups
  FOR EACH ROW EXECUTE FUNCTION sys_integrity_block_mutation();

-- ============================================================
-- 4) 参数种子：断言严重级别 + 结账阻断开关 + 备份默认范围
-- ============================================================
INSERT INTO sys_settings (key, name, value, value_type, group_name, description, is_sensitive, is_system)
VALUES
  ('integrity.block_period_close', '断言失败阻断期末结账', 'true', 'boolean', '数据一致性',
   '开启后：存在 fail 级断言时，期末结账接口返回 409 阻断；关闭则仅告警。', false, true),
  ('integrity.value_recon.severity', '货值勾稽失败级别', 'warn', 'string', '数据一致性',
   '库存货值与总账 1405 勾稽偏差时的严重级别：fail=阻断结账，warn=仅告警（历史偏差场景默认 warn）。', false, true),
  ('backup.default_scope', '备份默认范围', '["md","po","so","inv","fin","tax","ma","sys","dict"]', 'json', '系统备份',
   '全量备份默认覆盖的表分组：md 基础资料 / po 采购 / so 销售 / inv 库存 / fin 财务 / tax 税务 / ma 加工 / sys 系统 / dict 字典。', false, true)
ON CONFLICT (key) DO NOTHING;

NOTIFY pgrst, 'reload schema';

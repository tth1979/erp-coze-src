import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
  varchar,
} from "drizzle-orm/pg-core";

// ============================================================
// 系统表（勿删除，平台健康检查依赖）
// ============================================================
export const healthCheck = pgTable("health_check", {
  id: serial().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).defaultNow(),
});

// ============================================================
// sys_ 系统模块：认证 + 基于角色的权限（T2：users.role 枚举）
// 升级路径：T3 时新增 roles / permissions / role_permissions / user_roles 四表
// ============================================================

/** 用户主体 */
export const sysUsers = pgTable(
  "sys_users",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    username: varchar("username", { length: 64 }).notNull().unique(),
    display_name: varchar("display_name", { length: 128 }).notNull(),
    /** 角色：admin(系统管理员) | manager(业务主管) | staff(业务员) */
    role: varchar("role", { length: 32 }).notNull().default("staff"),
    /** 状态：active | disabled */
    status: varchar("status", { length: 20 }).notNull().default("active"),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("sys_users_status_idx").on(table.status),
    index("sys_users_role_idx").on(table.role),
  ],
);

/** 登录凭证（抽象：新增登录方式 = 新增 type 值，不改表） */
export const sysUserCredentials = pgTable(
  "sys_user_credentials",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    user_id: varchar("user_id", { length: 36 })
      .notNull()
      .references(() => sysUsers.id, { onDelete: "cascade" }),
    /** 凭证类型：password | email_otp | oauth_* ... */
    type: varchar("type", { length: 32 }).notNull(),
    /** 标识：password 类型时为用户名 */
    identifier: varchar("identifier", { length: 128 }).notNull(),
    /** 口令哈希（scrypt 格式：scrypt$N$r$p$salt$hash） */
    secret_hash: varchar("secret_hash", { length: 256 }).notNull(),
    verified_at: timestamp("verified_at", { withTimezone: true }),
    metadata: jsonb("metadata"),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("sys_user_credentials_type_identifier_uniq").on(table.type, table.identifier),
    index("sys_user_credentials_user_id_idx").on(table.user_id),
  ],
);

/** 会话（opaque token，库存哈希） */
export const sysSessions = pgTable(
  "sys_sessions",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    user_id: varchar("user_id", { length: 36 })
      .notNull()
      .references(() => sysUsers.id, { onDelete: "cascade" }),
    /** 会话令牌 SHA-256 哈希（明文只出现在客户端 cookie） */
    token_hash: varchar("token_hash", { length: 128 }).notNull().unique(),
    user_agent: varchar("user_agent", { length: 256 }),
    ip: varchar("ip", { length: 64 }),
    issued_at: timestamp("issued_at", { withTimezone: true }).defaultNow().notNull(),
    last_active_at: timestamp("last_active_at", { withTimezone: true }).defaultNow().notNull(),
    expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
    revoked_at: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    index("sys_sessions_user_id_idx").on(table.user_id),
    index("sys_sessions_expires_at_idx").on(table.expires_at),
  ],
);

// ============================================================
// md_ 基础资料模块：客户 / 供应商 / 商品主数据
// ============================================================

/** 客户档案 */
export const mdCustomers = pgTable(
  "md_customers",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    /** 客户编码（业务唯一） */
    code: varchar("code", { length: 32 }).notNull().unique(),
    name: varchar("name", { length: 128 }).notNull(),
    contact: varchar("contact", { length: 64 }),
    phone: varchar("phone", { length: 32 }),
    email: varchar("email", { length: 128 }),
    address: varchar("address", { length: 256 }),
    /** 客户等级：normal | vip | strategic */
    level: varchar("level", { length: 32 }).notNull().default("normal"),
    tax_no: varchar("tax_no", { length: 64 }),
    status: varchar("status", { length: 20 }).notNull().default("active"),
    remark: text("remark"),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("md_customers_name_idx").on(table.name),
    index("md_customers_status_idx").on(table.status),
    index("md_customers_created_at_idx").on(table.created_at),
  ],
);

/** 供应商 */
export const mdSuppliers = pgTable(
  "md_suppliers",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    code: varchar("code", { length: 32 }).notNull().unique(),
    name: varchar("name", { length: 128 }).notNull(),
    contact: varchar("contact", { length: 64 }),
    phone: varchar("phone", { length: 32 }),
    email: varchar("email", { length: 128 }),
    address: varchar("address", { length: 256 }),
    tax_no: varchar("tax_no", { length: 64 }),
    /** 结算方式：月结/款到发货等 */
    settlement: varchar("settlement", { length: 64 }),
    status: varchar("status", { length: 20 }).notNull().default("active"),
    remark: text("remark"),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("md_suppliers_name_idx").on(table.name),
    index("md_suppliers_status_idx").on(table.status),
    index("md_suppliers_created_at_idx").on(table.created_at),
  ],
);

/** 瓷砖商品主数据 */
export const mdProducts = pgTable(
  "md_products",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    /** 商品编码/SKU（业务唯一） */
    sku_code: varchar("sku_code", { length: 32 }).notNull().unique(),
    name: varchar("name", { length: 128 }).notNull(),
    /** 型号（厂家型号） */
    model: varchar("model", { length: 64 }),
    /** 规格，如 800x800 / 600x1200 */
    spec: varchar("spec", { length: 64 }),
    /** 计量单位：片 | 箱 | ㎡ */
    unit: varchar("unit", { length: 16 }).notNull().default("片"),
    /** 条形码 */
    barcode: varchar("barcode", { length: 64 }),
    /** 品类：抛光砖/釉面砖/岩板/仿古砖... */
    category: varchar("category", { length: 64 }),
    brand: varchar("brand", { length: 64 }),
    color: varchar("color", { length: 64 }),
    pieces_per_box: integer("pieces_per_box"),
    /** 每箱面积（㎡） */
    area_per_box: numeric("area_per_box", { precision: 10, scale: 3 }),
    reference_purchase_price: numeric("reference_purchase_price", { precision: 12, scale: 2 }),
    reference_sale_price: numeric("reference_sale_price", { precision: 12, scale: 2 }),
    status: varchar("status", { length: 20 }).notNull().default("active"),
    remark: text("remark"),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("md_products_name_idx").on(table.name),
    index("md_products_barcode_idx").on(table.barcode),
    index("md_products_category_idx").on(table.category),
    index("md_products_status_idx").on(table.status),
    index("md_products_created_at_idx").on(table.created_at),
  ],
);

// ============================================================
// po_ 采购模块：采购订单（单据头 + 明细行）
// 库存联动（到货入库）留待 inv_ 库存里程碑，状态机已预留 completed
// ============================================================

/** 采购订单（单据头） */
export const poPurchaseOrders = pgTable(
  "po_purchase_orders",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    /** 采购单号：POyyyymmdd-NNNN（业务唯一） */
    order_no: varchar("order_no", { length: 32 }).notNull().unique(),
    supplier_id: varchar("supplier_id", { length: 36 })
      .notNull()
      .references(() => mdSuppliers.id),
    /**
     * 状态机（采购 V2）：draft(草稿) → pending(待审) → approved(已审) → received(已入库)
     *                  ↘ rejected(已驳回，可改回草稿重报) | draft/pending → closed(已关闭)
     * 历史状态映射：confirmed→approved / completed→received / cancelled→closed
     */
    status: varchar("status", { length: 20 }).notNull().default("draft"),
    /** 下单日期（YYYY-MM-DD） */
    order_date: date("order_date", { mode: "string" }).notNull(),
    /** 订单总额（由明细行服务端计算） */
    total_amount: numeric("total_amount", { precision: 14, scale: 2 }).notNull().default("0"),
    /** 来源采购申请单（可空；申请单转入后回写） */
    requisition_id: varchar("requisition_id", { length: 36 }),
    /** 审批级别（按金额命中规则，1-4；未提交为 null） */
    approval_level: integer("approval_level"),
    /** 当前审批步（1 起；审批完成为 0） */
    current_step: integer("current_step").notNull().default(0),
    submitted_by: varchar("submitted_by", { length: 36 }).references(() => sysUsers.id),
    submitted_at: timestamp("submitted_at", { withTimezone: true }),
    approved_by: varchar("approved_by", { length: 36 }).references(() => sysUsers.id),
    approved_at: timestamp("approved_at", { withTimezone: true }),
    /** 驳回原因（rejected 时非空） */
    reject_reason: text("reject_reason"),
    remark: text("remark"),
    created_by: varchar("created_by", { length: 36 }).references(() => sysUsers.id),
    confirmed_at: timestamp("confirmed_at", { withTimezone: true }),
    cancelled_at: timestamp("cancelled_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("po_orders_supplier_idx").on(table.supplier_id),
    index("po_orders_status_idx").on(table.status),
    index("po_orders_order_date_idx").on(table.order_date),
    index("po_orders_created_at_idx").on(table.created_at),
  ],
);

/** 采购订单明细行（随订单级联删除） */
export const poPurchaseOrderItems = pgTable(
  "po_purchase_order_items",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    order_id: varchar("order_id", { length: 36 })
      .notNull()
      .references(() => poPurchaseOrders.id, { onDelete: "cascade" }),
    product_id: varchar("product_id", { length: 36 })
      .notNull()
      .references(() => mdProducts.id),
    /** 数量（支持小数，如按 ㎡ 采购） */
    quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull(),
    /** 采购单价 */
    unit_price: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
    /** 行金额 = quantity * unit_price（服务端计算） */
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    /** 单位快照（商品单位后续变更不影响历史单据） */
    unit: varchar("unit", { length: 16 }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("po_items_order_idx").on(table.order_id),
    index("po_items_product_idx").on(table.product_id),
  ],
);

// ============================================================
// 销售模块（so_*）
// 库存联动（销售出库）留待 inv_ 库存里程碑，状态机已预留 completed
// ============================================================

/** 销售订单（单据头） */
export const soSalesOrders = pgTable(
  "so_sales_orders",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    /** 销售单号：SOyyyymmdd-NNNN（业务唯一） */
    order_no: varchar("order_no", { length: 32 }).notNull().unique(),
    customer_id: varchar("customer_id", { length: 36 })
      .notNull()
      .references(() => mdCustomers.id),
    /** 状态：draft(草稿) | pending(待审) | approved(已审) | rejected(已驳回) | shipped(已出库) | closed(已关闭) */
    status: varchar("status", { length: 20 }).notNull().default("draft"),
    /** 下单日期（YYYY-MM-DD） */
    order_date: date("order_date", { mode: "string" }).notNull(),
    /** 订单总额（由明细行服务端计算，审批通过即锁定成交价） */
    total_amount: numeric("total_amount", { precision: 14, scale: 2 }).notNull().default("0"),
    /** 审批：命中的规则级别 / 当前步骤序号 */
    approval_level: integer("approval_level"),
    current_step: integer("current_step").notNull().default(0),
    submitted_by: varchar("submitted_by", { length: 36 }),
    submitted_at: timestamp("submitted_at", { withTimezone: true }),
    approved_by: varchar("approved_by", { length: 36 }),
    approved_at: timestamp("approved_at", { withTimezone: true }),
    reject_reason: text("reject_reason"),
    remark: text("remark"),
    created_by: varchar("created_by", { length: 36 }).references(() => sysUsers.id),
    confirmed_at: timestamp("confirmed_at", { withTimezone: true }),
    cancelled_at: timestamp("cancelled_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("so_orders_customer_idx").on(table.customer_id),
    index("so_orders_status_idx").on(table.status),
    index("so_orders_order_date_idx").on(table.order_date),
    index("so_orders_created_at_idx").on(table.created_at),
  ],
);

/** 销售订单明细行（随订单级联删除） */
export const soSalesOrderItems = pgTable(
  "so_sales_order_items",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    order_id: varchar("order_id", { length: 36 })
      .notNull()
      .references(() => soSalesOrders.id, { onDelete: "cascade" }),
    product_id: varchar("product_id", { length: 36 })
      .notNull()
      .references(() => mdProducts.id),
    /** 数量（支持小数，如按 ㎡ 销售） */
    quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull(),
    /** 销售单价 */
    unit_price: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
    /** 行金额 = quantity * unit_price（服务端计算） */
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    /** 单位快照（商品单位后续变更不影响历史单据） */
    unit: varchar("unit", { length: 16 }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("so_items_order_idx").on(table.order_id),
    index("so_items_product_idx").on(table.product_id),
  ],
);

/** 销售出库单（SH；审核通过单事务扣库存并结转移动加权成本） */
export const soShipments = pgTable(
  "so_shipments",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    /** 出库单号：SHyyyymmdd-NNNN（业务唯一） */
    shipment_no: varchar("shipment_no", { length: 32 }).notNull().unique(),
    order_id: varchar("order_id", { length: 36 })
      .notNull()
      .references(() => soSalesOrders.id),
    /** 客户快照（冗余，便于台账与权限过滤） */
    customer_id: varchar("customer_id", { length: 36 })
      .notNull()
      .references(() => mdCustomers.id),
    /** 状态：draft | pending | approved(已出库) | rejected | closed */
    status: varchar("status", { length: 20 }).notNull().default("draft"),
    ship_date: date("ship_date", { mode: "string" }).notNull(),
    /** 出库金额（按订单锁定成交价计算） */
    total_amount: numeric("total_amount", { precision: 14, scale: 2 }).notNull().default("0"),
    /** 结转销售成本（Σ 明细 cost，审批通过后写入） */
    total_cost: numeric("total_cost", { precision: 16, scale: 2 }).notNull().default("0"),
    approval_level: integer("approval_level"),
    current_step: integer("current_step").notNull().default(0),
    submitted_by: varchar("submitted_by", { length: 36 }),
    submitted_at: timestamp("submitted_at", { withTimezone: true }),
    approved_by: varchar("approved_by", { length: 36 }),
    approved_at: timestamp("approved_at", { withTimezone: true }),
    reject_reason: text("reject_reason"),
    remark: text("remark"),
    created_by: varchar("created_by", { length: 36 }).references(() => sysUsers.id),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("so_shipments_order_idx").on(table.order_id),
    index("so_shipments_customer_idx").on(table.customer_id),
    index("so_shipments_status_idx").on(table.status),
    index("so_shipments_created_at_idx").on(table.created_at),
  ],
);

/** 销售出库单明细 */
export const soShipmentItems = pgTable(
  "so_shipment_items",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    shipment_id: varchar("shipment_id", { length: 36 })
      .notNull()
      .references(() => soShipments.id, { onDelete: "cascade" }),
    product_id: varchar("product_id", { length: 36 })
      .notNull()
      .references(() => mdProducts.id),
    quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull(),
    unit_price: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    /** 结转成本（= 出库时点移动加权均价 × 数量，审批通过时写入） */
    cost: numeric("cost", { precision: 14, scale: 2 }),
    unit: varchar("unit", { length: 16 }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("so_shipment_items_shipment_idx").on(table.shipment_id),
    index("so_shipment_items_product_idx").on(table.product_id),
  ],
);

/** 销售退货单（SR；审核通过按出库成本红字回补库存） */
export const soReturns = pgTable(
  "so_returns",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    /** 退货单号：SRyyyymmdd-NNNN（业务唯一） */
    return_no: varchar("return_no", { length: 32 }).notNull().unique(),
    order_id: varchar("order_id", { length: 36 })
      .notNull()
      .references(() => soSalesOrders.id),
    /** 关联出库单（可空，按订单维度退货时为空） */
    shipment_id: varchar("shipment_id", { length: 36 }).references(() => soShipments.id),
    customer_id: varchar("customer_id", { length: 36 })
      .notNull()
      .references(() => mdCustomers.id),
    /** 状态：draft | pending | approved(已入库) | rejected | closed */
    status: varchar("status", { length: 20 }).notNull().default("draft"),
    return_date: date("return_date", { mode: "string" }).notNull(),
    reason: text("reason"),
    /** 退货金额（红字，按销售价计） */
    total_amount: numeric("total_amount", { precision: 14, scale: 2 }).notNull().default("0"),
    approval_level: integer("approval_level"),
    current_step: integer("current_step").notNull().default(0),
    submitted_by: varchar("submitted_by", { length: 36 }),
    submitted_at: timestamp("submitted_at", { withTimezone: true }),
    approved_by: varchar("approved_by", { length: 36 }),
    approved_at: timestamp("approved_at", { withTimezone: true }),
    reject_reason: text("reject_reason"),
    remark: text("remark"),
    created_by: varchar("created_by", { length: 36 }).references(() => sysUsers.id),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("so_returns_order_idx").on(table.order_id),
    index("so_returns_customer_idx").on(table.customer_id),
    index("so_returns_status_idx").on(table.status),
    index("so_returns_created_at_idx").on(table.created_at),
  ],
);

/** 销售退货单明细 */
export const soReturnItems = pgTable(
  "so_return_items",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    return_id: varchar("return_id", { length: 36 })
      .notNull()
      .references(() => soReturns.id, { onDelete: "cascade" }),
    product_id: varchar("product_id", { length: 36 })
      .notNull()
      .references(() => mdProducts.id),
    quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull(),
    unit_price: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    /** 回补成本单价（创建时快照当前移动加权均价，红字冲销口径） */
    unit_cost: numeric("unit_cost", { precision: 14, scale: 4 }),
    unit: varchar("unit", { length: 16 }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("so_return_items_return_idx").on(table.return_id),
    index("so_return_items_product_idx").on(table.product_id),
  ],
);

// ============================================================
// 库存模块（inv_*）
// 余额表（每个商品一行）+ 流水台账；出入库强一致由数据库函数保证
// ============================================================

/** 库存余额（单仓库模型，每个商品一行） */
export const invStock = pgTable(
  "inv_stock",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    product_id: varchar("product_id", { length: 36 })
      .notNull()
      .unique()
      .references(() => mdProducts.id),
    /** 当前库存数量 */
    quantity: numeric("quantity", { precision: 14, scale: 3 }).notNull().default("0"),
    /** 移动加权平均单位成本（采购 V2 入库时重算） */
    avg_cost: numeric("avg_cost", { precision: 14, scale: 4 }).notNull().default("0"),
    /** 库存货值 = Σ(入库金额) − Σ(出库成本)，随移动加权联动 */
    total_cost: numeric("total_cost", { precision: 16, scale: 2 }).notNull().default("0"),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("inv_stock_quantity_idx").on(table.quantity)],
);

/** 库存流水（台账，只追加不改写） */
export const invStockMovements = pgTable(
  "inv_stock_movements",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    product_id: varchar("product_id", { length: 36 })
      .notNull()
      .references(() => mdProducts.id),
    /** 类型：in(入库) | out(出库) | adjust(盘盈/盘亏) */
    type: varchar("type", { length: 16 }).notNull(),
    /** 本次变动数量（in/adjust盘盈为正，out/adjust盘亏为负） */
    quantity: numeric("quantity", { precision: 14, scale: 3 }).notNull(),
    /** 变动后余额（冗余快照，便于台账直接对账） */
    balance: numeric("balance", { precision: 14, scale: 3 }).notNull(),
    /** 来源：purchase_in / sales_out / purchase_return / receipt_reversal / manual */
    source: varchar("source", { length: 32 }).notNull().default("manual"),
    /** 单位成本快照（入库=入库价；出库=当时移动加权成本；历史数据可空） */
    unit_cost: numeric("unit_cost", { precision: 14, scale: 4 }),
    /** 关联单号（如 PO/SO 单号），手工出入库可空 */
    ref_no: varchar("ref_no", { length: 32 }),
    remark: text("remark"),
    created_by: varchar("created_by", { length: 36 }).references(() => sysUsers.id),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("inv_mov_product_idx").on(table.product_id),
    index("inv_mov_created_at_idx").on(table.created_at),
    index("inv_mov_type_idx").on(table.type),
  ],
);

// ============================================================
// 财务模块（fin_*）：收付款台账 + 应收/应付欠款
// 欠款 = Σ(已完成订单总额) − Σ(收付款)，服务端内存聚合（不建视图）
// ============================================================

/** 收付款单（台账：receipt=收款 / payment=付款，共用一表） */
export const finPayments = pgTable(
  "fin_payments",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    /** 单号：RCyyyymmdd-NNNN（收款）/ PYyyyymmdd-NNNN（付款），业务唯一 */
    doc_no: varchar("doc_no", { length: 32 }).notNull().unique(),
    /** 方向：receipt(收款，关联客户) | payment(付款，关联供应商) */
    direction: varchar("direction", { length: 16 }).notNull(),
    /** 客户（direction=receipt 时非空） */
    customer_id: varchar("customer_id", { length: 36 }).references(() => mdCustomers.id),
    /** 供应商（direction=payment 时非空） */
    supplier_id: varchar("supplier_id", { length: 36 }).references(() => mdSuppliers.id),
    /**
     * 关联订单 ID（可空；receipt→so_sales_orders.id / payment→po_purchase_orders.id）。
     * 因指向不同表不建 FK，仅存值 + order_no 快照。
     */
    order_id: varchar("order_id", { length: 36 }),
    /** 关联单号快照（便于台账直接对账） */
    order_no: varchar("order_no", { length: 32 }),
    /** 金额（>0，两位小数） */
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    /** 方式：cash(现金) | bank(银行转账) | wechat(微信) | alipay(支付宝) | other(其他) */
    method: varchar("method", { length: 32 }).notNull().default("bank"),
    /** 收付款日期（YYYY-MM-DD） */
    paid_at: date("paid_at", { mode: "string" }).notNull(),
    remark: text("remark"),
    created_by: varchar("created_by", { length: 36 }).references(() => sysUsers.id),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("fin_payments_direction_idx").on(table.direction),
    index("fin_payments_customer_idx").on(table.customer_id),
    index("fin_payments_supplier_idx").on(table.supplier_id),
    index("fin_payments_paid_at_idx").on(table.paid_at),
    index("fin_payments_created_at_idx").on(table.created_at),
  ],
);

// ============================================================
// 采购 V2（po_*）：审批流 + 申请单 / 入库单 / 退货单
// 状态机统一：draft → pending → approved（→ received / reversed / closed 等终态）
//                        ↘ rejected（可编辑后重新提交）
// 审批按金额分级（po_approval_rules，1-4 级，级内可配多步角色链）。
// ============================================================

/** 审批规则（按单据类型 + 金额区间分级） */
export const poApprovalRules = pgTable(
  "po_approval_rules",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    /** 单据类型：requisition(申请) | order(订单) | receipt(入库) | return(退货) */
    doc_type: varchar("doc_type", { length: 16 }).notNull(),
    /** 级别 1-4（金额越大级别越高） */
    level: integer("level").notNull(),
    /** 金额下限（含） */
    min_amount: numeric("min_amount", { precision: 14, scale: 2 }).notNull().default("0"),
    /** 金额上限（不含；null 表示不封顶） */
    max_amount: numeric("max_amount", { precision: 14, scale: 2 }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [unique("po_approval_rules_type_level_uniq").on(table.doc_type, table.level)],
);

/** 审批规则步骤（角色链，step_no 递增依次审批） */
export const poApprovalRuleSteps = pgTable(
  "po_approval_rule_steps",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    rule_id: varchar("rule_id", { length: 36 })
      .notNull()
      .references(() => poApprovalRules.id, { onDelete: "cascade" }),
    step_no: integer("step_no").notNull(),
    /** 审批角色：manager | admin（admin 可代审任意步骤） */
    approver_role: varchar("approver_role", { length: 16 }).notNull(),
  },
  (table) => [unique("po_approval_rule_steps_uniq").on(table.rule_id, table.step_no)],
);

/** 审批步骤实例（单据提交时按规则快照生成） */
export const poApprovalSteps = pgTable(
  "po_approval_steps",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    doc_type: varchar("doc_type", { length: 16 }).notNull(),
    /** 单据 ID（多态，不建 FK） */
    doc_id: varchar("doc_id", { length: 36 }).notNull(),
    step_no: integer("step_no").notNull(),
    approver_role: varchar("approver_role", { length: 16 }).notNull(),
    /** pending | approved | rejected */
    status: varchar("status", { length: 16 }).notNull().default("pending"),
    approver_id: varchar("approver_id", { length: 36 }).references(() => sysUsers.id),
    comment: text("comment"),
    acted_at: timestamp("acted_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("po_approval_steps_doc_idx").on(table.doc_type, table.doc_id)],
);

/** 采购申请单（业务申请 → 审批 → 转采购订单） */
export const poRequisitions = pgTable(
  "po_requisitions",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    /** 申请单号：PRyyyymmdd-NNNN（业务唯一） */
    req_no: varchar("req_no", { length: 32 }).notNull().unique(),
    status: varchar("status", { length: 20 }).notNull().default("draft"),
    /** 申请事由 */
    reason: text("reason"),
    /** 估算总额（按明细建议价服务端计算） */
    total_estimate: numeric("total_estimate", { precision: 14, scale: 2 }).notNull().default("0"),
    approval_level: integer("approval_level"),
    current_step: integer("current_step").notNull().default(0),
    submitted_by: varchar("submitted_by", { length: 36 }).references(() => sysUsers.id),
    submitted_at: timestamp("submitted_at", { withTimezone: true }),
    approved_by: varchar("approved_by", { length: 36 }).references(() => sysUsers.id),
    approved_at: timestamp("approved_at", { withTimezone: true }),
    reject_reason: text("reject_reason"),
    /** 转出的采购订单（approved 后一张申请单只转一次） */
    converted_order_id: varchar("converted_order_id", { length: 36 }),
    remark: text("remark"),
    created_by: varchar("created_by", { length: 36 }).references(() => sysUsers.id),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("po_req_status_idx").on(table.status),
    index("po_req_created_at_idx").on(table.created_at),
  ],
);

/** 采购申请明细行 */
export const poRequisitionItems = pgTable(
  "po_requisition_items",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    requisition_id: varchar("requisition_id", { length: 36 })
      .notNull()
      .references(() => poRequisitions.id, { onDelete: "cascade" }),
    product_id: varchar("product_id", { length: 36 })
      .notNull()
      .references(() => mdProducts.id),
    quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull(),
    /** 建议采购单价（转入订单时预填） */
    suggest_price: numeric("suggest_price", { precision: 12, scale: 2 }).notNull().default("0"),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull().default("0"),
    unit: varchar("unit", { length: 16 }),
    remark: varchar("remark", { length: 200 }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("po_req_items_req_idx").on(table.requisition_id)],
);

/**
 * 采购入库单（订单已审 → 入库 → 库存/成本/应付联动）
 * 暂估：is_estimated=true（发票未到）；来票后冲回生成红/蓝字单，本单置 reversed。
 */
export const poReceipts = pgTable(
  "po_receipts",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    /** 入库单号：GRyyyymmdd-NNNN（业务唯一） */
    receipt_no: varchar("receipt_no", { length: 32 }).notNull().unique(),
    order_id: varchar("order_id", { length: 36 })
      .notNull()
      .references(() => poPurchaseOrders.id),
    supplier_id: varchar("supplier_id", { length: 36 })
      .notNull()
      .references(() => mdSuppliers.id),
    /**
     * 状态：draft → pending → approved(已入库) → reversed(已冲回)
     *                    ↘ rejected | draft/pending → closed
     */
    status: varchar("status", { length: 20 }).notNull().default("draft"),
    /** 暂估入库（发票未到按暂估价入账） */
    is_estimated: boolean("is_estimated").notNull().default(false),
    /** 来票发票号（冲回时登记） */
    invoice_no: varchar("invoice_no", { length: 64 }),
    /** 冲回来源单（红/蓝字单指向被冲回的暂估单） */
    reversal_of_id: varchar("reversal_of_id", { length: 36 }),
    /** 冲回字别：red(红字冲销) | blue(蓝字重入)；正常单为 null */
    reversal_kind: varchar("reversal_kind", { length: 8 }),
    total_amount: numeric("total_amount", { precision: 14, scale: 2 }).notNull().default("0"),
    /** 入库日期（YYYY-MM-DD） */
    receive_date: date("receive_date", { mode: "string" }).notNull(),
    approval_level: integer("approval_level"),
    current_step: integer("current_step").notNull().default(0),
    submitted_by: varchar("submitted_by", { length: 36 }).references(() => sysUsers.id),
    submitted_at: timestamp("submitted_at", { withTimezone: true }),
    approved_by: varchar("approved_by", { length: 36 }).references(() => sysUsers.id),
    approved_at: timestamp("approved_at", { withTimezone: true }),
    reject_reason: text("reject_reason"),
    remark: text("remark"),
    created_by: varchar("created_by", { length: 36 }).references(() => sysUsers.id),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("po_receipts_order_idx").on(table.order_id),
    index("po_receipts_supplier_idx").on(table.supplier_id),
    index("po_receipts_status_idx").on(table.status),
    index("po_receipts_created_at_idx").on(table.created_at),
  ],
);

/** 采购入库明细行 */
export const poReceiptItems = pgTable(
  "po_receipt_items",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    receipt_id: varchar("receipt_id", { length: 36 })
      .notNull()
      .references(() => poReceipts.id, { onDelete: "cascade" }),
    product_id: varchar("product_id", { length: 36 })
      .notNull()
      .references(() => mdProducts.id),
    quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull(),
    /** 入库单价（即入库成本价） */
    unit_price: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    unit: varchar("unit", { length: 16 }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("po_receipt_items_receipt_idx").on(table.receipt_id),
    index("po_receipt_items_product_idx").on(table.product_id),
  ],
);

/** 采购退货单（审批通过 → 库存出库 + 应付冲减） */
export const poReturns = pgTable(
  "po_returns",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    /** 退货单号：RTyyyymmdd-NNNN（业务唯一） */
    return_no: varchar("return_no", { length: 32 }).notNull().unique(),
    /** 关联采购订单 / 入库单（可空，便于无单退货） */
    order_id: varchar("order_id", { length: 36 }).references(() => poPurchaseOrders.id),
    receipt_id: varchar("receipt_id", { length: 36 }).references(() => poReceipts.id),
    supplier_id: varchar("supplier_id", { length: 36 })
      .notNull()
      .references(() => mdSuppliers.id),
    /** 状态：draft → pending → approved(已出库) ↘ rejected | closed */
    status: varchar("status", { length: 20 }).notNull().default("draft"),
    /** 退货原因 */
    reason: text("reason"),
    total_amount: numeric("total_amount", { precision: 14, scale: 2 }).notNull().default("0"),
    return_date: date("return_date", { mode: "string" }).notNull(),
    approval_level: integer("approval_level"),
    current_step: integer("current_step").notNull().default(0),
    submitted_by: varchar("submitted_by", { length: 36 }).references(() => sysUsers.id),
    submitted_at: timestamp("submitted_at", { withTimezone: true }),
    approved_by: varchar("approved_by", { length: 36 }).references(() => sysUsers.id),
    approved_at: timestamp("approved_at", { withTimezone: true }),
    reject_reason: text("reject_reason"),
    remark: text("remark"),
    created_by: varchar("created_by", { length: 36 }).references(() => sysUsers.id),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("po_returns_supplier_idx").on(table.supplier_id),
    index("po_returns_status_idx").on(table.status),
    index("po_returns_created_at_idx").on(table.created_at),
  ],
);

/** 采购退货明细行 */
export const poReturnItems = pgTable(
  "po_return_items",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    return_id: varchar("return_id", { length: 36 })
      .notNull()
      .references(() => poReturns.id, { onDelete: "cascade" }),
    product_id: varchar("product_id", { length: 36 })
      .notNull()
      .references(() => mdProducts.id),
    quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull(),
    unit_price: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    unit: varchar("unit", { length: 16 }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("po_return_items_return_idx").on(table.return_id),
    index("po_return_items_product_idx").on(table.product_id),
  ],
);

// ============================================================
// 类型导出
// ============================================================
export type SysUser = typeof sysUsers.$inferSelect;
export type SysUserCredential = typeof sysUserCredentials.$inferSelect;
export type SysSession = typeof sysSessions.$inferSelect;
export type MdCustomer = typeof mdCustomers.$inferSelect;
export type MdSupplier = typeof mdSuppliers.$inferSelect;
export type MdProduct = typeof mdProducts.$inferSelect;
export type PoPurchaseOrder = typeof poPurchaseOrders.$inferSelect;
export type PoPurchaseOrderItem = typeof poPurchaseOrderItems.$inferSelect;
export type SoSalesOrder = typeof soSalesOrders.$inferSelect;
export type SoSalesOrderItem = typeof soSalesOrderItems.$inferSelect;
export type InvStock = typeof invStock.$inferSelect;
export type InvStockMovement = typeof invStockMovements.$inferSelect;
export type FinPayment = typeof finPayments.$inferSelect;
export type PoApprovalRule = typeof poApprovalRules.$inferSelect;
export type PoApprovalRuleStep = typeof poApprovalRuleSteps.$inferSelect;
export type PoApprovalStep = typeof poApprovalSteps.$inferSelect;
export type PoRequisition = typeof poRequisitions.$inferSelect;
export type PoRequisitionItem = typeof poRequisitionItems.$inferSelect;
export type PoReceipt = typeof poReceipts.$inferSelect;
export type PoReceiptItem = typeof poReceiptItems.$inferSelect;
export type PoReturn = typeof poReturns.$inferSelect;
export type PoReturnItem = typeof poReturnItems.$inferSelect;
export type SoShipment = typeof soShipments.$inferSelect;
export type SoShipmentItem = typeof soShipmentItems.$inferSelect;
export type SoReturn = typeof soReturns.$inferSelect;
export type SoReturnItem = typeof soReturnItems.$inferSelect;

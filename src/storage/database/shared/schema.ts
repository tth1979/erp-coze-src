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
    /** 部门（数据级"本部门"范围归属依据，0020 新增） */
    dept: varchar("dept", { length: 64 }),
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
    /** 销项/进项税率（%），凭证与税务引擎按此计算税额，可配 */
    tax_rate: numeric("tax_rate", { precision: 5, scale: 2 }).notNull().default("13"),
    /** 安全库存阈值（跨仓合计现有量 ≤ 该值触发预警；0=不预警） */
    safety_stock: numeric("safety_stock", { precision: 12, scale: 3 }).notNull().default("0"),
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
    /** 期望入库仓库（可空，空=默认仓 WH01；一键到货入库时带入入库单） */
    warehouse_id: varchar("warehouse_id", { length: 36 }).references(() => invWarehouses.id),
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
    /** 发货仓库（可空，空=默认仓 WH01；一键发货出库时带入出库单） */
    warehouse_id: varchar("warehouse_id", { length: 36 }).references(() => invWarehouses.id),
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
    /** 出库仓库（可空，空=默认仓 WH01） */
    warehouse_id: varchar("warehouse_id", { length: 36 }).references(() => invWarehouses.id),
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
    /** 退货入仓库（可空，空=默认仓 WH01） */
    warehouse_id: varchar("warehouse_id", { length: 36 }).references(() => invWarehouses.id),
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
// 库存模块（inv_*，库存 V2 多仓库版）
// 余额表（仓库 × 商品一行）+ 批次表 + 只追加台账；出入库强一致由数据库函数保证
// ============================================================

/** 仓库档案 */
export const invWarehouses = pgTable(
  "inv_warehouses",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    /** 仓库编码（业务唯一，如 WH01） */
    code: varchar("code", { length: 20 }).notNull().unique(),
    name: varchar("name", { length: 100 }).notNull(),
    address: text("address"),
    is_active: boolean("is_active").notNull().default(true),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("inv_wh_active_idx").on(table.is_active)],
);

/** 库存余额（仓库 × 商品一行；可用量 = quantity − frozen_quantity） */
export const invStock = pgTable(
  "inv_stock",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    warehouse_id: varchar("warehouse_id", { length: 36 })
      .notNull()
      .references(() => invWarehouses.id),
    product_id: varchar("product_id", { length: 36 })
      .notNull()
      .references(() => mdProducts.id),
    /** 现有量（实物在库数量） */
    quantity: numeric("quantity", { precision: 14, scale: 3 }).notNull().default("0"),
    /** 在途量（调拨已审未收货，计入本仓） */
    in_transit: numeric("in_transit", { precision: 14, scale: 3 }).notNull().default("0"),
    /** 冻结量（不可用数量；可用量 = quantity − frozen） */
    frozen_quantity: numeric("frozen_quantity", { precision: 14, scale: 3 }).notNull().default("0"),
    /** 移动加权平均单位成本（采购 V2 入库时重算） */
    avg_cost: numeric("avg_cost", { precision: 14, scale: 4 }).notNull().default("0"),
    /** 库存货值 = Σ(入库金额) − Σ(出库成本)，随移动加权联动 */
    total_cost: numeric("total_cost", { precision: 16, scale: 2 }).notNull().default("0"),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("inv_stock_warehouse_product_unique").on(table.warehouse_id, table.product_id),
    index("inv_stock_quantity_idx").on(table.quantity),
    index("inv_stock_product_idx").on(table.product_id),
  ],
);

/** 库存批次（入库自动生成批次：批号默认取入库单号；出库按 FIFO 扣减剩余量） */
export const invBatches = pgTable(
  "inv_batches",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    /** 批号（采购入库=入库单号；销售退货=退货单号；调拨调入=调拨单号） */
    batch_no: varchar("batch_no", { length: 40 }).notNull(),
    product_id: varchar("product_id", { length: 36 })
      .notNull()
      .references(() => mdProducts.id),
    warehouse_id: varchar("warehouse_id", { length: 36 })
      .notNull()
      .references(() => invWarehouses.id),
    /** 批次入库单位成本快照（用于 FIFO 对账） */
    unit_cost: numeric("unit_cost", { precision: 14, scale: 4 }).notNull().default("0"),
    initial_quantity: numeric("initial_quantity", { precision: 14, scale: 3 }).notNull(),
    /** 剩余量（FIFO 扣减；CHECK 非负） */
    remaining_quantity: numeric("remaining_quantity", { precision: 14, scale: 3 }).notNull(),
    production_date: date("production_date", { mode: "string" }),
    expiry_date: date("expiry_date", { mode: "string" }),
    /** 来源单号（入库/退货/调拨单号） */
    source_ref: varchar("source_ref", { length: 40 }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("inv_batches_unique").on(table.product_id, table.warehouse_id, table.batch_no),
    index("inv_batches_product_idx").on(table.product_id),
    index("inv_batches_warehouse_idx").on(table.warehouse_id),
    index("inv_batches_expiry_idx").on(table.expiry_date),
  ],
);

/** 库存台账（原 inv_stock_movements，0008 改名；只追加不改写，CHECK 余额非负） */
export const invStockLedger = pgTable(
  "inv_stock_ledger",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    warehouse_id: varchar("warehouse_id", { length: 36 })
      .notNull()
      .references(() => invWarehouses.id),
    product_id: varchar("product_id", { length: 36 })
      .notNull()
      .references(() => mdProducts.id),
    /** 批次（出库为 FIFO 扣减的首个批次；可空） */
    batch_id: varchar("batch_id", { length: 36 }),
    /** 类型：in(入库) | out(出库) | adjust(盘盈/盘亏) */
    type: varchar("type", { length: 16 }).notNull(),
    /** 本次变动数量（in/adjust盘盈为正，out/adjust盘亏为负） */
    quantity: numeric("quantity", { precision: 14, scale: 3 }).notNull(),
    /** 变动后余额（冗余快照，便于台账直接对账；CHECK 非负） */
    balance: numeric("balance", { precision: 14, scale: 3 }).notNull(),
    /** 来源：purchase_in / sales_out / purchase_return / receipt_reversal / sales_return_in /
     *  transfer_out / transfer_in / check_in / check_out / manual */
    source: varchar("source", { length: 32 }).notNull().default("manual"),
    /** 单位成本快照（入库=入库价；出库=当时移动加权成本；历史数据可空） */
    unit_cost: numeric("unit_cost", { precision: 14, scale: 4 }),
    /** 关联单号（如 PO/SO/IT/IC 单号），手工出入库可空 */
    ref_no: varchar("ref_no", { length: 40 }),
    remark: text("remark"),
    created_by: varchar("created_by", { length: 36 }).references(() => sysUsers.id),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("inv_mov_product_idx").on(table.product_id),
    index("inv_mov_created_at_idx").on(table.created_at),
    index("inv_mov_type_idx").on(table.type),
    index("inv_mov_warehouse_idx").on(table.warehouse_id),
  ],
);

/** 调拨单（仓库 → 仓库；审核=调出仓出库+调入仓在途，收货=在途转库存） */
export const invTransfers = pgTable(
  "inv_transfers",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    /** 调拨单号：ITyyyymmdd-NNNN（业务唯一） */
    transfer_no: varchar("transfer_no", { length: 32 }).notNull().unique(),
    from_warehouse_id: varchar("from_warehouse_id", { length: 36 })
      .notNull()
      .references(() => invWarehouses.id),
    to_warehouse_id: varchar("to_warehouse_id", { length: 36 })
      .notNull()
      .references(() => invWarehouses.id),
    /**
     * 状态机：draft → pending → approved(已审，调出仓已出库/调入仓在途) → received(已收货)
     *         ↘ rejected(可编辑重提) | draft/pending/rejected → closed
     */
    status: varchar("status", { length: 20 }).notNull().default("draft"),
    transfer_date: date("transfer_date", { mode: "string" }).notNull(),
    approval_level: integer("approval_level"),
    current_step: integer("current_step").notNull().default(0),
    submitted_by: varchar("submitted_by", { length: 36 }).references(() => sysUsers.id),
    submitted_at: timestamp("submitted_at", { withTimezone: true }),
    approved_by: varchar("approved_by", { length: 36 }).references(() => sysUsers.id),
    approved_at: timestamp("approved_at", { withTimezone: true }),
    reject_reason: text("reject_reason"),
    /** 收货确认时间（received 时非空） */
    received_at: timestamp("received_at", { withTimezone: true }),
    remark: text("remark"),
    created_by: varchar("created_by", { length: 36 }).references(() => sysUsers.id),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("inv_transfers_status_idx").on(table.status),
    index("inv_transfers_created_at_idx").on(table.created_at),
  ],
);

/** 调拨单明细 */
export const invTransferItems = pgTable(
  "inv_transfer_items",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    transfer_id: varchar("transfer_id", { length: 36 })
      .notNull()
      .references(() => invTransfers.id, { onDelete: "cascade" }),
    product_id: varchar("product_id", { length: 36 })
      .notNull()
      .references(() => mdProducts.id),
    quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull(),
    /** 调出时移动加权成本快照（调入仓按此成本入账） */
    unit_cost: numeric("unit_cost", { precision: 14, scale: 4 }),
    unit: varchar("unit", { length: 16 }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("inv_transfer_items_doc_idx").on(table.transfer_id),
    index("inv_transfer_items_product_idx").on(table.product_id),
  ],
);

/** 盘点单（按仓盘点；审批通过=差异过账，盘盈入库/盘亏出库） */
export const invChecks = pgTable(
  "inv_checks",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    /** 盘点单号：ICyyyymmdd-NNNN（业务唯一） */
    check_no: varchar("check_no", { length: 32 }).notNull().unique(),
    warehouse_id: varchar("warehouse_id", { length: 36 })
      .notNull()
      .references(() => invWarehouses.id),
    /** 状态机：draft → pending → approved(差异已过账) / rejected；draft/pending/rejected → closed */
    status: varchar("status", { length: 20 }).notNull().default("draft"),
    check_date: date("check_date", { mode: "string" }).notNull(),
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
    index("inv_checks_status_idx").on(table.status),
    index("inv_checks_warehouse_idx").on(table.warehouse_id),
  ],
);

/** 盘点单明细（book=建单账面快照；difference=过账时按当时账面重算：实盘−账面） */
export const invCheckItems = pgTable(
  "inv_check_items",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    check_id: varchar("check_id", { length: 36 })
      .notNull()
      .references(() => invChecks.id, { onDelete: "cascade" }),
    product_id: varchar("product_id", { length: 36 })
      .notNull()
      .references(() => mdProducts.id),
    /** 账面数量（建单时快照） */
    book_quantity: numeric("book_quantity", { precision: 14, scale: 3 }).notNull(),
    /** 实盘数量 */
    counted_quantity: numeric("counted_quantity", { precision: 14, scale: 3 }).notNull(),
    /** 差异 = counted − book（过账时按过账瞬间账面重算更新） */
    difference: numeric("difference", { precision: 14, scale: 3 }).notNull().default("0"),
    /** 过账成本快照（盘亏=当时加权均价；盘盈=当时加权均价） */
    unit_cost: numeric("unit_cost", { precision: 14, scale: 4 }),
    unit: varchar("unit", { length: 16 }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("inv_check_items_doc_idx").on(table.check_id),
    index("inv_check_items_product_idx").on(table.product_id),
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
    /**
     * 状态：pending(待核销) | approved(已核销/生效) | cancelled(作废)。
     * 默认 approved 兼容历史数据（登记即生效）；新建单据默认 pending，审核核销后才递减应收/应付。
     */
    status: varchar("status", { length: 20 }).notNull().default("approved"),
    /** 核销对象单号快照（收款→应收单号/销售订单号；付款→应付单号/采购订单号），供台账追溯 */
    bill_no: varchar("bill_no", { length: 32 }),
    approved_by: varchar("approved_by", { length: 36 }).references(() => sysUsers.id),
    approved_at: timestamp("approved_at", { withTimezone: true }),
    cancelled_by: varchar("cancelled_by", { length: 36 }).references(() => sysUsers.id),
    cancelled_at: timestamp("cancelled_at", { withTimezone: true }),
    remark: text("remark"),
    created_by: varchar("created_by", { length: 36 }).references(() => sysUsers.id),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("fin_payments_direction_idx").on(table.direction),
    index("fin_payments_status_idx").on(table.status),
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
    /** 入库仓库（可空，空=默认仓 WH01） */
    warehouse_id: varchar("warehouse_id", { length: 36 }).references(() => invWarehouses.id),
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
    /** 退货出仓库（可空，空=默认仓 WH01） */
    warehouse_id: varchar("warehouse_id", { length: 36 }).references(() => invWarehouses.id),
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
// 系统数据字典（dict_*）：字典类型 + 字典项，供各模块下拉引用
// ============================================================

/** 字典类型（如 unit 计量单位 / payment_method 付款方式 / tax_rate 税率 / customer_level 客户等级） */
export const dictSystemTypes = pgTable(
  "dict_system_types",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    /** 字典类型编码（业务唯一，供前端下拉引用） */
    type_code: varchar("type_code", { length: 48 }).notNull().unique(),
    name: varchar("name", { length: 128 }).notNull(),
    description: varchar("description", { length: 256 }),
    /** 是否系统内置（内置类型不可删除） */
    is_system: boolean("is_system").notNull().default(false),
    is_active: boolean("is_active").notNull().default(true),
    sort: integer("sort").notNull().default(0),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("dict_types_active_idx").on(table.is_active)],
);

/** 字典项（type_code 关联类型，不建外键以允许类型级级联维护） */
export const dictSystemItems = pgTable(
  "dict_system_items",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    type_code: varchar("type_code", { length: 48 }).notNull(),
    /** 字典项编码（同类型内唯一） */
    item_code: varchar("item_code", { length: 48 }).notNull(),
    /** 展示名 */
    label: varchar("label", { length: 128 }).notNull(),
    /** 扩展属性（如客户等级折扣率 {"discount_rate":0.95}） */
    extra: jsonb("extra"),
    sort: integer("sort").notNull().default(0),
    is_active: boolean("is_active").notNull().default(true),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("dict_items_type_code_item_code_uniq").on(table.type_code, table.item_code),
    index("dict_items_type_idx").on(table.type_code),
    index("dict_items_active_idx").on(table.is_active),
  ],
);

// ============================================================
// 基础资料扩充：计量单位（md_units，含换算法则）
// ============================================================

/** 计量单位（可维护换算关系：1 单位 = conversion_ratio 基准单位） */
export const mdUnits = pgTable(
  "md_units",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    /** 单位编码（业务唯一） */
    unit_code: varchar("unit_code", { length: 32 }).notNull().unique(),
    unit_name: varchar("unit_name", { length: 64 }).notNull(),
    /** 基准单位（换算的锚点，如 片） */
    base_unit: varchar("base_unit", { length: 16 }).notNull(),
    /** 换算系数：1 本单位 = conversion_ratio 基准单位 */
    conversion_ratio: numeric("conversion_ratio", { precision: 12, scale: 4 }).notNull().default("1"),
    remark: varchar("remark", { length: 256 }),
    is_active: boolean("is_active").notNull().default(true),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("md_units_active_idx").on(table.is_active),
    index("md_units_base_unit_idx").on(table.base_unit),
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
export type InvStockLedger = typeof invStockLedger.$inferSelect;
export type InvWarehouse = typeof invWarehouses.$inferSelect;
export type InvBatch = typeof invBatches.$inferSelect;
export type InvTransfer = typeof invTransfers.$inferSelect;
export type InvTransferItem = typeof invTransferItems.$inferSelect;
export type InvCheck = typeof invChecks.$inferSelect;
export type InvCheckItem = typeof invCheckItems.$inferSelect;
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
export type DictSystemType = typeof dictSystemTypes.$inferSelect;
export type DictSystemItem = typeof dictSystemItems.$inferSelect;
export type MdUnit = typeof mdUnits.$inferSelect;
export type SoShipmentItem = typeof soShipmentItems.$inferSelect;
export type SoReturn = typeof soReturns.$inferSelect;
export type SoReturnItem = typeof soReturnItems.$inferSelect;

// ============================================================
// fin_ 财务凭证引擎：模板 + 凭证 + 分录（0011）
// 事件(event_type,event_id) 唯一定位一套凭证，幂等防重
// ============================================================

/** 凭证模板：模板名(第 k 字段)+ JSONB 分录规格(spec) + 平衡兜底科目 */
export const finVoucherTemplates = pgTable(
  "fin_voucher_templates",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    /** 模板编码，业务唯一 */
    template_code: varchar("template_code", { length: 64 }).notNull().unique(),
    /** 模板名称 */
    name: varchar("name", { length: 128 }).notNull(),
    /** 业务事件类型：sales_shipment | purchase_receipt | receipt_settle | payment_settle | receipt_reverse */
    event_type: varchar("event_type", { length: 32 }).notNull().unique(),
    /**
     * 分录规格 JSON：[{dc:'d'|'c', account, account_name, expr, summary}]
     * expr 令牌：#amount(含税额) | #excl(不含税额) | #tax(税额) | #est(暂估含税额)
     */
    spec: jsonb("spec").notNull(),
    /** 平衡兜底科目，尾差(0.01)归入 {account, account_name, summary} */
    balance_to: jsonb("balance_to"),
    is_system: boolean("is_system").notNull().default(false),
    status: varchar("status", { length: 20 }).notNull().default("active"),
    remark: text("remark"),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("fin_voucher_templates_event_idx").on(table.event_type),
  ],
);

/** 记账凭证：事件幂等(event)+voucher Number 唯一+借贷平衡 CHECK */
export const finVouchers = pgTable(
  "fin_vouchers",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    /** 凭证号：如 记-2026-03-0001（凭证序+日期唯一） */
    voucher_no: varchar("voucher_no", { length: 40 }).notNull().unique(),
    /** 记账日期（YYYY-MM-DD） */
    voucher_date: date("voucher_date", { mode: "string" }).notNull(),
    /** 业务事件类型（与模板一致） */
    event_type: varchar("event_type", { length: 32 }).notNull(),
    /** 业务事件主键（单据/核销单 id），与 event_type 联合唯一→幂等防重 */
    event_id: varchar("event_id", { length: 36 }).notNull(),
    /** 业务单号快照（便于追溯） */
    ref_no: varchar("ref_no", { length: 32 }),
    ref_summary: text("ref_summary"),
    template_code: varchar("template_code", { length: 64 }).notNull(),
    /** 借方合计（numeric(14,2)），balance CHECK 总借=总贷 */
    total_debit: numeric("total_debit", { precision: 14, scale: 2 }).notNull().default("0"),
    total_credit: numeric("total_credit", { precision: 14, scale: 2 }).notNull().default("0"),
    /** draft(草稿,未过账) | posted(已过账) | void(红冲作废) */
    status: varchar("status", { length: 20 }).notNull().default("posted"),
    source: varchar("source", { length: 20 }).notNull().default("manual"),
    created_by: varchar("created_by", { length: 36 }).references(() => sysUsers.id),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    posted_by: varchar("posted_by", { length: 36 }).references(() => sysUsers.id),
    posted_at: timestamp("posted_at", { withTimezone: true }),
    /** 红字冲销：原凭证号 */
    void_of_no: varchar("void_of_no", { length: 40 }),
    void_by: varchar("void_by", { length: 36 }).references(() => sysUsers.id),
    void_at: timestamp("void_at", { withTimezone: true }),
    void_remark: text("void_remark"),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("fin_vouchers_event_uniq").on(table.event_type, table.event_id),
    index("fin_vouchers_date_idx").on(table.voucher_date),
    index("fin_vouchers_status_idx").on(table.status),
    index("fin_vouchers_event_idx").on(table.event_type),
    index("fin_vouchers_ref_no_idx").on(table.ref_no),
  ],
);

/** 凭证分录行：direction 借/贷 + 科目 + 金额（红字负） */
export const finVoucherLines = pgTable(
  "fin_voucher_lines",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    voucher_id: varchar("voucher_id", { length: 36 })
      .notNull()
      .references(() => finVouchers.id, { onDelete: "cascade" }),
    line_no: integer("line_no").notNull(),
    /** d(借) | c(贷) */
    direction: varchar("direction", { length: 2 }).notNull(),
    account_code: varchar("account_code", { length: 32 }).notNull(),
    account_name: varchar("account_name", { length: 64 }).notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    summary: text("summary"),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("fin_voucher_lines_voucher_idx").on(table.voucher_id),
    index("fin_voucher_lines_account_idx").on(table.account_code),
  ],
);

// ============================================================
// tax_ 税务（0011）：销项/进项税登记 + 税额统计
// ============================================================

/** 税额登记（销项/进项），随业务事件生成，供期间/税率汇总 */
export const taxEntries = pgTable(
  "tax_entries",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    /** tax_type: output(销项) | input(进项) */
    tax_type: varchar("tax_type", { length: 12 }).notNull(),
    /** 期间 YYYY-MM */
    period: varchar("period", { length: 7 }).notNull(),
    tax_rate: numeric("tax_rate", { precision: 5, scale: 2 }).notNull(),
    /** 含税金额 */
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    /** 不含税金额 */
    base_amount: numeric("base_amount", { precision: 14, scale: 2 }).notNull(),
    /** 税额 */
    tax_amount: numeric("tax_amount", { precision: 14, scale: 2 }).notNull(),
    /** 关联业务单号急照 */
    doc_no: varchar("doc_no", { length: 32 }),
    ref_type: varchar("ref_type", { length: 32 }),
    ref_id: varchar("ref_id", { length: 36 }),
    source: varchar("source", { length: 20 }).notNull().default("auto"),
    status: varchar("status", { length: 20 }).notNull().default("active"),
    created_by: varchar("created_by", { length: 36 }).references(() => sysUsers.id),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("tax_entries_ref_uniq").on(table.ref_type, table.ref_id, table.tax_type),
    index("tax_entries_period_idx").on(table.period),
    index("tax_entries_type_idx").on(table.tax_type),
    index("tax_entries_rate_idx").on(table.tax_rate),
  ],
);

export type FinVoucherTemplate = typeof finVoucherTemplates.$inferSelect;
export type FinVoucher = typeof finVouchers.$inferSelect;
export type FinVoucherLine = typeof finVoucherLines.$inferSelect;
export type TaxEntry = typeof taxEntries.$inferSelect;

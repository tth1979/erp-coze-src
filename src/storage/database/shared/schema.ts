import { sql } from "drizzle-orm";
import {
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
// 类型导出
// ============================================================
export type SysUser = typeof sysUsers.$inferSelect;
export type SysUserCredential = typeof sysUserCredentials.$inferSelect;
export type SysSession = typeof sysSessions.$inferSelect;
export type MdCustomer = typeof mdCustomers.$inferSelect;
export type MdSupplier = typeof mdSuppliers.$inferSelect;
export type MdProduct = typeof mdProducts.$inferSelect;

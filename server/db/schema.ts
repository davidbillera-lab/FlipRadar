import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

export const deals = sqliteTable("deals", {
  id: text("id").primaryKey(),
  platform: text("platform").notNull(), // facebook | craigslist | estatesales
  sourceUrl: text("source_url").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  category: text("category"), // electronics | antiques | collectibles | power_tools
  city: text("city"),
  askingPrice: real("asking_price").notNull(),
  imageUrl: text("image_url"),

  // LLM identification
  aiBrand: text("ai_brand"),
  aiModel: text("ai_model"),
  aiProduct: text("ai_product"),

  // eBay comps
  ebayAvgSold: real("ebay_avg_sold"),
  ebayCompCount: integer("ebay_comp_count"),
  ebaySearchQuery: text("ebay_search_query"),

  // Scoring
  ebayFees: real("ebay_fees"),
  netProfit: real("net_profit"),
  roiPct: real("roi_pct"),
  score: integer("score"), // 0-100
  exitChannel: text("exit_channel"), // ebay | facebook | local
  flaggedHighRoi: integer("flagged_high_roi", { mode: "boolean" }).default(false),

  // Tracking
  purchasePrice: real("purchase_price"),
  soldPrice: real("sold_price"),
  soldAt: integer("sold_at", { mode: "timestamp" }),
  trackingNotes: text("tracking_notes"),

  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const garageSales = sqliteTable("garage_sales", {
  id: text("id").primaryKey(),
  platform: text("platform").notNull(), // facebook | craigslist | estatesales
  sourceUrl: text("source_url").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  city: text("city").notNull(),
  address: text("address"),
  lat: real("lat"),
  lng: real("lng"),
  saleDate: text("sale_date"),
  images: text("images", { mode: "json" }).$type<string[]>().default([]),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export type Deal = typeof deals.$inferSelect;
export type NewDeal = typeof deals.$inferInsert;
export type GarageSale = typeof garageSales.$inferSelect;
export type NewGarageSale = typeof garageSales.$inferInsert;

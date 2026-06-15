import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

export const deals = sqliteTable("deals", {
  id: text("id").primaryKey(),
  platform: text("platform").notNull(),
  sourceUrl: text("source_url").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  category: text("category"),
  city: text("city"),
  askingPrice: real("asking_price").notNull(),
  imageUrl: text("image_url"),
  aiBrand: text("ai_brand"),
  aiModel: text("ai_model"),
  aiProduct: text("ai_product"),
  ebayAvgSold: real("ebay_avg_sold"),
  ebayCompCount: integer("ebay_comp_count"),
  ebaySearchQuery: text("ebay_search_query"),
  ebayFees: real("ebay_fees"),
  netProfit: real("net_profit"),
  roiPct: real("roi_pct"),
  score: integer("score"),
  exitChannel: text("exit_channel"),
  flaggedHighRoi: integer("flagged_high_roi", { mode: "boolean" }).default(false),
  purchasePrice: real("purchase_price"),
  soldPrice: real("sold_price"),
  actualRoi: real("actual_roi"),
  soldAt: integer("sold_at", { mode: "timestamp" }),
  trackingNotes: text("tracking_notes"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const garageSales = sqliteTable("garage_sales", {
  id: text("id").primaryKey(),
  platform: text("platform").notNull(),
  sourceUrl: text("source_url").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  city: text("city").notNull(),
  address: text("address"),
  lat: real("lat"),
  lng: real("lng"),
  saleDate: text("sale_date"),
  status: text("status").default("upcoming"),
  notes: text("notes"),
  images: text("images", { mode: "json" }).$type<string[]>().default([]),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const geocodeCache = sqliteTable("geocode_cache", {
  address: text("address").primaryKey(),
  lat: real("lat").notNull(),
  lng: real("lng").notNull(),
  formatted: text("formatted"),
  createdAt: integer("created_at").notNull(),
});

export const fmListings = sqliteTable("fm_listings", {
  id: text("id").primaryKey(),
  city: text("city").notNull(),
  title: text("title").notNull(),
  priceCents: integer("price_cents"),
  locationText: text("location_text"),
  sourceUrl: text("source_url").notNull(),
  description: text("description"),
  images: text("images", { mode: "json" }).$type<string[]>().default([]),
  postedAt: integer("posted_at", { mode: "timestamp" }),
  scrapedAt: integer("scraped_at", { mode: "timestamp" }).notNull(),
  processed: integer("processed", { mode: "boolean" }).default(false),
});

export const fmScrapeJobs = sqliteTable("fm_scrape_jobs", {
  city: text("city").primaryKey(),
  lastScrapedAt: integer("last_scraped_at", { mode: "timestamp" }),
  status: text("status").default("pending"),
  listingsFound: integer("listings_found").default(0),
  errorMsg: text("error_msg"),
});

export type Deal = typeof deals.$inferSelect;
export type NewDeal = typeof deals.$inferInsert;
export type GarageSale = typeof garageSales.$inferSelect;
export type NewGarageSale = typeof garageSales.$inferInsert;
export type FmListing = typeof fmListings.$inferSelect;
export type FmScrapeJob = typeof fmScrapeJobs.$inferSelect;

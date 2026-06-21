import { pgTable, text, integer, real, boolean, timestamp, jsonb, doublePrecision } from "drizzle-orm/pg-core";

export const deals = pgTable("deals", {
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
  flaggedHighRoi: boolean("flagged_high_roi").default(false),
  purchasePrice: real("purchase_price"),
  soldPrice: real("sold_price"),
  actualRoi: real("actual_roi"),
  soldAt: timestamp("sold_at"),
  trackingNotes: text("tracking_notes"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

export const garageSales = pgTable("garage_sales", {
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
  images: jsonb("images").$type<string[]>().default([]),
  createdAt: timestamp("created_at").notNull(),
});

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const geocodeCache = pgTable("geocode_cache", {
  address: text("address").primaryKey(),
  lat: real("lat").notNull(),
  lng: real("lng").notNull(),
  formatted: text("formatted"),
  createdAt: timestamp("created_at").notNull(),
});

export const fmListings = pgTable("fm_listings", {
  id: text("id").primaryKey(),
  city: text("city").notNull(),
  title: text("title").notNull(),
  priceCents: integer("price_cents"),
  locationText: text("location_text"),
  sourceUrl: text("source_url").notNull(),
  description: text("description"),
  images: jsonb("images").$type<string[]>().default([]),
  postedAt: timestamp("posted_at"),
  scrapedAt: timestamp("scraped_at").notNull(),
  processed: boolean("processed").default(false),
});

export const fmScrapeJobs = pgTable("fm_scrape_jobs", {
  city: text("city").primaryKey(),
  lastScrapedAt: timestamp("last_scraped_at"),
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

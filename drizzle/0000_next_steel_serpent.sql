CREATE TABLE IF NOT EXISTS "deals" (
	"id" text PRIMARY KEY NOT NULL,
	"platform" text NOT NULL,
	"source_url" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"category" text,
	"city" text,
	"asking_price" real NOT NULL,
	"image_url" text,
	"ai_brand" text,
	"ai_model" text,
	"ai_product" text,
	"ebay_avg_sold" real,
	"ebay_comp_count" integer,
	"ebay_search_query" text,
	"ebay_fees" real,
	"net_profit" real,
	"roi_pct" real,
	"score" integer,
	"exit_channel" text,
	"flagged_high_roi" boolean DEFAULT false,
	"purchase_price" real,
	"sold_price" real,
	"actual_roi" real,
	"sold_at" timestamp,
	"tracking_notes" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fm_listings" (
	"id" text PRIMARY KEY NOT NULL,
	"city" text NOT NULL,
	"title" text NOT NULL,
	"price_cents" integer,
	"location_text" text,
	"source_url" text NOT NULL,
	"description" text,
	"images" jsonb DEFAULT '[]'::jsonb,
	"posted_at" timestamp,
	"scraped_at" timestamp NOT NULL,
	"processed" boolean DEFAULT false
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fm_scrape_jobs" (
	"city" text PRIMARY KEY NOT NULL,
	"last_scraped_at" timestamp,
	"status" text DEFAULT 'pending',
	"listings_found" integer DEFAULT 0,
	"error_msg" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "garage_sales" (
	"id" text PRIMARY KEY NOT NULL,
	"platform" text NOT NULL,
	"source_url" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"city" text NOT NULL,
	"address" text,
	"lat" real,
	"lng" real,
	"sale_date" text,
	"status" text DEFAULT 'upcoming',
	"notes" text,
	"images" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "geocode_cache" (
	"address" text PRIMARY KEY NOT NULL,
	"lat" real NOT NULL,
	"lng" real NOT NULL,
	"formatted" text,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL
);

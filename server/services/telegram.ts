import { request } from "undici";

export async function sendTelegramAlert(message: string): Promise<boolean> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) {
    console.warn("[telegram] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set, skipping alert");
    return false;
  }
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const res = await request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: "Markdown",
      disable_web_page_preview: false,
    }),
  });
  if (res.statusCode !== 200) {
    const txt = await res.body.text();
    console.error(`[telegram] send failed ${res.statusCode}: ${txt}`);
    return false;
  }
  return true;
}

export function formatDealAlert(deal: {
  title: string;
  askingPrice: number;
  ebayAvgSold: number | null;
  netProfit: number | null;
  roiPct: number | null;
  score: number | null;
  sourceUrl: string;
  city?: string | null;
  compConfidence?: "high" | "medium" | "low";
  compCount?: number;
}): string {
  // Surface how much to trust the ROI: real eBay sold comps, with sample size.
  const confIcon =
    deal.compConfidence === "high"
      ? "🟢"
      : deal.compConfidence === "medium"
        ? "🟡"
        : "🔴";
  const compLine =
    deal.compConfidence && deal.ebayAvgSold
      ? `Comp confidence: ${confIcon} ${deal.compConfidence}${
          deal.compCount ? ` (${deal.compCount} sold)` : ""
        }`
      : "";
  const lines = [
    `*High-ROI Deal Found* — Score ${deal.score ?? "?"}/100`,
    `*${deal.title}*`,
    `Asking: $${deal.askingPrice.toFixed(0)}${deal.city ? ` • ${deal.city}` : ""}`,
    deal.ebayAvgSold ? `eBay Avg Sold: $${deal.ebayAvgSold.toFixed(0)}` : "",
    deal.netProfit !== null
      ? `Net Profit: $${deal.netProfit.toFixed(0)} (ROI ${deal.roiPct?.toFixed(0) ?? "?"}%)`
      : "",
    compLine,
    `[View Listing](${deal.sourceUrl})`,
  ].filter(Boolean);
  return lines.join("\n");
}

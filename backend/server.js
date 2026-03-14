import express from "express";
import cors from "cors";

import { loadTickets } from "./src/services/ticketLoader.js";
import preprocessTickets from "./src/services/preprocessTickets.js";
import { getEmbedding } from "./src/services/embeddingService.js";
import { clusterTickets } from "./src/services/clusteringService.js";
import { aggregateClusters } from "./src/services/clusterAggregator.js";
import { labelClusters } from "./src/services/clusterLabeler.js";
import { detectTrend } from "./src/services/trendDetector.js";

const app = express();
const PORT = 8080;
app.use(cors());
app.use(express.json());

let insightsCache = null;
function getPriority(score) {

  if (score >= 500) return "critical";
  if (score >= 250) return "high";
  if (score >= 100) return "medium";
  return "low";

}
async function buildInsights() {

  console.log("1. Loading tickets");
  const tickets = await loadTickets();

  console.log("2. Preprocessing");
  const processed = preprocessTickets(tickets);

  console.log("3. Limiting dataset");
  const subset = processed.slice(0, 150);

  console.log("4. Clustering");
  const clustered = await clusterTickets(subset);

  console.log("5. Aggregating");
  const aggregated = aggregateClusters(clustered);

  console.log("6. Sorting");
  aggregated.sort((a, b) => b.count - a.count);

  
  console.log("7. Detecting trends");

  const withTrends = aggregated.map(cluster => {

    const trendData = detectTrend(cluster);

    const growthRate = Math.min(trendData.growthRate, 5);

    return {
      ...cluster,
      trend: trendData.trend,
      growth_rate: growthRate
    };

  });

console.log("8. Labeling clusters");

const labeled = labelClusters(withTrends);

console.log("9. Calculating impact scores");

const insights = labeled.map(cluster => {

  const trendData = cluster.trend;

  const growthRate = Math.min(trendData.growthRate, 2);

  const impactScore =
    cluster.mentions * (1 + growthRate);

  const priority = getPriority(impactScore);

  return {
    ...cluster,
    trend: trendData.trend,
    growth_rate: growthRate,
    impact_score: impactScore,
    priority
  };

});

return insights;
}

app.get("/", (req, res) => {
    
  res.send("Support Ticket Intelligence API");
});
app.get("/insights", (req, res) => {

  if (!insightsCache) {
    return res.status(503).json({
      message: "Insights still building. Try again in a few seconds."
    });
  }

  res.json(insightsCache);

});
app.post("/rebuild-insights", async (req, res) => {

  try {

    console.log("Manual rebuild triggered");

    insightsCache = await buildInsights();

    res.json({
      status: "ok",
      message: "Insights rebuilt"
    });

  } catch (err) {

    console.error(err);

    res.status(500).json({
      error: "Rebuild failed"
    });

  }

});

app.get("/tickets", async (req, res) => {
  const tickets = await loadTickets("./data/customer_support_tickets.csv");
  const processed = preprocessTickets(tickets);

  res.json(processed.slice(0, 20));
});





app.listen(PORT, async () => {

  console.log(`Server running on port ${PORT}`);
  console.log("Building insights cache...");

  try {

    insightsCache = await buildInsights();

    console.log("Insights ready.");
    console.log(`Issues detected: ${insightsCache.length}`);
  } catch (error) {

    console.error("Failed to build insights:", error);

  }

});
setInterval(async () => {
  console.log("Periodic refresh running...");

  try {
    insightsCache = await buildInsights();
    console.log("Insights refreshed automatically");
  } catch (err) {
    console.error("Periodic refresh failed:", err);
  }

}, 15 * 60 * 1000); // every 15 minutes

import { broadcastDailyRecap } from "../services/notifications/daily-recap.js";

// Runs each morning to recap yesterday's KO matches for the participants involved.
export async function sendDailyRecapCron(): Promise<void> {
  console.info("[daily-recap] Running...");

  try {
    const result = await broadcastDailyRecap();
    console.info(
      `[daily-recap] Done — total=${result.total} sent=${result.sent} ` +
        `failed=${result.failed} skipped=${result.skipped}`,
    );
  } catch (error) {
    console.error("[daily-recap] Fatal error:", (error as Error).message);
  }
}

import { AppError } from "../lib/errors.js";
import {
  type NotificationType,
  type BroadcastResultDto,
} from "./notifications/shared.js";
import { sendGroupPhaseLastRoundReminder } from "./notifications/group-phase-last-round-reminder.js";
import { sendGenericBroadcast } from "./notifications/generic.js";
import { broadcastDailyRecap } from "./notifications/daily-recap.js";

export { type NotificationType } from "./notifications/shared.js";

interface BroadcastOptions {
  message?: string;
  participantIds?: string[];
  day?: string;
}

function requireMessage(message?: string): string {
  if (!message || !message.trim())
    throw new AppError(400, "MESSAGE_REQUIRED", "message is required");
  return message.trim();
}

export async function sendBroadcast(
  type: NotificationType,
  options: BroadcastOptions = {},
): Promise<BroadcastResultDto> {
  const { message, participantIds, day } = options;

  switch (type) {
    case "GROUP_PHASE_LAST_ROUND_REMINDER":
      return sendGroupPhaseLastRoundReminder(requireMessage(message), participantIds);
    case "GENERIC":
      return sendGenericBroadcast(requireMessage(message), participantIds);
    case "DAILY_RECAP":
      return broadcastDailyRecap(day, participantIds);
    default:
      throw new AppError(
        400,
        "INVALID_NOTIFICATION_TYPE",
        "Unknown notification type",
      );
  }
}

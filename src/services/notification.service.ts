import { AppError } from "../lib/errors.js";
import {
  type NotificationType,
  type BroadcastResultDto,
} from "./notifications/shared.js";
import { sendGroupPhaseLastRoundReminder } from "./notifications/group-phase-last-round-reminder.js";
import { sendGenericBroadcast } from "./notifications/generic.js";

export { type NotificationType } from "./notifications/shared.js";

export async function sendBroadcast(
  type: NotificationType,
  message: string,
  participantIds?: string[],
): Promise<BroadcastResultDto> {
  if (!message || !message.trim())
    throw new AppError(400, "MESSAGE_REQUIRED", "message is required");
  const body = message.trim();

  switch (type) {
    case "GROUP_PHASE_LAST_ROUND_REMINDER":
      return sendGroupPhaseLastRoundReminder(body, participantIds);
    case "GENERIC":
      return sendGenericBroadcast(body, participantIds);
    default:
      throw new AppError(
        400,
        "INVALID_NOTIFICATION_TYPE",
        "Unknown notification type",
      );
  }
}

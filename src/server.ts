import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import "dotenv/config";
import prismaPlugin from "./plugins/prisma.js";
import authenticatePlugin from "./plugins/authenticate.js";
import healthRoutes from "./routes/health.js";
import authRoutes from "./routes/auth.js";
import groupRoutes from "./routes/groups.js";
import koRoutes from "./routes/ko.js";
import powerupsRoutes from "./routes/powerups.js";
import adminRoutes from "./routes/admin.js";
import scoreboardRoutes from "./routes/scoreboard.js";
import whatsappRoutes from "./routes/whatsapp.js";
// Crons DESREGISTRADOS — el torneo terminó; no se agenda ningún cron (sync,
// stats ni notificaciones). Las funciones siguen disponibles en ./crons/* para
// ejecución manual si hiciera falta.
import { AppError } from "./lib/errors.js";

export async function buildServer(): Promise<FastifyInstance> {
  const server = Fastify({ logger: true });

  server.register(cors, {
    credentials: true,
    origin: process.env.CORS_ORIGIN ?? true,
  });
  server.register(cookie);
  server.register(prismaPlugin);
  server.register(authenticatePlugin);
  server.register(healthRoutes, { prefix: "/health" });
  server.register(authRoutes, { prefix: "/auth" });
  server.register(groupRoutes, { prefix: "/groups" });
  server.register(koRoutes, { prefix: "/ko" });
  server.register(powerupsRoutes, { prefix: "/powerups" });
  server.register(adminRoutes, { prefix: "/admin" });
  server.register(scoreboardRoutes, { prefix: "/scoreboard" });
  server.register(whatsappRoutes, { prefix: "/admin/whatsapp" });

  server.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      return reply
        .code(error.statusCode)
        .send({ code: error.code, message: error.message });
    }
    server.log.error(error);
    return reply
      .code((error as { statusCode?: number }).statusCode ?? 500)
      .send({ code: "INTERNAL_ERROR", message: error.message });
  });

  if (process.env.NODE_ENV !== "test") {
    // Todos los crons DESREGISTRADOS — el torneo terminó. Ni sync (sync-ko-results,
    // sync-group-results) ni stats (calculate-group-stats, calculate-powerup-stats)
    // ni notificaciones (whatsapp-reminder, group-phase-reminder, daily-recap) se
    // agendan. El único envío que queda es manual: la notificación FINAL_STANDINGS
    // vía POST /admin/notifications/broadcast.
    server.log.info("Crons desregistrados: ninguno agendado (torneo finalizado)");
  }

  return server;
}

if (require.main === module) {
  const PORT = parseInt(process.env.PORT ?? "3000");
  buildServer().then((server) => {
    server.listen({ port: PORT, host: "0.0.0.0" }, (err) => {
      if (err) {
        server.log.error(err);
        process.exit(1);
      }
    });
  });
}

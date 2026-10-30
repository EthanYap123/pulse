import { DEFAULT_EXPECTED_STATUS } from "@pulse/shared";

export type Env = {
  ENVIRONMENT?: string;
};

export default {
  fetch(request: Request, env: Env): Response {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({ status: "ok", environment: env.ENVIRONMENT ?? "local" });
    }
    return new Response("Not found", { status: 404 });
  },

  // The check loop arrives in Phase 2. For now the tick only proves the cron fires.
  scheduled(controller: ScheduledController, env: Env): void {
    console.log(
      JSON.stringify({
        msg: "tick",
        cron: controller.cron,
        scheduledTime: new Date(controller.scheduledTime).toISOString(),
        environment: env.ENVIRONMENT ?? "local",
        defaultExpected: DEFAULT_EXPECTED_STATUS,
      }),
    );
  },
} satisfies ExportedHandler<Env>;

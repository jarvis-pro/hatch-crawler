import cron from "node-cron";
import { logger } from "../utils/logger.js";

export interface ScheduleHandle {
  /** Resolves when the (one-shot) job is done. For cron mode, never resolves. */
  done: Promise<void>;
  stop: () => void;
}

/**
 * Wrap a runnable in a cron schedule.
 *
 * If the schedule expression is empty, runs the job once immediately and
 * resolves `done` when finished. With a cron expression, the returned
 * `done` promise never resolves — the caller stops the schedule explicitly
 * (e.g. on SIGINT).
 */
export function scheduleOrRunOnce(
  schedule: string,
  job: () => Promise<unknown>,
): ScheduleHandle {
  if (!schedule) {
    const done = job()
      .then(() => undefined)
      .catch((err) => {
        logger.error({ err }, "one-shot job failed");
      });
    return { done, stop: () => {} };
  }

  if (!cron.validate(schedule)) {
    throw new Error(`Invalid cron expression: ${schedule}`);
  }

  let running = false;
  const task = cron.schedule(schedule, async () => {
    if (running) {
      logger.warn("previous run still in progress, skipping tick");
      return;
    }
    running = true;
    try {
      await job();
    } catch (err) {
      logger.error({ err }, "scheduled job failed");
    } finally {
      running = false;
    }
  });

  logger.info({ schedule }, "cron schedule registered");
  task.start();
  return {
    done: new Promise(() => {}), // never resolves; cron runs forever
    stop: () => task.stop(),
  };
}

import pino from "pino";

const SERVICE_NAME = "sendlit:api";
const LOGS_PATH = "/i/v1/logs";

// When POSTHOG_API_KEY is set, every pino log at POSTHOG_LOG_LEVEL and above
// is also shipped to PostHog's OTLP logs endpoint (batched, in a worker
// thread). Without the key, logs go to stdout only.
function createLogger() {
    const token = process.env.POSTHOG_API_KEY;
    if (!token) {
        return pino();
    }

    const baseHost = (process.env.POSTHOG_HOST || "https://us.i.posthog.com")
        .replace(/\/+$/, "")
        .trim();

    return pino(
        pino.transport({
            targets: [
                {
                    target: "pino/file",
                    level: process.env.LOG_LEVEL || "info",
                    options: { destination: 1 },
                },
                {
                    target: "pino-opentelemetry-transport",
                    level: process.env.POSTHOG_LOG_LEVEL || "info",
                    options: {
                        loggerName: SERVICE_NAME,
                        resourceAttributes: {
                            "service.name": SERVICE_NAME,
                            "deployment.environment":
                                process.env.DEPLOY_ENV ||
                                process.env.NODE_ENV ||
                                "unknown",
                        },
                        logRecordProcessorOptions: {
                            recordProcessorType: "batch",
                            exporterOptions: {
                                protocol: "http",
                                httpExporterOptions: {
                                    url: `${baseHost}${LOGS_PATH}`,
                                    headers: {
                                        Authorization: `Bearer ${token}`,
                                    },
                                },
                            },
                        },
                    },
                },
            ],
        }),
    );
}

const logger = createLogger();

export default logger;

export function traceAction<T>(tool: string, fn: () => Promise<T>): Promise<T> {
  if (!process.env.OTEL_ENABLED) return fn();

  // Only import OTel if enabled (avoid dep for most users)
  return import("@opentelemetry/api").then(({ trace, SpanStatusCode }) => {
    const tracer = trace.getTracer("lead-routing-agent-api");
    return tracer.startActiveSpan(`agent.${tool}`, async (span) => {
      try {
        const result = await fn();
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (err) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: err instanceof Error ? err.message : String(err),
        });
        throw err;
      } finally {
        span.end();
      }
    });
  }).catch(() => fn()); // If OTel not installed, just run the function
}

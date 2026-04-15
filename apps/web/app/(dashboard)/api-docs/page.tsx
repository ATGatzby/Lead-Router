"use client";

import { useEffect, useRef } from "react";

declare global {
  interface Window {
    SwaggerUIBundle?: {
      (config: Record<string, unknown>): void;
      presets: { apis: unknown };
    };
  }
}

export default function SwaggerDocsPage() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href =
      "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css";
    document.head.appendChild(link);

    const script = document.createElement("script");
    script.src =
      "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js";
    script.onload = () => {
      if (window.SwaggerUIBundle) {
        window.SwaggerUIBundle({
          url: "/api/v1/openapi",
          dom_id: "#swagger-ui",
          presets: [window.SwaggerUIBundle.presets.apis],
          layout: "BaseLayout",
          deepLinking: true,
          defaultModelsExpandDepth: 1,
          docExpansion: "list",
          filter: true,
        });
      }
    };
    document.body.appendChild(script);

    return () => {
      link.remove();
      script.remove();
    };
  }, []);

  return (
    <div style={{ minHeight: "100vh", background: "#fff" }}>
      <div id="swagger-ui" ref={containerRef} />
    </div>
  );
}

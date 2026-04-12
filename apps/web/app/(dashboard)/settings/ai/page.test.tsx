import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AiSettingsPage from "./page";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  };
}

function mockFetchResponses(overrides: {
  license?: { tier: string };
  ai?: {
    provider: string | null;
    model: string | null;
    baseUrl: string | null;
    customHeaders: Record<string, string> | null;
    hasKey: boolean;
    chatCount: number;
  };
} = {}) {
  const license = overrides.license ?? { tier: "pro" };
  const ai = overrides.ai ?? {
    provider: null,
    model: null,
    baseUrl: null,
    customHeaders: null,
    hasKey: false,
    chatCount: 0,
  };

  global.fetch = vi.fn().mockImplementation((input: string | Request) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.includes("/api/license")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(license),
      });
    }
    // /api/settings/ai
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(ai),
    });
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

const originalFetch = global.fetch;

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe("AiSettingsPage", () => {
  it("renders the description text for pro users", async () => {
    mockFetchResponses();

    render(<AiSettingsPage />, { wrapper: createWrapper() });

    expect(
      await screen.findByText(/connect an llm provider to power the ai routing assistant/i)
    ).toBeDefined();
  });

  it("shows all four provider cards and connect buttons for pro users", async () => {
    mockFetchResponses();

    const { container } = render(<AiSettingsPage />, { wrapper: createWrapper() });

    // The description appears synchronously (not gated by query)
    expect(
      screen.getAllByText(/connect an llm provider/i).length
    ).toBeGreaterThan(0);

    // Provider short names are rendered immediately (static content)
    expect(screen.getAllByText("Claude").length).toBeGreaterThan(0);
    expect(screen.getAllByText("OpenAI").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Gemini").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Custom").length).toBeGreaterThan(0);

    // Connect buttons (text includes icon children)
    const buttons = container.querySelectorAll("button");
    const connectButtons = Array.from(buttons).filter(
      (b) => b.textContent?.includes("Connect")
    );
    expect(connectButtons.length).toBe(4);
  });

  it("shows Connected status and Edit/Disconnect for the active provider", async () => {
    mockFetchResponses({
      ai: {
        provider: "claude",
        model: "claude-sonnet-4-5-20250514",
        baseUrl: null,
        customHeaders: null,
        hasKey: true,
        chatCount: 5,
      },
    });

    const { findByText } = render(<AiSettingsPage />, {
      wrapper: createWrapper(),
    });

    expect(await findByText("Connected")).toBeDefined();
    expect(screen.getByText("Edit")).toBeDefined();
    expect(screen.getByText("Disconnect")).toBeDefined();

    // Other providers should still show Connect
    expect(screen.getAllByText("Connect OpenAI").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Connect Gemini").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Connect Custom").length).toBeGreaterThan(0);
  });

  it("shows the active provider banner when connected", async () => {
    mockFetchResponses({
      ai: {
        provider: "openai",
        model: "gpt-4o",
        baseUrl: null,
        customHeaders: null,
        hasKey: true,
        chatCount: 12,
      },
    });

    const { findByText } = render(<AiSettingsPage />, {
      wrapper: createWrapper(),
    });

    expect(await findByText("Active Provider")).toBeDefined();
    expect(screen.getByText("Open Chat")).toBeDefined();
  });
});

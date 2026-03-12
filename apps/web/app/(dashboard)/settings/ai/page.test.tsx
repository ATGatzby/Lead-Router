import { describe, it, expect, vi, beforeEach } from "vitest";
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

function mockFetchResponse(data: unknown) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(data),
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("AiSettingsPage", () => {
  it("renders the description text", async () => {
    mockFetchResponse({
      provider: null,
      model: null,
      baseUrl: null,
      customHeaders: null,
      hasKey: false,
      chatCount: 0,
    });

    render(<AiSettingsPage />, { wrapper: createWrapper() });

    expect(
      screen.getByText(/connect an llm provider to power the ai routing assistant/i)
    ).toBeDefined();
  });

  it("shows all four provider cards", async () => {
    mockFetchResponse({
      provider: null,
      model: null,
      baseUrl: null,
      customHeaders: null,
      hasKey: false,
      chatCount: 0,
    });

    render(<AiSettingsPage />, { wrapper: createWrapper() });

    expect(screen.getByText("Claude")).toBeDefined();
    expect(screen.getByText("OpenAI")).toBeDefined();
    expect(screen.getByText("Gemini")).toBeDefined();
    expect(screen.getByText("Custom")).toBeDefined();
  });

  it("shows Connect buttons for unconnected providers", async () => {
    mockFetchResponse({
      provider: null,
      model: null,
      baseUrl: null,
      customHeaders: null,
      hasKey: false,
      chatCount: 0,
    });

    render(<AiSettingsPage />, { wrapper: createWrapper() });

    expect(screen.getByText("Connect Claude")).toBeDefined();
    expect(screen.getByText("Connect OpenAI")).toBeDefined();
    expect(screen.getByText("Connect Gemini")).toBeDefined();
    expect(screen.getByText("Connect Custom")).toBeDefined();
  });

  it("shows Connected status and Edit/Disconnect for the active provider", async () => {
    mockFetchResponse({
      provider: "claude",
      model: "claude-sonnet-4-5-20250514",
      baseUrl: null,
      customHeaders: null,
      hasKey: true,
      chatCount: 5,
    });

    const { findByText } = render(<AiSettingsPage />, {
      wrapper: createWrapper(),
    });

    // Wait for query to resolve and re-render
    expect(await findByText("Connected")).toBeDefined();
    expect(screen.getByText("Edit")).toBeDefined();
    expect(screen.getByText("Disconnect")).toBeDefined();

    // Other providers should still show Connect
    expect(screen.getByText("Connect OpenAI")).toBeDefined();
    expect(screen.getByText("Connect Gemini")).toBeDefined();
    expect(screen.getByText("Connect Custom")).toBeDefined();
  });

  it("shows the active provider banner when connected", async () => {
    mockFetchResponse({
      provider: "openai",
      model: "gpt-4o",
      baseUrl: null,
      customHeaders: null,
      hasKey: true,
      chatCount: 12,
    });

    const { findByText } = render(<AiSettingsPage />, {
      wrapper: createWrapper(),
    });

    expect(await findByText("Active Provider")).toBeDefined();
    expect(screen.getByText("Open Chat")).toBeDefined();
  });
});

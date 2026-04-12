import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Breadcrumbs } from "./breadcrumbs";

// Mock next/navigation
const mockUsePathname = vi.fn<() => string>();
vi.mock("next/navigation", () => ({
  usePathname: () => mockUsePathname(),
}));

// Mock next/link to render a plain anchor
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Breadcrumbs", () => {
  it('renders nothing on root path "/"', () => {
    mockUsePathname.mockReturnValue("/");
    const { container } = render(<Breadcrumbs />);
    expect(container.innerHTML).toBe("");
  });

  it('renders "Route Workflows" for /routing-rules', () => {
    mockUsePathname.mockReturnValue("/routing-rules");
    render(<Breadcrumbs />);
    const el = screen.getByText("Route Workflows");
    // Single segment should be bold (non-link span)
    expect(el.tagName).toBe("SPAN");
    expect(el.className).toContain("font-semibold");
  });

  it('renders "Route Workflows > New" for /routing-rules/new', () => {
    mockUsePathname.mockReturnValue("/routing-rules/new");
    render(<Breadcrumbs />);

    const routeWorkflows = screen.getByText("Route Workflows");
    expect(routeWorkflows.tagName).toBe("A");
    expect(routeWorkflows.getAttribute("href")).toBe("/routing-rules");

    const newLabel = screen.getByText("New");
    expect(newLabel.tagName).toBe("SPAN");
    expect(newLabel.className).toContain("font-semibold");
  });

  it('renders "Integrations > Salesforce" for /integrations/salesforce', () => {
    mockUsePathname.mockReturnValue("/integrations/salesforce");
    render(<Breadcrumbs />);

    const integrations = screen.getByText("Integrations");
    expect(integrations.tagName).toBe("A");
    expect(integrations.getAttribute("href")).toBe("/integrations");

    const salesforce = screen.getByText("Salesforce");
    expect(salesforce.tagName).toBe("SPAN");
    expect(salesforce.className).toContain("font-semibold");
  });

  it('renders "Settings > AI > Prompts" for /settings/ai/prompts', () => {
    mockUsePathname.mockReturnValue("/settings/ai/prompts");
    render(<Breadcrumbs />);

    const settings = screen.getByText("Settings");
    expect(settings.tagName).toBe("A");
    expect(settings.getAttribute("href")).toBe("/settings");

    const ai = screen.getByText("AI");
    expect(ai.tagName).toBe("A");
    expect(ai.getAttribute("href")).toBe("/settings/ai");

    const prompts = screen.getByText("Prompts");
    expect(prompts.tagName).toBe("SPAN");
    expect(prompts.className).toContain("font-semibold");
  });

  it("skips UUID segments in the breadcrumb trail", () => {
    mockUsePathname.mockReturnValue(
      "/routing-rules/550e8400-e29b-41d4-a716-446655440000/flow"
    );
    render(<Breadcrumbs />);

    expect(screen.getByText("Route Workflows")).toBeTruthy();
    expect(screen.getByText("Flow Builder")).toBeTruthy();
    // UUID should not appear
    expect(
      screen.queryByText("550e8400-e29b-41d4-a716-446655440000")
    ).toBeNull();
  });

  it("renders chevron separators between segments", () => {
    mockUsePathname.mockReturnValue("/settings/ai/prompts");
    const { container } = render(<Breadcrumbs />);
    // Two separators for three segments
    const chevrons = container.querySelectorAll("svg");
    expect(chevrons.length).toBe(2);
  });
});

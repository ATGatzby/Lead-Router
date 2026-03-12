import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import LicenseUsersPage from "./page";

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

const mockUsersResponse = {
  users: [
    {
      id: "u1",
      sfdcUserId: "005xx000001",
      name: "Alice Smith",
      email: "alice@example.com",
      role: "AE",
      profile: "Standard",
      department: "Sales",
      isLicensed: true,
      lastRoutedAt: null,
      teamMemberships: [],
    },
    {
      id: "u2",
      sfdcUserId: "005xx000002",
      name: "Bob Jones",
      email: "bob@example.com",
      role: "SDR",
      profile: "Standard",
      department: "Sales",
      isLicensed: false,
      lastRoutedAt: null,
      teamMemberships: [],
    },
  ],
  total: 2,
  page: 1,
  pages: 1,
};

const mockMeResponse = {
  org: { sfdcOrgId: "00Dxx0000001" },
};

function mockFetchResponses() {
  global.fetch = vi.fn().mockImplementation((url: string) => {
    if (url.includes("/api/auth/me")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockMeResponse),
      });
    }
    // Default: users endpoint
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(mockUsersResponse),
    });
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("LicenseUsersPage", () => {
  it("renders the title 'License Users'", async () => {
    mockFetchResponses();
    const { findByRole } = render(<LicenseUsersPage />, {
      wrapper: createWrapper(),
    });

    const heading = await findByRole("heading", { name: /license users/i });
    expect(heading).toBeDefined();
    expect(heading.tagName).toBe("H1");
  });

  it("renders the subtitle description", async () => {
    mockFetchResponses();
    const { findAllByText } = render(<LicenseUsersPage />, {
      wrapper: createWrapper(),
    });

    const matches = await findAllByText(
      /manage which salesforce users can receive routed records/i
    );
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it("renders the Salesforce source badge", async () => {
    mockFetchResponses();
    const { findAllByText } = render(<LicenseUsersPage />, {
      wrapper: createWrapper(),
    });

    const matches = await findAllByText("Salesforce");
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it("renders the Sync Users button", async () => {
    mockFetchResponses();
    const { findAllByText } = render(<LicenseUsersPage />, {
      wrapper: createWrapper(),
    });

    const matches = await findAllByText("Sync Users");
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it("renders the search input with correct placeholder", async () => {
    mockFetchResponses();
    const { findAllByPlaceholderText } = render(<LicenseUsersPage />, {
      wrapper: createWrapper(),
    });

    const inputs = await findAllByPlaceholderText("Search by name, email, role...");
    expect(inputs.length).toBeGreaterThanOrEqual(1);
    expect(inputs[0].tagName).toBe("INPUT");
  });

  it("renders the license filter dropdown with all options", async () => {
    mockFetchResponses();
    const { findAllByText } = render(<LicenseUsersPage />, {
      wrapper: createWrapper(),
    });

    const matches = await findAllByText("All users");
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it("renders header and filter bar separately", async () => {
    mockFetchResponses();
    const { findAllByRole, findAllByPlaceholderText } = render(
      <LicenseUsersPage />,
      { wrapper: createWrapper() }
    );

    const headings = await findAllByRole("heading", { name: /license users/i });
    expect(headings.length).toBeGreaterThanOrEqual(1);

    const inputs = await findAllByPlaceholderText(
      "Search by name, email, role..."
    );
    expect(inputs.length).toBeGreaterThanOrEqual(1);

    // Heading and search input should not share the same immediate parent
    expect(headings[0].parentElement).not.toBe(inputs[0].parentElement);
  });
});

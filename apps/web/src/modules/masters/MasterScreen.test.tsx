import { describe, expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import { screen, waitFor, within } from "@testing-library/react";
import { renderApp } from "../../test/render-app";
import { useAppStore } from "../../core/store/app-store";

// Generous on purpose - this environment has shown real, unrelated
// system-load variance between runs; the assertions themselves are exact.
// Each test below is deliberately short and touches a distinct seeded row
// (masters-handlers.ts's mock store isn't reset between tests), both to
// keep any one flaky step isolated and to avoid cross-test interference.
const ASYNC = { timeout: 20000 };

function signIn(): void {
  useAppStore.setState({
    accessToken: "access-token",
    refreshToken: "refresh-token",
    user: {
      id: "11111111-1111-4111-8111-111111111111",
      email: "demo.admin@hyperion.test",
      name: "Demo Admin",
      companyId: "22222222-2222-4222-8222-222222222222",
    },
    mustChangePassword: false,
  });
}

function rowFor(text: string): HTMLElement {
  const cell = screen.getByText(text);
  const row = cell.closest("tr");
  if (!row) {
    throw new Error(`expected "${text}" to be inside a table row`);
  }
  return row;
}

/**
 * The Drawer's SchemaForm fields share labels with the (still-mounted,
 * merely covered) SchemaTable's own columns - "Name" resolves to both the
 * form input (label-for) and the table's `<th aria-label="Name">` column
 * header via getByLabelText's aria-label fallback. Scoping to the dialog
 * (AntD Drawer renders role="dialog") is the fix, not a longer timeout.
 */
function drawer() {
  return within(screen.getByRole("dialog"));
}

describe("MasterScreen - the generic proof (one component, real masters CRUD)", () => {
  it("lists seeded rows with columns from field-definitions", async () => {
    signIn();
    renderApp({ initialEntries: ["/masters/countries"] });

    expect(await screen.findByRole("heading", { name: "Countries" }, ASYNC)).toBeInTheDocument();
    expect(await screen.findByText("Countries 1", {}, ASYNC)).toBeInTheDocument();
    expect(screen.getByText("COUNTRIES-1")).toBeInTheDocument();
    expect(screen.getByText("Countries 2")).toBeInTheDocument();
  });

  it("search narrows to matching rows via the server, not the client", async () => {
    signIn();
    const user = userEvent.setup();
    renderApp({ initialEntries: ["/masters/countries"] });

    await screen.findByText("Countries 1", {}, ASYNC);
    await user.type(screen.getByLabelText("Search"), "Countries 2{enter}");

    await waitFor(() => expect(screen.queryByText("Countries 1")).not.toBeInTheDocument(), ASYNC);
    expect(screen.getByText("Countries 2")).toBeInTheDocument();
  });

  it("creates a new record via the drawer and it appears in the list", async () => {
    signIn();
    const user = userEvent.setup();
    renderApp({ initialEntries: ["/masters/countries"] });

    await screen.findByText("Countries 1", {}, ASYNC);
    // findByRole (not getByRole): permission-gated (<Can/>) behind its own async fetch.
    // Name is a RegExp: PlusOutlined's own aria-label ("plus") folds into
    // the button's computed accessible name ("plus New Countries").
    await user.click(await screen.findByRole("button", { name: /New Countries/ }, ASYNC));
    await user.type(await drawer().findByLabelText("Code", {}, ASYNC), "ZZ");
    await user.type(drawer().getByLabelText("Name"), "Zed Land");
    await user.click(drawer().getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument(), ASYNC);
    expect(await screen.findByText("Zed Land", {}, ASYNC)).toBeInTheDocument();
  });

  it("edits an existing record - the drawer round-trips it as initialValues", async () => {
    signIn();
    const user = userEvent.setup();
    renderApp({ initialEntries: ["/masters/countries"] });

    await screen.findByText("Countries 3", {}, ASYNC);
    await user.click(within(rowFor("Countries 3")).getByRole("button", { name: "Edit" }));

    const nameInput = await drawer().findByLabelText("Name", {}, ASYNC);
    expect(nameInput).toHaveValue("Countries 3");
    await user.clear(nameInput);
    await user.type(nameInput, "Renamed Country");
    await user.click(drawer().getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Renamed Country", {}, ASYNC)).toBeInTheDocument();
  });

  it("deactivates and reactivates a record - real PATCH .../:id/(de)activate, list refreshes after each", async () => {
    signIn();
    const user = userEvent.setup();
    renderApp({ initialEntries: ["/masters/countries"] });

    await screen.findByText("Countries 1", {}, ASYNC);

    await user.click(within(rowFor("Countries 1")).getByRole("button", { name: "Deactivate" }));
    await waitFor(
      () => expect(within(rowFor("Countries 1")).queryByRole("button", { name: "Deactivate" })).not.toBeInTheDocument(),
      ASYNC,
    );
    expect(within(rowFor("Countries 1")).getByRole("button", { name: "Activate" })).toBeInTheDocument();

    // Restore seed state for any other test in this file that reads Countries 1.
    await user.click(within(rowFor("Countries 1")).getByRole("button", { name: "Activate" }));
    await waitFor(
      () => expect(within(rowFor("Countries 1")).queryByRole("button", { name: "Activate" })).not.toBeInTheDocument(),
      ASYNC,
    );
    expect(within(rowFor("Countries 1")).getByRole("button", { name: "Deactivate" })).toBeInTheDocument();
  });

  it("renders a second, unrelated master through the exact same route/component - proving genericity", async () => {
    signIn();
    renderApp({ initialEntries: ["/masters/uom"] });

    expect(await screen.findByRole("heading", { name: "Units of Measure" }, ASYNC)).toBeInTheDocument();
    expect(await screen.findByText("Units of Measure 1", {}, ASYNC)).toBeInTheDocument();
  });
});

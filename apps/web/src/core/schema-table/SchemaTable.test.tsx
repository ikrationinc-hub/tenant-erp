import { describe, expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import { screen, waitFor, within } from "@testing-library/react";
import type { RouteObject } from "react-router-dom";
import { renderApp } from "../../test/render-app";
import { SchemaTable } from "./SchemaTable";
import { DEV_ENTITY_LIST_ENDPOINT, schemaTableDevFieldDefinitions } from "./dev-fixture";

const testRoutes: RouteObject[] = [
  {
    path: "/",
    element: (
      <SchemaTable
        module={schemaTableDevFieldDefinitions.module}
        entity={schemaTableDevFieldDefinitions.entity}
        endpoint={DEV_ENTITY_LIST_ENDPOINT}
      />
    ),
  },
];

describe("SchemaTable", () => {
  it("paginates against the server - page 2 shows different rows and the URL updates", async () => {
    const user = userEvent.setup();
    const { router } = renderApp({ routes: testRoutes, initialEntries: ["/"] });

    expect(await screen.findByText("Sample Record 1")).toBeInTheDocument();
    expect(screen.queryByText("Sample Record 21")).not.toBeInTheDocument();

    await user.click(screen.getByTitle("2"));

    expect(await screen.findByText("Sample Record 21")).toBeInTheDocument();
    expect(screen.queryByText("Sample Record 1")).not.toBeInTheDocument();
    expect(router.state.location.search).toContain("page=2");
  });

  it("sorts against the server, not the client", async () => {
    const user = userEvent.setup();
    renderApp({ routes: testRoutes, initialEntries: ["/"] });

    expect(await screen.findByText("CODE-001")).toBeInTheDocument();

    // `sticky` renders a second, hidden "measure" header for width
    // calculation - the real one is the sortable <th>, found via its
    // aria-label rather than plain text (which matches both).
    const codeHeader = screen.getByRole("columnheader", { name: "Code" });
    await user.click(codeHeader); // ascend
    await user.click(codeHeader); // descend

    await screen.findByText("CODE-047");
    const rows = screen.getAllByRole("row");
    const firstDataRow = rows[1];
    if (!firstDataRow) {
      throw new Error("expected at least one data row");
    }
    expect(within(firstDataRow).getByText("CODE-047")).toBeInTheDocument();
  });

  it("filters against the server - a search term narrows to matching rows only", async () => {
    const user = userEvent.setup();
    renderApp({ routes: testRoutes, initialEntries: ["/"] });

    expect(await screen.findByText("Sample Record 1")).toBeInTheDocument();

    const search = screen.getByLabelText("Search");
    await user.type(search, "Sample Record 25{enter}");

    await waitFor(() => expect(screen.queryByText("Sample Record 1")).not.toBeInTheDocument());
    expect(screen.getByText("Sample Record 25")).toBeInTheDocument();
  });

  it("URL state round-trips - a search/page from the URL survives a fresh mount", async () => {
    renderApp({ routes: testRoutes, initialEntries: ["/?search=Sample+Record+30&page=1"] });

    expect(await screen.findByText("Sample Record 30")).toBeInTheDocument();
    expect(screen.queryByText("Sample Record 1")).not.toBeInTheDocument();
  });
});

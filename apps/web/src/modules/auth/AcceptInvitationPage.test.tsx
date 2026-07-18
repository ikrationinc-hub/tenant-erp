import { describe, expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import { screen } from "@testing-library/react";
import { renderApp } from "../../test/render-app";

describe("AcceptInvitationPage", () => {
  it("loads the invitation, sets a password, and reaches the success state", async () => {
    const user = userEvent.setup();
    renderApp({ initialEntries: ["/accept-invitation/mock-token"] });

    expect(await screen.findByText(/new\.hire@hyperion\.test/)).toBeInTheDocument();

    await user.type(screen.getByLabelText("Password"), "a very long passphrase 123");
    await user.type(screen.getByLabelText("Confirm password"), "a very long passphrase 123");
    await user.click(screen.getByRole("button", { name: "Set password" }));

    expect(await screen.findByText("Password set")).toBeInTheDocument();
  });
});

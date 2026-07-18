import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { App } from "./App";

describe("App", () => {
  it("boots, mocks /auth/me via MSW, and renders the returned user", async () => {
    render(<App />);

    const userLine = await screen.findByTestId("bootstrap-user");
    expect(userLine).toHaveTextContent("Signed in as Demo Admin");
    expect(userLine).toHaveTextContent("demo.admin@hyperion.test");
  });
});

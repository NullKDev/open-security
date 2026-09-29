import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RemoteMode } from "../RemoteMode";

describe("RemoteMode", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders URL input with placeholder", () => {
    render(
      <RemoteMode
        value=""
        onChange={() => {}}
        onValidate={() => {}}
      />
    );

    const input = screen.getByPlaceholderText("https://github.com/owner/repo");
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute("type", "url");
  });

  it("calls onChange when user types", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <RemoteMode
        value=""
        onChange={onChange}
        onValidate={() => {}}
      />
    );

    const input = screen.getByPlaceholderText("https://github.com/owner/repo");
    await user.type(input, "https://github.com/user/repo");

    expect(onChange).toHaveBeenCalled();
  });

  it("calls onValidate on blur with non-empty value", async () => {
    const user = userEvent.setup();
    const onValidate = vi.fn();

    render(
      <RemoteMode
        value="https://github.com/user/repo"
        onChange={() => {}}
        onValidate={onValidate}
      />
    );

    const input = screen.getByPlaceholderText("https://github.com/owner/repo");
    await user.click(input);
    await user.tab(); // blur

    expect(onValidate).toHaveBeenCalledWith("https://github.com/user/repo");
  });

  it("shows GitHub badge when detectedType=github", () => {
    render(
      <RemoteMode
        value="https://github.com/org/repo"
        onChange={() => {}}
        onValidate={() => {}}
        detectedType="github"
      />
    );

    expect(screen.getByText("GitHub")).toBeInTheDocument();
  });

  it("shows GitLab badge when detectedType=gitlab", () => {
    render(
      <RemoteMode
        value="https://gitlab.com/org/repo"
        onChange={() => {}}
        onValidate={() => {}}
        detectedType="gitlab"
      />
    );

    expect(screen.getByText("GitLab")).toBeInTheDocument();
  });

  it("shows GitLab badge for self-hosted gitlab (detectedType=gitlab)", () => {
    render(
      <RemoteMode
        value="https://gitlab.internal.co/project/repo"
        onChange={() => {}}
        onValidate={() => {}}
        detectedType="gitlab"
      />
    );

    expect(screen.getByText("GitLab")).toBeInTheDocument();
  });

  it("shows Unknown badge when no detectedType and value is valid URL", () => {
    render(
      <RemoteMode
        value="https://bitbucket.org/owner/repo"
        onChange={() => {}}
        onValidate={() => {}}
      />
    );

    // No detectedType — shows "Unknown" badge
    expect(screen.getByText("Unknown")).toBeInTheDocument();
  });

  it("does not show badge when value is empty", () => {
    render(
      <RemoteMode
        value=""
        onChange={() => {}}
        onValidate={() => {}}
      />
    );

    expect(screen.queryByText("GitHub")).not.toBeInTheDocument();
    expect(screen.queryByText("GitLab")).not.toBeInTheDocument();
    expect(screen.queryByText("Unknown")).not.toBeInTheDocument();
  });

  it("shows error message when error prop is set", () => {
    render(
      <RemoteMode
        value="not-a-url"
        onChange={() => {}}
        onValidate={() => {}}
        error="Enter a valid HTTPS URL"
      />
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Enter a valid HTTPS URL");
  });

  it("shows validation spinner when isDetecting is true", () => {
    render(
      <RemoteMode
        value="https://github.com/user/repo"
        onChange={() => {}}
        onValidate={() => {}}
        isDetecting={true}
      />
    );

    expect(screen.getByTestId("validation-spinner")).toBeInTheDocument();
  });

  it("shows green checkmark when validated", () => {
    render(
      <RemoteMode
        value="https://github.com/user/repo"
        onChange={() => {}}
        onValidate={() => {}}
        isValidated={true}
      />
    );

    expect(screen.getByLabelText("Validated")).toBeInTheDocument();
  });

  it("shows validation reason when provided", () => {
    render(
      <RemoteMode
        value="https://github.com/user/repo"
        onChange={() => {}}
        onValidate={() => {}}
        validationReason="Could not validate. Submit anyway?"
      />
    );

    expect(screen.getByText("Could not validate. Submit anyway?")).toBeInTheDocument();
  });

  it("marks input as invalid when error is present", () => {
    render(
      <RemoteMode
        value="invalid"
        onChange={() => {}}
        onValidate={() => {}}
        error="Enter a valid HTTPS URL"
      />
    );

    const input = screen.getByPlaceholderText("https://github.com/owner/repo");
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("associates error message with input via aria-describedby", () => {
    render(
      <RemoteMode
        value="invalid"
        onChange={() => {}}
        onValidate={() => {}}
        error="Enter a valid HTTPS URL"
      />
    );

    const input = screen.getByPlaceholderText("https://github.com/owner/repo");
    expect(input.getAttribute("aria-describedby")).toContain("remote-mode-error");
  });
});

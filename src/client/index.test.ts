/// <reference types="vite/client" />

import { describe, expect, test } from "vitest";
import { Debouncer, type DebouncerComponentApi } from "./index.js";

// Client tests focus on the Debouncer class API and instantiation.
// The actual component functionality is tested in src/component/lib.test.ts
// and example/convex/example.test.ts which have full component access.

describe("Debouncer client", () => {
  describe("class instantiation", () => {
    // Create a mock component API for testing instantiation
    const mockComponent: DebouncerComponentApi = {
      lib: {
        schedule: {} as DebouncerComponentApi["lib"]["schedule"],
        status: {} as DebouncerComponentApi["lib"]["status"],
        cancel: {} as DebouncerComponentApi["lib"]["cancel"],
      },
    };

    test("creates instance with delay only (default mode is sliding)", () => {
      const debouncer = new Debouncer(mockComponent, { delay: 1000 });
      expect(debouncer).toBeDefined();
      expect(debouncer).toBeInstanceOf(Debouncer);
    });

    test("creates instance with eager mode", () => {
      const debouncer = new Debouncer(mockComponent, {
        delay: 500,
        mode: "eager",
      });
      expect(debouncer).toBeDefined();
    });

    test("creates instance with fixed mode", () => {
      const debouncer = new Debouncer(mockComponent, {
        delay: 500,
        mode: "fixed",
      });
      expect(debouncer).toBeDefined();
    });

    test("creates instance with sliding mode", () => {
      const debouncer = new Debouncer(mockComponent, {
        delay: 500,
        mode: "sliding",
      });
      expect(debouncer).toBeDefined();
    });

    test("creates instance with large delay", () => {
      const debouncer = new Debouncer(mockComponent, {
        delay: 15 * 60 * 1000, // 15 minutes
      });
      expect(debouncer).toBeDefined();
    });
  });

  describe("method existence", () => {
    const mockComponent: DebouncerComponentApi = {
      lib: {
        schedule: {} as DebouncerComponentApi["lib"]["schedule"],
        status: {} as DebouncerComponentApi["lib"]["status"],
        cancel: {} as DebouncerComponentApi["lib"]["cancel"],
      },
    };

    test("has schedule method", () => {
      const debouncer = new Debouncer(mockComponent, { delay: 1000 });
      expect(typeof debouncer.schedule).toBe("function");
    });

    test("has status method", () => {
      const debouncer = new Debouncer(mockComponent, { delay: 1000 });
      expect(typeof debouncer.status).toBe("function");
    });

    test("has cancel method", () => {
      const debouncer = new Debouncer(mockComponent, { delay: 1000 });
      expect(typeof debouncer.cancel).toBe("function");
    });
  });

  describe("type exports", () => {
    test("DebouncerComponentApi type is exported", () => {
      // This test verifies the type is importable
      const api: DebouncerComponentApi = {
        lib: {
          schedule: {} as DebouncerComponentApi["lib"]["schedule"],
          status: {} as DebouncerComponentApi["lib"]["status"],
          cancel: {} as DebouncerComponentApi["lib"]["cancel"],
        },
      };
      expect(api).toBeDefined();
    });
  });
});

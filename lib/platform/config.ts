export class PlatformError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export function localPlatformMode() {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.PLATFORM_LOCAL_MODE === "1"
  );
}

export function platformOrigin() {
  const value = process.env.AUTH_BASE_URL?.trim();
  if (!value)
    throw new PlatformError(
      "Set AUTH_BASE_URL to configure the workspace.",
      503,
    );
  const url = new URL(value);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(localPlatformMode() && loopback && url.protocol === "http:"))
  ) {
    throw new PlatformError(
      "AUTH_BASE_URL must be an HTTPS origin, or a loopback HTTP origin in local mode.",
      503,
    );
  }
  return url.origin;
}

export function developmentLoginEnabled() {
  if (!localPlatformMode() || process.env.PLATFORM_DEV_AUTH !== "1")
    return false;
  return ["localhost", "127.0.0.1", "[::1]"].includes(
    new URL(platformOrigin()).hostname,
  );
}

export function platformConfiguration() {
  return {
    database: localPlatformMode()
      ? "local"
      : process.env.DATABASE_URL?.trim()
        ? "postgresql"
        : "missing",
    login:
      process.env.AUTH_OIDC_ISSUER?.trim() &&
      process.env.AUTH_OIDC_CLIENT_ID?.trim()
        ? "oidc"
        : developmentLoginEnabled()
          ? "local"
          : "missing",
    storage: localPlatformMode()
      ? "local"
      : process.env.OBJECT_STORAGE_BUCKET?.trim()
        ? "s3"
        : "missing",
  };
}

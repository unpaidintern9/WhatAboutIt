export type CloudflareConnectionState = "unconfigured" | "disconnected" | "connecting" | "connected" | "error";

export interface CloudflareConnectionStatus {
  state: CloudflareConnectionState;
  clientConfigured: boolean;
  accountId?: string;
  accountName?: string;
  userEmail?: string;
  expiresAt?: string;
  error?: string;
}

export interface CloudflareOAuthConfiguration {
  clientId?: string;
  redirectUri: string;
  scopes: string[];
}

export const cloudflareOAuthRedirectUri = "http://127.0.0.1:42831/oauth/cloudflare/callback";

// The desktop login is only for account identity/setup. Episode media will move
// through the What About It sync Worker, so broad R2 credentials never live in
// the desktop app.
export const cloudflareOAuthScopes = ["account.read"] as const;

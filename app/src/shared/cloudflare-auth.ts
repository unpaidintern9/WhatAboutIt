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

export const cloudflareOAuthScopes = [
  "account.read",
  "workers-r2-storage.write"
] as const;

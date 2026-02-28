"use client";

import { useSearchParams } from "next/navigation";

const ERROR_MESSAGES: Record<string, string> = {
  auth_failed: "Authentication failed. Please try again.",
  access_denied: "Access was denied. Make sure you have Salesforce API access enabled.",
};

export function LoginError() {
  const params = useSearchParams();
  const error = params.get("error");
  if (!error) return null;

  const message = ERROR_MESSAGES[error] ?? decodeURIComponent(error);

  return (
    <div className="rounded-md bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
      {message}
    </div>
  );
}

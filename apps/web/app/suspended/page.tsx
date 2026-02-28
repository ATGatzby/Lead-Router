export default function SuspendedPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="max-w-md w-full mx-auto px-6 text-center space-y-4">
        <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-6 w-6 text-destructive"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
            />
          </svg>
        </div>
        <h1 className="text-xl font-semibold text-foreground">Account Suspended</h1>
        <p className="text-sm text-muted-foreground">
          Your organization&apos;s account has been suspended. Please contact support to
          reactivate your account.
        </p>
        <a
          href="mailto:support@leadrouter.io"
          className="inline-block text-sm font-medium text-primary underline underline-offset-4"
        >
          Contact Support
        </a>
      </div>
    </div>
  );
}

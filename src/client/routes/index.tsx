import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { authClient } from "../lib/auth-client";

export const Route = createFileRoute("/")({
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const { data: session, isPending } = authClient.useSession();

  useEffect(() => {
    if (session) {
      navigate({ to: "/games" });
    }
  }, [session, navigate]);

  if (isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  if (session) {
    return null;
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 p-4">
      <div className="text-center">
        <h1 className="text-3xl font-bold">OnBoard</h1>
        <p className="mt-2 text-gray-600">Board game score tracker</p>
      </div>

      <div className="flex w-full max-w-sm flex-col gap-3">
        {!import.meta.env.VITE_TEST_AUTH && (
          <button
            type="button"
            onClick={() =>
              authClient.signIn.social({ provider: "google", callbackURL: "/games" })
            }
            className="rounded-lg bg-white px-4 py-3 font-medium text-gray-700 shadow-sm ring-1 ring-gray-300 hover:bg-gray-50"
          >
            Sign in with Google
          </button>
        )}

        {import.meta.env.VITE_TEST_AUTH && <TestAuthForm />}
      </div>
    </div>
  );
}

function TestAuthForm() {
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = form.get("email") as string;
    const password = form.get("password") as string;
    const name = form.get("name") as string;

    // Try sign in first, fall back to sign up
    const signIn = await authClient.signIn.email({ email, password });
    if (signIn.error) {
      await authClient.signUp.email({ email, password, name: name || "Test User" });
    }
    navigate({ to: "/games" });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <input
        name="name"
        type="text"
        placeholder="Name"
        defaultValue="Test User"
        className="rounded-lg border px-4 py-3"
      />
      <input
        name="email"
        type="email"
        placeholder="Email"
        required
        className="rounded-lg border px-4 py-3"
      />
      <input
        name="password"
        type="password"
        placeholder="Password"
        required
        className="rounded-lg border px-4 py-3"
      />
      <button
        type="submit"
        className="rounded-lg bg-blue-600 px-4 py-3 font-medium text-white hover:bg-blue-700"
      >
        Sign in / Sign up
      </button>
    </form>
  );
}

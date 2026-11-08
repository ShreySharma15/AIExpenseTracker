import { signIn } from "./actions";

export default async function Login({ searchParams }: { searchParams: Promise<{ failed?: string }> }) {
  const { failed } = await searchParams;
  return <main className="mx-auto grid min-h-dvh max-w-md content-center px-5 py-12">
    <div className="rounded-3xl bg-white p-7 shadow-sm">
      <p className="text-sm font-semibold text-emerald-700">Personal ledger</p>
      <h1 className="mb-6 mt-1 text-3xl font-bold">Expense Tracker</h1>
      {failed && <p role="alert" className="mb-4 text-sm text-red-800">Sign-in failed. Check your email and password.</p>}
      <form action={signIn} className="grid gap-4">
        <label>Email<input name="email" type="email" autoComplete="username" maxLength={254} required /></label>
        <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
        <button className="bg-emerald-950 text-white">Sign in</button>
      </form>
    </div>
  </main>;
}

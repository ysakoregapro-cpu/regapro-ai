import { isDevSampleMode } from "@/lib/supabase/env";
import { redirect } from "next/navigation";

export const metadata = { title: "ログイン" };

export default function LoginPage() {
  if (isDevSampleMode()) {
    redirect("/home");
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4">
      <h1 className="text-[24px] font-semibold">レガプロへログイン</h1>
      <p className="mt-2 text-[13px] text-text-secondary">
        招待制です。アカウントをお持ちでない場合は管理者へ連絡してください。
      </p>
      <form className="mt-6 space-y-3" action="/api/auth/login" method="post">
        <div>
          <label htmlFor="email" className="text-[12px] text-text-secondary">
            メール
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            className="mt-1 h-10 w-full rounded-md border border-border bg-surface px-3 text-[14px]"
          />
        </div>
        <div>
          <label htmlFor="password" className="text-[12px] text-text-secondary">
            パスワード
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            className="mt-1 h-10 w-full rounded-md border border-border bg-surface px-3 text-[14px]"
          />
        </div>
        <button
          type="submit"
          className="h-10 w-full rounded-md bg-accent text-[14px] font-medium text-accent-fg"
        >
          ログイン
        </button>
      </form>
      <p className="mt-4 text-[12px]">
        <a href="/reset-password" className="text-accent hover:underline">
          パスワードを再設定
        </a>
      </p>
    </main>
  );
}

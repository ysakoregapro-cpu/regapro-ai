export const metadata = { title: "パスワード再設定" };

export default function ResetPasswordPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4">
      <h1 className="text-[24px] font-semibold">パスワード再設定</h1>
      <p className="mt-2 text-[13px] text-text-secondary">
        登録メール宛に再設定用のリンクを送ります（supabaseモード時）。
      </p>
      <form className="mt-6 space-y-3">
        <label htmlFor="email" className="text-[12px] text-text-secondary">
          メール
        </label>
        <input
          id="email"
          type="email"
          className="h-10 w-full rounded-md border border-border bg-surface px-3"
        />
        <button
          type="button"
          className="h-10 w-full rounded-md border border-border text-[14px]"
          disabled
          title="本番メール送信は未接続です"
        >
          送信（未接続）
        </button>
      </form>
    </main>
  );
}

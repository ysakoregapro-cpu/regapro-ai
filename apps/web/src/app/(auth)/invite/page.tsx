export const metadata = { title: "招待の受諾" };

export default function InvitePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4">
      <h1 className="text-[24px] font-semibold">招待を受諾</h1>
      <p className="mt-2 text-[13px] text-text-secondary">
        招待リンクからアカウントを有効化します。公開サインアップはありません。
      </p>
      <form className="mt-6 space-y-3">
        <label htmlFor="password" className="text-[12px] text-text-secondary">
          新しいパスワード
        </label>
        <input
          id="password"
          type="password"
          className="h-10 w-full rounded-md border border-border bg-surface px-3"
        />
        <button
          type="button"
          className="h-10 w-full rounded-md bg-accent text-[14px] text-accent-fg"
          disabled
          title="supabaseモードかつ有効な招待トークンが必要です"
        >
          受諾する
        </button>
      </form>
    </main>
  );
}

import { Suspense } from "react";
import TasksClient from "./TasksClient";

export const metadata = { title: "タスク" };

export default function Page() {
  return (
    <Suspense fallback={<div className="py-8 text-[13px] text-text-secondary">読み込み中…</div>}>
      <TasksClient />
    </Suspense>
  );
}

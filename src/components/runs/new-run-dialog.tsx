"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Spider } from "@/lib/db";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { api, ApiClientError } from "@/lib/api-client";

export function NewRunDialog({ trigger }: { trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const router = useRouter();
  const qc = useQueryClient();

  const { data: spiders } = useQuery({
    queryKey: ["spiders"],
    queryFn: () => api.get<Spider[]>("/api/spiders"),
    enabled: open,
  });

  const mutation = useMutation({
    mutationFn: (spider: string) =>
      api.post<{ id: string }>("/api/runs", { spider, overrides: {} }),
    onSuccess: ({ id }) => {
      toast.success("Run 已入队");
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ["runs"] });
      router.push(`/runs/${id}`);
    },
    onError: (err) => {
      const msg = err instanceof ApiClientError ? err.message : String(err);
      toast.error(`启动失败：${msg}`);
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新建运行</DialogTitle>
          <DialogDescription>选择一个 Spider 立即抓取。</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          {spiders?.map((s) => (
            <label
              key={s.name}
              className={`flex cursor-pointer items-center justify-between rounded-md border px-3 py-2 ${
                selected === s.name ? "border-primary" : ""
              }`}
            >
              <input
                type="radio"
                name="spider"
                value={s.name}
                className="sr-only"
                onChange={() => setSelected(s.name)}
              />
              <div>
                <div className="font-medium">{s.displayName}</div>
                <div className="text-xs text-muted-foreground">{s.name}</div>
              </div>
              {!s.enabled && (
                <span className="text-xs text-muted-foreground">disabled</span>
              )}
            </label>
          ))}
          {spiders?.length === 0 && (
            <div className="text-sm text-muted-foreground">
              暂无 Spider，请先去 Spiders 页创建。
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button
            disabled={!selected || mutation.isPending}
            onClick={() => selected && mutation.mutate(selected)}
          >
            {mutation.isPending ? "启动中…" : "启动"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

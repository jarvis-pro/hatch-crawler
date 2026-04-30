"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function SettingsPage() {
  return (
    <Tabs defaultValue="proxy">
      <TabsList>
        <TabsTrigger value="proxy">代理池</TabsTrigger>
        <TabsTrigger value="ua">UA 池</TabsTrigger>
        <TabsTrigger value="defaults">默认参数</TabsTrigger>
      </TabsList>
      <TabsContent value="proxy">
        <SettingEditor settingKey="proxy_pool" />
      </TabsContent>
      <TabsContent value="ua">
        <SettingEditor settingKey="ua_pool" />
      </TabsContent>
      <TabsContent value="defaults">
        <SettingEditor settingKey="defaults" />
      </TabsContent>
    </Tabs>
  );
}

function SettingEditor({ settingKey }: { settingKey: string }) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["setting", settingKey],
    queryFn: () =>
      api.get<{ key: string; value: unknown }>(`/api/settings/${settingKey}`),
  });

  const [text, setText] = useState<string>("");

  // 初次加载时同步 textarea
  if (data && !text) {
    setText(JSON.stringify(data.value ?? {}, null, 2));
  }

  const save = useMutation({
    mutationFn: (value: unknown) =>
      api.put(`/api/settings/${settingKey}`, { value }),
    onSuccess: () => {
      toast.success("已保存");
      void qc.invalidateQueries({ queryKey: ["setting", settingKey] });
    },
    onError: (err) => toast.error(String(err)),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-mono">{settingKey}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <textarea
          className="h-72 w-full rounded-md border bg-background p-3 font-mono text-xs"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="flex justify-end">
          <Button
            disabled={save.isPending}
            onClick={() => {
              try {
                const parsed = JSON.parse(text) as unknown;
                save.mutate(parsed);
              } catch (err) {
                toast.error(`JSON 不合法：${String(err)}`);
              }
            }}
          >
            {save.isPending ? "保存中…" : "保存"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

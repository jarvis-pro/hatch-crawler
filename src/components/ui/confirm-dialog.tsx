'use client';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface ConfirmDialogProps {
  open: boolean;
  title?: string;
  description: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  isPending?: boolean;
  /** destructive 操作传 true，按钮变红 */
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * 通用确认弹窗，替代浏览器原生 confirm()。
 * 用法：
 *   <ConfirmDialog
 *     open={showConfirm}
 *     title="删除凭据"
 *     description={`确认删除"${label}"？`}
 *     danger
 *     onConfirm={handleConfirm}
 *     onClose={() => setShowConfirm(false)}
 *   />
 */
export function ConfirmDialog({
  open,
  title = '确认操作',
  description,
  confirmText = '确认',
  cancelText = '取消',
  isPending = false,
  danger = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <p className="py-1 text-sm text-muted-foreground">{description}</p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            {cancelText}
          </Button>
          <Button
            variant={danger ? 'destructive' : 'default'}
            onClick={onConfirm}
            disabled={isPending}
          >
            {isPending ? '处理中…' : confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { apiFetch, ApiClientError } from '@/lib/api-client';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface DeleteConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 删除接口地址，如 /api/md/customers/xxx */
  endpoint: string | null;
  /** 展示用名称，如客户名称 */
  name: string;
  onDeleted: () => void;
}

export function DeleteConfirmDialog({
  open,
  onOpenChange,
  endpoint,
  name,
  onDeleted,
}: DeleteConfirmDialogProps) {
  const [deleting, setDeleting] = useState(false);

  async function onConfirm() {
    if (!endpoint) return;
    setDeleting(true);
    try {
      await apiFetch(endpoint, { method: 'DELETE' });
      toast.success('删除成功');
      onOpenChange(false);
      onDeleted();
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : '删除失败');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>确认删除</AlertDialogTitle>
          <AlertDialogDescription>
            确定要删除「{name}」吗？此操作不可恢复。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              void onConfirm();
            }}
            disabled={deleting}
            className="bg-destructive text-white hover:bg-destructive/90"
          >
            {deleting ? '删除中…' : '确认删除'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

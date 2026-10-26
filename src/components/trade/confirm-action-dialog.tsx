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

interface ConfirmActionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  actionLabel: string;
  /** POST 接口地址，如 /api/po/orders/xxx/confirm */
  endpoint: string | null;
  destructive?: boolean;
  onDone: () => void;
}

/** 通用 POST 动作确认弹窗（确认订单 / 取消订单等状态流转） */
export function ConfirmActionDialog({
  open,
  onOpenChange,
  title,
  description,
  actionLabel,
  endpoint,
  destructive,
  onDone,
}: ConfirmActionDialogProps) {
  const [submitting, setSubmitting] = useState(false);

  async function onConfirm() {
    if (!endpoint) return;
    setSubmitting(true);
    try {
      await apiFetch(endpoint, { method: 'POST' });
      toast.success(`${actionLabel}成功`);
      onOpenChange(false);
      onDone();
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : `${actionLabel}失败`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={submitting}>再想想</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              void onConfirm();
            }}
            disabled={submitting}
            className={destructive ? 'bg-destructive text-white hover:bg-destructive/90' : undefined}
          >
            {submitting ? `${actionLabel}中…` : actionLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

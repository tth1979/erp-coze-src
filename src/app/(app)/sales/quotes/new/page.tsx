'use client';

import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { QuoteEditor } from '@/components/sales/quote-editor';
import { Button } from '@/components/ui/button';

export default function NewQuotePage() {
  const router = useRouter();
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => router.push('/sales/quotes')} aria-label="返回列表">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-lg font-bold text-stone-900">新建报价单</h1>
          <p className="text-xs text-stone-500 sm:text-sm">填写客户与报价明细，保存为草稿后可发出</p>
        </div>
      </div>
      <QuoteEditor
        mode="create"
        onSaved={(quote) => router.replace(`/sales/quotes/${quote.id}`)}
        onCancel={() => router.push('/sales/quotes')}
      />
    </div>
  );
}

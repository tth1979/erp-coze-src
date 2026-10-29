'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ArrowDownToLine, ArrowUpFromLine, PackageCheck, ScanLine } from 'lucide-react';
import { useAuth } from '@/components/auth/auth-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { apiFetch } from '@/lib/api-client';

interface DocRow {
  id: string;
  doc_no: string;
  status: string;
  partner: string;
  date: string;
}
interface ItemRow {
  product_id?: string;
  product_name?: string | null;
  product_sku?: string | null;
  quantity?: number;
}
interface DocDetail {
  items?: ItemRow[];
}

const STATUS_LABEL: Record<string, string> = { draft: '草稿', pending: '待审', approved: '已审' };

/** PDA 扫码出入库核对（弱耦合，只读复用 po/so 出入库 API，扫码确认数量，不落新数据） */
export default function StockIOPage() {
  const [tab, setTab] = useState<'in' | 'out'>('in');
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [current, setCurrent] = useState<{ doc: DocRow; items: ItemRow[] } | null>(null);
  const [scan, setScan] = useState('');
  const [done, setDone] = useState<Set<string>>(new Set());
  const { can } = useAuth();

  const isIn = tab === 'in';
  const endpoint = isIn ? '/api/po/receipts' : '/api/so/shipments';
  const readPerm = isIn ? 'po.read' : 'so.read';

  const loadDocs = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ items: Array<Record<string, unknown>> }>(`${endpoint}?pageSize=100`);
      const rows: DocRow[] = (data.items ?? [])
        .filter((r) => ['draft', 'pending', 'approved'].includes(String(r.status)))
        .map((r) => ({
          id: String(r.id),
          doc_no: String(r[isIn ? 'receipt_no' : 'shipment_no'] ?? ''),
          status: String(r.status),
          partner: String(r[isIn ? 'supplier_name' : 'customer_name'] ?? ''),
          date: String(r[isIn ? 'receipt_date' : 'ship_date'] ?? ''),
        }));
      setDocs(rows);
    } catch (e) {
      toast.error('单据列表加载失败', { description: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, [endpoint, isIn]);

  useEffect(() => {
    setCurrent(null);
    setDone(new Set());
    void loadDocs();
  }, [loadDocs]);

  async function openDoc(doc: DocRow): Promise<void> {
    try {
      const detail = await apiFetch<DocDetail>(`${endpoint}/${doc.id}`);
      setCurrent({ doc, items: detail.items ?? [] });
      setDone(new Set());
      setScan('');
    } catch (e) {
      toast.error('明细加载失败', { description: (e as Error).message });
    }
  }

  function onScan(): void {
    const code = scan.trim().toLowerCase();
    if (!code) return;
    if (!current) return;
    const matched = current.items.find(
      (i) => String(i.product_sku ?? '').toLowerCase() === code || String(i.product_name ?? '').toLowerCase().includes(code),
    );
    if (matched) {
      const key = String(matched.product_id ?? matched.product_sku ?? matched.product_name ?? '');
      setDone((prev) => new Set(prev).add(key));
      toast.success(`已核对：${matched.product_name}`);
      setScan('');
    } else {
      toast.error('未匹配到该条码对应的出入库明细');
    }
  }

  if (!can(readPerm)) {
    return (
      <div className="rounded-xl border border-stone-200 bg-white p-6 text-center text-sm text-stone-500">无出入库查看权限</div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-base font-bold text-stone-900">扫码出入库核对</h1>
        <Button size="sm" variant="outline" onClick={() => void loadDocs()} disabled={loading}>
          刷新
        </Button>
      </div>

      {/* 出入库切换 */}
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-stone-100 p-1">
        <button
          onClick={() => setTab('in')}
          className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-medium transition ${
            isIn ? 'bg-white text-emerald-700 shadow' : 'text-stone-500'
          }`}
        >
          <ArrowDownToLine className="h-4 w-4" /> 采购入库(GR)
        </button>
        <button
          onClick={() => setTab('out')}
          className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-medium transition ${
            !isIn ? 'bg-white text-red-600 shadow' : 'text-stone-500'
          }`}
        >
          <ArrowUpFromLine className="h-4 w-4" /> 销售出库(SH)
        </button>
      </div>

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : docs.length === 0 ? (
        <div className="rounded-xl border border-stone-200 bg-white p-6 text-center text-sm text-stone-500">
          暂无进行中的{isIn ? '入库单' : '出库单'}
        </div>
      ) : current ? (
        /* 明细核对 */
        <div className="rounded-xl border border-stone-200 bg-white p-3">
          <button onClick={() => setCurrent(null)} className="mb-2 text-xs text-sky-600">
            ← 返回单据列表
          </button>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-mono text-sm font-bold">{current.doc.doc_no}</p>
              <p className="text-xs text-stone-500">
                {current.doc.partner} · {STATUS_LABEL[current.doc.status] ?? current.doc.status}
              </p>
            </div>
            <span className="text-xs font-semibold text-emerald-700">
              已核对 {done.size}/{current.items.length}
            </span>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <div className="relative flex-1">
              <ScanLine className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
              <Input
                value={scan}
                onChange={(e) => setScan(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && onScan()}
                placeholder="扫描/输入条码，回车核对"
                className="h-11 pl-8 text-base"
                autoFocus
              />
            </div>
            <Button size="sm" onClick={onScan} className="h-11">
              核对
            </Button>
          </div>

          <div className="mt-3 space-y-2">
            {current.items.map((item) => {
              const key = String(item.product_id ?? item.product_sku ?? item.product_name ?? '');
              const ok = done.has(key);
              return (
                <div
                  key={key}
                  className={`flex items-center justify-between rounded-lg border px-3 py-2 ${
                    ok ? 'border-emerald-200 bg-emerald-50' : 'border-stone-200 bg-white'
                  }`}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{item.product_name ?? '未知商品'}</p>
                    <p className="font-mono text-xs text-stone-500">{item.product_sku}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold tabular-nums">x{item.quantity ?? 0}</span>
                    {ok && <PackageCheck className="h-4 w-4 text-emerald-600" />}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* 单据列表 */
        <div className="space-y-2">
          {docs.map((doc) => (
            <button
              key={doc.id}
              onClick={() => void openDoc(doc)}
              className="w-full rounded-xl border border-stone-200 bg-white p-3 text-left"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-sm font-bold">{doc.doc_no}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    doc.status === 'approved'
                      ? 'bg-emerald-50 text-emerald-700'
                      : doc.status === 'pending'
                        ? 'bg-amber-50 text-amber-700'
                        : 'bg-stone-100 text-stone-600'
                  }`}
                >
                  {STATUS_LABEL[doc.status] ?? doc.status}
                </span>
              </div>
              <p className="mt-0.5 truncate text-xs text-stone-500">{doc.partner}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
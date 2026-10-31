'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { KeyRound, Pencil, Plus, ShieldCheck, Trash2, UserCog, Users } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/components/auth/auth-provider';
import { apiFetch, ApiClientError } from '@/lib/api-client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DeleteConfirmDialog } from '@/components/master-data/delete-confirm-dialog';

interface RoleView {
  id: string;
  code: string;
  name: string;
  description: string | null;
  data_scope: 'all' | 'dept' | 'self';
  is_system: boolean;
  status: string;
  user_count: number;
  permissions: string[];
  created_at: string;
}

interface CatalogEntry {
  key: string;
  label: string;
  granularity: 'menu' | 'operation' | 'data' | 'field';
}

interface UserRoleView {
  user_id: string;
  username: string;
  display_name: string | null;
  builtin_role: string;
  dept: string | null;
  status: string;
  roles: Array<{ id: string; code: string; name: string }>;
}

const SCOPE_LABELS: Record<string, string> = { all: '全部数据', dept: '本部门', self: '仅本人' };
const BUILTIN_LABELS: Record<string, string> = { admin: '系统管理员', manager: '业务主管', staff: '业务员' };
const GRANULARITY_LABELS: Record<string, string> = { menu: '菜单级', operation: '操作级', data: '数据级', field: '字段级' };

export default function RolesPage() {
  const { can } = useAuth();
  const writable = can('sys.write');

  const [roles, setRoles] = useState<RoleView[]>([]);
  const [users, setUsers] = useState<UserRoleView[]>([]);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'roles' | 'users'>('roles');

  const [roleDialog, setRoleDialog] = useState<{ id: string | null; code: string; name: string; description: string; data_scope: string } | null>(null);
  const [permDialog, setPermDialog] = useState<{ role: RoleView; selected: Set<string> } | null>(null);
  const [assignDialog, setAssignDialog] = useState<{ user: UserRoleView; selected: Set<string> } | null>(null);
  const [deptDialog, setDeptDialog] = useState<{ user: UserRoleView; dept: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RoleView | null>(null);
  const [saving, setSaving] = useState(false);

  const customRoles = useMemo(() => roles.filter((r) => !r.is_system), [roles]);

  const reload = useCallback(async () => {
    try {
      const [roleData, userData] = await Promise.all([
        apiFetch<{ items: RoleView[] }>('/api/system/roles?pageSize=100'),
        apiFetch<{ items: UserRoleView[] }>('/api/system/users'),
      ]);
      setRoles(roleData.items);
      setUsers(userData.items);
      if (roleData.items.length > 0) {
        // 拉一次权限目录（任一角色详情返回统一 catalog）
        const detail = await apiFetch<{ catalog: CatalogEntry[] }>(`/api/system/roles/${roleData.items[0].id}/permissions`);
        setCatalog(detail.catalog);
      }
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const saveRole = async () => {
    if (!roleDialog) return;
    if (!roleDialog.name.trim()) {
      toast.error('角色名称不能为空');
      return;
    }
    if (!roleDialog.id && !roleDialog.code.trim()) {
      toast.error('角色编码不能为空');
      return;
    }
    setSaving(true);
    try {
      if (roleDialog.id) {
        await apiFetch(`/api/system/roles/${roleDialog.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: roleDialog.name.trim(),
            description: roleDialog.description || null,
            data_scope: roleDialog.data_scope,
          }),
        });
      } else {
        await apiFetch('/api/system/roles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: roleDialog.code.trim(),
            name: roleDialog.name.trim(),
            description: roleDialog.description || null,
            data_scope: roleDialog.data_scope,
          }),
        });
      }
      toast.success('角色已保存');
      setRoleDialog(null);
      await reload();
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const openPermDialog = async (role: RoleView) => {
    try {
      const detail = await apiFetch<{ permissions: string[]; catalog: CatalogEntry[] }>(`/api/system/roles/${role.id}/permissions`);
      setCatalog(detail.catalog);
      setPermDialog({ role, selected: new Set(detail.permissions) });
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : '加载权限失败');
    }
  };

  const savePermissions = async () => {
    if (!permDialog) return;
    setSaving(true);
    try {
      await apiFetch(`/api/system/roles/${permDialog.role.id}/permissions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissions: [...permDialog.selected] }),
      });
      toast.success('权限配置已保存');
      setPermDialog(null);
      await reload();
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const saveAssign = async () => {
    if (!assignDialog) return;
    setSaving(true);
    try {
      await apiFetch(`/api/system/users/${assignDialog.user.user_id}/roles`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role_ids: [...assignDialog.selected] }),
      });
      toast.success('角色分配已保存');
      setAssignDialog(null);
      await reload();
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const saveDept = async () => {
    if (!deptDialog) return;
    setSaving(true);
    try {
      await apiFetch(`/api/system/users/${deptDialog.user.user_id}/dept`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dept: deptDialog.dept || null }),
      });
      toast.success('部门已更新');
      setDeptDialog(null);
      await reload();
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const groupedCatalog = useMemo(() => {
    const groups = new Map<string, CatalogEntry[]>();
    for (const entry of catalog) {
      const list = groups.get(entry.granularity) ?? [];
      list.push(entry);
      groups.set(entry.granularity, list);
    }
    return ['menu', 'operation', 'field'].map((g) => ({ granularity: g, entries: groups.get(g) ?? [] }));
  }, [catalog]);

  const togglePerm = (key: string) => {
    setPermDialog((prev) => {
      if (!prev) return prev;
      const selected = new Set(prev.selected);
      if (selected.has(key)) selected.delete(key);
      else selected.add(key);
      return { ...prev, selected };
    });
  };

  if (loading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">角色与权限</h1>
          <p className="text-sm text-muted-foreground">四粒度权限：菜单级 / 操作级 / 数据级（数据范围）/ 字段级（敏感字段）</p>
        </div>
        <div className="flex gap-2">
          <Button variant={tab === 'roles' ? 'default' : 'outline'} onClick={() => setTab('roles')}>
            <ShieldCheck className="mr-2 h-4 w-4" /> 角色管理
          </Button>
          <Button variant={tab === 'users' ? 'default' : 'outline'} onClick={() => setTab('users')}>
            <Users className="mr-2 h-4 w-4" /> 用户分配
          </Button>
        </div>
      </div>

      {tab === 'roles' ? (
        <>
          <div className="flex justify-end">
            {writable && (
              <Button onClick={() => setRoleDialog({ id: null, code: '', name: '', description: '', data_scope: 'all' })}>
                <Plus className="mr-2 h-4 w-4" /> 新增角色
              </Button>
            )}
          </div>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>角色编码</TableHead>
                  <TableHead>名称</TableHead>
                  <TableHead>数据范围</TableHead>
                  <TableHead>类型</TableHead>
                  <TableHead>权限点数</TableHead>
                  <TableHead className="text-right">分配用户</TableHead>
                  <TableHead className="w-40">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {roles.map((role) => (
                  <TableRow key={role.id}>
                    <TableCell className="font-mono text-sm">{role.code}</TableCell>
                    <TableCell>
                      <div className="font-medium">{role.name}</div>
                      {role.description && <div className="text-xs text-muted-foreground">{role.description}</div>}
                    </TableCell>
                    <TableCell>
                      <Badge variant={role.data_scope === 'all' ? 'secondary' : 'default'}>{SCOPE_LABELS[role.data_scope]}</Badge>
                    </TableCell>
                    <TableCell>{role.is_system ? <Badge variant="outline">内置</Badge> : <Badge>自定义</Badge>}</TableCell>
                    <TableCell>{role.permissions.includes('*') ? '全部' : role.permissions.length}</TableCell>
                    <TableCell className="text-right">{role.user_count}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => void openPermDialog(role)} title="权限配置">
                          <KeyRound className="h-4 w-4" />
                        </Button>
                        {writable && !role.is_system && (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                setRoleDialog({
                                  id: role.id,
                                  code: role.code,
                                  name: role.name,
                                  description: role.description ?? '',
                                  data_scope: role.data_scope,
                                })
                              }
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(role)}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>用户名</TableHead>
                <TableHead>姓名</TableHead>
                <TableHead>内置角色</TableHead>
                <TableHead>部门</TableHead>
                <TableHead>自定义角色</TableHead>
                <TableHead className="w-32">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.user_id}>
                  <TableCell className="font-mono text-sm">{u.username}</TableCell>
                  <TableCell>{u.display_name ?? '-'}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{BUILTIN_LABELS[u.builtin_role] ?? u.builtin_role}</Badge>
                  </TableCell>
                  <TableCell>
                    <button
                      type="button"
                      className="text-sm underline-offset-2 hover:underline disabled:no-underline disabled:opacity-60"
                      disabled={!writable}
                      onClick={() => setDeptDialog({ user: u, dept: u.dept ?? '' })}
                    >
                      {u.dept ?? '未设置'}
                    </button>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {u.roles.length === 0 && <span className="text-xs text-muted-foreground">无</span>}
                      {u.roles.map((r) => (
                        <Badge key={r.id} variant="secondary">{r.name}</Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    {writable && (
                      <Button size="sm" variant="ghost" onClick={() => setAssignDialog({ user: u, selected: new Set(u.roles.map((r) => r.id)) })}>
                        <UserCog className="h-4 w-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* 角色新增/编辑 */}
      <Dialog open={!!roleDialog} onOpenChange={(open) => !open && setRoleDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{roleDialog?.id ? '编辑角色' : '新增角色'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {!roleDialog?.id && (
              <div className="space-y-2">
                <Label>角色编码</Label>
                <Input
                  value={roleDialog?.code ?? ''}
                  onChange={(e) => setRoleDialog((prev) => (prev ? { ...prev, code: e.target.value } : prev))}
                  placeholder="如 warehouse_lead（小写字母开头）"
                />
              </div>
            )}
            <div className="space-y-2">
              <Label>角色名称</Label>
              <Input
                value={roleDialog?.name ?? ''}
                onChange={(e) => setRoleDialog((prev) => (prev ? { ...prev, name: e.target.value } : prev))}
              />
            </div>
            <div className="space-y-2">
              <Label>数据范围（数据级粒度）</Label>
              <Select
                value={roleDialog?.data_scope ?? 'all'}
                onValueChange={(v) => setRoleDialog((prev) => (prev ? { ...prev, data_scope: v } : prev))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部数据</SelectItem>
                  <SelectItem value="dept">本部门</SelectItem>
                  <SelectItem value="self">仅本人</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">作用于采购订单/销售订单/费用报销等单据列表的可见范围</p>
            </div>
            <div className="space-y-2">
              <Label>描述</Label>
              <Input
                value={roleDialog?.description ?? ''}
                onChange={(e) => setRoleDialog((prev) => (prev ? { ...prev, description: e.target.value } : prev))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRoleDialog(null)}>取消</Button>
            <Button onClick={() => void saveRole()} disabled={saving}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 权限配置 */}
      <Dialog open={!!permDialog} onOpenChange={(open) => !open && setPermDialog(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>权限配置 - {permDialog?.role.name}</DialogTitle>
          </DialogHeader>
          {permDialog?.role.is_system ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">内置角色权限以系统定义为准，不可修改。当前权限点：</p>
              <div className="flex flex-wrap gap-1">
                {permDialog.role.permissions.includes('*') ? (
                  <Badge>全部权限</Badge>
                ) : (
                  permDialog.role.permissions.map((p) => (
                    <Badge key={p} variant="secondary" className="font-mono text-xs">{p}</Badge>
                  ))
                )}
              </div>
            </div>
          ) : (
            <div className="max-h-[60vh] space-y-5 overflow-y-auto pr-2">
              <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
                数据级粒度在角色上配置（数据范围：全部/本部门/仅本人），此处配置菜单级、操作级与字段级权限点。
              </div>
              {groupedCatalog.map((group) =>
                group.entries.length === 0 ? null : (
                  <div key={group.granularity} className="space-y-2">
                    <div className="text-sm font-semibold">{GRANULARITY_LABELS[group.granularity]}</div>
                    <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                      {group.entries.map((entry) => (
                        <label key={entry.key} className="flex items-center gap-2 rounded border p-2 text-sm">
                          <Checkbox
                            checked={permDialog?.selected.has(entry.key) ?? false}
                            onCheckedChange={() => togglePerm(entry.key)}
                            disabled={!writable}
                          />
                          <span>{entry.label}</span>
                          <span className="font-mono text-[10px] text-muted-foreground">{entry.key}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ),
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPermDialog(null)}>关闭</Button>
            {permDialog && !permDialog.role.is_system && writable && (
              <Button onClick={() => void savePermissions()} disabled={saving}>保存</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 用户角色分配 */}
      <Dialog open={!!assignDialog} onOpenChange={(open) => !open && setAssignDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>分配自定义角色 - {assignDialog?.user.display_name ?? assignDialog?.user.username}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              内置角色（{BUILTIN_LABELS[assignDialog?.user.builtin_role ?? ''] ?? assignDialog?.user.builtin_role}）在账号管理中维护；此处分配自定义角色，权限取并集。
            </p>
            {customRoles.length === 0 && <p className="text-sm text-muted-foreground">暂无自定义角色，请先在角色管理中创建。</p>}
            {customRoles.map((role) => (
              <label key={role.id} className="flex items-center gap-2 rounded border p-2 text-sm">
                <Checkbox
                  checked={assignDialog?.selected.has(role.id) ?? false}
                  onCheckedChange={() =>
                    setAssignDialog((prev) => {
                      if (!prev) return prev;
                      const selected = new Set(prev.selected);
                      if (selected.has(role.id)) selected.delete(role.id);
                      else selected.add(role.id);
                      return { ...prev, selected };
                    })
                  }
                />
                <span className="font-medium">{role.name}</span>
                <span className="font-mono text-xs text-muted-foreground">{role.code}</span>
                <Badge variant="outline" className="ml-auto">{SCOPE_LABELS[role.data_scope]}</Badge>
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignDialog(null)}>取消</Button>
            <Button onClick={() => void saveAssign()} disabled={saving}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 部门编辑 */}
      <Dialog open={!!deptDialog} onOpenChange={(open) => !open && setDeptDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>设置部门 - {deptDialog?.user.display_name ?? deptDialog?.user.username}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label>部门名称（留空为未设置）</Label>
            <Input
              value={deptDialog?.dept ?? ''}
              onChange={(e) => setDeptDialog((prev) => (prev ? { ...prev, dept: e.target.value } : prev))}
              placeholder="如 销售一部"
            />
            <p className="text-xs text-muted-foreground">数据范围为"本部门"的角色按此归属过滤单据</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeptDialog(null)}>取消</Button>
            <Button onClick={() => void saveDept()} disabled={saving}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeleteConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        endpoint={deleteTarget ? `/api/system/roles/${deleteTarget.id}` : null}
        name={deleteTarget?.name ?? ''}
        onDeleted={() => {
          setDeleteTarget(null);
          void reload();
        }}
      />
    </div>
  );
}

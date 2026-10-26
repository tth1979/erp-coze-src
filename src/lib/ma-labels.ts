/** 加工管理标签常量（独立模块，避免从页面文件具名导出破坏 Next 路由类型生成） */

export const MA_TYPE_LABELS: Record<string, string> = {
  cut: '切割',
  slot: '开槽',
  edge: '磨边',
  combine: '组合拼贴',
};

export const MA_STATUS_LABELS: Record<string, string> = {
  draft: '草稿',
  pending: '待审',
  approved: '已审',
  completed: '已完成',
  closed: '已关闭',
};
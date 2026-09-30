'use client';

import { AlertTriangle, ChevronLeft, Loader2, Trash2, X } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type DeleteScope = 'segment' | 'broadcast';

export interface DeleteBroadcastOption {
  /** 选项文字：删除本场直播（N 段，MM-DD HH:MM–HH:MM） */
  label: string;
  /** 时间范围 MM-DD HH:MM–HH:MM */
  rangeText: string;
  /** 将删除的文件名（选集中该整场的全部分段） */
  fileNames: string[];
  /** 整场总时长（有才显示） */
  durationText?: string;
  /** 补充说明（如 dyzb 统计段数与选集段数不一致） */
  note?: string;
}

interface DeleteEpisodeDialogProps {
  isOpen: boolean;
  /** 主播名（文件夹标题） */
  anchorName: string;
  /** 分集标题 */
  episodeTitle: string;
  /** 当前分段完整文件名 */
  fileName: string;
  /** 整场删除选项；不可用时为 null（配合 broadcastDisabledReason 显示原因） */
  broadcast: DeleteBroadcastOption | null;
  broadcastDisabledReason: string | null;
  /** 仅用于不可用时的按钮文字 */
  broadcastFallbackLabel: string;
  isDeleting: boolean;
  error: string | null;
  /** 整场删除中失败的文件 */
  failedFiles?: { name: string; error: string }[];
  onConfirm: (scope: DeleteScope) => void;
  onCancel: () => void;
}

/**
 * 播放页删除弹窗：先选「删除本分段 / 删除本场直播」，再二次确认
 * - 每一步默认焦点都在「取消」；Esc / 点遮罩关闭（删除中不可关闭）
 * - 弹窗打开期间拦截键盘事件，避免触发播放器快捷键
 */
export default function DeleteEpisodeDialog({
  isOpen,
  anchorName,
  episodeTitle,
  fileName,
  broadcast,
  broadcastDisabledReason,
  broadcastFallbackLabel,
  isDeleting,
  error,
  failedFiles,
  onConfirm,
  onCancel,
}: DeleteEpisodeDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const isDeletingRef = useRef(isDeleting);
  const onCancelRef = useRef(onCancel);
  isDeletingRef.current = isDeleting;
  onCancelRef.current = onCancel;

  // null = 选择删除范围；否则为二次确认步骤
  const [scope, setScope] = useState<DeleteScope | null>(null);

  // 关闭时回到「选择范围」步骤，下次打开从头开始
  useEffect(() => {
    if (!isOpen) setScope(null);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    const handleKeyDown = (e: KeyboardEvent) => {
      // 捕获阶段拦截，播放页/播放器的全局快捷键不再收到事件；按钮激活、Tab 等默认行为不受影响
      e.stopPropagation();

      if (e.key === 'Escape') {
        e.preventDefault();
        if (!isDeletingRef.current) onCancelRef.current();
        return;
      }

      // 简单焦点陷阱：Tab 在弹窗内循环
      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(
            'button:not([disabled])'
          )
        );
        if (focusable.length === 0) {
          e.preventDefault();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && (active === first || !dialogRef.current.contains(active))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (active === last || !dialogRef.current.contains(active))) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      previouslyFocused?.focus?.();
    };
  }, [isOpen]);

  // 每一步都把焦点放回「取消」（须在上面记录 previouslyFocused 之后执行）
  useEffect(() => {
    if (isOpen) cancelButtonRef.current?.focus();
  }, [isOpen, scope]);

  if (!isOpen || typeof document === 'undefined') return null;

  const title =
    scope === 'segment'
      ? '删除本分段'
      : scope === 'broadcast'
        ? '删除本场直播'
        : '删除';

  const infoRow = (label: string, value: ReactNode, mono = false) => (
    <div className='flex gap-2'>
      <dt className='flex-shrink-0 w-12 text-gray-500 dark:text-gray-400'>{label}</dt>
      <dd
        className={`flex-1 min-w-0 break-words ${mono
          ? 'font-mono text-xs leading-5 text-gray-700 dark:text-gray-300 break-all'
          : 'text-gray-900 dark:text-gray-100'
          }`}
      >
        {value}
      </dd>
    </div>
  );

  return createPortal(
    <div className='fixed inset-0 z-[10000] flex items-center justify-center p-4'>
      <div
        className='absolute inset-0 bg-black/60 backdrop-blur-sm'
        onClick={() => {
          if (!isDeleting) onCancel();
        }}
        aria-hidden='true'
      />
      <div
        ref={dialogRef}
        role='alertdialog'
        aria-modal='true'
        aria-labelledby='delete-episode-dialog-title'
        aria-describedby='delete-episode-dialog-desc'
        className='relative w-full max-w-md max-h-[90vh] flex flex-col bg-white dark:bg-gray-900 rounded-2xl shadow-2xl overflow-hidden'
      >
        {/* Header */}
        <div className='flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700 flex-shrink-0'>
          <div className='flex items-center gap-3'>
            <AlertTriangle className='w-6 h-6 text-red-500' aria-hidden='true' />
            <h2
              id='delete-episode-dialog-title'
              className='text-lg font-semibold text-gray-800 dark:text-gray-200'
            >
              {title}
            </h2>
          </div>
          <button
            type='button'
            onClick={onCancel}
            disabled={isDeleting}
            aria-label='关闭'
            className='p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
          >
            <X className='w-5 h-5 text-gray-600 dark:text-gray-400' />
          </button>
        </div>

        {/* Content */}
        <div id='delete-episode-dialog-desc' className='p-4 space-y-3 overflow-y-auto min-h-0'>
          {scope === null && (
            <>
              <dl className='text-sm space-y-2'>
                {infoRow('主播', <span className='font-medium'>{anchorName}</span>)}
                {infoRow('分集', episodeTitle)}
                {infoRow('文件', fileName, true)}
              </dl>
              <div className='space-y-2 pt-1' role='group' aria-label='选择删除范围'>
                <button
                  type='button'
                  onClick={() => setScope('segment')}
                  className='w-full min-h-[48px] text-left px-4 py-3 rounded-xl border border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors'
                >
                  <div className='font-medium'>删除本分段</div>
                  <div className='text-xs text-gray-500 dark:text-gray-400 mt-0.5'>
                    只删除当前这个文件
                  </div>
                </button>
                <button
                  type='button'
                  onClick={() => broadcast && setScope('broadcast')}
                  disabled={!broadcast}
                  aria-describedby={
                    !broadcast && broadcastDisabledReason
                      ? 'delete-broadcast-disabled-reason'
                      : undefined
                  }
                  className='w-full min-h-[48px] text-left px-4 py-3 rounded-xl border border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors disabled:border-gray-200 disabled:text-gray-400 disabled:bg-gray-50 dark:disabled:border-gray-700 dark:disabled:text-gray-500 dark:disabled:bg-gray-800/50 disabled:cursor-not-allowed disabled:hover:bg-gray-50'
                >
                  <div className='font-medium'>
                    {broadcast ? broadcast.label : broadcastFallbackLabel}
                  </div>
                  {broadcast ? (
                    <div className='text-xs text-gray-500 dark:text-gray-400 mt-0.5'>
                      删除该整场的全部分段
                    </div>
                  ) : (
                    broadcastDisabledReason && (
                      <div
                        id='delete-broadcast-disabled-reason'
                        className='text-xs text-amber-600 dark:text-amber-400 mt-0.5'
                      >
                        {broadcastDisabledReason}
                      </div>
                    )
                  )}
                </button>
              </div>
            </>
          )}

          {scope === 'segment' && (
            <>
              <dl className='text-sm space-y-2'>
                {infoRow('主播', <span className='font-medium'>{anchorName}</span>)}
                {infoRow('分集', episodeTitle)}
                {infoRow('文件', fileName, true)}
              </dl>
              <p className='text-sm font-medium text-red-600 dark:text-red-400'>
                将从 OpenList（沃盘）永久删除该文件，无法撤销
              </p>
            </>
          )}

          {scope === 'broadcast' && broadcast && (
            <>
              <dl className='text-sm space-y-2'>
                {infoRow('主播', <span className='font-medium'>{anchorName}</span>)}
                {broadcast.rangeText && infoRow('场次', broadcast.rangeText)}
                {infoRow('段数', `${broadcast.fileNames.length} 段`)}
                {broadcast.durationText && infoRow('时长', broadcast.durationText)}
              </dl>
              {broadcast.note && (
                <p className='text-xs text-gray-500 dark:text-gray-400'>{broadcast.note}</p>
              )}
              <p className='text-sm font-medium text-red-600 dark:text-red-400'>
                将从 OpenList（沃盘）永久删除以下 {broadcast.fileNames.length} 个文件，无法撤销
              </p>
              <ul
                className='max-h-48 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-800'
                aria-label='将删除的文件'
                tabIndex={0}
              >
                {broadcast.fileNames.map((name) => (
                  <li
                    key={name}
                    className='px-3 py-1.5 font-mono text-xs leading-5 text-gray-700 dark:text-gray-300 break-all'
                  >
                    {name}
                  </li>
                ))}
              </ul>
            </>
          )}

          {error && (
            <div
              role='alert'
              className='text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2 whitespace-pre-wrap break-words'
            >
              删除失败：{error}
              {failedFiles && failedFiles.length > 0 && (
                <ul className='mt-2 space-y-1'>
                  {failedFiles.map((f) => (
                    <li key={f.name} className='font-mono text-xs break-all'>
                      {f.name}：{f.error}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className='flex items-center gap-3 p-4 border-t border-gray-200 dark:border-gray-700 flex-shrink-0'>
          {scope !== null && (
            <button
              type='button'
              onClick={() => setScope(null)}
              disabled={isDeleting}
              className='inline-flex items-center gap-0.5 px-2 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
            >
              <ChevronLeft className='w-4 h-4' aria-hidden='true' />
              返回
            </button>
          )}
          <div className='flex-1' />
          <button
            ref={cancelButtonRef}
            type='button'
            onClick={onCancel}
            disabled={isDeleting}
            className='px-4 py-2 min-h-[40px] text-sm text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
          >
            取消
          </button>
          {scope !== null && (
            <button
              type='button'
              onClick={() => onConfirm(scope)}
              disabled={isDeleting}
              className='inline-flex items-center gap-1.5 px-4 py-2 min-h-[40px] text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed'
            >
              {isDeleting ? (
                <>
                  <Loader2 className='w-4 h-4 animate-spin' aria-hidden='true' />
                  删除中…
                </>
              ) : (
                <>
                  <Trash2 className='w-4 h-4' aria-hidden='true' />
                  {scope === 'broadcast' ? '确认删除整场' : '确认删除'}
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

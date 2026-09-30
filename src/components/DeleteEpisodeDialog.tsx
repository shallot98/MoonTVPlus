'use client';

import { AlertTriangle, Loader2, Trash2, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

interface DeleteEpisodeDialogProps {
  isOpen: boolean;
  /** 主播名（文件夹标题） */
  anchorName: string;
  /** 分集标题 */
  episodeTitle: string;
  /** 完整文件名 */
  fileName: string;
  isDeleting: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * 播放页「删除本集」二次确认弹窗
 * - 默认焦点在「取消」；Esc / 点遮罩关闭（删除中不可关闭）
 * - 弹窗打开期间拦截键盘事件，避免触发播放器快捷键
 */
export default function DeleteEpisodeDialog({
  isOpen,
  anchorName,
  episodeTitle,
  fileName,
  isDeleting,
  error,
  onConfirm,
  onCancel,
}: DeleteEpisodeDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const isDeletingRef = useRef(isDeleting);
  const onCancelRef = useRef(onCancel);
  isDeletingRef.current = isDeleting;
  onCancelRef.current = onCancel;

  useEffect(() => {
    if (!isOpen) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    cancelButtonRef.current?.focus();

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

  if (!isOpen || typeof document === 'undefined') return null;

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
        className='relative w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl shadow-2xl overflow-hidden'
      >
        {/* Header */}
        <div className='flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700'>
          <div className='flex items-center gap-3'>
            <AlertTriangle className='w-6 h-6 text-red-500' aria-hidden='true' />
            <h2
              id='delete-episode-dialog-title'
              className='text-lg font-semibold text-gray-800 dark:text-gray-200'
            >
              删除本集
            </h2>
          </div>
          <button
            type='button'
            onClick={onCancel}
            disabled={isDeleting}
            aria-label='关闭'
            className='p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
          >
            <X className='w-5 h-5 text-gray-600 dark:text-gray-400' />
          </button>
        </div>

        {/* Content */}
        <div id='delete-episode-dialog-desc' className='p-4 space-y-3'>
          <dl className='text-sm space-y-2'>
            <div className='flex gap-2'>
              <dt className='flex-shrink-0 w-12 text-gray-500 dark:text-gray-400'>主播</dt>
              <dd className='flex-1 min-w-0 text-gray-900 dark:text-gray-100 font-medium break-words'>
                {anchorName}
              </dd>
            </div>
            <div className='flex gap-2'>
              <dt className='flex-shrink-0 w-12 text-gray-500 dark:text-gray-400'>分集</dt>
              <dd className='flex-1 min-w-0 text-gray-900 dark:text-gray-100 break-words'>
                {episodeTitle}
              </dd>
            </div>
            <div className='flex gap-2'>
              <dt className='flex-shrink-0 w-12 text-gray-500 dark:text-gray-400'>文件</dt>
              <dd className='flex-1 min-w-0 font-mono text-xs leading-5 text-gray-700 dark:text-gray-300 break-all'>
                {fileName}
              </dd>
            </div>
          </dl>
          <p className='text-sm font-medium text-red-600 dark:text-red-400'>
            将从 OpenList（沃盘）永久删除该文件，无法撤销
          </p>
          {error && (
            <div
              role='alert'
              className='text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2 whitespace-pre-wrap break-words'
            >
              删除失败：{error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className='flex items-center justify-end gap-3 p-4 border-t border-gray-200 dark:border-gray-700'>
          <button
            ref={cancelButtonRef}
            type='button'
            onClick={onCancel}
            disabled={isDeleting}
            className='px-4 py-2 text-sm text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
          >
            取消
          </button>
          <button
            type='button'
            onClick={onConfirm}
            disabled={isDeleting}
            className='inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed'
          >
            {isDeleting ? (
              <>
                <Loader2 className='w-4 h-4 animate-spin' aria-hidden='true' />
                删除中…
              </>
            ) : (
              <>
                <Trash2 className='w-4 h-4' aria-hidden='true' />
                确认删除
              </>
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

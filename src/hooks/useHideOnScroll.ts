'use client';

import { useEffect, useRef, useState } from 'react';

interface UseHideOnScrollOptions {
  /** 为 false 时始终显示（并停止监听） */
  enabled?: boolean;
  /** 同方向累计滚动超过该距离才切换，防抖动 */
  threshold?: number;
  /** 距顶部不超过该距离时一定显示 */
  topOffset?: number;
}

/** 本项目的滚动容器是 document.body（html/body height:100% + overflow-x:hidden），兼容 window 滚动 */
function getScrollTop(): number {
  return Math.max(
    window.scrollY || 0,
    document.documentElement.scrollTop || 0,
    document.body.scrollTop || 0
  );
}

function getMaxScrollTop(): number {
  const body = document.body;
  const root = document.documentElement;
  return Math.max(
    body.scrollHeight - body.clientHeight,
    root.scrollHeight - window.innerHeight,
    0
  );
}

/**
 * 上滑（内容向下滚动）隐藏、下滑（向上滚动）出现。
 * passive scroll + requestAnimationFrame 节流；回到顶部一定显示。
 */
export function useHideOnScroll({
  enabled = true,
  threshold = 8,
  topOffset = 48,
}: UseHideOnScrollOptions = {}): boolean {
  const [hidden, setHidden] = useState(false);
  const hiddenRef = useRef(false);

  useEffect(() => {
    const apply = (next: boolean) => {
      if (hiddenRef.current === next) return;
      hiddenRef.current = next;
      setHidden(next);
    };

    if (!enabled) {
      apply(false);
      return;
    }

    let lastY = getScrollTop();
    let rafId = 0;

    const update = () => {
      rafId = 0;
      // 夹到 [0, max]，避免 iOS 回弹时的越界值造成反向抖动
      const y = Math.min(Math.max(getScrollTop(), 0), getMaxScrollTop());
      if (y <= topOffset) {
        apply(false);
        lastY = y;
        return;
      }
      const delta = y - lastY;
      if (Math.abs(delta) < threshold) return; // 未达阈值：不更新 lastY，继续累计
      apply(delta > 0);
      lastY = y;
    };

    const onScroll = () => {
      if (!rafId) rafId = window.requestAnimationFrame(update);
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    document.body.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      document.body.removeEventListener('scroll', onScroll);
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [enabled, threshold, topOffset]);

  return hidden;
}

export default useHideOnScroll;

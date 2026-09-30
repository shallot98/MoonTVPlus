'use client';

import { useRouter } from 'next/navigation';
import { type CSSProperties, useEffect, useState } from 'react';

import { useHideOnScroll } from '@/hooks/useHideOnScroll';

import { BackButton } from './BackButton';
import MobileBottomNav from './MobileBottomNav';
import MobileHeader from './MobileHeader';
import Sidebar from './Sidebar';
import { ThemeToggle } from './ThemeToggle';
import { UpdateNotification } from './UpdateNotification';
import { UserMenu } from './UserMenu';
import { VersionCheckProvider } from './VersionCheckProvider';

interface PageLayoutProps {
  children: React.ReactNode;
  activePath?: string;
  hideNavigation?: boolean; // 控制是否隐藏顶部和底部导航栏
}

const PageLayout = ({ children, activePath = '/', hideNavigation = false }: PageLayoutProps) => {
  const router = useRouter();
  const [backgroundImage, setBackgroundImage] = useState('');
  const isPlayPage = activePath === '/play';
  const shouldShowSharedBackground = !hideNavigation && !isPlayPage;
  // 移动端顶栏/底栏：上滑隐藏、下滑出现（md:hidden，桌面不受影响）
  const navHidden = useHideOnScroll({ enabled: !hideNavigation });

  useEffect(() => {
    router.prefetch('/search');
    router.prefetch('/play');
  }, [router]);

  useEffect(() => {
    if (typeof window === 'undefined' || !shouldShowSharedBackground) {
      setBackgroundImage('');
      return;
    }

    const homeBg = (
      window as Window & {
        RUNTIME_CONFIG?: {
          HOME_BACKGROUND_IMAGE?: string;
        };
      }
    ).RUNTIME_CONFIG?.HOME_BACKGROUND_IMAGE;
    if (!homeBg) {
      setBackgroundImage('');
      return;
    }

    const urls = homeBg
      .split('\n')
      .map((url: string) => url.trim())
      .filter((url: string) => url !== '');

    if (urls.length === 0) {
      setBackgroundImage('');
      return;
    }

    const randomIndex = Math.floor(Math.random() * urls.length);
    setBackgroundImage(urls[randomIndex]);
  }, [shouldShowSharedBackground]);

  return (
    <VersionCheckProvider>
      <div
        // 播放页用 overflow-x-clip：overflow-hidden 会成为滚动容器，导致播放器 sticky 失效
        className={`relative w-full min-h-screen ${isPlayPage ? 'overflow-x-clip' : 'overflow-hidden'}`}
        // 顶栏当前占用高度，供播放页 sticky 播放器定位（见 globals.css .play-sticky-player）
        style={
          {
            '--mobile-header-offset': !hideNavigation && !navHidden ? '3rem' : '0px',
          } as CSSProperties
        }
      >
        {shouldShowSharedBackground && backgroundImage && (
          <>
            <div
              className='absolute inset-0 pointer-events-none bg-cover bg-center bg-no-repeat opacity-45'
              style={{ backgroundImage: `url(${backgroundImage})` }}
            />
            <div className='absolute inset-0 pointer-events-none bg-white/50 dark:bg-gray-950/50' />
          </>
        )}

        {/* 移动端头部 */}
        {!hideNavigation && (
          <MobileHeader
            showBackButton={['/play', '/live'].includes(activePath)}
            hidden={navHidden}
          />
        )}

        {/* 主要布局容器 */}
        <div className='relative z-10 flex md:grid md:grid-cols-[auto_1fr] w-full min-h-screen md:min-h-auto'>
          {/* 侧边栏 - 桌面端显示，移动端隐藏 */}
          {!hideNavigation && (
            <div className='hidden md:block'>
              <Sidebar activePath={activePath} />
            </div>
          )}

          {/* 主内容区域 */}
          <div className='relative min-w-0 flex-1 transition-all duration-300'>
            {/* 桌面端左上角返回按钮 */}
            {!hideNavigation && ['/play', '/live'].includes(activePath) && (
              <div className='absolute top-3 left-1 z-20 hidden md:flex'>
                <BackButton />
              </div>
            )}

            {/* 桌面端顶部按钮 */}
            {!hideNavigation && (
              <div className='absolute top-2 right-4 z-20 hidden md:flex items-center gap-2'>
                <ThemeToggle />
                <UserMenu />
                <UpdateNotification />
              </div>
            )}

            {/* 主内容 */}
            <main
              className={`flex-1 md:min-h-0 md:mb-0 md:mt-0 mt-[calc(3rem+env(safe-area-inset-top))] ${
                isPlayPage ? '' : 'mb-14'
              }`}
              style={{
                // 播放页移动端不显示底栏，只留安全区
                paddingBottom: isPlayPage
                  ? 'env(safe-area-inset-bottom)'
                  : 'calc(3.5rem + env(safe-area-inset-bottom))',
              }}
            >
              {children}
            </main>
          </div>
        </div>

        {/* 移动端底部导航 */}
        {!hideNavigation && !isPlayPage && (
          <div className='md:hidden'>
            <MobileBottomNav activePath={activePath} hidden={navHidden} />
          </div>
        )}
      </div>
    </VersionCheckProvider>
  );
};

export default PageLayout;

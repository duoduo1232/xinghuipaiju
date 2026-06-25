import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.pixelcard.duel',
  appName: '星辉牌局',
  webDir: 'dist',
  server: {
    // 用 http 方案加载本地页面，这样页面内可直接连 ws:// 与 http:// 的联机服务器和排行榜，
    // 不会被 https 页面的混合内容策略拦截。
    androidScheme: 'http',
    cleartext: true,
  },
};

export default config;

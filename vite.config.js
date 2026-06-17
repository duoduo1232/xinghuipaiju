import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  // 👇 新增 server 配置
  server: {
    host: '0.0.0.0',   // 监听所有网络接口，允许局域网设备访问
    port: 5173,         // 指定端口（可改成你想要的，比如 3000）
    strictPort: false,  // 如果端口被占用，自动尝试下一个端口（设为 true 则会报错）
  },
});
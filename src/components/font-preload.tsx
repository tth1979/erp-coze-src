'use client';

import ReactDOM from 'react-dom';

/** 字体资源加载时序优化（CN 域，避免跨境链路） */
export function FontPreload() {
  ReactDOM.preconnect('https://fonts.googleapis.cn');
  ReactDOM.preconnect('https://fonts.gstatic.cn', { crossOrigin: 'anonymous' });
  return null;
}

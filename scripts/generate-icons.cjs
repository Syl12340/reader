/**
 * 生成 Tauri 应用图标
 * 运行: node scripts/generate-icons.js
 */

const fs = require('fs');
const path = require('path');

// 创建简单的 SVG 图标
const svgIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <defs>
    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#4F46E5;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#7C3AED;stop-opacity:1" />
    </linearGradient>
  </defs>
  <rect width="128" height="128" rx="20" fill="url(#grad)"/>
  <text x="64" y="75" font-family="Arial, sans-serif" font-size="60" font-weight="bold" fill="white" text-anchor="middle">R</text>
  <text x="64" y="105" font-family="Arial, sans-serif" font-size="16" fill="rgba(255,255,255,0.8)" text-anchor="middle">Reader</text>
</svg>`;

// 图标尺寸
const sizes = [
  { name: '32x32.png', size: 32 },
  { name: '128x128.png', size: 128 },
  { name: '128x128@2x.png', size: 256 },
  { name: 'icon.png', size: 512 },
];

// 创建 icons 目录
const iconsDir = path.join(__dirname, '..', 'src-tauri', 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

// 保存 SVG
fs.writeFileSync(path.join(iconsDir, 'icon.svg'), svgIcon);
console.log('Created icon.svg');

// 注意：PNG 和 ICO 文件需要图像处理库
// 这里我们创建一个简单的说明文件
const readme = `# Tauri 图标说明

## 需要的图标文件

1. 32x32.png - 32x32 像素 PNG
2. 128x128.png - 128x128 像素 PNG
3. 128x128@2x.png - 256x256 像素 PNG (Retina)
4. icon.png - 512x512 像素 PNG
5. icon.ico - Windows ICO 格式
6. icon.icns - macOS ICNS 格式

## 生成方法

### 方法 1: 使用 Tauri CLI (推荐)
\`\`\`bash
pnpm tauri icon src-tauri/icons/icon.svg
\`\`\`

### 方法 2: 使用在线工具
1. 访问 https://convertio.co/png-ico/
2. 上传 icon.png
3. 转换为 ICO 格式

### 方法 3: 使用 Node.js 脚本
\`\`\`bash
npm install sharp
node scripts/convert-icons.js
\`\`\`

## 当前状态

已创建 SVG 源文件: icon.svg
需要转换为其他格式。
`;

fs.writeFileSync(path.join(iconsDir, 'README.md'), readme);
console.log('Created README.md');

console.log('\n图标目录已创建:', iconsDir);
console.log('请运行以下命令生成 PNG/ICO/ICNS 文件:');
console.log('  pnpm tauri icon src-tauri/icons/icon.svg');

# Tauri 图标说明

## 需要的图标文件

1. 32x32.png - 32x32 像素 PNG
2. 128x128.png - 128x128 像素 PNG
3. 128x128@2x.png - 256x256 像素 PNG (Retina)
4. icon.png - 512x512 像素 PNG
5. icon.ico - Windows ICO 格式
6. icon.icns - macOS ICNS 格式

## 生成方法

### 方法 1: 使用 Tauri CLI (推荐)
```bash
pnpm tauri icon src-tauri/icons/icon.svg
```

### 方法 2: 使用在线工具
1. 访问 https://convertio.co/png-ico/
2. 上传 icon.png
3. 转换为 ICO 格式

### 方法 3: 使用 Node.js 脚本
```bash
npm install sharp
node scripts/convert-icons.js
```

## 当前状态

已创建 SVG 源文件: icon.svg
需要转换为其他格式。

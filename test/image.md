# 图片测试

## 网络图片

### Tauri Logo
![Tauri Logo](https://tauri.app/meta/favicon-96x96.png)

### GitHub Logo
![GitHub Logo](https://github.githubassets.com/favicons/favicon.svg)

### 示例图片
![示例图片](https://picsum.photos/400/300)

---

## 本地图片（Tauri 模式）

> 注意：以下图片路径仅在 Tauri 模式下有效。
> 浏览器模式不支持本地文件访问。

### 绝对路径（Windows）
![Windows 绝对路径](D:\Shaoyilei\Desktop\test-image.png)

### 相对路径
![相对路径](./test-image.png)

### 上级目录
![上级目录](../test-image.png)

---

## 图片加载测试

### 正常加载
正常加载的图片应该显示完整，并有淡入动画。

### 加载失败
![不存在的图片](./nonexistent.png)

加载失败的图片应该显示为半透明，并显示"图片加载失败"提示。

### 懒加载
下面的图片应该在滚动到可见区域时才开始加载：

![懒加载图片 1](https://picsum.photos/400/200?random=1)

![懒加载图片 2](https://picsum.photos/400/200?random=2)

![懒加载图片 3](https://picsum.photos/400/200?random=3)

---

## 图片样式测试

### 圆角
图片应该有圆角效果。

### 阴影
图片应该有轻微的阴影效果。

### 响应式
图片应该自适应容器宽度，最大宽度为 100%。

---

## 混合内容

这是一段文字，中间包含一张图片 ![行内图片](https://picsum.photos/50/50) 继续文字。

这是另一段文字，图片在下方：

![块级图片](https://picsum.photos/600/200)

图片后面的文字。
